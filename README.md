# Tobot Agent

[![CI](https://github.com/christiantobin/tobot-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/christiantobin/tobot-agent/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

An open-source CDK template for an org-wide AI agent on AWS. One-shot
deploy gets you a Bedrock-backed AI member of your team — reachable
through Slack and a generic webhook, with tools you ship on your own
cadence.

**AWS-native platform, multi-cloud reach.** The agent _runs_ on AWS, but
what it can _operate_ is open-ended: every integration is just a tool, so
an AWS-hosted bot can be the ops front-end for your whole estate — AWS,
Azure, GCP, SaaS. See `tools/aws-account-info/` and
`tools/azure-resource-info/` for the AWS and cross-cloud reference tools.

> **Status:** v1 development. Slack adapter (with engaged-thread
> following), webhook adapter, manifest-based tools, capability-bound
> IAM, admin tools, destructive-action confirmation, and AgentCore
> Gateway (shell + consumer construct + runtime consumption) are all in.
> Approver-reaction confirmation and live-Gateway e2e verification are
> next. See [`SPEC.md`](SPEC.md) for the full architecture.

## What you get

- Tobot Agent running on **Bedrock AgentCore Runtime** (Claude Opus 4.7
  by default, swappable via `config/models.yaml`).
- **Slack adapter** — HMAC-verified events, FIFO-ordered per thread,
  user/channel allowlist, hourglass→✅/✗ reaction lifecycle, admin
  bypass, **engaged-thread following** (Haiku classifier decides
  whether a non-mention thread reply is addressed to the bot, so users
  don't have to re-@mention every turn).
- **Generic HTTPS webhook** — HMAC-signed `POST /webhook` accepting the
  canonical runtime payload. Replay-windowed. Synchronous reply.
- **Manifest-driven tools** — drop a directory under `tools/<name>/`,
  the agent discovers it at the next container start. No framework
  code edits per tool.
- **Multi-cloud ops bot** — the platform is AWS-native, but reach isn't.
  Tools can operate any cloud or SaaS; non-AWS tools carry their own
  credentials (service principal, API key) via the manifest's `secrets:`
  block instead of the AWS capability model. `tools/azure-resource-info/`
  is the worked Azure example.
- **Capability-bound IAM** — tools declare AWS reach in domain language
  (`iot:read`, `dynamodb:write:<table>`); your deployment binds
  capabilities to roles in `config/capabilities.yaml`. Auto-grant-reads
  by default makes the read tier zero-config.
- **Admin tools** — `list_allowlist`, `add_allowed_user`,
  `add_allowed_channel`, etc. Exposed to the agent ONLY when the
  invocation comes from an admin (configured in `config/admins.yaml`).
- **Destructive-action guard** — tools tagged `destructive` are wrapped
  by a runtime confirmation gate. First call returns "needs
  confirmation", model relays to the user, only an explicit `confirm`
  reply lets the next call through. Hard runtime check; model cannot
  bypass via prompt injection.
- **Scope-filtered tool catalog** — manifest's `access.scopes` filters
  the toolset at `list_tools()` time. Out-of-scope tools never enter
  the model's context, so they cannot be hallucinated into use.
- **Thread-keyed session history** — DynamoDB-backed, 7-day TTL, text
  transcript only (no replay of intermediate tool blocks).

## Quick start

Fork this repo, clone your fork, and follow the steps below. The whole
platform comes up with one `cdk deploy`.

> **Using Claude Code?** This repo ships `/setup` and `/setup-slack`
> skills. Open the repo in Claude Code and run **`/setup`** to have it
> drive the deploy with you (prerequisites, `cdk deploy`, secrets, smoke
> test, maintenance), then **`/setup-slack`** to wire a Slack workspace.
> The steps below are exactly what those skills automate — follow them by
> hand if you prefer.

### 1. Prerequisites

| You need                                          | How to get it / check                                                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An AWS account** with credentials on your shell | `aws sso login` (SSO) or `aws configure` (keys). Verify: `aws sts get-caller-identity`.                                                                                                                                                 |
| **AWS CLI v2**                                    | `aws --version` should print `aws-cli/2.x`.                                                                                                                                                                                             |
| **Node.js 20+** and **AWS CDK**                   | `node --version`; CDK via `npx cdk` (no global install needed).                                                                                                                                                                         |
| **Docker**, running                               | The agent runs in a container built locally at deploy time. `docker info` should succeed.                                                                                                                                               |
| **Bedrock model access**                          | In the AWS console → **Bedrock → Model access**, enable the models in `config/models.yaml` for your region (default **Claude Opus 4.7** + **Claude Haiku 4.5**). **This is the #1 first-run gotcha** — without it the agent gets a 403. |
| **arm64 build emulation** (x86/Intel hosts only)  | AgentCore requires an arm64 image. On Intel/AMD machines (most CI + Linux/WSL), enable cross-build once: `docker run --privileged --rm tonistiigi/binfmt --install arm64`. Apple Silicon builds arm64 natively — skip this.             |

### 2. Deploy everything

```bash
npm install
npx cdk bootstrap                 # once per AWS account + region
npx cdk deploy --all              # equivalently: npx cdk deploy '*'
```

Add `--context stage=<name>` to run an isolated copy (default: `dev`).
The deploy prints **outputs** you'll use next — the front-door URLs
(`SlackEventsUrl`, `WebhookUrl`) and the runtime ARN.

### 3. Connect a front door

The platform is live; now point a chat tool at it.

#### Slack (native adapter)

1. Create an app at <https://api.slack.com/apps> → **From scratch**.
2. **OAuth & Permissions → Bot Token Scopes**: add `app_mentions:read`,
   `chat:write`, `reactions:write`, `channels:history` (plus
   `groups:history` for private channels).
3. **Event Subscriptions** → enable → **Request URL** = the
   `SlackEventsUrl` deploy output. Under _Subscribe to bot events_ add
   `app_mention` (required) and `message.channels` / `message.groups`
   (optional — enables engaged-thread follow-ups without re-@mentioning).
4. **Install to Workspace**, then copy the **Bot User OAuth Token**
   (`xoxb-…`) and the **Signing Secret** (Basic Information).
5. Store the secrets: `scripts/bootstrap-secrets.sh <stage>` (prompts for
   each; auto-generates the webhook secret).
6. Copy the **Bot User ID** (Basic Information) and redeploy with
   `-c bot_user_id=U0XYZ…` for precise mention dedup.
7. Add your Slack user id to `config/admins.yaml` and redeploy — now you
   can `@mention` the bot anywhere and manage the user/channel allowlist.

#### Other platforms

| Platform            | Status                                          | Create the bot/app                                                                                               |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Slack**           | ✅ native adapter                               | <https://api.slack.com/apps>                                                                                     |
| **Generic webhook** | ✅ native adapter (HMAC-signed `POST /webhook`) | bridge anything to it                                                                                            |
| **Microsoft Teams** | 🛣️ roadmap — bridge via webhook today           | [Create a bot for Teams](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/create-a-bot-for-teams) |
| **Discord**         | 🛣️ bridge via webhook today                     | [Discord developer portal](https://discord.com/developers/applications)                                          |
| **Telegram**        | 🛣️ bridge via webhook today                     | [@BotFather](https://core.telegram.org/bots#how-do-i-create-a-bot)                                               |

Until a native adapter ships for your platform, the **webhook adapter**
is the universal bridge: a small relay on that platform translates its
events into the canonical `POST /webhook` payload (see the contract in
`platform/webhook/`). Native Teams/Discord adapters are on the roadmap.

### 4. Verify

```bash
scripts/smoke-test.sh <stage>
```

Expects **HTTP 200 + a real reply** — exercising API Gateway → runtime →
Bedrock → the `echo` tool. (Works as soon as the webhook secret is set,
even before you wire up Slack.)

### 5. Add your first tool

Copy `tools/_template/` to `tools/<your-tool>/`, edit the manifest, ship
the Python, redeploy. Worked examples: `tools/echo/` (zero-AWS),
`tools/aws-account-info/` (AWS via capabilities), and
`tools/azure-resource-info/` (non-AWS, carries its own credentials).

## How tools work

Two parallel mechanisms:

### In-tree tools (here today)

Each tool is a folder under `tools/` with a `tool.yaml` manifest and a
`tool.py` (simple form) or `pyproject.toml`-shaped package (advanced).
The manifest declares:

- `entrypoints` — which functions to expose
- `capabilities` — AWS reach in domain language
- `tags` — invocation semantics (`destructive` gets the guard)
- `access.scopes` — which front-door scopes (Slack channels etc.) see this tool
- `secrets`, `env` — Secrets Manager shells and literal env vars

See [`tools/MANIFEST.md`](tools/MANIFEST.md) for the schema and
[`config/VOCAB.md`](config/VOCAB.md) for capability conventions.

### Gateway-registered tools

An empty AgentCore Gateway is provisioned alongside the runtime. External
teams register their tools as targets on it from their own CDK apps
using `lib/constructs/TobotGatewayTarget`:

```ts
import { Gateway, ToolSchema } from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { TobotGatewayTarget } from 'tobot-agent/lib/constructs';

const gateway = Gateway.fromGatewayAttributes(this, 'TobotGateway', {
  gatewayArn: cdk.Fn.importValue('TobotAgent-GatewayArn-prod'),
  /* ... */
});

new TobotGatewayTarget(this, 'MyTeamsTools', {
  gateway,
  kind: 'lambda',
  lambdaFunction: myLambda,
  toolSchema: ToolSchema.fromInline({
    /* ... */
  }),
});
```

Three target shapes are supported: `lambda`, `openapi`, `smithy`.

**Runtime consumption:** the agent opens an MCP session to the Gateway
each invocation and merges its tools with the in-tree manifest tools
(`agent-runtime/gateway_tools.py`). It degrades gracefully — no Gateway
configured, or an unreachable one, means the agent simply runs with
in-tree tools. To actually call Gateway tools, the runtime needs a
bearer token for the Gateway's authorizer; supply one via
`GATEWAY_ACCESS_TOKEN`, or OAuth2 client-credentials env
(`GATEWAY_TOKEN_URL` + `GATEWAY_CLIENT_ID` + `GATEWAY_CLIENT_SECRET`).
This path is unit-tested against a mocked MCP client; verifying it
against a live Gateway is a post-deploy step.

## How capabilities resolve to IAM

Tools declare `capabilities: [iot:read, dynamodb:write:my-table]`. Your
`config/capabilities.yaml` binds those names to actual role ARNs in
your topology. Two binding shapes:

```yaml
# Single-account: one role per capability
capabilities:
  dynamodb:write:my-table:
    role_arn: arn:aws:iam::111:role/TobotMyTableWrite

# Multi-env: per-env bindings
capabilities:
  iot:write:
    envs:
      dev:  arn:aws:iam::111:role/TobotIotWriteDev
      prod: arn:aws:iam::222:role/TobotIotWriteProd
```

Read-only capabilities (`*:read`) are auto-granted by default — the
hub task role gets a wide read policy and tools doing reads need zero
binding. Flip `defaults.auto_grant_reads: false` in
`config/capabilities.yaml` to require explicit binding for reads too.

Synth fails loudly if a tool declares an unbound capability that isn't
auto-grantable, so typos don't slip into deploys.

## Configuration files

| file                       | purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `config/capabilities.yaml` | Capability → role-ARN bindings + auto-grant-reads flag |
| `config/admins.yaml`       | Static admin user IDs per adapter                      |
| `config/models.yaml`       | Bedrock model IDs (agent + classifier)                 |
| `config/identity.yaml`     | Cognito (default) vs OIDC (toggle)                     |
| `config/scope.yaml`        | (Reserved for cross-tool scope mapping, Phase 2c)      |
| `config/VOCAB.md`          | Capability vocabulary reference                        |

## Repo layout

```
agent-runtime/        Python — AgentCore container, Strands agent loop, tool discovery
  capabilities.py     get_session(capability, env=...) — runtime side of capability resolution
  gateway_tools.py    Opens an MCP session to the AgentCore Gateway; merges its tools with in-tree tools
  destructive_guard.py Tool wrapper enforcing destructive-action confirmation
  admin_tools.py      Allowlist-management tools (exposed when is_admin=true)
  invocation_context.py Thread-local per-invocation state
  session_store.py    Thread-keyed DDB session history
  tools/discovery.py  Manifest-driven tool loader
  main.py             AgentCore entrypoint
config/               YAML configuration (see table above)
lib/                  CDK TypeScript — stacks, manifest reader, capability registry
platform/             Front-door Lambdas (Slack adapter, webhook adapter)
tools/                Your tools (one folder per tool)
  MANIFEST.md         Tool manifest schema
  _template/          Starter tool — copy and edit
```

## Architecture

[`docs/architecture.md`](docs/architecture.md) is the quick tour — three
planes, the canonical payload, the request lifecycle, and where to look
in the tree. [`SPEC.md`](SPEC.md) has the full design rationale and
roadmap.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
