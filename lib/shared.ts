/**
 * Cross-stack shared values. Empty in v0 — fills as Platform exports
 * resources (allowlist table, engaged-threads table, identity issuer URL)
 * that the Agent stack's runtime needs.
 */
export interface Shared {
  readonly region: string;
  readonly stage: string;
}
