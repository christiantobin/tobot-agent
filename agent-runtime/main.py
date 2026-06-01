"""Tobot Agent — AgentCore Runtime entrypoint.

The canonical runtime payload (sent by every front-door adapter):

    {
        "prompt":       str,    # required — user text, bot mention already stripped
        "thread_id":    str,    # required — stable id for the conversation
        "scope":        str,    # optional — adapter-defined opaque scope
                                #            (Slack channel id, webhook tenant id, etc).
                                #            Drives the manifest scope filter; tools
                                #            outside the scope are never named to the model.
        "principal_id": str,    # optional — opaque caller identifier (Slack user id, etc).
                                #            Threaded into the system prompt so the agent
                                #            can answer "who are you talking to" questions.
        "is_admin":     bool,   # optional — if true, admin tools (allowlist mgmt, etc)
                                #            are added to the toolset.
        "adapter":      str,    # optional — names the front door ("slack", "webhook").
                                #            Informational; the runtime does not branch on it.
    }

Front-door adapters not yet built (webhook, MCP-stdio) populate only the
required fields; that's fine — the optional context just doesn't surface
to the model.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from bedrock_agentcore import BedrockAgentCoreApp
from strands import Agent
from strands.models.bedrock import BedrockModel

from admin_tools import ADMIN_TOOLS
from gateway_tools import gateway_tools
from invocation_context import invocation_context
from invocation_context import reset as reset_invocation_context
from session_store import load_history, save_history
from tools.discovery import AUTO_TOOLS, filter_for_invocation

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tobot-agent")

# Model id is injected by the CDK stack from config/models.yaml.
# Default is sane for adopters running main.py outside the container.
BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_AGENT_MODEL", "us.anthropic.claude-opus-4-7"
)

app = BedrockAgentCoreApp()
_model = BedrockModel(model_id=BEDROCK_MODEL_ID)

_BASE_SYSTEM_PROMPT = (
    "You are Tobot Agent, an AI member of an engineering team. You operate "
    "through a set of tools that are dynamically composed per invocation — "
    "if a tool isn't in your toolset, it's not available in this context "
    "and you should not pretend it is. Be concise; surface uncertainty "
    "rather than guess; when a tool returns an error, classify it (transient "
    "vs. permanent vs. scope/permission) before deciding to retry or explain."
)


def _build_system_prompt(
    *,
    principal_id: str | None,
    scope: str | None,
    is_admin: bool,
    adapter: str | None,
) -> str:
    """Compose the per-invocation system prompt.

    Optional context is appended only when present so adapters that don't
    populate it (webhook, MCP-stdio) don't pollute the prompt with
    empty-string placeholders.
    """
    parts = [_BASE_SYSTEM_PROMPT]
    if scope or principal_id:
        ctx_bits = []
        if adapter:
            ctx_bits.append(f"adapter={adapter}")
        if scope:
            ctx_bits.append(f"scope={scope}")
        if principal_id:
            ctx_bits.append(f"principal_id={principal_id}")
        parts.append("Invocation context: " + ", ".join(ctx_bits) + ".")
    if principal_id:
        parts.append(
            f"When the user says \"me\" or \"I\", they mean principal_id={principal_id}."
        )
    if scope:
        parts.append(
            f"When the user says \"this channel\" or \"here\", they mean scope={scope}."
        )
    if is_admin:
        parts.append(
            "You are talking to an administrator who has access to admin tools "
            "(allowlist management, scope override). Use them when asked."
        )
    return " ".join(parts)


def _sanitize_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only text turns. Strip tool_use / tool_result blocks.

    Two reasons: (1) we only persist a transcript; (2) DynamoDB
    deserializes numbers as Decimal, which Bedrock Converse rejects
    inside tool_use inputs. Text-only sidesteps both.
    """
    cleaned: list[dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = msg.get("content") or []
        text_blocks = []
        for block in content:
            if isinstance(block, dict) and block.get("text"):
                text_blocks.append({"text": str(block["text"])})
        if text_blocks:
            cleaned.append({"role": role, "content": text_blocks})
    return cleaned


def _extract_reply(result: Any) -> str:
    """Pull the assistant's text out of a Strands AgentResult."""
    reply = ""
    message = getattr(result, "message", None)
    blocks: list = []
    if message is not None:
        blocks = list(getattr(message, "content", []) or [])
        if not blocks and isinstance(message, dict):
            blocks = list(message.get("content", []) or [])
    for block in blocks:
        text = (
            block.get("text") if isinstance(block, dict) else getattr(block, "text", "")
        )
        if text:
            reply += text
    if not reply:
        reply = str(result).strip()
    return reply


@app.entrypoint
def handler(request: dict[str, Any]) -> dict[str, Any]:
    prompt = (request.get("prompt") or "").strip()
    thread_id = request.get("thread_id") or "default"
    scope = request.get("scope")
    principal_id = request.get("principal_id")
    is_admin = bool(request.get("is_admin"))
    adapter = request.get("adapter")

    if not prompt:
        return {"text": ""}

    log.info(
        "invoke thread_id=%s scope=%s principal=%s admin=%s adapter=%s prompt_len=%d",
        thread_id, scope, principal_id, is_admin, adapter, len(prompt),
    )

    # Per-invocation thread-local state. Reset first so values from a
    # prior turn (if the thread is reused) don't leak.
    reset_invocation_context()
    invocation_context.invoking_principal_id = principal_id or "unknown"
    invocation_context.destructive_confirmed = bool(request.get("destructive_confirmed"))
    invocation_context.scope = scope
    invocation_context.is_admin = is_admin

    prior = _sanitize_history(load_history(thread_id))
    prior_snapshot = [
        {"role": m["role"], "content": [dict(b) for b in m["content"]]}
        for m in prior
    ]

    # Compose the toolset for this invocation: manifest-discovered tools
    # (scope-filtered) + admin tools when the caller is an admin + tools
    # registered on the AgentCore Gateway by external teams. The Gateway
    # session must stay open while the agent runs, so the agent call lives
    # inside the gateway_tools() context manager (it yields [] when no
    # Gateway is configured).
    with gateway_tools() as gw_tools:
        tools = list(filter_for_invocation(AUTO_TOOLS, scope=scope))
        if is_admin:
            tools.extend(ADMIN_TOOLS)
        tools.extend(gw_tools)

        agent = Agent(
            model=_model,
            system_prompt=_build_system_prompt(
                principal_id=principal_id,
                scope=scope,
                is_admin=is_admin,
                adapter=adapter,
            ),
            tools=tools,
            messages=prior,
        )

        result = agent(prompt)
        reply = _extract_reply(result)
    log.info("reply_len=%d", len(reply))

    persisted: list[dict[str, Any]] = list(prior_snapshot)
    persisted.append({"role": "user", "content": [{"text": prompt}]})
    if reply:
        persisted.append({"role": "assistant", "content": [{"text": reply}]})
    save_history(thread_id, persisted)

    return {"text": reply}


if __name__ == "__main__":
    app.run()
