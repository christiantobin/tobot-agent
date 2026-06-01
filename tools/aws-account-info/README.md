# aws-account-info

A worked example of a **read-only AWS tool** — copy this when your tool
needs AWS reach. It demonstrates the framework's core abstraction:
declare capabilities in domain language, let the runtime resolve them to
credentials.

## What it exposes

| function          | shape                                                              | when to call                                           |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `who_am_i`        | `() -> {success, account, arn, user_id}`                           | "What account are we in?" / "Who does the bot run as?" |
| `list_log_groups` | `(prefix="", limit=50) -> {success, log_groups, count, truncated}` | "What log groups exist?" / find a group by prefix.     |

## Worth studying

- **Capabilities, not ARNs.** The code calls
  `get_session("sts:read")` / `get_session("cloudwatch:read")`. It never
  names a role. `config/capabilities.yaml` is where those names bind to
  IAM in your topology — single-account or multi-stage, the tool code is
  identical.
- **Reads are free by default.** Both capabilities are `*:read`, and
  `defaults.auto_grant_reads: true` covers them — so this tool deploys
  with **zero** capability bindings. Change one to a write and synth
  fails until you bind it. That asymmetry is intentional.
- **Never raises.** Every entrypoint returns `{"success": ...}` so a
  transient AWS error becomes data the model can reason over, not a
  crashed turn.

## Setup

Ships enabled and works on a fresh deploy (reads are auto-granted). No
bindings required unless you flip `auto_grant_reads` off in
`config/capabilities.yaml`, in which case add:

```yaml
capabilities:
  sts:read:
    role_arn: arn:aws:iam::<acct>:role/<role-with-sts-and-logs-read>
  cloudwatch:read:
    role_arn: arn:aws:iam::<acct>:role/<role-with-sts-and-logs-read>
```
