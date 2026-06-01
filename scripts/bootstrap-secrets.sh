#!/usr/bin/env bash
#
# bootstrap-secrets.sh — populate the three Secrets Manager shells the
# CDK stack creates empty. Run this once after the first `cdk deploy`.
#
# The secret NAMES are deterministic (derived from the stage), so this
# script doesn't need to read stack outputs — just pass the stage.
#
# Usage:
#   scripts/bootstrap-secrets.sh [STAGE]
#
# STAGE defaults to "dev". Honors AWS_PROFILE / AWS_REGION from your env.
#
# You'll be prompted for each value. The webhook signing secret can be
# auto-generated (press enter to accept a fresh random one).
set -euo pipefail

STAGE="${1:-dev}"
PREFIX="tobot-agent"

SLACK_SIGNING="${PREFIX}/slack/signing-secret-${STAGE}"
SLACK_BOT="${PREFIX}/slack/bot-token-${STAGE}"
WEBHOOK_SIGNING="${PREFIX}/webhook/signing-secret-${STAGE}"

echo "Bootstrapping secrets for stage: ${STAGE}"
echo "  (AWS_PROFILE=${AWS_PROFILE:-<default>}, region=${AWS_REGION:-${AWS_DEFAULT_REGION:-<cli default>}})"
echo

put_secret() {
  local secret_id="$1" value="$2"
  aws secretsmanager put-secret-value \
    --secret-id "$secret_id" \
    --secret-string "$value" \
    --query 'ARN' --output text >/dev/null
  echo "  ✓ set ${secret_id}"
}

# --- Slack signing secret -------------------------------------------------
read -r -s -p "Slack signing secret (from the app's Basic Information page): " slack_signing
echo
if [[ -n "$slack_signing" ]]; then
  put_secret "$SLACK_SIGNING" "$slack_signing"
else
  echo "  – skipped Slack signing secret (empty)"
fi

# --- Slack bot token ------------------------------------------------------
read -r -s -p "Slack bot token (xoxb-...): " slack_bot
echo
if [[ -n "$slack_bot" ]]; then
  put_secret "$SLACK_BOT" "$slack_bot"
else
  echo "  – skipped Slack bot token (empty)"
fi

# --- Webhook signing secret ----------------------------------------------
read -r -s -p "Webhook signing secret (enter to auto-generate): " webhook_signing
echo
if [[ -z "$webhook_signing" ]]; then
  webhook_signing="$(openssl rand -hex 32)"
  echo "  generated a random 32-byte webhook signing secret."
  echo "  SAVE THIS — your webhook caller needs it to sign requests:"
  echo "    ${webhook_signing}"
fi
put_secret "$WEBHOOK_SIGNING" "$webhook_signing"

echo
echo "Done. Secrets are populated for stage '${STAGE}'."
