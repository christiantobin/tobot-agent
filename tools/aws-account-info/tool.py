"""aws-account-info — a worked example of a read-only AWS tool.

The teaching points:

  1. AWS reach comes from `capabilities.get_session(<capability>)`, never
     from a hard-coded role ARN or a bare `boto3.client(...)`. The
     framework resolves the capability to credentials (assuming a role,
     or using the hub role's auto-granted read access).

  2. Tools NEVER raise into the agent loop. Every entrypoint returns a
     structured dict: `{"success": True, ...}` or
     `{"success": False, "error": "..."}`. The model reasons over the
     shape; an exception would just crash the turn.

  3. The capability names here (`sts:read`, `cloudwatch:read`) match the
     `capabilities:` list in tool.yaml. Keep them in sync — the manifest
     is what the deployment grants IAM for.
"""
from __future__ import annotations

import logging
from typing import Any

from strands import tool

# Runtime-side capability resolver. Guarded so the module still imports
# in a bare environment (e.g. unit tests) where agent-runtime isn't on
# the path; the entrypoints return a structured error in that case.
try:
    from capabilities import get_session
except Exception:  # pragma: no cover - only outside the runtime
    get_session = None

log = logging.getLogger(__name__)


def _no_resolver() -> dict[str, Any]:
    return {
        "success": False,
        "error": "capability resolver unavailable (running outside the runtime)",
    }


@tool
def who_am_i() -> dict[str, Any]:
    """Return the AWS identity the agent is operating as.

    Call this when the user asks what AWS account the bot is in, what
    role/identity it runs as, or to confirm AWS access works at all.

    Returns:
        {"success": True, "account": "<id>", "arn": "<arn>",
         "user_id": "<id>"}
        or {"success": False, "error": "<message>"}
    """
    if get_session is None:
        return _no_resolver()
    try:
        session = get_session("sts:read")
        identity = session.client("sts").get_caller_identity()
    except Exception as err:  # noqa: BLE001 — never raise into the agent loop
        log.warning("who_am_i failed: %s: %s", type(err).__name__, err)
        return {"success": False, "error": f"{type(err).__name__}: {err}"}
    return {
        "success": True,
        "account": identity.get("Account"),
        "arn": identity.get("Arn"),
        "user_id": identity.get("UserId"),
    }


@tool
def list_log_groups(prefix: str = "", limit: int = 50) -> dict[str, Any]:
    """List CloudWatch Logs group names, optionally filtered by prefix.

    Call this when the user asks what log groups exist, or to find a log
    group by name prefix (e.g. "/aws/lambda/"). Read-only.

    Args:
        prefix: Only return groups whose name starts with this. Empty
            string returns groups from the start (most recently created
            ordering is not guaranteed).
        limit: Maximum number of names to return (1-50). Defaults to 50.

    Returns:
        {"success": True, "log_groups": ["<name>", ...], "count": <int>,
         "truncated": <bool>}
        or {"success": False, "error": "<message>"}
    """
    if get_session is None:
        return _no_resolver()
    limit = max(1, min(int(limit), 50))
    try:
        session = get_session("cloudwatch:read")
        logs = session.client("logs")
        kwargs: dict[str, Any] = {"limit": limit}
        if prefix:
            kwargs["logGroupNamePrefix"] = prefix
        resp = logs.describe_log_groups(**kwargs)
    except Exception as err:  # noqa: BLE001 — never raise into the agent loop
        log.warning("list_log_groups failed: %s: %s", type(err).__name__, err)
        return {"success": False, "error": f"{type(err).__name__}: {err}"}
    names = [g.get("logGroupName") for g in resp.get("logGroups", [])]
    return {
        "success": True,
        "log_groups": names,
        "count": len(names),
        "truncated": bool(resp.get("nextToken")),
    }
