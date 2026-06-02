# Configuration & repo layout

## Configuration files

All deployment-specific configuration lives in `config/` as YAML — edit
these, not the stacks.

| file                       | purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `config/capabilities.yaml` | Capability → role-ARN bindings + auto-grant-reads flag |
| `config/admins.yaml`       | Static admin user IDs per adapter                      |
| `config/models.yaml`       | Bedrock model IDs (agent + classifier)                 |
| `config/identity.yaml`     | Cognito (default) vs OIDC (toggle)                     |
| `config/scope.yaml`        | (Reserved for cross-tool scope mapping)                |
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

See [`architecture.md`](architecture.md) for the three planes, the
canonical runtime payload, and the request lifecycle.
