/**
 * The verification Lambda's routing decision, extracted as a pure
 * function with its two I/O dependencies injected. No AWS SDK imports
 * here — so it's unit-testable without the SDK's transitive ESM deps,
 * and the I/O (engagement lookup, classifier call) is supplied by the
 * caller.
 */

export interface RoutableEvent {
  readonly type: string;
  readonly text?: string;
  readonly ts?: string;
  readonly thread_ts?: string;
}

export interface RoutingDeps {
  /** Has the bot replied in this thread within the TTL? */
  readonly getEngagement: (
    threadTs: string,
  ) => Promise<{ engaged: boolean; previousBotReply?: string }>;
  /** Cheap classifier: is this thread message addressed to the bot? */
  readonly isAddressedToBot: (input: {
    text: string;
    previousBotReply?: string;
  }) => Promise<boolean>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide whether this event should be routed to the agent.
 *
 * - app_mention: always 'queue'.
 * - message in a thread: 'queue' only if engaged + classifier says yes.
 * - everything else: 'drop'.
 *
 * Slack delivers both `app_mention` AND `message` for the same
 * @-mention; the mention dedup below drops the `message` copy so the
 * agent isn't double-invoked. With BOT_USER_ID set the match is exact;
 * otherwise any `<@U...>` is treated as a likely bot mention.
 */
export async function chooseRoute(
  ev: RoutableEvent,
  deps: RoutingDeps,
): Promise<'queue' | 'drop'> {
  if (ev.type === 'app_mention') return 'queue';

  if (ev.type === 'message') {
    const threadTs = ev.thread_ts;
    if (!threadTs || threadTs === ev.ts) return 'drop';

    const text = (ev.text ?? '').trim();
    if (!text) return 'drop';

    const botUserId = process.env.BOT_USER_ID;
    const mentionPattern = botUserId
      ? new RegExp(`<@${escapeRegex(botUserId)}>`)
      : /<@[A-Z0-9]+>/;
    if (mentionPattern.test(text)) return 'drop';

    const { engaged, previousBotReply } = await deps.getEngagement(threadTs);
    if (!engaged) return 'drop';

    const addressed = await deps.isAddressedToBot({ text, previousBotReply });
    return addressed ? 'queue' : 'drop';
  }

  return 'drop';
}
