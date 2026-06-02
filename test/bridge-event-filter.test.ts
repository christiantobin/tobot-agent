import { isProcessableEventType } from '../platform/slack/bridge-lambda/event-filter';

describe('isProcessableEventType', () => {
  it('processes app_mention', () => {
    expect(isProcessableEventType('app_mention')).toBe(true);
  });

  // Regression: the bridge previously filtered to app_mention only, which
  // silently dropped every engaged-thread follow-up the verification
  // Lambda had already routed to the queue.
  it('processes engaged-thread message events', () => {
    expect(isProcessableEventType('message')).toBe(true);
  });

  it.each(['reaction_added', 'channel_join', 'app_home_opened', '', undefined])(
    'drops %j',
    (eventType) => {
      expect(isProcessableEventType(eventType as string | undefined)).toBe(false);
    },
  );
});
