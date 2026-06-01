"""Manifest-driven tool discovery.

Walks `tools/*/tool.yaml`, imports each tool's module, and collects the
@strands.tool callables named in `entrypoints`. The result is the union
of every tool that ships in this image — no hand-edited registry.

Two manifest forms are accepted (see tools/MANIFEST.md):
  * Simple form: a single tool.py file, `module: tool`, no pip install.
    Discovery puts the tool directory on sys.path before importing.
  * Package form: a pip-installed Python package (the Dockerfile is
    responsible for pip install), `module: <package_name>`.

Tools whose manifest sets `auto_register: false` are intentionally
SKIPPED here — they're handled at framework level by custom wrappers
that decorate the entrypoints first.
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger(__name__)


def _candidate_tools_dirs() -> list[Path]:
    """Locations to search for `<dir>/tool.yaml`.

    In the deployed container, tools are copied to /opt/tools (one
    directory per tool — see Dockerfile). In local dev the agent-runtime
    runs from `agent-runtime/`, so tools live one level up under
    `../tools/`.
    """
    candidates = [Path("/opt/tools")]
    here = Path(__file__).resolve()
    repo_tools = here.parent.parent.parent / "tools"
    candidates.append(repo_tools)
    return [p for p in candidates if p.is_dir()]


def _load_manifest(manifest_path: Path) -> dict[str, Any] | None:
    try:
        with manifest_path.open() as f:
            data = yaml.safe_load(f) or {}
    except Exception as err:  # noqa: BLE001 — bad YAML in one tool shouldn't kill the agent
        log.warning("skipping tool: failed to load %s (%s: %s)",
                    manifest_path, type(err).__name__, err)
        return None
    if not isinstance(data, dict):
        log.warning("skipping tool: %s did not parse to a mapping", manifest_path)
        return None
    if not data.get("name"):
        log.warning("skipping tool: %s has no `name`", manifest_path)
        return None
    return data


def _import_tool_module(tool_dir: Path, module_name: str):
    """Import `module_name` for a tool.

    Simple form (a `<module_name>.py` file next to `tool.yaml`): load
    via spec_from_file_location with a synthesized unique name
    `tobot_tools.<dir>` so two tools that both ship a `tool.py` don't
    collide in `sys.modules`.

    Package form (a pip-installed Python package): use the normal import
    machinery — the Dockerfile already pip-installed it, so the package
    name resolves through site-packages.
    """
    file_candidate = tool_dir / f"{module_name}.py"
    if file_candidate.is_file():
        synthesized = f"tobot_tools.{tool_dir.name.replace('-', '_')}"
        spec = importlib.util.spec_from_file_location(synthesized, file_candidate)
        if spec is None or spec.loader is None:
            raise ImportError(f"could not build spec for {file_candidate}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[synthesized] = module
        spec.loader.exec_module(module)
        return module
    return importlib.import_module(module_name)


def _collect_entrypoints(module, names: Iterable[str], tool_name: str) -> list[Any]:
    found: list[Any] = []
    for name in names:
        attr = getattr(module, name, None)
        if attr is None:
            log.warning("tool %s declares entrypoint %s but module %s "
                        "has no such attribute — skipping",
                        tool_name, name, module.__name__)
            continue
        found.append(attr)
    return found


def discover_tools() -> list[tuple[Any, dict[str, Any]]]:
    """Return all auto-registered (callable, access) pairs across manifests.

    `access` is the manifest's `access:` block (or {} if unset). The
    runtime is responsible for filtering by the per-invocation scope
    before constructing the agent's toolset — discovery itself does not
    gate.

    Tools whose manifest tags include "destructive" are wrapped with
    the runtime confirmation guard (agent-runtime/destructive_guard.py)
    before being added to the result. The wrapper preserves the tool's
    schema so the model sees the same shape; only the runtime behavior
    changes.

    Order: alphabetical by tool name, then in entrypoints-list order.
    Stable so logs and prompts don't shuffle between runs.
    """
    # Local import to avoid a circular dependency at module load time
    # (destructive_guard imports invocation_context, which is otherwise
    # framework-side code; tools.discovery is also framework-side but
    # imported very early by main.py).
    from destructive_guard import wrap_destructive

    discovered: list[tuple[Any, dict[str, Any]]] = []
    seen_names: set[str] = set()

    for tools_root in _candidate_tools_dirs():
        for manifest_path in sorted(tools_root.glob("*/tool.yaml")):
            tool_dir = manifest_path.parent
            # Directories starting with `_` are templates / examples.
            if tool_dir.name.startswith("_"):
                continue
            manifest = _load_manifest(manifest_path)
            if manifest is None:
                continue
            name = manifest["name"]
            if name in seen_names:
                # Same tool reachable from both /opt/tools and ../tools
                # (local dev with the package also installed). Don't
                # double-register.
                continue
            seen_names.add(name)

            if not manifest.get("auto_register", True):
                log.info("tool %s opted out of auto-registration "
                         "(handled by a framework wrapper)", name)
                continue

            module_name = manifest.get("module")
            entrypoints = manifest.get("entrypoints") or []
            if not module_name or not entrypoints:
                log.warning("tool %s has no `module` or `entrypoints` — "
                            "skipping", name)
                continue

            try:
                module = _import_tool_module(tool_dir, module_name)
            except Exception as err:  # noqa: BLE001
                log.warning("tool %s: import of %s failed (%s: %s) — skipping",
                            name, module_name, type(err).__name__, err)
                continue

            callables = _collect_entrypoints(module, entrypoints, name)
            access = manifest.get("access") or {}
            tags = manifest.get("tags") or []
            is_destructive = isinstance(tags, list) and "destructive" in tags
            if is_destructive:
                callables = [wrap_destructive(fn) for fn in callables]
            if access or tags:
                log.info("discovered tool %s (%d entrypoints, access=%s, tags=%s)",
                         name, len(callables), access, tags)
            else:
                log.info("discovered tool %s (%d entrypoints)", name, len(callables))
            for fn in callables:
                discovered.append((fn, access))

    return discovered


AUTO_TOOLS: list[tuple[Any, dict[str, Any]]] = discover_tools()
"""Module-level cache of (callable, access) pairs.

`access` is the manifest's `access:` block. The runtime filters per
invocation by `scope`. An empty `access` dict means the tool is
visible everywhere.
"""


def filter_for_invocation(
    auto_tools: list[tuple[Any, dict[str, Any]]],
    *,
    scope: str | None = None,
) -> list[Any]:
    """Return the callables visible for an invocation in the given scope.

    A tool is included unless it declares `access.scopes` and the
    invocation's scope isn't in that list. The model never sees the
    tool's name when it's filtered out, so hallucinated invocation is
    impossible.

    `scope` is whatever opaque string the front-door adapter passes —
    typically a Slack channel id, a webhook tenant id, etc. The
    framework does not interpret it.
    """
    out: list[Any] = []
    for fn, access in auto_tools:
        scopes = (access or {}).get("scopes")
        if scopes and scope not in scopes:
            continue
        out.append(fn)
    return out
