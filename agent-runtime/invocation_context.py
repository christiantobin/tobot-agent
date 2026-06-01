"""Per-invocation thread-local state shared across framework components.

Strands runs the tool-use loop on a single Python thread per invocation,
so threading.local gives us a clean per-call scratchpad without leaking
between concurrent invocations (each AgentCore session is its own
microVM, but ThreadPoolExecutor inside one would still need this).

Fields:
    invoking_principal_id: opaque caller id (Slack user id, etc).
        Used by admin_tools to populate added_by on allowlist entries
        WITHOUT exposing it on the tool-call schema where the model
        could forge it.

    destructive_confirmed: True iff the user has explicitly confirmed
        the destructive action they're about to invoke. The destructive
        guard reads this before allowing a tagged tool to run; the
        front-door adapter (Slack bridge, etc) sets it based on user
        intent (typed "confirm", approver reaction, etc).

    scope: the front-door scope for this invocation (Slack channel id,
        webhook tenant id, etc), or None. Tools may read it to act
        "in this channel/tenant". The framework also uses it to filter
        the toolset, but tools see the resolved value here.

    is_admin: True iff the caller was flagged as an administrator. Admin
        tools are added to the toolset upstream of this; a tool can also
        read the flag directly to vary behavior for admins.
"""
from __future__ import annotations

import threading


class _InvocationContext(threading.local):
    invoking_principal_id: str = "unknown"
    destructive_confirmed: bool = False
    scope: str | None = None
    is_admin: bool = False


invocation_context = _InvocationContext()


def reset() -> None:
    """Clear all per-invocation state. Call at the top of each handler turn
    so values from the previous invocation (in case Python reuses the
    thread) don't leak into the next.
    """
    invocation_context.invoking_principal_id = "unknown"
    invocation_context.destructive_confirmed = False
    invocation_context.scope = None
    invocation_context.is_admin = False
