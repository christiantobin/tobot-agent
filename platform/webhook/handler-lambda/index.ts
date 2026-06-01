import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { verifyWebhookSignature } from './signature';

const secrets = new SecretsManagerClient({});
const agentCore = new BedrockAgentCoreClient({});

let cachedSigningSecret: string | undefined;

async function getSigningSecret(): Promise<string> {
  if (cachedSigningSecret) return cachedSigningSecret;
  const arn = process.env.WEBHOOK_SIGNING_SECRET_ARN;
  if (!arn) throw new Error('WEBHOOK_SIGNING_SECRET_ARN env var is not set');
  const resp = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!resp.SecretString) throw new Error('Webhook signing secret value is empty');
  cachedSigningSecret = resp.SecretString;
  return cachedSigningSecret;
}

/** Pad the runtime session id to AgentCore's 33-char minimum. */
function asRuntimeSessionId(threadId: string): string {
  const base = `webhook-${threadId}`;
  return base.length >= 33 ? base : base.padEnd(33, '0');
}

interface WebhookPayload {
  prompt?: string;
  thread_id?: string;
  scope?: string;
  principal_id?: string;
  is_admin?: boolean;
  destructive_confirmed?: boolean;
}

/**
 * Generic webhook front door for Tobot Agent.
 *
 * Verifies HMAC-signed POST bodies and synchronously invokes the agent
 * runtime. The body shape IS the canonical runtime payload — no Slack-
 * style transform layer, no engaged-thread following, no async ack.
 * Caller is responsible for sending only events that should be processed.
 *
 * Returns the agent's reply as JSON: `{"text": "<assistant reply>"}`.
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const body = event.body;
  if (!body) return { statusCode: 400, body: 'missing body' };

  const timestamp = event.headers['x-tobot-timestamp'] ?? '';
  const signature = event.headers['x-tobot-signature'] ?? '';
  const signingSecret = await getSigningSecret();

  const verdict = verifyWebhookSignature({ body, timestamp, signature, signingSecret });
  if (!verdict.valid) {
    return { statusCode: 401, body: verdict.reason ?? 'invalid signature' };
  }

  let parsed: WebhookPayload;
  try {
    parsed = JSON.parse(body) as WebhookPayload;
  } catch {
    return { statusCode: 400, body: 'invalid json' };
  }

  const prompt = (parsed.prompt ?? '').trim();
  const threadId = parsed.thread_id ?? '';
  if (!prompt || !threadId) {
    return { statusCode: 400, body: 'prompt and thread_id are required' };
  }

  const runtimeArn = process.env.AGENT_RUNTIME_ARN;
  if (!runtimeArn) throw new Error('AGENT_RUNTIME_ARN env var is not set');

  const payload = {
    prompt,
    thread_id: threadId,
    scope: parsed.scope,
    principal_id: parsed.principal_id,
    is_admin: Boolean(parsed.is_admin),
    adapter: 'webhook',
    destructive_confirmed: Boolean(parsed.destructive_confirmed),
  };

  try {
    const resp = await agentCore.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: runtimeArn,
        runtimeSessionId: asRuntimeSessionId(threadId),
        qualifier: 'DEFAULT',
        contentType: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
    );
    const responseBytes = resp.response;
    if (!responseBytes) {
      return { statusCode: 502, body: 'runtime returned empty response' };
    }
    const responseText = await responseBytes.transformToString();
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: responseText,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { statusCode: 502, body: `runtime invocation failed: ${msg}` };
  }
}
