/**
 * Minimal Slack Web API wrapper. Pure fetch — no SDK, no transitive deps.
 *
 * Only the four endpoints the bridge actually uses are here. Add more
 * sparingly; the small surface keeps the Lambda bundle tight.
 */

export interface PostMessageInput {
  readonly botToken: string;
  readonly channel: string;
  readonly text: string;
  /** Optional thread parent — pass through thread_ts from the original event. */
  readonly threadTs?: string;
}

export interface PostMessageResult {
  readonly ok: boolean;
  /** Slack returns a ts for the posted message on success. */
  readonly ts?: string;
  /** Slack returns an error string on failure (e.g. "not_in_channel"). */
  readonly error?: string;
}

export async function postMessage(input: PostMessageInput): Promise<PostMessageResult> {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: input.channel,
      text: input.text,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    }),
  });
  const data = (await resp.json()) as { ok: boolean; ts?: string; error?: string };
  return { ok: data.ok, ts: data.ts, error: data.error };
}

export interface UpdateMessageInput {
  readonly botToken: string;
  readonly channel: string;
  readonly ts: string;
  readonly text: string;
}

export async function updateMessage(
  input: UpdateMessageInput,
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://slack.com/api/chat.update', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: input.channel, ts: input.ts, text: input.text }),
  });
  return (await resp.json()) as { ok: boolean; error?: string };
}

export interface ReactionInput {
  readonly botToken: string;
  readonly channel: string;
  /** ts of the message being reacted to. */
  readonly ts: string;
  /** Reaction name, no colons (e.g. "hourglass_flowing_sand"). */
  readonly name: string;
}

export async function addReaction(input: ReactionInput): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: input.channel,
      timestamp: input.ts,
      name: input.name,
    }),
  });
  return (await resp.json()) as { ok: boolean; error?: string };
}

export async function removeReaction(
  input: ReactionInput,
): Promise<{ ok: boolean; error?: string }> {
  const resp = await fetch('https://slack.com/api/reactions.remove', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.botToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: input.channel,
      timestamp: input.ts,
      name: input.name,
    }),
  });
  return (await resp.json()) as { ok: boolean; error?: string };
}
