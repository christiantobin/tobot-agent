# Contributing to Tobot Agent

Thanks for your interest. Tobot Agent is an open template for an AWS-hosted, MCP-pluggable AI agent — contributions that make it easier to deploy, easier to extend with tools, or easier to wire to a new front door are very welcome.

## Ways to contribute

- **Report a bug.** Open an issue using the bug-report template.
- **Request a feature.** Open an issue using the feature-request template. For larger changes, please open the issue _first_ — alignment before implementation saves everyone time.
- **Add a front-door adapter.** Teams, Jira-as-trigger, WhatsApp, Discord — see `docs/adding-an-adapter.md` (coming soon) or model on the Slack adapter under `platform/`.
- **Add a reference tool.** Copy `tools/_template/` to `tools/<name>/`. The `tools/echo/` and `tools/aws-account-info/` tools are worked examples — keep new ones small and self-contained.
- **Improve docs.** README, SPEC, in-code comments — clearer is always better than longer.

## Development setup

```bash
git clone https://github.com/christiantobin/tobot-agent.git
cd tobot-agent
npm install
npx cdk synth   # verify your environment can synth the stacks
```

For the agent runtime (Python):

```bash
cd agent-runtime
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python main.py    # serves on :8080
```

## Tests and linting

Both run in CI; run them locally before opening a PR.

```bash
# TypeScript (CDK + adapters)
npm run lint          # eslint + prettier --check
npm run format        # prettier --write (auto-fix)
npm test              # jest
npx tsc --noEmit      # type-check

# Python (agent runtime), from agent-runtime/ with the venv active
ruff check .          # lint (ruff check --fix to auto-fix)
python -m pytest      # tests
```

## Pull request guidelines

- Open against `main`. Keep PRs focused — one concern per PR.
- The PR description should answer: _what changed_, _why_, and _how it was tested_.
- CI must pass: lint (eslint/prettier/ruff), type-check, `cdk synth`, and the jest + pytest suites. PRs with red CI will be asked to fix before review.
- Avoid drive-by refactors in feature PRs — open a separate PR for cleanup.
- For changes that affect public surface (`config/` shape, `TobotGatewayTarget` construct API, adapter contract), please open a discussion or issue first.

## Code style

- **TypeScript** (CDK, adapter Lambdas): match the existing style. Strict mode is on. No `any` without comment.
- **Python** (agent runtime): PEP 8, type hints required, `from __future__ import annotations` at the top.
- Comments explain _why_, not _what_. Skip them when the code is self-evident.

## Commit messages

- Imperative mood: "Add Teams adapter," not "Added Teams adapter."
- One subject line under 72 chars; body wrapped at 80 if longer rationale is needed.

## Reporting security issues

**Do not open a public issue for security vulnerabilities.** See [`SECURITY.md`](SECURITY.md) for the disclosure process.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to its terms.

## License

By contributing, you agree your contributions will be licensed under [Apache 2.0](LICENSE).
