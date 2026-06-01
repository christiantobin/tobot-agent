import { createHmac } from 'node:crypto';
import { verifySlackSignature } from '../platform/slack/verification-lambda/slack-signature';

const SECRET = 'test-signing-secret';

function sign(body: string, timestamp: string, secret = SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
}

function now(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifySlackSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const body = '{"type":"event_callback"}';
    const ts = now();
    const res = verifySlackSignature({
      body,
      timestamp: ts,
      signature: sign(body, ts),
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const ts = now();
    const sig = sign('original', ts);
    const res = verifySlackSignature({
      body: 'tampered',
      timestamp: ts,
      signature: sig,
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/mismatch/);
  });

  it('rejects the wrong signing secret', () => {
    const body = 'x';
    const ts = now();
    const res = verifySlackSignature({
      body,
      timestamp: ts,
      signature: sign(body, ts, 'other-secret'),
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
  });

  it('rejects a stale timestamp outside the replay window', () => {
    const body = 'x';
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const res = verifySlackSignature({
      body,
      timestamp: ts,
      signature: sign(body, ts),
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/replay window/);
  });

  it('rejects a missing timestamp', () => {
    expect(
      verifySlackSignature({ body: 'x', timestamp: '', signature: 'v0=abc', signingSecret: SECRET })
        .valid,
    ).toBe(false);
  });

  it('rejects a malformed signature prefix', () => {
    const ts = now();
    const res = verifySlackSignature({
      body: 'x',
      timestamp: ts,
      signature: 'sha256=deadbeef',
      signingSecret: SECRET,
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/malformed/);
  });
});
