# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/christiantobin/tobot-agent/security) of this repository.
2. Click **Report a vulnerability**.
3. Fill out the form with as much detail as you can: affected versions, reproduction steps, suspected impact.

You will get an acknowledgement within 72 hours and a status update within 7 days. If the issue is confirmed, we will work on a fix in private and credit you in the release notes (unless you ask not to be credited).

## Supported versions

Tobot Agent is pre-1.0. Only the latest commit on `main` is supported. There are no LTS branches.

## Scope

In scope:

- The CDK app, stacks, and constructs in `lib/` and `packages/`
- The platform Lambdas in `platform/`
- The agent runtime container in `agent-runtime/`
- The CLI in `packages/cli`
- Reference tools in `examples/` (when treated as deployable code, not as documentation)

Out of scope:

- Vulnerabilities in dependencies that have not yet been patched upstream — please report those to the upstream project. We track Dependabot alerts and will pull patches as they land.
- Vulnerabilities in AWS services Tobot Agent uses (Bedrock, AgentCore Runtime, AgentCore Gateway, Cognito, etc.) — please report those to AWS.
- Misconfigurations in operator deployments. The platform's defaults aim to be safe, but operators are responsible for their scope rules, allowlists, IAM, and front-door secrets.

## Hardening guidance for operators

If you deploy Tobot Agent in your environment:

- Keep `config/admins.yaml` short. Admin users bypass the channel/user allowlist.
- Tag tools accurately at registration time. `destructive` is the strongest guard the platform offers.
- Review your scope rules in `config/scope.yaml` before exposing a new channel — the rule of least surprise applies.
- Rotate Slack signing secrets and webhook HMAC keys on a schedule.
- Treat the AgentCore Runtime container's IAM role as a privileged identity. Audit any IAM additions.
