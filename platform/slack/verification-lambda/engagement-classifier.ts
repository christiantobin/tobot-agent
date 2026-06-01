import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({});

/**
 * Cheap binary classifier: is this Slack thread message addressed to
 * the bot, or is it conversation between humans that happens to be in
 * a thread the bot previously replied in?
 *
 * Called by the verification Lambda when an engaged thread sees a
 * non-mention message. Yes routes to the agent; no drops silently.
 *
 * Uses the classifier model configured in config/models.yaml (Haiku
 * by default — pick a small model; this is sub-100-token classification
 * and you do NOT want to spend Opus tokens on it).
 */
export async function isAddressedToBot(input: {
  readonly text: string;
  readonly previousBotReply?: string;
}): Promise<boolean> {
  const modelId = process.env.BEDROCK_CLASSIFIER_MODEL;
  if (!modelId) {
    // Defensive: if model id isn't set, fail closed (treat as not
    // addressed). Better to miss a follow-up than to route every
    // thread chat to the agent.
    return false;
  }

  const userPrompt =
    `Most recent message in a Slack thread the assistant is participating in:\n\n` +
    `"${truncate(input.text, 600)}"\n\n` +
    (input.previousBotReply
      ? `For context, the assistant's previous reply was:\n"${truncate(input.previousBotReply, 300)}"\n\n`
      : '') +
    `Is this message addressed to the assistant (a follow-up question, ` +
    `instruction, response to its question, or correction), ` +
    `OR is it conversation between humans that just happens to be in ` +
    `the same thread? Reply with exactly one word: "yes" if addressed ` +
    `to the assistant, "no" otherwise. No explanation.`;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4,
    temperature: 0,
    messages: [{ role: 'user', content: userPrompt }],
  };

  try {
    const resp = await bedrock.send(
      new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        body: new TextEncoder().encode(JSON.stringify(body)),
      }),
    );
    const text = new TextDecoder().decode(resp.body);
    const parsed = JSON.parse(text) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const reply = (parsed.content ?? [])
      .map((b) => b.text ?? '')
      .join('')
      .trim()
      .toLowerCase();
    return reply.startsWith('yes');
  } catch (err) {
    // Bedrock errors are not fatal — drop the message rather than ack
    // a noisy thread continuation. Log so operators can spot a
    // consistently broken classifier and fix it.
    console.warn('engagement classifier failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
