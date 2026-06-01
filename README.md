# Tobot Agent

An open-source CDK template for an org-wide AI agent on AWS. One-shot
deploy gets you a Bedrock-backed AI member of your team — reachable
through Slack and a generic webhook, with tools you ship on your own
cadence.

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

```bash
git clone <this repo>
cd tobot-agent
npm install
npx cdk bootstrap                              # first time per account/region
npx cdk deploy --all
```

After the deploy:

1. **Populate the secrets** (CDK creates empty shells). The stack outputs
   print the ARNs:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id <SlackSigningSecretArn>    --secret-string '<from-slack-app>'
   aws secretsmanager put-secret-value \
     --secret-id <SlackBotTokenArn>         --secret-string 'xoxb-...'
   aws secretsmanager put-secret-value \
     --secret-id <WebhookSigningSecretArn>  --secret-string "$(openssl rand -hex 32)"
   ```

2. **Register your Slack app**: point Event Subscriptions at the
   `SlackEventsUrl` output. Subscribe to:
   - `app_mention` — required, the primary invocation path.
   - `message.channels` (and `message.groups` for private channels) —
     optional but recommended; enables engaged-thread following so
     users don't have to re-@mention you for every follow-up.

   After install, grab the bot user id from the app's *Basic
   Information* page and redeploy with `-c bot_user_id=U0XYZ...` so the
   engaged-thread dedup is precise (without it, dedup falls back to a
   heuristic that occasionally drops thread replies containing
   non-bot user mentions).

3. **Bootstrap an admin**: add your Slack user ID to
   `config/admins.yaml`, run `npx cdk deploy` again. Now you can
   `@-mention` the bot from any channel and use the allowlist-management
   tools to add users/channels for non-admins.

4. **Add your first tool**: copy `tools/_template/` to
   `tools/<your-tool>/`, edit the manifest, ship the Python. Redeploy.

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
  toolSchema: ToolSchema.fromInline({ /* ... */ }),
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

| file | purpose |
| ---- | ------- |
| `config/capabilities.yaml` | Capability → role-ARN bindings + auto-grant-reads flag |
| `config/admins.yaml` | Static admin user IDs per adapter |
| `config/models.yaml` | Bedrock model IDs (agent + classifier) |
| `config/identity.yaml` | Cognito (default) vs OIDC (toggle) |
| `config/scope.yaml` | (Reserved for cross-tool scope mapping, Phase 2c) |
| `config/VOCAB.md` | Capability vocabulary reference |

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

See [`SPEC.md`](SPEC.md) for the architecture, design rationale, and
roadmap.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
