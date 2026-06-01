"""The destructive-action guard is a hard runtime gate.

These tests prove: (1) an unconfirmed call returns the confirmation
response WITHOUT running the underlying function; (2) a confirmed call
runs it; (3) the strands tool spec (name, description) survives the wrap
so the model sees the same tool.
"""
import pytest
from strands import tool

from destructive_guard import _CONFIRMATION_RESPONSE, wrap_destructive
from invocation_context import invocation_context, reset


@pytest.fixture(autouse=True)
def _clean_context():
    reset()
    yield
    reset()


def _make_tool(spy):
    @tool
    def delete_thing(name: str) -> dict:
        """Delete a thing by name. Destructive."""
        spy.append(name)
        return {"deleted": name}

    return delete_thing


def _invoke(wrapped, **kwargs):
    """Call the guarded function underneath the re-applied @tool."""
    return wrapped.__wrapped__(**kwargs)


def test_unconfirmed_call_is_blocked():
    spy: list[str] = []
    wrapped = wrap_destructive(_make_tool(spy))

    invocation_context.destructive_confirmed = False
    result = _invoke(wrapped, name="prod-db")

    assert result == _CONFIRMATION_RESPONSE
    assert result["requires_confirmation"] is True
    assert spy == []  # underlying function never ran


def test_confirmed_call_passes_through():
    spy: list[str] = []
    wrapped = wrap_destructive(_make_tool(spy))

    invocation_context.destructive_confirmed = True
    result = _invoke(wrapped, name="prod-db")

    assert result == {"deleted": "prod-db"}
    assert spy == ["prod-db"]


def test_tool_spec_preserved():
    wrapped = wrap_destructive(_make_tool([]))
    # Name comes from the wrapped function; functools.wraps preserves it.
    assert getattr(wrapped, "tool_name", None) == "delete_thing"
    spec = getattr(wrapped, "tool_spec", None)
    assert spec is not None
    # The description (from the docstring) carries through the wrap.
    assert "Delete a thing" in str(spec)
