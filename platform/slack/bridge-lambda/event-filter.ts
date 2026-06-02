/**
 * Pure predicate for which Slack event types the bridge should process.
 * No AWS SDK imports — kept separate so it's unit-testable.
 *
 * The verification Lambda only enqueues events meant for the agent:
 * `app_mention`, AND engaged-thread `message` events the classifier
 * already approved. The bridge must accept BOTH — accepting only
 * `app_mention` here silently drops every engaged-thread follow-up
 * (the verification Lambda did the work to route them, and they'd
 * vanish at this step).
 */
export function isProcessableEventType(eventType: string | undefined): boolean {
  return eventType === 'app_mention' || eventType === 'message';
}
