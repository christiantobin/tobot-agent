"""Runtime guard for tools tagged `destructive` in their manifest.

The guard is a hard runtime check, NOT a system-prompt instruction. The
model cannot bypass it: a destructive tool call without prior user
confirmation returns a structured `requires_confirmation` response back
into the tool-use loop, instructing the model to ask the user before
trying again.

Confirmation is set by the front-door adapter (Slack bridge etc) based
on user intent — a typed `confirm`, an approver reaction in the thread,
etc. The adapter passes `destructive_confirmed: true` on the runtime
payload; main.py threads it into `invocation_context` before agent.run().

Wrapping happens at discovery time: tools whose manifest tags include
`destructive` get their underlying function wrapped with the guard,
then re-decorated with @strands.tool so the tool spec (schema, name,
description) is preserved.
"""
from __future__ import annotations

import functools
from typing import Any

from strands import tool as _strands_tool

from invocation_context import invocation_context


_CONFIRMATION_RESPONSE: dict[str, Any] = {
    "requires_confirmation": True,
    "reason": (
        "This tool is destructive and requires explicit user confirmation "
        "before it can run. The runtime blocks the call until the user opts in."
    ),
    "instructions": (
        "Describe what you intend to do (which resource(s), which environment) "
        "and ask the user to reply with the single word 'confirm' to proceed. "
        "Do NOT call this tool again until they have confirmed."
    ),
}


def wrap_destructive(decorated_tool: Any) -> Any:
    """Wrap a @strands.tool-decorated function so it requires confirmation.

    Strands' @tool returns a DecoratedFunctionTool whose `__wrapped__`
    attribute is the original undecorated function. We pull that out,
    wrap it with a guard that short-circuits when
    `invocation_context.destructive_confirmed` is False, and re-apply
    @tool. The new wrapper is what gets registered with the agent.

    The tool spec (name, description, input schema) is regenerated from
    the wrapped function's signature + docstring, which functools.wraps
    preserves verbatim. So the model sees the same tool — only the
    runtime behavior changes.
    """
    original = getattr(decorated_tool, "__wrapped__", None)
    if original is None:
        # Fallback: tool wasn't produced by @strands.tool (or strands
        # version changed). Wrap the object itself; the spec may differ
        # but the guard still works.
        original = decorated_tool

    @functools.wraps(original)
    def guarded(*args: Any, **kwargs: Any) -> Any:
        if not invocation_context.destructive_confirmed:
            return _CONFIRMATION_RESPONSE
        return original(*args, **kwargs)

    return _strands_tool(guarded)
