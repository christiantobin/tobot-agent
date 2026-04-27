# Tobot Agent

An open-source CDK template for an org-wide AI agent on AWS. One-shot deploy gets you a Slack-reachable AI member of your team with pluggable MCP tools your developers ship on their own cadence.

> **Status:** v0 scaffold. See [`SPEC.md`](SPEC.md) for the full design.

## What you get

- Tobot Agent running on **Bedrock AgentCore Runtime** (Claude Opus 4.7 by default)
- Two front-door adapters in v1: **Slack** and a **generic HTTPS webhook**
- **AgentCore Gateway** as the pluggable MCP tool registry — your developers register tools from their own repos, the agent picks them up automatically
- Read / write / destructive tool taxonomy with hard-runtime confirmation guards
- Channel-scoped tool access — out-of-scope tools never enter the model's context
- Cognito by default, BYO OIDC via config toggle

## Quick start

```bash
git clone <this repo>
cd tobot-agent
npm install
npx cdk bootstrap
npx cdk deploy --all
```

(More detailed guides land as the platform takes shape — this README will fill out as v0 → v1.)

## Architecture

See [`SPEC.md`](SPEC.md) for the architecture, design rationale, and v1 / v1.x scope.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
