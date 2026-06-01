"""echo — the simplest Tobot tool: no AWS, no capabilities, no secrets.

Two entrypoints:

  * `echo`   — returns text verbatim. The canonical "is the bot alive?"
               check.
  * `whoami` — reports the calling identity the framework injected for
               this invocation. A worked example of how a tool reads
               per-invocation context WITHOUT that context appearing on
               its tool schema (where the model could forge it).

Copy this directory to tools/<your-tool>/ as a starting point for any
tool that doesn't touch AWS. For a tool that does, copy
tools/aws-account-info/ instead.
"""
from __future__ import annotations

from typing import Any

from strands import tool


# The framework exposes the caller's identity via a thread-local set at
# the top of each invocation (see agent-runtime/invocation_context.py).
# Tools read it directly — it is deliberately NOT a function argument, so
# the model can't spoof it. The import is guarded so this tool still
# loads in a bare environment (e.g. unit tests that import the module
# without the agent-runtime package on the path).
try:
    from invocation_context import invocation_context as _ctx
except Exception:  # pragma: no cover - only hit outside the runtime
    _ctx = None


@tool
def echo(text: str) -> dict[str, Any]:
    """Return the given text unchanged.

    Call this when the user explicitly asks you to echo, repeat, or play
    back something verbatim, or asks you to confirm the tool path works.
    It has no side effects.

    Args:
        text: The text to return.

    Returns:
        {"echo": "<text>"}
    """
    return {"echo": text}


@tool
def whoami() -> dict[str, Any]:
    """Report who the framework thinks is invoking this turn.

    Call this when the user asks "who am I to you?", "do you know who I
    am?", or "am I an admin?". The values come from the front-door
    adapter (e.g. the Slack user id), not from anything the model can
    set.

    Returns:
        {
          "principal_id": "<opaque caller id>",
          "scope": "<front-door scope, e.g. Slack channel id, or null>",
          "is_admin": <bool>
        }
    """
    if _ctx is None:
        return {
            "principal_id": "unknown",
            "scope": None,
            "is_admin": False,
            "note": "invocation context unavailable (running outside the runtime)",
        }
    return {
        "principal_id": getattr(_ctx, "invoking_principal_id", "unknown"),
        "scope": getattr(_ctx, "scope", None),
        "is_admin": bool(getattr(_ctx, "is_admin", False)),
    }
