# echo

The "hello world" of Tobot tools — no AWS, no capabilities, no secrets.
Use it to confirm the discovery + invocation path works end to end, and
as the starting point for any tool that doesn't touch AWS.

## What it exposes

| function | shape                                         | when to call                                                            |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `echo`   | `(text: str) -> {"echo": str}`                | User asks the bot to repeat/echo something, or to confirm it's working. |
| `whoami` | `() -> {"principal_id", "scope", "is_admin"}` | User asks "who am I to you?" / "am I an admin?".                        |

## Worth studying

- **`whoami` reads `invocation_context`, not an argument.** The caller's
  identity is injected by the framework per invocation and is deliberately
  not on the tool schema — so the model can't spoof it. This is the
  pattern any tool uses to know who it's acting for.
- The guarded `import invocation_context` lets the module load in a bare
  environment (e.g. unit tests) without the runtime on the path.

## Setup

It ships enabled. To smoke-test a deploy, `@mention` the bot and ask it
to "echo hello" or "tell me who I am to you."
