# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 0 scaffold: empty CDK app with `TobotAgent-Platform-{stage}` and `TobotAgent-AgentCore-{stage}` stacks that synthesize cleanly.
- `SPEC.md` capturing the architecture and design decisions.
- `agent-runtime/` Python container scaffold with a hello-world AgentCore entrypoint.
- `config/` directory with `models.yaml`, `scope.yaml`, `identity.yaml`, `admins.yaml`.
- Apache 2.0 license, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY policy.
- Standard GitHub project files: issue templates, PR template, Dependabot, FUNDING, CODEOWNERS, CI workflow.
- Capability model: tools declare AWS reach in domain language (`config/capabilities.yaml`, `config/VOCAB.md`); synth binds capabilities to IAM with reads auto-granted by default.
- Manifest-driven tool discovery (`tools/*/tool.yaml`); Slack + webhook front-door adapters; admin tools; destructive-action confirmation guard; thread-keyed session history.
- AgentCore Gateway: shell + `TobotGatewayTarget` consumer construct, and runtime consumption (`agent-runtime/gateway_tools.py`) that merges Gateway-registered tools with in-tree tools, degrading gracefully when no Gateway is configured.
- Example tools: `tools/echo/` (zero-AWS smoke-test) and `tools/aws-account-info/` (read-only, demonstrates the capability→IAM binding).
- Test suites: jest (TypeScript, 61 tests) and pytest (Python, 24 tests), both wired into CI alongside eslint/prettier/ruff linting.
- First-run scripts: `scripts/bootstrap-secrets.sh` and `scripts/smoke-test.sh`.
- `docs/architecture.md` quick-tour.

[Unreleased]: https://github.com/christiantobin/tobot-agent/commits/main
