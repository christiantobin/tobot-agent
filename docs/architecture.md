# Architecture

A short tour of how Tobot Agent is put together. For design rationale and
the full feature list, see [`../SPEC.md`](../SPEC.md).

## Three planes

```
   ┌─────────────┐     ┌─────────────┐
   │   Slack     │     │  Webhook    │     front-door plane  (platform-owned)
   │  adapter    │     │  adapter    │     translate native events -> canonical payload
   └──────┬──────┘     └──────┬──────┘
          │                   │
          └─────────┬─────────┘
                    ▼
        ┌───────────────────────┐
        │   AgentCore Runtime   │           agent plane  (platform-owned)
        │  Strands agent loop   │           scope filter, destructive guard,
        │  session store (DDB)  │           capability resolver, session history
        └───────┬───────────────┘
                │ in-tree tools          ┌──────────────────────┐
                │ (tools/*/tool.yaml)    │  AgentCore Gateway    │  tool plane  (NOT platform-owned)
                └── + MCP session ──────►│  Lambda / OpenAPI /   │  external teams register
                                         │  Smithy targets       │  targets from their own repos
                                         └──────────────────────┘
```

- **Front-door plane** (`platform/`) — adapters that verify the caller,
  gate access, and translate a platform-native event (a Slack event, an
  HTTP POST) into the one canonical runtime payload. Owned and deployed
  by the platform team.
- **Agent plane** (`agent-runtime/`) — the AgentCore Runtime container:
  the Strands agent loop, the per-invocation scope filter, the
  destructive-action guard, the capability→credentials resolver, and the
  thread-keyed session store.
- **Tool plane** — two mechanisms. In-tree tools (`tools/*/tool.yaml`,
  discovered at container start) and Gateway-registered tools (external
  teams register MCP/Lambda/OpenAPI/Smithy targets on the AgentCore
  Gateway; the runtime merges them in at invocation time). The Gateway
  half needs zero platform-team coordination.

## The canonical runtime payload

Every front door produces the same shape, so the runtime never learns
about Slack or HTTP specifics:

```jsonc
{
  "prompt": "string", // required — user text, bot mention stripped
  "thread_id": "string", // required — stable conversation id
  "scope": "string", // optional — opaque scope (Slack channel, tenant)
  "principal_id": "string", // optional — opaque caller id
  "is_admin": false, // optional — unlocks admin tools
  "adapter": "slack|webhook", // optional — informational
  "destructive_confirmed": false, // optional — set when the user confirmed
}
```

## Request lifecycle (Slack)

1. Slack POSTs an event → **verification Lambda** checks the HMAC
   signature, drops the bot's own messages, applies the allowlist, and
   (for `app_mention` or an engaged thread the Haiku classifier approves)
   enqueues the event on an SQS FIFO queue keyed by thread.
2. The **bridge Lambda** consumes the queue, reacts ⏳ on the message,
   builds the canonical payload, and invokes the AgentCore Runtime.
3. The **runtime** resets per-invocation context, composes the toolset
   (scope-filtered in-tree tools + admin tools if admin + Gateway tools),
   runs the Strands loop, and returns `{ "text": ... }`.
4. The bridge posts the reply to the thread, swaps the reaction to ✅
   (or ✗ on error), and records the thread as engaged.

The webhook front door is the same minus steps 1–2's Slack specifics: a
single signed `POST /webhook` invokes the runtime synchronously.

## Two extension points, two cadences

- **Add a tool the agent owns**: drop a folder under `tools/`. No
  framework edits. Capabilities in the manifest bind to IAM via
  `config/capabilities.yaml`. Ships on the platform's deploy cadence.
- **Add a tool another team owns**: register a target on the Gateway
  with `lib/constructs/TobotGatewayTarget` from that team's own CDK app.
  Ships on their cadence, in their repo/account.

## Where to look

| concern                               | file                                                  |
| ------------------------------------- | ----------------------------------------------------- |
| Stacks + cross-stack wiring           | `bin/tobot-agent.ts`, `lib/*-stack.ts`                |
| Manifest reader / capability registry | `lib/tool-manifests.ts`, `lib/capability-registry.ts` |
| Agent loop + tool composition         | `agent-runtime/main.py`                               |
| Tool discovery + scope filter         | `agent-runtime/tools/discovery.py`                    |
| Capability → boto3 session            | `agent-runtime/capabilities.py`                       |
| Gateway consumption                   | `agent-runtime/gateway_tools.py`                      |
| Destructive guard                     | `agent-runtime/destructive_guard.py`                  |
| Slack adapter                         | `platform/slack/**`                                   |
| Webhook adapter                       | `platform/webhook/**`                                 |
