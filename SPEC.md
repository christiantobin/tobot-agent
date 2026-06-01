# Tobot Agent — Spec

v0.1 — by Christian Tobin

## What it is

Open-source CDK template for an org-wide AI agent on AWS. One-shot `cdk deploy` brings up the agent platform: Tobot Agent itself, two front-door adapters (Slack + generic webhook), and the wiring for any developer to register MCP tools dynamically without touching the platform's code.

The pitch: a 24/7 AI member of your org that anyone can reach from the front door of their choice, with capabilities your developers ship on their own cadence.

## Architecture

Three planes, three deploy cadences:

- **Front-door plane** (platform-owned): adapters that translate platform-native events into a canonical event schema. Slack adapter and webhook adapter in v1.
- **Agent plane** (platform-owned): AgentCore Runtime container with the Strands agent loop, scope filter, write guard, progress emitter, and DynamoDB session store.
- **Tool plane** (NOT platform-owned): AgentCore Gateway as the MCP tool registry. Tools live in their own repos and deploy via the `@tobot/gateway-target` CDK construct, registering with the Gateway. Agent picks them up at the next `list_tools()` cycle. Zero platform-team coordination required.

```
[Slack] [Webhook] ─► [AgentCore Runtime] ─list_tools─► [AgentCore Gateway]
                                                            │
                                          ┌─────────────────┼─────────────────┐
                                       [Lambda targets] [MCP servers] [OpenAPI/Smithy]
                                       ▲ deployed independently by tool teams ▲
```

## Models

- Agent loop: `us.anthropic.claude-opus-4-7` (latest available Claude on Bedrock; swappable to Sonnet 4.6 via config for cheaper invocations)
- Engaged-thread classifier: `us.anthropic.claude-haiku-4-5-20251001`
- Both pinned in `config/models.yaml`, surfaced as CDK context

## Identity

- Default: Cognito User Pool provisioned by CDK (zero-friction one-shot deploy)
- Toggle: BYO OIDC issuer (Okta, Entra ID, Auth0) via `identity.provider: oidc` in `config/identity.yaml`

## Sessions and memory

- DynamoDB session table, thread-keyed, 7-day TTL. Text turns only (no intermediate tool blocks).
- **No long-term conversational memory in v1.** Operational agents do worse with semantic recall, not better — see SPEC §"Why no long-term memory."
- Company knowledge lives as a *tool* (e.g. a Bedrock Knowledge Bases MCP target), not as a memory subsystem. Knowledge stays in the company's existing systems where it can be governed, versioned, and access-controlled.

## Tools

Two parallel mechanisms, each appropriate for different authoring populations:

### In-tree tools (Phase 1, current)

- Authored as a directory under `tools/<name>/` with a `tool.yaml` manifest declaring entrypoints, capabilities, secrets, and env vars. See `tools/MANIFEST.md`.
- Discovery is automatic at container start — no framework code edits per tool.
- Capability model (see "Capabilities" below) means tool authors declare AWS reach in domain language (`iot:read`), not raw IAM. The deployment binds capabilities to roles.
- Best for tools the platform team owns or that ship alongside the agent.

### Gateway-registered tools

- Pluggable via AgentCore Gateway. The platform stack provisions an empty Gateway shell ready for targets.
- Three target shapes (CDK alpha module surface):
  - **Lambda target**: author writes a Lambda + tool schema; Gateway MCP-wraps it transparently. Convenient for AWS-shops.
  - **OpenAPI target**: author provides an OpenAPI 3 schema referencing their HTTPS API.
  - **Smithy target**: author provides a Smithy model.
- Consumer-side construct: `lib/constructs/TobotGatewayTarget`. Discriminated union of the three kinds; consumers in other CDK apps instantiate it referencing the exported Gateway ARN.
- Best for tools other teams ship on their own cadence, in their own repos / accounts.
- **Open gap**: the agent runtime does not yet merge Gateway-registered tools with in-tree manifest tools at `list_tools()` time. Registering a target works; the agent won't call it until the runtime-side wiring lands.

### Tags + invocation gating (both mechanisms)

- Tags: `read | write | destructive`
  - `read`: invoked freely
  - `write`: invoked, logged, flagged in response
  - `destructive`: requires explicit `confirm` reply OR second-approver reaction in the thread before invocation. Hard runtime check, NOT a system-prompt instruction — model cannot bypass it.
- Scope filter at `list_tools()`: `{adapter, scope} → tool_set`. Out-of-scope tools never enter the model's context. Containment + cheaper context. For in-tree tools, scopes are declared in the manifest's `access.scopes`; for Gateway-registered tools, scopes are configured in `config/scope.yaml`.

## Capabilities

Tools declare what AWS reach they need in domain language; the deployment binds those capability names to actual IAM roles in its topology. The framework's job is the indirection — so a tool written against `iot:write` works in a single-account setup AND in a five-stage org topology without modification.

- **Vocabulary**: `<service>:<verb>[:<scope>]` — see `config/VOCAB.md`. Common examples: `iot:read`, `s3:read:<bucket>`, `dynamodb:write:<table>`, `lambda:invoke:<function>`.
- **Bindings**: `config/capabilities.yaml` maps each capability to either a single role ARN (single-account / non-env-scoped) or a per-env map of role ARNs (multi-account / multi-stage).
- **Reads for free** (default): `defaults.auto_grant_reads: true` gives the hub task role a wide read policy. Tools doing only reads need zero binding. Writes and destructive caps must always be bound explicitly — that asymmetry is the point.
- **Runtime**: tools call `capabilities.get_session("iot:write", env="prod")` and get a `boto3.Session`. The framework handles AssumeRole caching, credential refresh, and the auto-grant-reads fallback transparently.
- **Synth-time validation**: a tool declaring a capability that isn't bound (and isn't auto-granted) fails synth, not runtime. No silent 403s.

This is the load-bearing abstraction that lets the same framework scale from a solo developer with one AWS account to a multi-stage organization without forking the tool surface.

## Front doors (v1)

- **Slack adapter**: full implementation. HMAC verification, allowlist gating, SQS FIFO buffering, `@mention` + engaged-thread following with Haiku classifier, in-thread progress updates, ⏳/✅/✗ reaction state, destructive-action confirmation via `confirm` reply or approver ✅ reaction.
- **Webhook adapter**: HMAC-verified `POST /webhook` accepting the canonical event schema. Calling system is responsible for sending only events meant for the agent (no engaged-thread following at this layer).

## v1.x roadmap (NOT in v1)

- Microsoft Teams adapter (Bot Framework manifest, tenant approval flow)
- Jira-as-trigger adapter (issue events → agent invocations)
- WhatsApp Business API adapter
- AgentCore Memory opt-in (long-term memory) via config flag
- Tool-count routing / tag-based meta-tool for orgs scaling past ~15 tools per scope
- Per-target ACL on Gateway as defence-in-depth (in addition to scope filter)
- Async tool support via `add_async_task` (works once a tool needs it)

## Conventions

- License: Apache 2.0
- Runtime container: Python 3.12, ARM64 (AgentCore Runtime requirement)
- CDK + adapters: TypeScript
- Config: YAML files in `config/` (models, scope, identity, admins)
- Stacks:
  - `TobotAgent-Platform-{stage}` — adapters, allowlist, engaged-threads, sessions, identity
  - `TobotAgent-AgentCore-{stage}` — AgentCore Runtime, Gateway shell, scope registry override

## Non-goals (intentional)

- Multi-cloud platform. The platform is AWS-native (AgentCore Runtime + Gateway are AWS services). Tools registered with Gateway can run on any cloud — that's where the cloud-agnosticism lives.
- A model abstraction layer. Bedrock-only. Operators wanting OpenAI/Anthropic API direct can fork.
- A general-purpose chat UI. Front doors are existing comms tools (Slack/Teams/etc.), not a custom web app.

## Why no long-term conversational memory

Long-term semantic memory is double-edged for operational agents:

- Stale facts get retrieved confidently. The agent doesn't know what's stale.
- Attention dilution: every retrieved memory is more text the model weighs.
- Cross-user/cross-channel bleed when semantic similarity wins over relevance.
- Surprising behavior: users can't predict when memory fires.
- Curation debt: memories rot, nobody owns expiring them.

For an SRE-style agent doing discrete request → investigate → reply work, **thread-scoped session history is sufficient**. The agent "knows the company" by *retrieving* from knowledge tools (which the company governs at the source), not by *remembering* prior conversations.

If a future adopter genuinely needs long-term memory for a companion-agent use case, AgentCore Memory can be enabled via config flag — the architecture allows it without breaking changes.
