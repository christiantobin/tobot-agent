import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Input for verifySlackSignature. All fields are untrusted caller data
 * EXCEPT signingSecret, which must come from a trusted source
 * (Secrets Manager).
 */
export interface VerifySlackSignatureInput {
  /** Raw request body, exactly as received. Any reparsing will break verification. */
  readonly body: string;
  /** Value of the X-Slack-Request-Timestamp header (unix seconds as string). */
  readonly timestamp: string;
  /** Value of the X-Slack-Signature header (e.g. "v0=abc123..."). */
  readonly signature: string;
  /** Slack app signing secret. */
  readonly signingSecret: string;
}

export interface VerifySlackSignatureResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Slack's documented replay-window allowance is 5 minutes. */
const MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

export function verifySlackSignature(
  input: VerifySlackSignatureInput,
): VerifySlackSignatureResult {
  const { body, timestamp, signature, signingSecret } = input;

  if (!timestamp) return { valid: false, reason: 'missing timestamp' };
  if (!signature || !signature.startsWith('v0=')) {
    return { valid: false, reason: 'missing or malformed signature' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { valid: false, reason: 'invalid timestamp' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { valid: false, reason: 'timestamp outside replay window' };
  }

  const base = `v0:${timestamp}:${body}`;
  const expected = 'v0=' + createHmac('sha256', signingSecret).update(base).digest('hex');

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
