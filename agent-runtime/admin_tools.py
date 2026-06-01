"""Allowlist-management tools — admin only.

These are first-class @strands.tool callables that the runtime adds to
the agent's toolset ONLY when the invocation's `is_admin=true`.
Non-admin invocations never see these names, so the model cannot
hallucinate them into use.

The invoking admin's identity is read from `invocation_context` (set by
main.py before agent.run()). It's deliberately kept OFF the tool-call
schema so the model can't forge it.

Slack-specific note: these tools operate on the table PlatformStack
creates for the Slack adapter (entity_type in {"USER", "CHANNEL"}).
A future webhook / Teams / etc. adapter with its own allowlist would
ship its own admin tools — admin tools are bound to an adapter's
authentication model, not the other way around.
"""
from __future__ import annotations

import os
import time
from typing import Any, Literal

import boto3
from strands import tool

from invocation_context import invocation_context

REGION = os.environ.get("AWS_REGION", "us-west-2")
_ddb = boto3.resource("dynamodb", region_name=REGION)

EntityType = Literal["USER", "CHANNEL"]


def _table():
    name = os.environ.get("ALLOWLIST_TABLE_NAME")
    if not name:
        raise RuntimeError("ALLOWLIST_TABLE_NAME env var is not set")
    return _ddb.Table(name)


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@tool
def list_allowlist() -> dict[str, Any]:
    """List every allowlisted user and channel.

    Use this when the user asks "who can talk to me", "show the
    allowlist", or wants to audit access before adding or removing
    entries.

    Returns:
        {"users": [<entry>, ...], "channels": [<entry>, ...]}
        Each entry has at least entity_type, entity_id, added_by, added_at.
    """
    table = _table()
    users = table.query(
        KeyConditionExpression="entity_type = :t",
        ExpressionAttributeValues={":t": "USER"},
    ).get("Items", [])
    channels = table.query(
        KeyConditionExpression="entity_type = :t",
        ExpressionAttributeValues={":t": "CHANNEL"},
    ).get("Items", [])
    return {"users": users, "channels": channels}


@tool
def add_allowed_user(user_id: str, note: str = "") -> dict[str, Any]:
    """Allowlist a user so they can invoke the agent in allowlisted channels.

    Args:
        user_id: Opaque user id from the front-door adapter (e.g. a Slack
            user id like "U0ABC1234").
        note: Optional human description for audit purposes.
    """
    return _put_entry("USER", user_id, note)


@tool
def remove_allowed_user(user_id: str) -> dict[str, Any]:
    """Remove a user from the allowlist. They lose invocation access immediately."""
    _table().delete_item(Key={"entity_type": "USER", "entity_id": user_id})
    return {"removed": {"entity_type": "USER", "entity_id": user_id}}


@tool
def add_allowed_channel(channel_id: str, note: str = "") -> dict[str, Any]:
    """Allowlist a channel where the agent will respond to allowlisted users.

    Args:
        channel_id: Opaque channel/scope id from the front-door adapter
            (e.g. a Slack channel id like "C0ABC1234").
        note: Optional human description for audit purposes.
    """
    return _put_entry("CHANNEL", channel_id, note)


@tool
def remove_allowed_channel(channel_id: str) -> dict[str, Any]:
    """Remove a channel from the allowlist. The agent stops responding there immediately."""
    _table().delete_item(Key={"entity_type": "CHANNEL", "entity_id": channel_id})
    return {"removed": {"entity_type": "CHANNEL", "entity_id": channel_id}}


def _put_entry(entity_type: EntityType, entity_id: str, note: str) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "added_by": invocation_context.invoking_principal_id,
        "added_at": _iso_now(),
    }
    if note:
        entry["note"] = note
    _table().put_item(Item=entry)
    return {"added": entry}


ADMIN_TOOLS = [
    list_allowlist,
    add_allowed_user,
    remove_allowed_user,
    add_allowed_channel,
    remove_allowed_channel,
]
