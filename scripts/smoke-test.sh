#!/usr/bin/env bash
#
# smoke-test.sh — confirm a deployed Tobot Agent is alive end to end.
#
# Sends a correctly-signed request to the webhook front door and checks
# for an HTTP 200 with a non-empty reply. This exercises the whole path:
# API Gateway -> webhook Lambda (HMAC verify) -> AgentCore Runtime ->
# Strands agent -> the `echo` tool -> back out.
#
# Usage:
#   scripts/smoke-test.sh [STAGE] [PROMPT]
#
# STAGE defaults to "dev". PROMPT defaults to asking the bot to echo.
# Reads the webhook URL from the Platform stack outputs and the signing
# secret from Secrets Manager, so you don't pass either by hand. Honors
# AWS_PROFILE / AWS_REGION.
set -euo pipefail

STAGE="${1:-dev}"
PROMPT="${2:-Please call the echo tool with the text smoke-test-ok.}"
STACK="TobotAgent-Platform-${STAGE}"
SECRET_ID="tobot-agent/webhook/signing-secret-${STAGE}"

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

echo "Resolving webhook URL from stack ${STACK}..."
URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='WebhookUrl'].OutputValue" \
  --output text)"
if [[ -z "$URL" || "$URL" == "None" ]]; then
  echo "Could not find WebhookUrl output on ${STACK}. Is it deployed?" >&2
  exit 1
fi

echo "Resolving webhook signing secret..."
SECRET="$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ID" \
  --query 'SecretString' --output text)"
if [[ -z "$SECRET" || "$SECRET" == "None" ]]; then
  echo "Webhook signing secret is empty. Run scripts/bootstrap-secrets.sh first." >&2
  exit 1
fi

TS="$(date +%s)"
BODY="$(printf '{"prompt":%s,"thread_id":"smoke-%s","adapter":"webhook"}' \
  "$(printf '%s' "$PROMPT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')" \
  "$TS")"

BASE="v1:${TS}:${BODY}"
SIG="v1=$(printf '%s' "$BASE" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')"

echo "POST ${URL}"
RESP="$(curl -sS -X POST "$URL" \
  -H 'content-type: application/json' \
  -H "x-tobot-timestamp: ${TS}" \
  -H "x-tobot-signature: ${SIG}" \
  --data-binary "$BODY" \
  -w $'\n%{http_code}')"

CODE="$(printf '%s' "$RESP" | tail -n1)"
PAYLOAD="$(printf '%s' "$RESP" | sed '$d')"

echo "HTTP ${CODE}"
echo "Response: ${PAYLOAD}"

if [[ "$CODE" != "200" ]]; then
  echo "✗ smoke test FAILED (expected 200)" >&2
  exit 1
fi
if [[ -z "$PAYLOAD" || "$PAYLOAD" == '{"text":""}' ]]; then
  echo "✗ smoke test FAILED (empty reply)" >&2
  exit 1
fi
echo "✓ smoke test passed"
