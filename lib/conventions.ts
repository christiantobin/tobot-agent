/**
 * Naming conventions for resources that cross stack boundaries.
 *
 * When two stacks both need to refer to the same resource (the agent
 * runtime's execution role needs IAM on the platform's allowlist table,
 * for instance), threading a CDK construct reference through props
 * creates a stack dependency that constrains deploy order in both
 * directions. We sidestep that by deterministically constructing the
 * resource name from the stage in both places — neither stack imports
 * the other's construct, but they agree on the physical name.
 *
 * Add new entries here whenever a resource is "physically named so
 * another stack can find it." Removing the convention is a breaking
 * change for any deployment with state on the old name.
 */

export const slackAllowlistTableName = (stage: string): string =>
  `tobot-agent-slack-allowlist-${stage}`;

export const engagedThreadsTableName = (stage: string): string =>
  `tobot-agent-engaged-threads-${stage}`;
