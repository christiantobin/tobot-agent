# my-tool

Replace this README with what your tool does. Keep it short — readers
who want the deep version can read `tool.py`.

## What it exposes

| function | shape | when to call |
| -------- | ----- | ------------ |
| `hello`  | `(name: str) -> dict` | Replace with your actual entrypoints. |

## Setup

1. Copy this whole `tools/_template/` directory to `tools/<your-tool-name>/`.
2. Rename the tool in `tool.yaml` (`name:` field) and in `module:` if you
   rename `tool.py`.
3. Add any capabilities you need in `config/capabilities.yaml` and list
   them in `tool.yaml`'s `capabilities:` block.
4. Redeploy: `npx cdk deploy --all`.

The agent discovers the tool at the next container start. No framework
code edits required.
