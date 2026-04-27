"""Tobot Agent — AgentCore Runtime entrypoint.

v0 scaffold. Phase 1 wires Strands + Bedrock + Gateway list_tools + scope filter.
Right now this is a hello-world that confirms the container hosts correctly.
"""
from __future__ import annotations

import logging
from typing import Any

from bedrock_agentcore import BedrockAgentCoreApp

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("tobot")

app = BedrockAgentCoreApp()


@app.entrypoint
def handler(request: dict[str, Any]) -> dict[str, Any]:
    prompt = (request.get("prompt") or "").strip()
    log.info("invoke prompt_len=%d", len(prompt))
    return {"text": f"Tobot Agent v0 received: {prompt!r}"}


if __name__ == "__main__":
    app.run()
