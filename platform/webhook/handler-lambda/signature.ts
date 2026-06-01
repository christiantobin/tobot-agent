import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC verification for the webhook adapter.
 *
 * Convention (Slack-shaped, deliberately):
 *   header X-Tobot-Timestamp: <unix-seconds>
 *   header X-Tobot-Signature: v1=<hex>
 *   sig basis: `v1:<timestamp>:<raw-body>`
 *
 * Same pattern as Slack's signing so an operator familiar with one
 * will recognize the other. The version prefix lets us roll the
 * algorithm later without breaking existing callers.
 */

export interface VerifySignatureInput {
  readonly body: string;
  readonly timestamp: string;
  readonly signature: string;
  readonly signingSecret: string;
}

export interface VerifySignatureResult {
  readonly valid: boolean;
  readonly reason?: string;
}

const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export function verifyWebhookSignature(
  input: VerifySignatureInput,
): VerifySignatureResult {
  const { body, timestamp, signature, signingSecret } = input;

  if (!timestamp) return { valid: false, reason: 'missing timestamp' };
  if (!signature || !signature.startsWith('v1=')) {
    return { valid: false, reason: 'missing or malformed signature' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'invalid timestamp' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { valid: false, reason: 'timestamp outside replay window' };
  }

  const base = `v1:${timestamp}:${body}`;
  const expected = 'v1=' + createHmac('sha256', signingSecret).update(base).digest('hex');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'signature mismatch' };
  }
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}
