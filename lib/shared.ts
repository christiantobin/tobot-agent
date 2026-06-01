/**
 * Cross-stack shared values. Plumbed by bin/tobot-agent.ts into each
 * stack's props.
 */
export interface Shared {
  readonly region: string;
  readonly stage: string;
}
