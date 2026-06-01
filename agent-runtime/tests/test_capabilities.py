"""Capability -> boto3.Session resolution.

We inject the registry directly (bypassing the YAML file) and stub STS,
so these tests don't touch disk or the network.
"""
from datetime import datetime, timedelta, timezone

import boto3
import pytest

import capabilities


@pytest.fixture(autouse=True)
def _isolate_registry(monkeypatch):
    """Reset the module-level caches around each test."""
    monkeypatch.setattr(capabilities, "_session_cache", {})
    yield
    monkeypatch.setattr(capabilities, "_session_cache", {})


def _set_registry(monkeypatch, *, auto_grant_reads=True, bindings=None):
    monkeypatch.setattr(
        capabilities,
        "_registry_cache",
        {
            "auto_grant_reads": auto_grant_reads,
            "default_region": "us-west-2",
            "bindings": bindings or {},
        },
    )


def test_read_capability_uses_default_session_when_auto_granted(monkeypatch):
    _set_registry(monkeypatch, auto_grant_reads=True)
    # If get_session tried to assume a role it would call boto3.client;
    # make that explode so the test fails loudly if it does.
    monkeypatch.setattr(
        capabilities.boto3, "client", lambda *a, **k: pytest.fail("should not assume")
    )
    session = capabilities.get_session("sts:read")
    assert isinstance(session, boto3.Session)
    assert session.region_name == "us-west-2"


def test_unbound_non_read_raises(monkeypatch):
    _set_registry(monkeypatch, auto_grant_reads=True, bindings={})
    with pytest.raises(RuntimeError, match="not bound"):
        capabilities.get_session("lambda:invoke:fn")


def test_read_requires_binding_when_auto_grant_off(monkeypatch):
    _set_registry(monkeypatch, auto_grant_reads=False, bindings={})
    with pytest.raises(RuntimeError, match="not bound"):
        capabilities.get_session("iot:read")


def test_bound_write_capability_assumes_role(monkeypatch):
    _set_registry(
        monkeypatch,
        bindings={
            "iot:write": {"role_arn": "arn:aws:iam::111:role/iot-write", "envs": {}},
        },
    )

    captured = {}

    class _FakeSts:
        def assume_role(self, **kwargs):
            captured.update(kwargs)
            return {
                "Credentials": {
                    "AccessKeyId": "AKIA",
                    "SecretAccessKey": "secret",
                    "SessionToken": "token",
                    "Expiration": datetime.now(timezone.utc) + timedelta(hours=1),
                }
            }

    monkeypatch.setattr(capabilities.boto3, "client", lambda *a, **k: _FakeSts())

    session = capabilities.get_session("iot:write")
    assert isinstance(session, boto3.Session)
    assert captured["RoleArn"] == "arn:aws:iam::111:role/iot-write"


def test_assumed_session_is_cached(monkeypatch):
    _set_registry(
        monkeypatch,
        bindings={"iot:write": {"role_arn": "arn:aws:iam::111:role/x", "envs": {}}},
    )
    calls = {"n": 0}

    class _FakeSts:
        def assume_role(self, **kwargs):
            calls["n"] += 1
            return {
                "Credentials": {
                    "AccessKeyId": "AKIA",
                    "SecretAccessKey": "secret",
                    "SessionToken": "token",
                    "Expiration": datetime.now(timezone.utc) + timedelta(hours=1),
                }
            }

    monkeypatch.setattr(capabilities.boto3, "client", lambda *a, **k: _FakeSts())

    capabilities.get_session("iot:write")
    capabilities.get_session("iot:write")
    assert calls["n"] == 1  # second call served from cache


def test_per_env_binding_requires_known_env(monkeypatch):
    _set_registry(
        monkeypatch,
        bindings={
            "iot:write": {
                "role_arn": None,
                "envs": {"dev": "arn:aws:iam::111:role/dev"},
            }
        },
    )
    with pytest.raises(RuntimeError, match="no binding for env"):
        capabilities.get_session("iot:write", env="prod")
