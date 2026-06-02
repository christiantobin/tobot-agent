import { toSlackMrkdwn } from '../platform/slack/bridge-lambda/format';

describe('toSlackMrkdwn', () => {
  it('converts **bold** and __bold__ to *bold*', () => {
    expect(toSlackMrkdwn('a **bold** word')).toBe('a *bold* word');
    expect(toSlackMrkdwn('__also bold__')).toBe('*also bold*');
  });

  it('converts links to <url|text>', () => {
    expect(toSlackMrkdwn('see [the docs](https://x.com/y)')).toBe('see <https://x.com/y|the docs>');
  });

  it('converts -, *, + bullets to •', () => {
    expect(toSlackMrkdwn('- one\n- two')).toBe('• one\n• two');
    expect(toSlackMrkdwn('* one\n+ two')).toBe('• one\n• two');
  });

  it('converts headers to bold lines', () => {
    expect(toSlackMrkdwn('## Heading')).toBe('*Heading*');
  });

  it('converts ~~strike~~ to ~strike~', () => {
    expect(toSlackMrkdwn('~~gone~~')).toBe('~gone~');
  });

  it('never rewrites inside inline code', () => {
    expect(toSlackMrkdwn('use `**not bold**` here')).toBe('use `**not bold**` here');
  });

  it('never rewrites inside fenced code blocks', () => {
    const md = 'text\n```\n**stays**\n- stays\n```\nmore';
    expect(toSlackMrkdwn(md)).toBe(md);
  });

  it('handles real-world mixed content', () => {
    const md =
      'Found **3** groups:\n- `payments-api`\n- `payments-worker`\n\nSee [logs](https://aws/x).';
    const out = toSlackMrkdwn(md);
    expect(out).toContain('*3*');
    expect(out).toContain('• `payments-api`');
    expect(out).toContain('<https://aws/x|logs>');
    expect(out).not.toContain('**');
  });

  it('returns empty input unchanged', () => {
    expect(toSlackMrkdwn('')).toBe('');
  });
});
