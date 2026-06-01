"""Gateway tool consumption — connection, listing, and graceful degrade.

The real MCP client is replaced with a fake context manager so these
tests don't open a network session.
"""
import pytest

import gateway_tools


class _FakeClient:
    def __init__(self, tools=None, list_raises=False, enter_raises=False):
        self._tools = tools or []
        self._list_raises = list_raises
        self._enter_raises = enter_raises
        self.entered = False
        self.exited = False

    def __enter__(self):
        if self._enter_raises:
            raise RuntimeError("cannot connect")
        self.entered = True
        return self

    def __exit__(self, *exc):
        self.exited = True
        return False

    def list_tools_sync(self):
        if self._list_raises:
            raise RuntimeError("list failed")
        return list(self._tools)


@pytest.fixture(autouse=True)
def _clear_gateway_env(monkeypatch):
    for var in (
        "GATEWAY_URL",
        "GATEWAY_ACCESS_TOKEN",
        "GATEWAY_TOKEN_URL",
        "GATEWAY_CLIENT_ID",
        "GATEWAY_CLIENT_SECRET",
        "GATEWAY_SCOPE",
    ):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr(gateway_tools, "_token_cache", {})


def test_yields_empty_when_no_gateway_configured():
    with gateway_tools.gateway_tools() as tools:
        assert tools == []


def test_yields_gateway_tools_and_closes_session(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "https://gw.example/mcp")
    fake = _FakeClient(tools=["alpha", "beta"])
    monkeypatch.setattr(gateway_tools, "_build_mcp_client", lambda url, headers: fake)

    with gateway_tools.gateway_tools() as tools:
        assert tools == ["alpha", "beta"]
        assert fake.entered is True
    assert fake.exited is True  # session closed on block exit


def test_degrades_when_listing_fails(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "https://gw.example/mcp")
    fake = _FakeClient(list_raises=True)
    monkeypatch.setattr(gateway_tools, "_build_mcp_client", lambda url, headers: fake)
    with gateway_tools.gateway_tools() as tools:
        assert tools == []
    assert fake.exited is True  # entered session still gets cleaned up


def test_degrades_when_connect_fails(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "https://gw.example/mcp")

    def _boom(url, headers):
        raise RuntimeError("dns failure")

    monkeypatch.setattr(gateway_tools, "_build_mcp_client", _boom)
    with gateway_tools.gateway_tools() as tools:
        assert tools == []


def test_body_exceptions_propagate(monkeypatch):
    monkeypatch.setenv("GATEWAY_URL", "https://gw.example/mcp")
    fake = _FakeClient(tools=["alpha"])
    monkeypatch.setattr(gateway_tools, "_build_mcp_client", lambda url, headers: fake)
    with pytest.raises(ValueError):
        with gateway_tools.gateway_tools():
            raise ValueError("agent error")
    assert fake.exited is True  # session cleaned up even when body raises


def test_auth_headers_static_token(monkeypatch):
    monkeypatch.setenv("GATEWAY_ACCESS_TOKEN", "tok-123")
    assert gateway_tools._auth_headers() == {"Authorization": "Bearer tok-123"}


def test_auth_headers_none_when_unconfigured():
    assert gateway_tools._auth_headers() == {}


def test_auth_headers_client_credentials(monkeypatch):
    monkeypatch.setenv("GATEWAY_TOKEN_URL", "https://idp/token")
    monkeypatch.setenv("GATEWAY_CLIENT_ID", "cid")
    monkeypatch.setenv("GATEWAY_CLIENT_SECRET", "secret")
    calls = {"n": 0}

    def _fake_fetch(token_url, client_id, client_secret, scope):
        calls["n"] += 1
        assert token_url == "https://idp/token"
        assert client_id == "cid"
        return "fetched-token", 3600

    monkeypatch.setattr(gateway_tools, "_fetch_client_credentials_token", _fake_fetch)
    assert gateway_tools._auth_headers() == {"Authorization": "Bearer fetched-token"}
    # second resolution served from cache, no second fetch
    gateway_tools._auth_headers()
    assert calls["n"] == 1
