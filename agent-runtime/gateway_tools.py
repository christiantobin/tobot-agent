"""Bridge in-tree tools with tools registered on the AgentCore Gateway.

The Gateway is an MCP server. External teams register their tools as
targets on it (Lambda / OpenAPI / Smithy) from their own repos. This
module lets the agent runtime *consume* those tools: it opens an MCP
session to the Gateway, lists the tools it exposes, and hands them to
the Strands agent alongside the in-tree manifest tools.

Usage (in main.py):

    from gateway_tools import gateway_tools

    with gateway_tools() as gw_tools:
        agent = Agent(..., tools=[*local_tools, *gw_tools])
        result = agent(prompt)

The Strands MCP client keeps a live session for the duration of the
`with` block — the agent must call Gateway tools while that session is
open, which is why this is a context manager rather than a plain list.

Graceful degradation is the rule: if no Gateway is configured
(`GATEWAY_URL` unset), or the connection / listing fails, the context
manager yields an empty list and the agent runs with in-tree tools only.
A missing or misconfigured Gateway never takes the agent down.

Configuration (env vars, injected by the CDK stack):
    GATEWAY_URL            MCP endpoint of the AgentCore Gateway.
    Auth — first match wins:
      GATEWAY_ACCESS_TOKEN   A pre-fetched bearer token (simplest; e.g.
                             for local testing).
      GATEWAY_TOKEN_URL +    OAuth2 client-credentials grant. The runtime
      GATEWAY_CLIENT_ID +    fetches + caches a token from the IdP
      GATEWAY_CLIENT_SECRET  (Cognito by default). Optional
      [+ GATEWAY_SCOPE]      GATEWAY_SCOPE narrows the requested scope.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from typing import Any

log = logging.getLogger(__name__)

# Refresh an OAuth token this many seconds before it actually expires.
_TOKEN_REFRESH_BUFFER_S = 60

_token_lock = threading.Lock()
_token_cache: dict[str, Any] = {}


def _fetch_client_credentials_token(
    token_url: str, client_id: str, client_secret: str, scope: str | None
) -> tuple[str, int]:
    """OAuth2 client-credentials grant. Returns (access_token, ttl_seconds).

    Uses urllib (stdlib) so the runtime takes on no extra dependency.
    """
    form = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": client_secret}
    if scope:
        form["scope"] = scope
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        token_url,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 - operator-configured URL
        payload = json.loads(resp.read().decode())
    token = payload["access_token"]
    ttl = int(payload.get("expires_in", 3600))
    return token, ttl


def _bearer_token() -> str | None:
    """Resolve a bearer token from the environment, or None.

    A static GATEWAY_ACCESS_TOKEN wins. Otherwise, if client-credentials
    config is present, fetch (and cache until shortly before expiry).
    Returns None when no auth is configured — the caller then connects
    without an Authorization header.
    """
    static = os.environ.get("GATEWAY_ACCESS_TOKEN")
    if static:
        return static

    token_url = os.environ.get("GATEWAY_TOKEN_URL")
    client_id = os.environ.get("GATEWAY_CLIENT_ID")
    client_secret = os.environ.get("GATEWAY_CLIENT_SECRET")
    if not (token_url and client_id and client_secret):
        return None
    scope = os.environ.get("GATEWAY_SCOPE")

    now = int(time.time())
    with _token_lock:
        cached = _token_cache.get("entry")
        if cached and now < cached["expires_at"] - _TOKEN_REFRESH_BUFFER_S:
            return cached["token"]
        token, ttl = _fetch_client_credentials_token(token_url, client_id, client_secret, scope)
        _token_cache["entry"] = {"token": token, "expires_at": now + ttl}
        return token


def _auth_headers() -> dict[str, str]:
    token = _bearer_token()
    return {"Authorization": f"Bearer {token}"} if token else {}


def _build_mcp_client(url: str, headers: dict[str, str]) -> Any:
    """Construct a Strands MCPClient over an HTTP-streaming transport.

    Imports are local so this module loads even where strands/mcp aren't
    installed (e.g. a bare unit-test environment that monkeypatches this
    function).
    """
    from mcp.client.streamable_http import streamablehttp_client
    from strands.tools.mcp import MCPClient

    return MCPClient(lambda: streamablehttp_client(url, headers=headers))


@contextmanager
def gateway_tools() -> Iterator[list[Any]]:
    """Yield Gateway-registered tools for the duration of the `with` block.

    Yields [] (never raises) when GATEWAY_URL is unset or the Gateway is
    unreachable, so the agent always runs with at least its in-tree
    tools. The MCP session stays open until the block exits.
    """
    url = os.environ.get("GATEWAY_URL")
    if not url:
        yield []
        return

    with ExitStack() as stack:
        tools: list[Any] = []
        try:
            client = _build_mcp_client(url, _auth_headers())
            stack.enter_context(client)
            tools = client.list_tools_sync()
            log.info("loaded %d tool(s) from gateway %s", len(tools), url)
        except Exception as err:  # noqa: BLE001 - degrade, don't crash the turn
            log.warning(
                "gateway tools unavailable (%s: %s) — continuing with in-tree tools only",
                type(err).__name__,
                err,
            )
            tools = []
        yield tools
