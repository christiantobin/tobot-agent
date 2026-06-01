"""Per-invocation thread-local state."""
from invocation_context import invocation_context, reset


def test_defaults_after_reset():
    invocation_context.invoking_principal_id = "U123"
    invocation_context.destructive_confirmed = True
    invocation_context.scope = "C999"
    invocation_context.is_admin = True

    reset()

    assert invocation_context.invoking_principal_id == "unknown"
    assert invocation_context.destructive_confirmed is False
    assert invocation_context.scope is None
    assert invocation_context.is_admin is False


def test_fields_round_trip():
    reset()
    invocation_context.invoking_principal_id = "UABC"
    invocation_context.scope = "Cchan"
    invocation_context.is_admin = True
    assert invocation_context.invoking_principal_id == "UABC"
    assert invocation_context.scope == "Cchan"
    assert invocation_context.is_admin is True
    reset()
