import { createHmac } from 'node:crypto';
import { verifyWebhookSignature } from '../platform/webhook/handler-lambda/signature';

const SECRET = 'webhook-secret';

function sign(body: string, timestamp: string, secret = SECRET): string {
  return 'v1=' + createHmac('sha256', secret).update(`v1:${timestamp}:${body}`).digest('hex');
}

function now(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifyWebhookSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const body = '{"prompt":"hi"}';
    const ts = now();
    expect(
      verifyWebhookSignature({
        body,
        timestamp: ts,
        signature: sign(body, ts),
        signingSecret: SECRET,
      }).valid,
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = now();
    const res = verifyWebhookSignature({
      body: 'tampered',
      timestamp: ts,
      signature: sign('original', ts),
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
  });

  it('requires the v1= prefix (rejects Slack-style v0=)', () => {
    const body = 'x';
    const ts = now();
    const slackStyle = 'v0=' + createHmac('sha256', SECRET).update(`v1:${ts}:${body}`).digest('hex');
    const res = verifyWebhookSignature({
      body,
      timestamp: ts,
      signature: slackStyle,
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/malformed/);
  });

  it('rejects a stale timestamp', () => {
    const body = 'x';
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    expect(
      verifyWebhookSignature({
        body,
        timestamp: ts,
        signature: sign(body, ts),
        signingSecret: SECRET,
      }).valid,
    ).toBe(false);
  });
});
