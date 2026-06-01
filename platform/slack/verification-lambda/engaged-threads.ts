import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({});

/**
 * Lookup helper: has the bot replied in this thread within the TTL?
 *
 * The bridge Lambda PutItems on every successful reply with a 24h TTL
 * refresh, so an "engaged" thread is one where the bot has been active
 * recently. The TTL cleans up stale entries server-side; this lookup
 * just checks presence.
 *
 * Returns the previousBotReply string if stored (used as classifier
 * context), or undefined if the thread is engaged but no reply text
 * was recorded.
 */
export interface EngagementRecord {
  readonly engaged: boolean;
  readonly previousBotReply?: string;
}

export async function getEngagement(threadTs: string): Promise<EngagementRecord> {
  const table = process.env.ENGAGED_THREADS_TABLE_NAME;
  if (!table) throw new Error('ENGAGED_THREADS_TABLE_NAME env var is not set');

  const resp = await ddb.send(
    new GetItemCommand({
      TableName: table,
      Key: { thread_ts: { S: threadTs } },
    }),
  );
  if (!resp.Item) return { engaged: false };
  const previousBotReply = resp.Item.last_bot_reply?.S;
  return { engaged: true, previousBotReply };
}
