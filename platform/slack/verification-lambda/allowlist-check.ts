import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

const ddb = new DynamoDBClient({});

/**
 * Admin user IDs come from the ADMIN_SLACK_USERS env var (comma-separated),
 * which the CDK stack populates from config/admins.yaml. Admins bypass
 * the user/channel allowlist and also get admin tools in the bridge.
 *
 * Parsed on each call so tests can set the env var in beforeEach.
 */
export function isAdmin(userId: string): boolean {
  const raw = process.env.ADMIN_SLACK_USERS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

async function existsInAllowlist(
  entityType: 'USER' | 'CHANNEL',
  entityId: string,
): Promise<boolean> {
  const tableName = process.env.ALLOWLIST_TABLE_NAME;
  if (!tableName) throw new Error('ALLOWLIST_TABLE_NAME env var is not set');

  const resp = await ddb.send(
    new GetItemCommand({
      TableName: tableName,
      Key: {
        entity_type: { S: entityType },
        entity_id: { S: entityId },
      },
    }),
  );
  return Boolean(resp.Item);
}

/**
 * True iff BOTH the user and the channel have explicit allowlist entries.
 * Admins bypass this check and should be short-circuited before calling.
 */
export async function isAllowlisted(userId: string, channelId: string): Promise<boolean> {
  const [userAllowed, channelAllowed] = await Promise.all([
    existsInAllowlist('USER', userId),
    existsInAllowlist('CHANNEL', channelId),
  ]);
  return userAllowed && channelAllowed;
}
