import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { postMessage, addReaction, removeReaction } from './slack-client';
import { stripBotMention, isExplicitConfirmation } from './confirmation';

const ENGAGED_TTL_SECONDS = 24 * 60 * 60;
const ENGAGED_REPLY_SNIPPET_CHARS = 600;

const ddb = new DynamoDBClient({});

const THINKING_REACTION = 'hourglass_flowing_sand';
const DONE_REACTION = 'white_check_mark';
const ERROR_REACTION = 'x';

const secrets = new SecretsManagerClient({});
const agentCore = new BedrockAgentCoreClient({});

let cachedBotToken: string | undefined;

async function getBotToken(): Promise<string> {
  if (cachedBotToken) return cachedBotToken;
  const arn = process.env.SLACK_BOT_TOKEN_ARN;
  if (!arn) throw new Error('SLACK_BOT_TOKEN_ARN env var is not set');
  const resp = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!resp.SecretString) throw new Error('Bot token value is empty');
  cachedBotToken = resp.SecretString;
  return cachedBotToken;
}

interface SlackEventEnvelope {
  type: 'event_callback' | string;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}

function isAdminUser(userId: string): boolean {
  const raw = process.env.ADMIN_SLACK_USERS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

/** Runtime requires runtimeSessionId >= 33 chars. thread_ts is ~17, pad. */
function asRuntimeSessionId(threadTs: string): string {
  const base = `slack-thread-${threadTs}`;
  return base.length >= 33 ? base : base.padEnd(33, '0');
}

/**
 * Slack-bridge Lambda — SQS consumer. Pulls events queued by the
 * verification Lambda, invokes AgentCore Runtime, posts the reply back
 * to the thread. Reaction lifecycle (hourglass -> check or x) gives the
 * user immediate feedback even though the model call is non-trivial.
 *
 * Intentionally thin — no Bedrock client, no session store, no tools.
 * All of that lives inside the agent container.
 */
async function processRecord(record: SQSRecord, botToken: string): Promise<void> {
  const parsed = JSON.parse(record.body) as SlackEventEnvelope;
  if (parsed.type !== 'event_callback' || parsed.event?.type !== 'app_mention') return;

  const channel = parsed.event.channel;
  const userId = parsed.event.user;
  const rawText = parsed.event.text ?? '';
  const threadTs = parsed.event.thread_ts ?? parsed.event.ts;
  if (!channel || !threadTs || !userId) return;

  const userText = stripBotMention(rawText);
  if (!userText) return;

  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  if (!runtimeArn) throw new Error('AGENT_RUNTIME_ARN env var is not set');

  // React to the user's own message as a working indicator. No
  // notification fires; the user just sees the hourglass land.
  const userMessageTs = parsed.event.ts;
  if (userMessageTs) {
    await addReaction({ botToken, channel, ts: userMessageTs, name: THINKING_REACTION }).catch(
      () => undefined,
    );
  }

  const swapReaction = async (finalName: string): Promise<void> => {
    if (!userMessageTs) return;
    await Promise.all([
      removeReaction({ botToken, channel, ts: userMessageTs, name: THINKING_REACTION }).catch(
        () => undefined,
      ),
      addReaction({ botToken, channel, ts: userMessageTs, name: finalName }).catch(
        () => undefined,
      ),
    ]);
  };

  // Canonical runtime payload. Optional fields let the agent know who's
  // talking and from where without baking Slack-specific concepts into
  // the runtime contract — same shape works for webhook adapter, MCP-stdio,
  // etc. destructive_confirmed gates tools tagged destructive in their
  // manifest; the strict text match here is the only path today —
  // approver-reaction confirmation is a later phase.
  const payload = {
    prompt: userText,
    thread_id: threadTs,
    scope: channel,
    principal_id: userId,
    is_admin: isAdminUser(userId),
    adapter: 'slack',
    destructive_confirmed: isExplicitConfirmation(userText),
  };

  let replyText = '';
  try {
    const resp = await agentCore.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: asRuntimeSessionId(threadTs),
        qualifier: 'DEFAULT',
        contentType: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    const responseBytes = resp.response;
    if (!responseBytes) throw new Error('Runtime response body was empty');
    const responseText = await responseBytes.transformToString();
    try {
      replyText = (JSON.parse(responseText) as { text?: string }).text ?? '';
    } catch {
      replyText = responseText;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await swapReaction(ERROR_REACTION);
    await postMessage({
      botToken,
      channel,
      text: `⚠️ _Tobot Agent hit an error:_ \`${msg}\``,
      threadTs,
    });
    throw err;
  }

  if (!replyText) replyText = '_(no response)_';
  await postMessage({ botToken, channel, text: replyText, threadTs });
  await swapReaction(DONE_REACTION);

  // Mark the thread as engaged so the verification Lambda will accept
  // non-mention follow-ups (subject to the classifier). Store a
  // truncated snippet of this reply so the classifier has context.
  // Engagement is recorded only after a successful reply so a failed
  // turn doesn't open the floodgates on a half-broken thread.
  await recordEngagement(threadTs, replyText).catch((err) => {
    console.warn(
      'failed to record thread engagement (non-fatal):',
      err instanceof Error ? err.message : String(err),
    );
  });
}

async function recordEngagement(threadTs: string, replyText: string): Promise<void> {
  const table = process.env.ENGAGED_THREADS_TABLE_NAME;
  if (!table) return; // table not configured — feature off, drop quietly
  const snippet =
    replyText.length > ENGAGED_REPLY_SNIPPET_CHARS
      ? replyText.slice(0, ENGAGED_REPLY_SNIPPET_CHARS) + '…'
      : replyText;
  const expiresAt = Math.floor(Date.now() / 1000) + ENGAGED_TTL_SECONDS;
  await ddb.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        thread_ts: { S: threadTs },
        last_bot_reply: { S: snippet },
        expires_at: { N: String(expiresAt) },
      },
    }),
  );
}

export async function handler(event: SQSEvent): Promise<void> {
  const botToken = await getBotToken();
  for (const record of event.Records) {
    await processRecord(record, botToken);
  }
}
