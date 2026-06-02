/**
 * Convert the agent's standard Markdown output to Slack "mrkdwn".
 *
 * The runtime is platform-agnostic — it emits normal Markdown. Slack does
 * NOT use Markdown: bold is a *single* asterisk, links are `<url|text>`,
 * lists use `•`, and there are no headers. Without this translation Slack
 * renders literal `**bold**`, `[text](url)`, `## Heading`, etc.
 *
 * Code spans and fenced code blocks are protected so their contents are
 * never rewritten (a `**` inside a code sample stays a `**`).
 *
 * No AWS SDK imports — pure + unit-tested.
 */

// NUL sentinel — cannot appear in Slack message text, so it's a safe
// placeholder delimiter while we protect code regions. Built at runtime
// to avoid embedding a control character in source.
const SENTINEL = String.fromCharCode(0);
const RESTORE = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g');

export function toSlackMrkdwn(md: string): string {
  if (!md) return md;

  // 1. Stash code regions so the rewrites below can't touch them.
  const stashed: string[] = [];
  const stash = (s: string): string => {
    stashed.push(s);
    return `${SENTINEL}${stashed.length - 1}${SENTINEL}`;
  };
  let out = md.replace(/```[\s\S]*?```/g, stash); // fenced blocks
  out = out.replace(/`[^`]+`/g, stash); // inline code

  // 2. Translate Markdown -> Slack mrkdwn.
  // Links: [text](url) -> <url|text>
  out = out.replace(/\[([^\]]+)\]\((\S+?)(?:\s+"[^"]*")?\)/g, '<$2|$1>');
  // Bold: **x** / __x__ -> *x*  (before bullets, so ** isn't seen as a bullet)
  out = out.replace(/\*\*([^*]+)\*\*/g, '*$1*');
  out = out.replace(/__([^_]+)__/g, '*$1*');
  // Strikethrough: ~~x~~ -> ~x~
  out = out.replace(/~~([^~]+)~~/g, '~$1~');
  // Headers: leading #'s on a line -> a bold line (Slack has no headers)
  out = out.replace(/^#{1,6}[ \t]+(.*)$/gm, '*$1*');
  // Bullets: -, *, + at line start -> •
  out = out.replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ');

  // 3. Restore the stashed code regions.
  out = out.replace(RESTORE, (_m, i: string) => stashed[Number(i)]);
  return out;
}
