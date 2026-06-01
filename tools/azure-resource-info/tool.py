"""azure-resource-info — a worked example of a NON-AWS (Azure) read tool.

The platform runs on AWS; this tool reaches into Azure. The interesting
part is how it authenticates across the cloud boundary:

  1. No AWS capability. Azure auth doesn't go through AWS IAM/STS, so this
     tool does NOT use `capabilities.get_session()`. It carries its own
     credentials instead — the manifest opts out of the capability model.

  2. Service principal from a Secrets Manager secret. The framework injects
     the secret's ARN as AZURE_SP_SECRET_ARN (see tool.yaml `secrets:`).
     The tool fetches the JSON value with boto3 and builds a
     ClientSecretCredential. The runtime already has read on that one
     secret (CDK grants it per manifest).

  3. Subscription id from a plain env var (AZURE_SUBSCRIPTION_ID, the
     manifest `env:` block) — non-secret, so it lives in config, not a
     secret.

Production note: a service principal is a long-lived secret. The
no-stored-key upgrade is Azure *workload identity federation* — have
Entra ID trust the runtime's AWS identity directly. That's a per-tool
setup detail; the tool code is the same.

Like every Tobot tool, entrypoints never raise into the agent loop — they
return {"success": True, ...} or {"success": False, "error": ...}.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from strands import tool

# All cloud SDKs are imported defensively so the module loads in a bare
# environment (CI compile/discovery, where the tool's requirements.txt
# isn't installed). The container installs azure-identity + azure-mgmt-
# resource at build time, so the happy path has them.
try:
    import boto3
except Exception:  # pragma: no cover
    boto3 = None

try:
    from azure.identity import ClientSecretCredential
    from azure.mgmt.resource import ResourceManagementClient
except Exception:  # pragma: no cover - azure SDK absent outside the container
    ClientSecretCredential = None
    ResourceManagementClient = None

log = logging.getLogger(__name__)

_SUBSCRIPTION_PLACEHOLDER = "<your-subscription-id>"


def _setup_error(message: str) -> dict[str, Any]:
    """A structured 'this isn't configured yet' result the model can relay."""
    return {"success": False, "error": message, "setup_required": True}


def _load_service_principal() -> dict[str, str]:
    """Fetch the SP credentials JSON from the Secrets Manager secret.

    Raises RuntimeError with an actionable message on any problem; callers
    convert that into a setup-required result.
    """
    arn = os.environ.get("AZURE_SP_SECRET_ARN")
    if not arn:
        raise RuntimeError(
            "AZURE_SP_SECRET_ARN is not set — the azure-sp secret isn't wired. "
            "Check the tool manifest deployed."
        )
    if boto3 is None:
        raise RuntimeError("boto3 is unavailable; cannot read the Azure secret.")
    raw = boto3.client("secretsmanager").get_secret_value(SecretId=arn)["SecretString"]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"azure-sp secret is not valid JSON: {err}") from err
    missing = [k for k in ("tenant_id", "client_id", "client_secret") if not data.get(k)]
    if missing:
        raise RuntimeError(
            f"azure-sp secret is missing keys: {', '.join(missing)}. Expected JSON "
            f'{{"tenant_id":"...","client_id":"...","client_secret":"..."}}.'
        )
    return data


def _resource_client() -> tuple[Any | None, dict[str, Any] | None]:
    """Build a ResourceManagementClient, or return (None, error_result)."""
    if ClientSecretCredential is None or ResourceManagementClient is None:
        return None, _setup_error(
            "Azure SDK not installed (azure-identity, azure-mgmt-resource). "
            "It ships in the container; this path means a bare environment."
        )
    subscription_id = os.environ.get("AZURE_SUBSCRIPTION_ID", "")
    if not subscription_id or subscription_id == _SUBSCRIPTION_PLACEHOLDER:
        return None, _setup_error(
            "AZURE_SUBSCRIPTION_ID is not set. Edit the azure-resource-info "
            "manifest's env block with your subscription id and redeploy."
        )
    try:
        sp = _load_service_principal()
    except Exception as err:  # noqa: BLE001 - surface as setup-required, don't raise
        return None, _setup_error(str(err))
    credential = ClientSecretCredential(
        tenant_id=sp["tenant_id"],
        client_id=sp["client_id"],
        client_secret=sp["client_secret"],
    )
    return ResourceManagementClient(credential, subscription_id), None


@tool
def list_resource_groups(limit: int = 50) -> dict[str, Any]:
    """List the resource groups in the configured Azure subscription.

    Call this when the user asks what resource groups exist in Azure, or to
    get the lay of the land before drilling into resources. Read-only.

    Args:
        limit: Maximum number of groups to return (1-200). Defaults to 50.

    Returns:
        {"success": True, "resource_groups": [{"name", "location"}, ...],
         "count": <int>}
        or {"success": False, "error": "<message>"} (with "setup_required":
        true when the tool isn't configured yet).
    """
    client, err = _resource_client()
    if err:
        return err
    limit = max(1, min(int(limit), 200))
    try:
        groups: list[dict[str, Any]] = []
        for rg in client.resource_groups.list():
            groups.append({"name": rg.name, "location": rg.location})
            if len(groups) >= limit:
                break
    except Exception as err:  # noqa: BLE001 - never raise into the agent loop
        log.warning("list_resource_groups failed: %s: %s", type(err).__name__, err)
        return {"success": False, "error": f"{type(err).__name__}: {err}"}
    return {"success": True, "resource_groups": groups, "count": len(groups)}


@tool
def list_resources(resource_group: str = "", limit: int = 50) -> dict[str, Any]:
    """List Azure resources, optionally scoped to one resource group.

    Call this when the user asks what's running in Azure, or what's inside a
    named resource group. Read-only.

    Args:
        resource_group: If given, only resources in this group. Empty lists
            across the whole subscription.
        limit: Maximum number of resources to return (1-200). Defaults to 50.

    Returns:
        {"success": True, "resources": [{"name", "type", "location"}, ...],
         "count": <int>, "resource_group": <str|None>}
        or {"success": False, "error": "<message>"}.
    """
    client, err = _resource_client()
    if err:
        return err
    limit = max(1, min(int(limit), 200))
    try:
        items: list[dict[str, Any]] = []
        iterator = (
            client.resources.list_by_resource_group(resource_group)
            if resource_group
            else client.resources.list()
        )
        for r in iterator:
            items.append({"name": r.name, "type": r.type, "location": r.location})
            if len(items) >= limit:
                break
    except Exception as err:  # noqa: BLE001 - never raise into the agent loop
        log.warning("list_resources failed: %s: %s", type(err).__name__, err)
        return {"success": False, "error": f"{type(err).__name__}: {err}"}
    return {
        "success": True,
        "resources": items,
        "count": len(items),
        "resource_group": resource_group or None,
    }
