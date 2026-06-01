# AgentCore Runtime requires linux/arm64.
FROM --platform=linux/arm64 python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Base runtime dependencies.
COPY agent-runtime/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Per-tool dependencies. Each tools/<name>/requirements.txt (if present)
# gets installed. Each tools/<name>/pyproject.toml (package-form tools)
# gets pip-installed. Simple-form tools (a single tool.py) are imported
# directly from /opt/tools by discovery.py at runtime — nothing to pip.
COPY tools/ /opt/tools/
RUN set -eux; \
    for d in /opt/tools/*/; do \
      name=$(basename "$d"); \
      case "$name" in _*) continue;; esac; \
      if [ -f "$d/requirements.txt" ]; then \
        pip install -r "$d/requirements.txt"; \
      fi; \
      if [ -f "$d/pyproject.toml" ]; then \
        pip install "$d"; \
      fi; \
    done

# Framework code + deployment config.
COPY agent-runtime /app
COPY config /app/config

EXPOSE 8080
CMD ["python", "main.py"]
