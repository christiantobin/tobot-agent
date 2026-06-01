/**
 * Pure text helpers for the Slack bridge. No AWS SDK imports — kept
 * separate from index.ts so they can be unit-tested without dragging in
 * the (ESM-heavy) AWS SDK transitive deps.
 */

/** Slack @-mentions render the bot id as `<@UXXXX>`. Remove and trim. */
export function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9_]+>\s*/g, '').trim();
}

/**
 * Does the user's message body (post-mention-strip) constitute an
 * explicit confirmation of a pending destructive action?
 *
 * Strict matching by design: we only accept the trimmed body being
 * literally "confirm" (case-insensitive, with optional trailing
 * punctuation). Embedded mentions of the word in a longer message don't
 * count — that's how we keep the gate meaningful in the face of a
 * malicious or mistaken prompt.
 */
export function isExplicitConfirmation(text: string): boolean {
  return /^confirm[.!\s]*$/i.test(text.trim());
}
