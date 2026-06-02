# Tools & capabilities

How Tobot's tools work, and how they get their AWS (and non-AWS) access.
For the manifest field reference see [`../tools/MANIFEST.md`](../tools/MANIFEST.md);
for capability naming see [`../config/VOCAB.md`](../config/VOCAB.md).

## Two ways to add a tool

### In-tree tools (here today)

Each tool is a folder under `tools/` with a `tool.yaml` manifest and a
`tool.py` (simple form) or a `pyproject.toml`-shaped package (advanced).
The agent discovers it at the next container start — no framework code
edits per tool. The manifest declares:

- `entrypoints` — which functions to expose
- `capabilities` — AWS reach in domain language
- `tags` — invocation semantics (`destructive` gets the confirmation guard)
- `access.scopes` — which front-door scopes (Slack channels, etc.) see this tool
- `secrets`, `env` — Secrets Manager shells and literal env vars

Worked examples: [`../tools/echo/`](../tools/echo/) (zero-AWS),
[`../tools/aws-account-info/`](../tools/aws-account-info/) (AWS via
capabilities), and [`../tools/azure-resource-info/`](../tools/azure-resource-info/)
(non-AWS, carries its own credentials).

### Gateway-registered tools

An empty AgentCore Gateway is provisioned alongside the runtime. External
teams register their tools as targets on it from their own CDK apps using
`lib/constructs/TobotGatewayTarget`:

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
in-tree tools. To actually call Gateway tools, the runtime needs a bearer
token for the Gateway's authorizer; supply one via `GATEWAY_ACCESS_TOKEN`,
or via OAuth2 client-credentials env vars (`GATEWAY_TOKEN_URL`,
`GATEWAY_CLIENT_ID`, and `GATEWAY_CLIENT_SECRET`). This path is unit-tested
against a mocked MCP client; verifying it against a live Gateway is a
post-deploy step.

## How capabilities resolve to IAM

Tools declare `capabilities: [iot:read, dynamodb:write:my-table]`. Your
`config/capabilities.yaml` binds those names to actual role ARNs in your
topology. Two binding shapes:

```yaml
# Single-account: one role per capability
capabilities:
  dynamodb:write:my-table:
    role_arn: arn:aws:iam::111:role/TobotMyTableWrite

# Multi-env: per-env bindings
capabilities:
  iot:write:
    envs:
      dev: arn:aws:iam::111:role/TobotIotWriteDev
      prod: arn:aws:iam::222:role/TobotIotWriteProd
```

Read-only capabilities (`*:read`) are auto-granted by default — the hub
task role gets a wide read policy and tools doing reads need zero binding.
Flip `defaults.auto_grant_reads: false` in `config/capabilities.yaml` to
require explicit binding for reads too.

Synth fails loudly if a tool declares an unbound capability that isn't
auto-grantable, so typos don't slip into deploys.

Non-AWS tools (e.g. the Azure example) skip the capability model entirely
and carry their own credentials via the manifest's `secrets:` block —
that's how an AWS-hosted agent reaches across clouds.
