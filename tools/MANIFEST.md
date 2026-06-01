# Tool manifest schema (`tool.yaml`)

Every directory under `tools/` that ships a Tobot Agent tool MUST contain a
`tool.yaml`. The manifest is the single source of truth for:

- **Build-time** (Dockerfile): which Python packages get installed into the agent container.
- **Synth-time** (CDK): which IAM permissions, Secrets Manager grants, and capability assume-role grants are added to the agent's execution role.
- **Run-time** (agent container): which Python module is imported and which `@strands.tool` callables are exposed to the agent loop.

**A new tool ships without editing any framework code** — drop a folder under `tools/`, redeploy, done.

---

## Schema

```yaml
# Required ----------------------------------------------------------------

name: my-tool                       # kebab-case, must match the directory name
version: 0.1.0                      # semver
description: |                      # human-readable AND model-readable —
  This is what the agent sees in its toolset. Write it for the model:
  what does this tool let me do, and when should I reach for it?

# How the tool ships in the container -------------------------------------

module: my_tool                     # snake_case Python module name (the .py
                                    # file for simple-form tools, or the
                                    # importable package name for package-form)

entrypoints:                        # @strands.tool functions to expose
  - do_the_thing
  - get_the_other_thing

# Optional ----------------------------------------------------------------

# CAPABILITIES — what AWS reach does this tool need? Declared in domain
# language; bound to actual roles in config/capabilities.yaml at synth
# time. Synth fails if a capability isn't bound (typos can't slip through).
capabilities:
  - iot:read
  - dynamodb:write:my-registry-table

# IAM ESCAPE HATCH — for IAM that can't be expressed as a capability binding.
# Most tools should not need this. If you do, the actions/resources are
# added DIRECTLY to the hub task role (not via assume-role), so use sparingly.
iam:
  - actions: ['ses:SendEmail']
    resources: ['arn:aws:ses:us-west-2:*:identity/notifications@example.com']

# SECRETS — empty Secrets Manager shells CDK creates and grants read on.
# Populate the value once per env post-deploy:
#   aws secretsmanager put-secret-value --secret-id tobot-agent/<name> ...
secrets:
  - name: my-tool-api-key
    description: API key for upstream service. Populate manually post-deploy.
    env: MY_TOOL_API_KEY_SECRET_ARN

# ENV VARS — literal (non-secret) env vars injected into the runtime.
env:
  MY_TOOL_API_BASE: https://api.example.com
  MY_TOOL_TIMEOUT: "30"

# TAGS — invocation-time semantics. Currently recognized:
#   read         — informational; default if no tags set.
#   write        — invokes external state change. Logged + flagged in reply.
#   destructive  — DELETE-shaped operation. Runtime wraps the tool in a
#                  confirmation guard: the first call returns a
#                  `requires_confirmation` response that instructs the
#                  model to ask the user, and only a follow-up turn
#                  with explicit confirmation lets it through.
#                  Hard runtime check — model cannot bypass.
tags:
  - destructive

# AUTO-REGISTER — defaults true. Set false if a framework wrapper needs
# to decorate the entrypoints before exposing them (e.g. for custom
# auth or audit logging).
auto_register: true

# ACCESS — per-invocation gating. If unset, the tool is visible to every
# invocation. If set, the tool is filtered OUT of the agent's toolset
# for invocations that don't match — the model never sees the name, so
# it cannot be hallucinated into use.
#
# Scopes are opaque strings the front-door adapter provides. Slack
# adapter passes channel IDs; webhook adapter passes whatever string
# was on the inbound event. Make these match your adapter's convention.
access:
  scopes:
    - C0ABC1234   # a Slack channel id, for example
```

---

## Two authoring forms

### Simple form (recommended starting point)

A single Python file. No `pyproject.toml`. No `src/` layout. Just:

```
tools/my-tool/
├── tool.yaml
├── tool.py            # contains @tool functions
├── requirements.txt   # pip deps (optional)
└── README.md
```

Set `module: tool` in the manifest. Discovery adds the directory to `sys.path` and imports `tool`.

### Package form (for tools shared across projects, or maintained as their own repo / git submodule)

A full Python package:

```
tools/my-tool/
├── tool.yaml
├── pyproject.toml
├── src/my_tool/
│   ├── __init__.py
│   └── ...
└── tests/
```

Set `module: my_tool` in the manifest. Discovery `pip install`s the package at container build time.

---

## How capabilities resolve to IAM

At synth time, the CDK stack reads each tool's `capabilities: [...]`, looks up
each name in `config/capabilities.yaml`, and either:

- **Adds `sts:AssumeRole` on the bound role ARN** (the common case), OR
- **Adds a read policy on the hub task role** (if the capability is a `*:read`
  and `defaults.auto_grant_reads: true` is set), OR
- **Fails synth loudly** if the capability isn't bound (and `auto_grant_reads`
  doesn't cover it).

At runtime, the tool calls `capabilities.get_session("capability-name", env="dev")`
and receives a `boto3.Session`. For auto-granted reads the session is just the
default; for bound capabilities the session is backed by the assumed role.

See `config/VOCAB.md` for the recommended capability names.

## How secrets work

CDK creates an empty Secrets Manager shell (so its ARN is stable) and grants the
runtime role read access. Populate the value once per env post-deploy:

```bash
aws secretsmanager put-secret-value \
  --secret-id tobot-agent/<secret-name> \
  --secret-string '{"api_key":"..."}'
```

The tool fetches it lazily at first call:

```python
import json, os, boto3
def _get_api_key() -> str:
    arn = os.environ["MY_TOOL_API_KEY_SECRET_ARN"]
    resp = boto3.client("secretsmanager").get_secret_value(SecretId=arn)
    return json.loads(resp["SecretString"])["api_key"]
```

Lazy fetch means populating the secret post-deploy doesn't require a container
roll — the next tool call picks it up.
