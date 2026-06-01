"""Thread-keyed DynamoDB session store.

AgentCore Runtime isolates microVMs per session (good for within-session
continuity), but doesn't persist history across session eviction or new
threads. We keep our own store so multi-turn conversations resume cleanly
even after a cold start.

Text turns only (no intermediate tool_use / tool_result blocks). DynamoDB
deserializes numbers as Decimal, which Bedrock Converse rejects inside
tool_use input dicts. Storing the transcript only sidesteps that AND keeps
history compact.
"""
from __future__ import annotations

import os
import time
from typing import Any

import boto3

REGION = os.environ.get("AWS_REGION", "us-west-2")
SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

_ddb = boto3.resource("dynamodb", region_name=REGION)


def _table():
    name = os.environ.get("SESSION_TABLE_NAME")
    if not name:
        raise RuntimeError("SESSION_TABLE_NAME env var is not set")
    return _ddb.Table(name)


def load_history(thread_id: str) -> list[dict[str, Any]]:
    resp = _table().get_item(Key={"thread_id": thread_id})
    item = resp.get("Item") or {}
    messages = item.get("messages") or []
    if not isinstance(messages, list):
        return []
    return messages


def save_history(thread_id: str, messages: list[dict[str, Any]]) -> None:
    _table().put_item(
        Item={
            "thread_id": thread_id,
            "messages": messages,
            "expires_at": int(time.time()) + SEVEN_DAYS_SECONDS,
        }
    )
