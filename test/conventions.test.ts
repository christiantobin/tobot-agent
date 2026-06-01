import {
  slackAllowlistTableName,
  engagedThreadsTableName,
} from '../lib/conventions';

describe('resource naming conventions', () => {
  it('builds a stage-suffixed allowlist table name', () => {
    expect(slackAllowlistTableName('prod')).toBe('tobot-agent-slack-allowlist-prod');
    expect(slackAllowlistTableName('dev')).toBe('tobot-agent-slack-allowlist-dev');
  });

  it('builds a stage-suffixed engaged-threads table name', () => {
    expect(engagedThreadsTableName('prod')).toBe('tobot-agent-engaged-threads-prod');
  });

  it('produces distinct names per stage so two stacks agree deterministically', () => {
    expect(slackAllowlistTableName('a')).not.toBe(slackAllowlistTableName('b'));
  });
});
