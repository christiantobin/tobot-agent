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

- Pluggable via AgentCore Gateway.
- Two target shapes:
  - **MCP server target** (primary path): author writes an MCP server in any language, hosts it anywhere (Lambda+Function-URL, Fargate, Render, Cloudflare Workers, on-prem), registers the URL with Gateway via the `TobotGatewayTarget` CDK construct.
  - **Lambda target** (AWS-shop convenience): author writes a Lambda + JSON schema; Gateway MCP-wraps it transparently.
- Tags: `read | write | destructive`
  - `read`: invoked freely
  - `write`: invoked, logged, flagged in response
  - `destructive`: requires explicit `confirm` reply OR second-approver reaction in the thread before invocation. Hard runtime check, NOT a system-prompt instruction — model cannot bypass it.
- Scope filter at `list_tools()`: `{adapter, channel_id} → tool_tag_set`. Out-of-scope tools never enter the model's context. Containment + cheaper context.

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
