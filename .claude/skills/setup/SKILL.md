---
name: setup
description: Use when deploying, redeploying, upgrading, or tearing down a Tobot Agent fork on AWS — first deploy, `cdk deploy`, Bedrock model access, arm64 container build errors, secrets, the smoke test, or ongoing maintenance.
---

# Setup — deploy & maintain Tobot Agent

One `cdk deploy` brings up the whole platform: the AgentCore Runtime + Gateway, the Slack and webhook front doors, the session/allowlist tables, and the (empty) secret shells.

## Prerequisites — check these first

Most first-deploy failures are a missing prerequisite, not a code bug.

| Need                                       | Check / fix                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS credentials                            | `aws sts get-caller-identity`. Expired? `aws sso login` (or `aws configure`).                                                                                                                                        |
| AWS CLI v2                                 | `aws --version` → `aws-cli/2.x`.                                                                                                                                                                                     |
| Node 20+                                   | `node --version`. CDK via `npx cdk` (no global install).                                                                                                                                                             |
| Docker running                             | `docker info`. The runtime is a container built locally at deploy time.                                                                                                                                              |
| **Bedrock model access**                   | The agent + classifier ids in `config/models.yaml` must be enabled in your region (AWS console → Bedrock → **Model access**). **The #1 first-run failure** — without it the agent 403s. Invoke each once to confirm. |
| **arm64 build emulation** (x86/Intel host) | AgentCore requires an arm64 image. On Intel/AMD/WSL: `docker run --privileged --rm tonistiigi/binfmt --install arm64`. Apple Silicon builds arm64 natively — skip.                                                   |

## Deploy

```bash
npm install
npx cdk bootstrap            # once per account + region
npx cdk deploy --all         # or: npx cdk deploy '*'
```

`--context stage=<name>` deploys an isolated copy (default `dev`). Note the outputs: `WebhookUrl`, `SlackEventsUrl`, and the runtime/gateway ARNs.

## Verify

```bash
scripts/bootstrap-secrets.sh <stage>   # press enter to auto-generate the webhook secret
scripts/smoke-test.sh <stage>          # expect HTTP 200 + a real reply
```

A 200 with a non-empty `{"text": ...}` proves API Gateway → runtime → Bedrock → the `echo` tool all work — before you wire up any chat platform.

## Connect a chat front door

For Slack, **use the `setup-slack` skill**. Other platforms (Teams, Discord, …) bridge through the webhook adapter (`platform/webhook/`) until a native adapter ships.

## Maintain

| Task                | How                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Ship any change     | edit, then `npx cdk deploy --all`. Only the platform changed? `npx cdk deploy TobotAgent-Platform-<stage>` (fast — no container rebuild). |
| Swap models         | edit `config/models.yaml`, redeploy. Use a valid Bedrock inference-profile id (some require a `-v1:0` suffix; verify by invoking it).     |
| Add a tool          | copy `tools/_template/` → `tools/<name>/`, redeploy. No framework edits.                                                                  |
| Update dependencies | merge Dependabot PRs after `npm run lint && npx tsc --noEmit && npx jest`, `pytest`, and `npx cdk synth` pass.                            |
| Tear down           | Use the `uninstall` skill: `npx cdk destroy --all` (secrets included — they use `RemovalPolicy.DESTROY`) + revoke the Slack app.          |
| Logs                | CloudWatch: the verification/bridge/webhook Lambda log groups + the AgentCore runtime.                                                    |

## Troubleshooting

| Symptom                                       | Cause → fix                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `exec /bin/sh: exec format error` (build)     | Building arm64 on x86 without emulation → install binfmt (see prerequisites).                                             |
| pip `Read timed out` (build)                  | Slow emulated build. The Dockerfile already sets generous `PIP_DEFAULT_TIMEOUT`/`PIP_RETRIES` — just re-run `cdk deploy`. |
| Agent replies with a model 403 / AccessDenied | Bedrock model access not granted for that model + region.                                                                 |
| Bot silently ignores thread follow-ups        | Classifier id in `config/models.yaml` is invalid → engaged-thread following fails closed. Use a valid id.                 |
| Smoke test returns 5xx                        | Read the webhook Lambda + AgentCore runtime CloudWatch logs.                                                              |
