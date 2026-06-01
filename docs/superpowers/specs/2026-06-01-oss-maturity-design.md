# Tobot Agent — OSS-readiness maturity push

Date: 2026-06-01
Author: Christian Tobin (with Claude)
Status: approved, in implementation

## Goal

Take `tobot-agent` from "scaffold + features landed" to "a stranger can
clone it, deploy it, run a tool in their first hour, and trust that the
load-bearing parts work." Get it ready to share broadly.

The OSS hygiene layer (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY,
CHANGELOG, full `.github/`) already exists. This effort closes the four
gaps that remain: no example tools, no tests, one documented functional
gap (Gateway runtime consumption), and first-run friction.

## Workstreams (in implementation order)

### 1. Example tools — the onboarding artifacts

Newcomers learn by copying. `_template/` stays a bare skeleton; we add
two *teaching* tools that exercise real manifest features.

- **`tools/echo/`** — zero-AWS, zero-capability. Entrypoints:
  - `echo(text)` — returns the text back.
  - `whoami()` — surfaces `principal_id` / `scope` / `is_admin` read from
    `invocation_context`, demonstrating how a tool sees its caller.
  - Tag: `read`. Runs in minute one with no IAM. The canonical
    "did my deploy work?" tool.
- **`tools/aws-account-info/`** — read-only, demonstrates the
  capability→IAM binding (the framework's core abstraction).
  - `who_am_i()` via `sts:read` — STS get-caller-identity (needs no
    special perms; works under auto-grant-reads).
  - `list_log_groups(prefix)` via `cloudwatch:read` — shows a named
    capability resolving through `capabilities.get_session()`.
  - Structured `{success, ...}` / `{success: false, error}` returns,
    never-raise. Heavily commented as a teaching artifact.

Both tools' manifests show `entrypoints`, `capabilities`, `tags`,
`access.scopes`.

### 2. Test suite + real CI — trust

CI currently only does `tsc --noEmit`, `cdk synth`, and Python
`compileall`. None of it proves behavior. Add real tests on the
load-bearing units.

- **TypeScript (jest + ts-jest):**
  - `capability-registry` — `isReadCapability`; `resolveAssumeRoleArns`
    returns ARNs when bound, throws on unbound non-read, honors
    auto-grant-reads for reads.
  - `tool-manifests` — parses a fixture `tool.yaml` (capabilities, tags,
    scopes, secrets, env).
  - `conventions` — table-name helpers.
  - **Slack HMAC** (`slack-signature.ts`) — valid / tampered body /
    stale timestamp.
  - **Webhook HMAC** (`signature.ts`) — valid / tampered / stale.
  - `isExplicitConfirmation` — regex accepts `confirm`, rejects prose.
  - `chooseRoute` / mention-dedup — app_mention→queue, bot-id drop,
    subtype drop, mention dedup.
- **Python (pytest):**
  - `destructive_guard` — unconfirmed call returns the confirmation
    gate; confirmed call passes through; `tool_spec` preserved through
    the wrap.
  - `capabilities.get_session` — auto-grant-reads fallback to the
    default session (mocked boto3 / STS).
  - `tools/discovery` — manifest load + `filter_for_invocation(scope)`.
  - `invocation_context` — threadlocal set + `reset()`.
- **CI:** add a jest step; replace `compileall` with `pytest`; keep tsc
  + synth. A `jest.config.js` and `pytest`/`requirements-dev.txt` land
  with this.

### 3. Functional completeness — close the Gateway gap

Today the runtime never calls Gateway-registered tools. Wire it.

- **`agent-runtime/gateway_tools.py`** — `load_gateway_tools()`:
  - Reads `GATEWAY_URL` + identity config (Cognito client-credentials
    token, or the OIDC toggle's issuer).
  - Connects a Strands MCP client to the Gateway MCP endpoint with a
    bearer token, lists tools, returns proxies usable by the agent loop.
  - **No-ops gracefully when `GATEWAY_URL` is unset** — local dev, and
    deploys that don't use a Gateway, keep working unchanged.
- **`main.py`** — merge Gateway tool proxies into the tool set assembled
  for the agent (alongside in-tree manifest tools, after scope filter /
  admin gating semantics are preserved).
- **Unit test** with a mocked MCP client (connect → list → one proxy
  appears in the merged set; unset URL → empty, no error).
- **Docs** — remove the "open gap" caveat from SPEC/README; recharac-
  terize as "wired + unit-tested; verify against a live Gateway after
  deploy." Full e2e requires real AWS and is out of scope for this pass.

### 4. Polish / contributor UX

- **Lint/format:** eslint + prettier (TS), ruff (py). `lint` + `format`
  npm scripts. CI lint job.
- **First-run scripts:**
  - `scripts/bootstrap-secrets.sh` — reads stack outputs, sets the three
    Secrets Manager secrets (Slack signing, Slack bot token, webhook
    signing). Kills the README copy-paste.
  - `scripts/smoke-test.sh` — sends a signed request to the webhook,
    asserts HTTP 200 + a text body. Confirms a deploy is live.
- **Docs:** README badges (CI, license); CONTRIBUTING updated to the
  real test/lint commands; short `docs/architecture.md` (the three
  planes + request lifecycle).

## Non-goals (stay on v1.x roadmap)

Teams adapter, OIDC wiring beyond the existing config toggle, AgentCore
Memory, async tools, per-target Gateway ACLs, live e2e Gateway
verification.

## Risks / open items

- **Gateway live-verification deferred.** The wiring is unit-tested
  against a mocked MCP client but not run against a real AgentCore
  Gateway from this environment. Flagged in docs as a post-deploy step.
- **Strands MCP client API surface.** `gateway_tools.py` depends on the
  Strands MCP-client integration; if the API differs from assumption,
  the module is isolated enough to adjust without touching the loop.

## Verification

Each workstream ends green:
- `npx tsc --noEmit` clean
- `npx jest` green
- `pytest agent-runtime` green
- `npx cdk synth --all` clean
- `npm run lint` clean
