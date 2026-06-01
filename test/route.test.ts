/**
 * Tests the verification Lambda's routing decision in isolation. The two
 * I/O dependencies (engagement lookup, classifier call) are injected as
 * stubs — so we exercise pure routing logic, including the app_mention /
 * message dedup that prevents Slack's double-delivery from double-firing.
 */
import { chooseRoute, type RoutingDeps } from '../platform/slack/verification-lambda/routing';

function deps(over: Partial<RoutingDeps> = {}): RoutingDeps {
  return {
    getEngagement: jest.fn().mockResolvedValue({ engaged: false }),
    isAddressedToBot: jest.fn().mockResolvedValue(false),
    ...over,
  };
}

describe('chooseRoute', () => {
  afterEach(() => {
    delete process.env.BOT_USER_ID;
  });

  it('always queues an app_mention', async () => {
    expect(await chooseRoute({ type: 'app_mention', text: 'hi', ts: '1' }, deps())).toBe('queue');
  });

  it('drops a top-level (non-thread) message', async () => {
    expect(await chooseRoute({ type: 'message', text: 'hi', ts: '1' }, deps())).toBe('drop');
  });

  it('drops a thread-root message (thread_ts === ts)', async () => {
    expect(
      await chooseRoute({ type: 'message', text: 'hi', ts: '1', thread_ts: '1' }, deps()),
    ).toBe('drop');
  });

  it('drops an empty thread reply', async () => {
    expect(
      await chooseRoute({ type: 'message', text: '   ', ts: '2', thread_ts: '1' }, deps()),
    ).toBe('drop');
  });

  it('drops a thread reply containing a bot mention (dedup with app_mention)', async () => {
    const d = deps({ getEngagement: jest.fn().mockResolvedValue({ engaged: true }) });
    expect(
      await chooseRoute({ type: 'message', text: '<@U999> hey', ts: '2', thread_ts: '1' }, d),
    ).toBe('drop');
    expect(d.getEngagement).not.toHaveBeenCalled();
  });

  it('with BOT_USER_ID set, only drops mentions of the bot itself', async () => {
    process.env.BOT_USER_ID = 'UBOT';
    const d = deps({
      getEngagement: jest.fn().mockResolvedValue({ engaged: true, previousBotReply: 'prev' }),
      isAddressedToBot: jest.fn().mockResolvedValue(true),
    });
    // a mention of another human is NOT the bot — proceed to classifier
    expect(
      await chooseRoute({ type: 'message', text: '<@UHUMAN> thanks', ts: '2', thread_ts: '1' }, d),
    ).toBe('queue');
  });

  it('drops a thread reply when the thread is not engaged', async () => {
    const d = deps({ getEngagement: jest.fn().mockResolvedValue({ engaged: false }) });
    expect(
      await chooseRoute({ type: 'message', text: 'follow up', ts: '2', thread_ts: '1' }, d),
    ).toBe('drop');
    expect(d.isAddressedToBot).not.toHaveBeenCalled();
  });

  it('drops an engaged thread reply the classifier rejects', async () => {
    const d = deps({
      getEngagement: jest.fn().mockResolvedValue({ engaged: true, previousBotReply: 'prev' }),
      isAddressedToBot: jest.fn().mockResolvedValue(false),
    });
    expect(
      await chooseRoute({ type: 'message', text: 'side chat', ts: '2', thread_ts: '1' }, d),
    ).toBe('drop');
  });

  it('queues an engaged thread reply the classifier accepts', async () => {
    const d = deps({
      getEngagement: jest.fn().mockResolvedValue({ engaged: true, previousBotReply: 'prev' }),
      isAddressedToBot: jest.fn().mockResolvedValue(true),
    });
    expect(
      await chooseRoute({ type: 'message', text: 'what about X?', ts: '2', thread_ts: '1' }, d),
    ).toBe('queue');
  });

  it('drops unknown event types', async () => {
    expect(await chooseRoute({ type: 'reaction_added', ts: '1' }, deps())).toBe('drop');
  });
});
