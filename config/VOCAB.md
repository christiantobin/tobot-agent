# Capability vocabulary

Tools declare what they need in capability names. The framework's job is to
map those names to actual IAM permissions at deploy time. This file is the
reference for the **conventional vocabulary** the framework recognizes.

You are not required to use these names. The framework only checks that
every capability a tool's manifest declares appears in your
`config/capabilities.yaml`. Made-up names are fine if every tool that uses
them is binding-aware.

The convention exists so a tool written by someone in another org has a
fighting chance of working in yours without renaming. If you adopt the
vocabulary, ecosystem tools just work.

## Format

```
<service>:<verb>[:<scope>]
```

- `service` — AWS service (`iot`, `s3`, `dynamodb`, `lambda`, `secretsmanager`,
  `cloudwatch`, `athena`, `glue`, ...) or a domain concept (`registry`,
  `telemetry`).
- `verb` — `read` (list/describe/get), `write` (create/update/delete that
  doesn't destroy data), `destructive` (delete/drop), or `invoke` (Lambda /
  API). Tools self-classify; the framework doesn't validate.
- `scope` — optional resource identifier (bucket name, table name, function
  name). Use when the IAM policy needs to be resource-pinned.

## Common capabilities

| name                              | shape    | typical IAM (when bound)                                      |
| --------------------------------- | -------- | ------------------------------------------------------------- |
| `iot:read`                        | service  | iot:Describe*, iot:List*, iot:Get*                             |
| `iot:write`                       | service  | iot:CreateThing, iot:UpdateThing, iot:AttachPolicy, etc.       |
| `iot:destructive`                 | service  | iot:DeleteThing, iot:DeleteCertificate                         |
| `s3:read:<bucket>`                | scoped   | s3:GetObject, s3:ListBucket on the named bucket               |
| `s3:write:<bucket>`               | scoped   | s3:PutObject, s3:DeleteObject on the named bucket             |
| `dynamodb:read:<table>`           | scoped   | dynamodb:GetItem, dynamodb:Query, dynamodb:Scan                |
| `dynamodb:write:<table>`          | scoped   | dynamodb:PutItem, dynamodb:UpdateItem, dynamodb:DeleteItem     |
| `lambda:invoke:<function>`        | scoped   | lambda:InvokeFunction on the named function                   |
| `secretsmanager:read:<prefix>`    | scoped   | secretsmanager:GetSecretValue on secrets with the prefix      |
| `cloudwatch:read`                 | service  | logs:DescribeLogGroups, logs:FilterLogEvents, logs:GetLogEvents |
| `athena:query:<workgroup>`        | scoped   | athena:StartQueryExecution + friends on a workgroup           |
| `glue:read`                       | service  | glue:GetDatabase, glue:GetTable, glue:GetPartitions            |

## How "auto-grant reads" interacts

When `defaults.auto_grant_reads: true` in `capabilities.yaml`, every
`*:read` capability is satisfied by a wide policy on the hub task role.
Tools just call boto3 against the local session. This makes the read
tier zero-friction for adopters who don't have strict per-tool read
isolation requirements. Flip to false and bind reads explicitly if you
need narrower scopes.

`*:write` and `*:destructive` capabilities are NEVER auto-granted. They
must be explicitly bound in `capabilities.yaml`. That asymmetry is the
point: blast radius for writes/destructive ops should be visible in
config, every time.

## Adding a new capability

1. Pick a name following the format above.
2. Add a binding in `config/capabilities.yaml`.
3. Declare it in your tool's manifest: `capabilities: [<name>]`.
4. The framework grants `sts:AssumeRole` at synth and the runtime mints
   a session at first call. No CDK edits required in the framework.

If a capability needs IAM the framework's default policy can't express
(unusual condition keys, custom resource patterns), use the `iam:`
escape hatch in the tool's manifest — see `tools/MANIFEST.md`.
