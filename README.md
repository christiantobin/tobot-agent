# Tobot Agent

[![CI](https://github.com/christiantobin/tobot-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/christiantobin/tobot-agent/actions/workflows/ci.yml)
[![CodeQL](https://github.com/christiantobin/tobot-agent/actions/workflows/codeql.yml/badge.svg)](https://github.com/christiantobin/tobot-agent/actions/workflows/codeql.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![AWS CDK](https://img.shields.io/badge/CDK-AWS_AgentCore-FF9900?logo=amazonaws&logoColor=white)](SPEC.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://prettier.io)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](CODE_OF_CONDUCT.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/christiantobin/tobot-agent?style=flat)](https://github.com/christiantobin/tobot-agent/stargazers)

> **A 24/7 AI teammate for your org — deployed with one command.**

`@mention` it in Slack and it investigates, answers, and acts using tools
your developers ship. It runs on AWS (Bedrock AgentCore) and reaches
across your whole stack — AWS, Azure, GCP, SaaS.

```text
You    @tobot which log groups exist for the payments service?
tobot  3 under /aws/lambda/payments-* — api, worker, reconciler
You    and what account are we in?        ← no @mention; it follows the thread
tobot  123456789012 (dev), running as the Tobot runtime role.
```

One `cdk deploy` brings up the agent, the Slack + webhook front doors,
and the plumbing for anyone to add a capability by dropping a folder.

**→ [Quick start](#quick-start) · [Architecture](docs/architecture.md) · [Writing a tool](docs/tools.md) · [SPEC](SPEC.md)**

## Why Tobot

- **One command.** `cdk deploy` stands up the agent, both front doors, and all the wiring.
- **Lives where you already work.** Native Slack adapter today; a generic webhook bridges anything else.
- **Capabilities, not forks.** Add a tool by dropping a folder under `tools/` — no edits to the core.
- **Whole-estate reach.** AWS-native platform, but the agent can operate any cloud or SaaS — every integration is just a tool.
- **Safe by default.** User/channel allowlist, admin gating, a hard destructive-action confirmation guard, and per-scope tool filtering.
- **Yours to run.** Bedrock-backed, Apache-2.0, no SaaS middleman. Swap the model in `config/models.yaml`.

## Quick start

Fork this repo, clone your fork, and follow the steps below. The whole
platform comes up with one `cdk deploy`.

> **Using Claude Code?** This repo ships `/setup`, `/setup-slack`, and
> `/uninstall` skills. Run **`/setup`** to have it drive the deploy with
> you, then **`/setup-slack`** to wire a Slack workspace — and
> **`/uninstall`** to tear it all down cleanly. The steps below are
> exactly what those skills automate.

### 1. Prerequisites

| You need                                                                                                                | How to get it / check                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[An AWS account](https://aws.amazon.com/resources/create-account/)** with credentials on your shell                   | `aws sso login` (SSO) or `aws configure` (keys). Verify: `aws sts get-caller-identity`.                                                                                                                                                                                                    |
| **[AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)**                         | `aws --version` should print `aws-cli/2.x`.                                                                                                                                                                                                                                                |
| **[Node.js 20+](https://nodejs.org/)** and **[AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html)** | `node --version`; CDK via `npx cdk` (no global install needed).                                                                                                                                                                                                                            |
| **[Docker](https://docs.docker.com/get-docker/)**, running                                                              | The agent runs in a container built locally at deploy time. `docker info` should succeed.                                                                                                                                                                                                  |
| **[Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)**                      | In the AWS console → **Bedrock → Model access**, enable the models in `config/models.yaml` for your region (default **Claude Opus 4.7** + **Claude Haiku 4.5**). **The #1 first-run gotcha** — without it the agent gets a 403.                                                            |
| **arm64 build emulation** (x86/Intel hosts only)                                                                        | AgentCore requires an arm64 image. On Intel/AMD machines (most CI + Linux/WSL), enable cross-build once with [tonistiigi/binfmt](https://github.com/tonistiigi/binfmt): `docker run --privileged --rm tonistiigi/binfmt --install arm64`. Apple Silicon builds arm64 natively — skip this. |

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

The fastest path is the app manifest in
[`docs/slack/app-manifest.example.yaml`](docs/slack/app-manifest.example.yaml)
(replace its `request_url` with your `SlackEventsUrl`):
**[api.slack.com/apps](https://api.slack.com/apps) → Create New App → From
an app manifest → paste**. Then:

1. **Install to Workspace** and copy the **Bot User OAuth Token**
   (`xoxb-…`, under _OAuth & Permissions_) and the **Signing Secret**
   (_Basic Information_).
2. Store the secrets: `scripts/bootstrap-secrets.sh <stage>`.
3. Copy the **Bot User ID** and redeploy with `-c bot_user_id=U0XYZ…` for
   precise mention dedup.
4. Add your Slack user ID to `config/admins.yaml` and redeploy — now you
   can `@mention` the bot and manage the allowlist.

Step-by-step (with the scopes and troubleshooting): the
[`/setup-slack` skill](.claude/skills/setup-slack/SKILL.md).

#### Other platforms

| Platform            | Status                                          | Create the bot/app                                                                                               |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Slack**           | ✅ native adapter                               | <https://api.slack.com/apps>                                                                                     |
| **Generic webhook** | ✅ native adapter (HMAC-signed `POST /webhook`) | bridge anything to it                                                                                            |
| **Microsoft Teams** | 🛣️ roadmap — bridge via webhook today           | [Create a bot for Teams](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/create-a-bot-for-teams) |
| **Discord**         | 🛣️ bridge via webhook today                     | [Discord developer portal](https://discord.com/developers/applications)                                          |
| **Telegram**        | 🛣️ bridge via webhook today                     | [@BotFather](https://core.telegram.org/bots#how-do-i-create-a-bot)                                               |

Until a native adapter ships, the **webhook adapter** is the universal
bridge: a small relay translates the platform's events into the canonical
`POST /webhook` payload (contract in `platform/webhook/`).

### 4. Verify

```bash
scripts/smoke-test.sh <stage>     # expect HTTP 200 + a real reply
```

This exercises the whole path — API Gateway → runtime → Bedrock → the
`echo` tool — and works before you even wire up Slack.

## Add a tool

Copy `tools/_template/` to `tools/<your-tool>/`, edit the manifest, ship
the Python, redeploy — no core edits. The agent picks it up at the next
container start.

Start from a worked example: [`tools/echo/`](tools/echo/) (zero-AWS),
[`tools/aws-account-info/`](tools/aws-account-info/) (AWS via
capabilities), or [`tools/azure-resource-info/`](tools/azure-resource-info/)
(non-AWS, carries its own credentials). Full guide:
**[docs/tools.md](docs/tools.md)**.

## Learn more

| Doc                                             | What's in it                                                   |
| ----------------------------------------------- | -------------------------------------------------------------- |
| [Architecture](docs/architecture.md)            | The three planes, the canonical payload, the request lifecycle |
| [Tools & capabilities](docs/tools.md)           | Authoring tools, the Gateway, capability → IAM resolution      |
| [Configuration & layout](docs/configuration.md) | The `config/` files and the repo map                           |
| [SPEC](SPEC.md)                                 | Full design rationale, decisions, and roadmap                  |
| [Contributing](CONTRIBUTING.md)                 | Dev setup, tests, and how to propose changes                   |

## Status

**v1, in development.** Landed: Slack adapter (with engaged-thread
following), webhook adapter, manifest-driven tools, capability-bound IAM,
admin tools, destructive-action confirmation, and AgentCore Gateway
(construct + runtime consumption). Next: approver-reaction confirmation
and live-Gateway end-to-end verification. Details in [`SPEC.md`](SPEC.md).

## License

Apache 2.0. See [`LICENSE`](LICENSE).
