"""Replace this docstring with what your tool does.

Every public callable decorated with @tool below will be exposed to the
Tobot Agent as long as it's listed under `entrypoints:` in tool.yaml.
"""
from __future__ import annotations

from typing import Any

from strands import tool


@tool
def hello(name: str = "world") -> dict[str, Any]:
    """Return a friendly greeting. Replace me with your actual tool.

    The docstring here is what the model reads to decide when to call
    your tool — write it as a directive to the model, not a human.
    Include: what the tool does, when to call it (and when NOT to),
    what the args mean, and what the return shape looks like.

    Args:
        name: Who to greet.

    Returns:
        {"greeting": "<text>"}
    """
    return {"greeting": f"hello, {name}"}
