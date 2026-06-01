import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { verifySlackSignature } from './slack-signature';
import { isAdmin, isAllowlisted } from './allowlist-check';
import { getEngagement } from './engaged-threads';
import { isAddressedToBot } from './engagement-classifier';
import { chooseRoute } from './routing';

const sqs = new SQSClient({});
const secrets = new SecretsManagerClient({});

let cachedSigningSecret: string | undefined;

async function getSigningSecret(): Promise<string> {
  if (cachedSigningSecret) return cachedSigningSecret;
  const arn = process.env.SLACK_SIGNING_SECRET_ARN;
  if (!arn) throw new Error('SLACK_SIGNING_SECRET_ARN env var is not set');
  const resp = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!resp.SecretString) throw new Error('Signing secret value is empty');
  cachedSigningSecret = resp.SecretString;
  return cachedSigningSecret;
}

interface SlackEventEnvelope {
  type: 'url_verification' | 'event_callback' | string;
  challenge?: string;
  event?: {
    type: string;
    subtype?: string;
    user?: string;
    bot_id?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  };
}

/**
 * Verification Lambda — Slack's front door into Tobot Agent.
 *
 * Two routing paths:
 *
 * 1. app_mention: explicit @-bot. Always queues after allowlist gate.
 *
 * 2. message in a thread: only queues if the bot is engaged in that
 *    thread AND a Haiku classifier judges the message is addressed
 *    to the bot. This lets users follow up with the bot in a thread
 *    without re-@-mentioning it every turn, but avoids picking up
 *    human side-conversation that happens to live in the same thread.
 *
 * Bot's own messages (bot_id set) are always dropped to prevent loops.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = event.body;
  if (!body) return { statusCode: 400, body: 'missing body' };

  const timestamp = event.headers['x-slack-request-timestamp'] ?? '';
  const signature = event.headers['x-slack-signature'] ?? '';
  const signingSecret = await getSigningSecret();

  const verdict = verifySlackSignature({ body, timestamp, signature, signingSecret });
  if (!verdict.valid) {
    return { statusCode: 401, body: verdict.reason ?? 'invalid signature' };
  }

  let parsed: SlackEventEnvelope;
  try {
    parsed = JSON.parse(body) as SlackEventEnvelope;
  } catch {
    return { statusCode: 400, body: 'invalid json' };
  }

  if (parsed.type === 'url_verification' && parsed.challenge) {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: parsed.challenge }),
    };
  }

  if (parsed.type !== 'event_callback' || !parsed.event) {
    return { statusCode: 200, body: '' };
  }

  const ev = parsed.event;

  // Bot's own messages — drop unconditionally to prevent loops.
  if (ev.bot_id) return { statusCode: 200, body: '' };

  // Edited/deleted message subtypes — ignore. We only act on fresh
  // user posts. (subtype is undefined for normal user messages.)
  if (ev.subtype) return { statusCode: 200, body: '' };

  const userId = ev.user;
  const channelId = ev.channel;
  if (!userId || !channelId) return { statusCode: 200, body: '' };

  const route = await chooseRoute(ev, { getEngagement, isAddressedToBot });
  if (route === 'drop') return { statusCode: 200, body: '' };

  // Same allowlist gate applies to both routing paths. Admins bypass.
  if (!isAdmin(userId)) {
    const allowed = await isAllowlisted(userId, channelId);
    if (!allowed) return { statusCode: 200, body: '' };
  }

  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!queueUrl) throw new Error('SQS_QUEUE_URL env var is not set');

  const groupId = ev.thread_ts ?? ev.ts ?? 'no-thread';
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageGroupId: groupId,
    }),
  );
  return { statusCode: 200, body: '' };
}

