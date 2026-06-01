# azure-resource-info

A worked example of a **non-AWS (cross-cloud) tool**. Tobot Agent's
platform runs on AWS, but its _reach_ doesn't have to — the agent can
operate any cloud through tools. This is the reference for that: a
read-only Azure tool, the cross-cloud sibling of `aws-account-info`.

## What it exposes

| function               | shape                                                               | when to call                                  |
| ---------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `list_resource_groups` | `(limit=50) -> {success, resource_groups:[{name,location}], count}` | "What resource groups do we have in Azure?"   |
| `list_resources`       | `(resource_group="", limit=50) -> {success, resources, count}`      | "What's running in Azure?" / inside one group |

## Worth studying — cross-cloud auth

This is the point of the example. An AWS-hosted agent reaching into Azure
can't use AWS IAM there, so:

- **No `capabilities:` block.** The capability model (`get_session`) is an
  AWS convenience. Non-AWS tools opt out and carry their own credentials.
- **Service principal from a secret.** The manifest `secrets:` block makes
  CDK provision an empty Secrets Manager shell and grant the runtime read.
  The tool fetches the JSON value and builds a `ClientSecretCredential`.
- **Subscription id from `env:`.** Non-secret, so it lives in the manifest
  env block, not a secret. One tool, both manifest credential mechanisms.

## Setup

1. **Create an Azure service principal** with a read role (e.g. _Reader_)
   on the subscription:

   ```bash
   az ad sp create-for-rbac --name tobot-agent-reader \
     --role Reader --scopes /subscriptions/<SUBSCRIPTION_ID>
   ```

2. **Store its creds** in the secret CDK created (after the first deploy):

   ```bash
   aws secretsmanager put-secret-value \
     --secret-id tobot-agent/azure-sp-<stage> \
     --secret-string '{"tenant_id":"...","client_id":"...","client_secret":"..."}'
   ```

3. **Set the subscription id**: edit `tool.yaml`'s `env.AZURE_SUBSCRIPTION_ID`
   and redeploy. Until then the tool returns a clear `setup_required` result.

## Production hardening

A service principal secret is a long-lived key. The no-stored-key upgrade
is **Azure workload identity federation** — configure Entra ID to trust
the runtime's AWS identity directly, drop the `client_secret`, and exchange
the AWS token for an Azure one. The tool code stays the same; only the
credential construction changes.
