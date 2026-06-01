import {
  isExplicitConfirmation,
  stripBotMention,
} from '../platform/slack/bridge-lambda/confirmation';

describe('isExplicitConfirmation', () => {
  it.each(['confirm', 'Confirm', 'CONFIRM', 'confirm.', 'confirm!', '  confirm  '])(
    'accepts %j',
    (text) => {
      expect(isExplicitConfirmation(text)).toBe(true);
    },
  );

  it.each(['confirm the deletion', 'yes confirm', 'please confirm this', 'confirmed', 'do it', ''])(
    'rejects %j',
    (text) => {
      expect(isExplicitConfirmation(text)).toBe(false);
    },
  );
});

describe('stripBotMention', () => {
  it('removes a leading bot mention and trims', () => {
    expect(stripBotMention('<@U123ABC> hello there')).toBe('hello there');
  });

  it('removes multiple mentions', () => {
    expect(stripBotMention('<@U1> <@U2> hi')).toBe('hi');
  });

  it('leaves plain text untouched', () => {
    expect(stripBotMention('just text')).toBe('just text');
  });
});
