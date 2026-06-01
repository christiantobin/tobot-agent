"""Capability-keyed boto3 session helper.

Tools that need AWS reach call:

    from capabilities import get_session
    session = get_session("iot:write", env="prod")
    iot = session.client("iot")

The capability name must exist in config/capabilities.yaml (which is
read once at import time and cached). The CDK stack has already granted
sts:AssumeRole at synth time for any capability declared in a tool's
manifest, so by the time runtime code calls this, IAM is in sync with
what's permitted.

If the capability has `defaults.auto_grant_reads: true` applied (i.e.
it's a *:read capability and the registry opts into auto-grant), the
helper returns the default session — no AssumeRole is needed because
the hub task role already has a wide read policy. Tools shouldn't have
to care about this distinction.

Credentials are cached per (capability, env) and refreshed 60s before
expiry. Default session duration when assuming is 1 hour.
"""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

import boto3
import yaml

log = logging.getLogger(__name__)

# Registry is copied into the container at /app/config/capabilities.yaml
# by the Dockerfile. Local dev runs the agent from agent-runtime/, so
# the file lives at ../config/capabilities.yaml.
_REGISTRY_CANDIDATES = [
    Path("/app/config/capabilities.yaml"),
    Path(__file__).resolve().parent.parent / "config" / "capabilities.yaml",
]

_REFRESH_BUFFER_S = 60
_DEFAULT_SESSION_DURATION_S = 3600

_lock = threading.Lock()
_registry_cache: dict[str, Any] | None = None
_session_cache: dict[tuple[str, str | None], dict[str, Any]] = {}


def _load_registry() -> dict[str, Any]:
    """Parse config/capabilities.yaml into a flat dict.

    Returns:
        {
            "auto_grant_reads": bool,
            "default_region": str,
            "bindings": { capability_name: {"role_arn": str | None,
                                            "envs": {env: arn, ...}} }
        }
    """
    global _registry_cache
    if _registry_cache is not None:
        return _registry_cache
    with _lock:
        if _registry_cache is not None:
            return _registry_cache
        loaded: dict[str, Any] = {
            "auto_grant_reads": True,
            "default_region": "us-west-2",
            "bindings": {},
        }
        for p in _REGISTRY_CANDIDATES:
            if not p.is_file():
                continue
            with p.open() as f:
                raw = yaml.safe_load(f) or {}
            if not isinstance(raw, dict):
                raise RuntimeError(f"{p} did not parse to a YAML mapping")
            defaults = raw.get("defaults") or {}
            if isinstance(defaults, dict):
                loaded["auto_grant_reads"] = bool(defaults.get("auto_grant_reads", True))
                loaded["default_region"] = str(defaults.get("region") or "us-west-2")
            caps = raw.get("capabilities") or {}
            if isinstance(caps, dict):
                for name, value in caps.items():
                    if not isinstance(value, dict):
                        continue
                    role_arn = value.get("role_arn")
                    envs = value.get("envs") or {}
                    loaded["bindings"][name] = {
                        "role_arn": role_arn if isinstance(role_arn, str) else None,
                        "envs": {k: v for k, v in envs.items() if isinstance(v, str)}
                            if isinstance(envs, dict)
                            else {},
                    }
            log.info("loaded capability registry from %s (%d bindings)",
                     p, len(loaded["bindings"]))
            break
        else:
            log.warning(
                "no capabilities.yaml found in any of: %s — capability "
                "lookups will fall back to the default session",
                [str(p) for p in _REGISTRY_CANDIDATES],
            )
        _registry_cache = loaded
        return _registry_cache


def _is_read(capability: str) -> bool:
    parts = capability.split(":")
    return len(parts) >= 2 and parts[1] == "read"


def _resolve_role_arn(capability: str, env: str | None, registry: dict[str, Any]) -> str | None:
    binding = registry["bindings"].get(capability)
    if binding is None:
        return None
    if env is not None and binding["envs"]:
        arn = binding["envs"].get(env)
        if arn is None:
            raise RuntimeError(
                f"capability {capability!r} has no binding for env {env!r}. "
                f"Available envs: {sorted(binding['envs'].keys())}"
            )
        return arn
    return binding.get("role_arn")


def get_session(capability: str, *, env: str | None = None) -> boto3.Session:
    """Return a boto3.Session for the given capability and env.

    Resolution:
      1. If the capability is a *:read AND auto_grant_reads is enabled in
         the registry, return the default session (no AssumeRole — the
         hub task role already has the read policy).
      2. Otherwise look up the capability's binding. If it's per-env,
         use the env-specific role; otherwise use the single role_arn.
      3. sts:AssumeRole, cache the creds, return the assumed session.

    Args:
        capability: A capability name (e.g. "iot:write", "s3:read:bucket").
        env: Required if the capability is bound per-env; ignored
            otherwise. Single-account adopters typically pass None.

    Raises:
        RuntimeError: capability isn't bound and isn't covered by
            auto_grant_reads, OR env was provided but isn't bound,
            OR the AssumeRole call fails.
    """
    registry = _load_registry()

    if _is_read(capability) and registry["auto_grant_reads"]:
        # Default session: the hub role's own credentials. Region falls
        # back to the registry's default if not set in the boto3 env.
        return boto3.Session(region_name=registry["default_region"])

    role_arn = _resolve_role_arn(capability, env, registry)
    if not role_arn:
        raise RuntimeError(
            f"capability {capability!r} is not bound in capabilities.yaml. "
            f"Either add a binding, or (if it's a *:read) enable "
            f"defaults.auto_grant_reads."
        )

    cache_key = (capability, env)
    now = int(time.time())
    cached = _session_cache.get(cache_key)
    if cached and now < cached["expires_at"] - _REFRESH_BUFFER_S:
        return cached["session"]

    sts = boto3.client("sts")
    try:
        resp = sts.assume_role(
            RoleArn=role_arn,
            RoleSessionName=f"tobot-{capability}-{env or 'default'}".replace(":", "-")[:64],
            DurationSeconds=_DEFAULT_SESSION_DURATION_S,
        )
    except Exception as err:
        raise RuntimeError(
            f"sts:AssumeRole on {role_arn} failed ({type(err).__name__}: {err}). "
            f"Check that the tool's manifest declares this capability and that "
            f"the spoke role's trust policy allows the hub account."
        ) from err

    creds = resp["Credentials"]
    session = boto3.Session(
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
        region_name=registry["default_region"],
    )
    _session_cache[cache_key] = {
        "session": session,
        "expires_at": int(creds["Expiration"].timestamp()),
    }
    return session
