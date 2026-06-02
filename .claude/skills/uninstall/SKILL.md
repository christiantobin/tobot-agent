---
name: uninstall
description: Use when removing or tearing down a deployed Tobot Agent — running cdk destroy, cleaning up leftover Secrets Manager secrets or Lambda log groups, revoking the Slack app/token, or fully deprovisioning a stage.
---

# Uninstall — tear down a Tobot Agent deployment

`cdk destroy` removes the stacks; a couple of follow-ups handle what AWS leaves behind (the Slack app, and anything not owned by the stack).

## 1. Destroy the stacks

```bash
npx cdk destroy --all --context stage=<stage>     # both stacks for the stage
```

In a **shared AWS account**, destroy by explicit name rather than `--all` — belt-and-suspenders so you only touch Tobot's stacks:

```bash
npx cdk destroy TobotAgent-Platform-<stage> TobotAgent-AgentCore-<stage> \
  --context stage=<stage>
```

The Platform stack destroys first (it depends on AgentCore). Confirm nothing's left:

```bash
npx cdk list
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName,'TobotAgent')].StackName"
```

## 2. Secrets

The framework's secrets — `tobot-agent/slack/*`, `tobot-agent/webhook/*`, and any tool `secrets:` (e.g. `tobot-agent/azure-sp-*`) — use `RemovalPolicy.DESTROY`, so `cdk destroy` removes them with **no recovery-window leftover**. Verify, and force-delete any that linger (a tool that set RETAIN, or a secret you created by hand):

```bash
aws secretsmanager list-secrets --include-planned-deletion \
  --query "SecretList[?starts_with(Name,'tobot-agent/')].Name" --output text
# for any that remain:
aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery
```

## 3. Revoke the Slack app

`cdk destroy` can't touch Slack. At <https://api.slack.com/apps> → your app → **Delete App** (or **OAuth & Permissions → Revoke** the bot token). The bot stops working the moment the stacks are gone regardless, but this closes the loop.

## 4. Optional — full wipe of leftovers

A few things `cdk destroy` leaves behind:

- **Lambda log groups** — `/aws/lambda/tobot-agent-*` may persist (Lambda auto-creates them). Remove with `aws logs delete-log-group --log-group-name <name>`.
- **Container image + CDK assets** — the agent image (in the CDK ECR repo) and build assets (in the `cdk-*-assets-*` bucket) are owned by the shared **CDKToolkit** bootstrap, not by Tobot's stacks. Leave the bootstrap alone unless you're fully deprovisioning the account/region; only then empty those.

**Don't delete the `CDKToolkit` stack** unless no other CDK app uses the account/region.

## Verify it's gone

```bash
npx cdk list                                  # no Tobot stacks
aws secretsmanager list-secrets --include-planned-deletion \
  --query "length(SecretList[?starts_with(Name,'tobot-agent/')])"   # -> 0
```
