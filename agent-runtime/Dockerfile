# AgentCore Runtime requires linux/arm64.
FROM --platform=linux/arm64 python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY agent-runtime/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY agent-runtime /app

EXPOSE 8080
CMD ["python", "main.py"]
