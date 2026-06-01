"""Tool discovery + scope filtering."""
from tools.discovery import AUTO_TOOLS, discover_tools, filter_for_invocation


def _name(fn):
    return getattr(fn, "tool_name", getattr(fn, "__name__", repr(fn)))


def test_filter_keeps_unscoped_tools_everywhere():
    a, b = object(), object()
    tools = [(a, {}), (b, {"scopes": ["C1"]})]
    # No scope given: unscoped tool stays, scoped tool is filtered out.
    assert filter_for_invocation(tools, scope=None) == [a]


def test_filter_includes_scoped_tool_for_matching_scope():
    a, b = object(), object()
    tools = [(a, {}), (b, {"scopes": ["C1", "C2"]})]
    assert filter_for_invocation(tools, scope="C2") == [a, b]


def test_filter_excludes_scoped_tool_for_other_scope():
    a, b = object(), object()
    tools = [(a, {}), (b, {"scopes": ["C1"]})]
    assert filter_for_invocation(tools, scope="C9") == [a]


def test_example_tools_are_discovered():
    # The echo tool ships in tools/ and should be auto-registered.
    names = {_name(fn) for fn, _ in discover_tools()}
    assert "echo" in names
    assert "whoami" in names


def test_auto_tools_is_populated():
    assert len(AUTO_TOOLS) >= 1
