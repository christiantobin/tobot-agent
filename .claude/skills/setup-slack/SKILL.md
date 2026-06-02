---
name: setup-slack
description: Use when connecting a Slack workspace to a deployed Tobot Agent — creating the Slack app, verifying the Request URL, installing the bot, setting the signing secret + bot token, admin/allowlist config, or debugging why the Slack bot doesn't reply or react.
---

# Setup Slack — wire a workspace to Tobot Agent

Connects a Slack workspace to an already-deployed Tobot. **Run the `setup` skill first** — you need the platform deployed and its `SlackEventsUrl` output. You also need a workspace where you can install apps (some orgs require admin approval — that's the first thing to confirm if you get stuck).

## 1. Create the app from the manifest

`docs/slack/app-manifest.example.yaml` has the scopes and event subscriptions pre-filled. Replace its `request_url` with your `SlackEventsUrl` output, then:

<https://api.slack.com/apps> → **Create New App → From an app manifest** → pick the workspace → paste the YAML → **Create**.

Slack verifies the Request URL on create — it should show **Verified ✓**. (The verification Lambda answers Slack's `url_verification` handshake without needing the signing secret, so this works on a fresh deploy before any secret is set.)

## 2. Install + set secrets

- **Install to Workspace** and authorize.
- **OAuth & Permissions** → copy the **Bot User OAuth Token** (`xoxb-…`).
- **Basic Information** → copy the **Signing Secret**.
- `scripts/bootstrap-secrets.sh <stage>` → paste both at the prompts (hidden input; tokens don't echo).

## 3. Make it usable

- **Bot User ID** (Basic Information) → redeploy with `-c bot_user_id=U0XYZ…` so mention dedup is precise.
- **Admin**: add your Slack user id to `config/admins.yaml` and redeploy. Admins bypass the allowlist; everyone else must be allowlisted (an admin can add users/channels by asking the bot).
- **Invite the bot to a channel**, then `@tobot hello`.

## Troubleshooting

| Symptom                                | Cause → fix                                                                                                                                                                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request URL won't verify               | Platform not deployed, or wrong URL. Confirm the `SlackEventsUrl` output and that the stack is up. The verification Lambda must be the deployed one.                                                                                     |
| Bot never replies to an `@mention`     | (a) you're not an admin and not allowlisted → add yourself to `config/admins.yaml` and redeploy; (b) the bot isn't in the channel → invite it; (c) Bedrock model access missing. Check the verification + bridge Lambda CloudWatch logs. |
| No ⏳ / ✅ / ✗ reactions               | Missing `reactions:write` scope → add it and reinstall the app.                                                                                                                                                                          |
| Thread follow-ups ignored              | Needs the `message.channels` / `message.groups` events AND a valid classifier id in `config/models.yaml`.                                                                                                                                |
| Replies, but drops some thread replies | Mention-dedup heuristic running without `bot_user_id` → set it (step 3).                                                                                                                                                                 |
