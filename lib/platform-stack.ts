import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import { slackAllowlistTableName, engagedThreadsTableName } from './conventions';

export interface PlatformStackProps extends cdk.StackProps {
  readonly stage: string;
}

/**
 * Front-door plane: Slack adapter (Phase 2a).
 *
 * Resources:
 *   - Two Secrets Manager shells (signing secret, bot token) populated
 *     manually post-deploy.
 *   - SQS FIFO queue + DLQ for buffering inbound events. FIFO grouping
 *     by thread_ts keeps replies ordered within a thread.
 *   - DynamoDB allowlist table (USER + CHANNEL entries) — admins bypass.
 *   - Verification Lambda behind an HTTP API endpoint Slack POSTs to.
 *   - Slack-bridge Lambda — SQS consumer, invokes the agent runtime,
 *     posts replies back to Slack.
 *
 * Webhook adapter, AgentCore Gateway, Cognito identity wiring land in
 * later phases — keep this stack focused on the Slack path for now.
 */
export class PlatformStack extends cdk.Stack {
  public readonly allowlistTable: dynamodb.Table;
  public readonly engagedThreadsTable: dynamodb.Table;
  private readonly slackBridgeLambda: nodejs.NodejsFunction;
  private readonly webhookHandlerLambda: nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    const repoRoot = path.join(__dirname, '..');
    const adminSlackUsers = loadAdmins(repoRoot, 'slack');
    const classifierModelId = loadClassifierModelId(repoRoot);

    // --- Secrets -------------------------------------------------------
    const signingSecret = new secrets.Secret(this, 'SlackSigningSecret', {
      secretName: `tobot-agent/slack/signing-secret-${props.stage}`,
      description: 'Slack signing secret. Populate manually after registering your Slack app.',
    });

    const botToken = new secrets.Secret(this, 'SlackBotToken', {
      secretName: `tobot-agent/slack/bot-token-${props.stage}`,
      description: 'Slack bot user OAuth token (xoxb-...). Populate manually after install.',
    });

    // --- SQS FIFO queue + DLQ -----------------------------------------
    const dlq = new sqs.Queue(this, 'SlackEventsDlq', {
      queueName: `tobot-agent-slack-events-dlq-${props.stage}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      retentionPeriod: Duration.days(14),
    });

    const queue = new sqs.Queue(this, 'SlackEventsQueue', {
      queueName: `tobot-agent-slack-events-${props.stage}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(720),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // --- Allowlist table ----------------------------------------------
    // Non-admin Slack users must appear as USER entries AND their
    // invoking channel must appear as a CHANNEL entry; otherwise the
    // verification Lambda drops the event silently.
    // Named via lib/conventions.ts so AgentStack can IAM-grant on the
    // same table without a CDK construct dependency.
    this.allowlistTable = new dynamodb.Table(this, 'AllowlistTable', {
      tableName: slackAllowlistTableName(props.stage),
      partitionKey: { name: 'entity_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'entity_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Engaged-threads table: records threads Tobot has replied in so
    // the verification Lambda can decide whether non-mention messages
    // in those threads should be classified-and-maybe-routed (vs. the
    // default of ignoring everything that isn't an @mention). 24h TTL
    // matches typical thread lifespan; bridge writes on every successful
    // reply, refreshing TTL.
    this.engagedThreadsTable = new dynamodb.Table(this, 'EngagedThreadsTable', {
      tableName: engagedThreadsTableName(props.stage),
      partitionKey: { name: 'thread_ts', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Verification Lambda ------------------------------------------
    // Verification Lambda: 5s isn't enough once the classifier path is
    // active — Bedrock cold start can spike to 1-2s. Bump to 8s. Still
    // well inside Slack's 3s ack window because Slack only requires the
    // initial HTTP ack, which we send before classifier latency (we
    // call classifier inline only when an engaged-thread match warrants
    // it; @-mentions still ack-and-queue in <100ms).
    const verificationLambda = new nodejs.NodejsFunction(this, 'SlackVerificationLambda', {
      functionName: `tobot-agent-slack-verification-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(repoRoot, 'platform', 'slack', 'verification-lambda', 'index.ts'),
      handler: 'handler',
      timeout: Duration.seconds(8),
      memorySize: 512,
      environment: {
        SQS_QUEUE_URL: queue.queueUrl,
        SLACK_SIGNING_SECRET_ARN: signingSecret.secretArn,
        ADMIN_SLACK_USERS: adminSlackUsers.join(','),
        ALLOWLIST_TABLE_NAME: this.allowlistTable.tableName,
        ENGAGED_THREADS_TABLE_NAME: this.engagedThreadsTable.tableName,
        BEDROCK_CLASSIFIER_MODEL: classifierModelId,
        // BOT_USER_ID is optional. Without it, the verification Lambda
        // treats *any* user mention in a thread reply as a likely
        // bot-mention and routes via the app_mention path (avoiding
        // double-processing). With it set, the dedup is precise.
        // Set this after registering the Slack app — the bot user id
        // appears on the app's "Basic Information" page.
        BOT_USER_ID: this.node.tryGetContext('bot_user_id') ?? '',
      },
    });
    queue.grantSendMessages(verificationLambda);
    signingSecret.grantRead(verificationLambda);
    this.allowlistTable.grantReadData(verificationLambda);
    this.engagedThreadsTable.grantReadData(verificationLambda);
    // Bedrock InvokeModel on the classifier inference profile +
    // foundation model. Inference-profile ARN is account-scoped; the
    // foundation-model ARN is wildcard (Bedrock requires both for
    // cross-region inference profiles).
    verificationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/${classifierModelId}`,
        ],
      }),
    );

    // --- Slack-Bridge Lambda ------------------------------------------
    this.slackBridgeLambda = new nodejs.NodejsFunction(this, 'SlackBridgeLambda', {
      functionName: `tobot-agent-slack-bridge-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(repoRoot, 'platform', 'slack', 'bridge-lambda', 'index.ts'),
      handler: 'handler',
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        SLACK_BOT_TOKEN_ARN: botToken.secretArn,
        ADMIN_SLACK_USERS: adminSlackUsers.join(','),
        ENGAGED_THREADS_TABLE_NAME: this.engagedThreadsTable.tableName,
      },
    });
    botToken.grantRead(this.slackBridgeLambda);
    this.engagedThreadsTable.grantWriteData(this.slackBridgeLambda);
    this.slackBridgeLambda.addEventSource(new SqsEventSource(queue, { batchSize: 1 }));

    // --- Webhook adapter ----------------------------------------------
    // Synchronous HTTP front door — caller HMAC-signs (X-Tobot-Signature),
    // we verify, invoke the runtime, return the reply inline. No queue,
    // no engaged-thread following — caller is responsible for sending
    // only events meant for the agent.
    const webhookSigningSecret = new secrets.Secret(this, 'WebhookSigningSecret', {
      secretName: `tobot-agent/webhook/signing-secret-${props.stage}`,
      description: 'Webhook HMAC signing secret. Generate a random value and share with callers.',
    });

    this.webhookHandlerLambda = new nodejs.NodejsFunction(this, 'WebhookHandlerLambda', {
      functionName: `tobot-agent-webhook-handler-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(repoRoot, 'platform', 'webhook', 'handler-lambda', 'index.ts'),
      handler: 'handler',
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        WEBHOOK_SIGNING_SECRET_ARN: webhookSigningSecret.secretArn,
      },
    });
    webhookSigningSecret.grantRead(this.webhookHandlerLambda);

    // --- HTTP API: shared front-door endpoint -------------------------
    const api = new apigw.HttpApi(this, 'FrontDoorApi', {
      apiName: `tobot-agent-frontdoor-${props.stage}`,
    });
    api.addRoutes({
      path: '/slack/events',
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        'SlackVerificationIntegration',
        verificationLambda,
      ),
    });
    api.addRoutes({
      path: '/webhook',
      methods: [apigw.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        'WebhookHandlerIntegration',
        this.webhookHandlerLambda,
      ),
    });

    // --- Outputs ------------------------------------------------------
    new cdk.CfnOutput(this, 'SlackEventsUrl', {
      value: `${api.apiEndpoint}/slack/events`,
      description: 'Paste this URL into the Slack app Event Subscriptions page.',
    });

    new cdk.CfnOutput(this, 'WebhookUrl', {
      value: `${api.apiEndpoint}/webhook`,
      description:
        'HMAC-signed POST endpoint. Callers sign with the value of WebhookSigningSecretArn.',
    });

    new cdk.CfnOutput(this, 'WebhookSigningSecretArn', {
      value: webhookSigningSecret.secretArn,
      description: 'Generate a random value, store it here, and share with each webhook caller.',
    });

    new cdk.CfnOutput(this, 'SlackSigningSecretArn', {
      value: signingSecret.secretArn,
      description: 'Set this secret to your Slack signing secret after registering the app.',
    });

    new cdk.CfnOutput(this, 'SlackBotTokenArn', {
      value: botToken.secretArn,
      description: 'Set this secret to your Slack bot token (xoxb-...) after installing the app.',
    });

    new cdk.CfnOutput(this, 'AllowlistTableName', {
      value: this.allowlistTable.tableName,
      description: 'DynamoDB allowlist table — USER / CHANNEL entries gate non-admin invocations.',
    });
  }

  /**
   * Connect the front-door Lambdas to the AgentCore Runtime. Called
   * from bin/tobot-agent.ts after both stacks are instantiated so CDK
   * resolves the cross-stack ARN dependency automatically.
   *
   * Every Lambda that invokes the runtime needs both the env var AND
   * the grantInvoke — adding a new adapter is one more pair here.
   */
  public wireAgentRuntime(runtime: agentcore.Runtime): void {
    for (const fn of [this.slackBridgeLambda, this.webhookHandlerLambda]) {
      fn.addEnvironment('AGENT_RUNTIME_ARN', runtime.agentRuntimeArn);
      runtime.grantInvoke(fn);
    }
  }
}

/**
 * Read the classifier model id from config/models.yaml. Falls back to
 * a sane default if the file or field is missing, matching AgentStack.
 */
function loadClassifierModelId(repoRoot: string): string {
  const fallback = 'us.anthropic.claude-haiku-4-5-20251001';
  const p = path.join(repoRoot, 'config', 'models.yaml');
  if (!fs.existsSync(p)) return fallback;
  const raw = yaml.parse(fs.readFileSync(p, 'utf8'));
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Record<string, unknown>;
  return typeof r.classifier === 'string' && r.classifier ? r.classifier : fallback;
}

/**
 * Read config/admins.yaml and return the list of admin IDs for a given
 * adapter. Returns [] if the file is missing or the adapter has no
 * entries — admins are optional (single-account adopters might run with
 * no admins until they need allowlist-management tools).
 */
function loadAdmins(repoRoot: string, adapter: 'slack' | 'webhook'): string[] {
  const p = path.join(repoRoot, 'config', 'admins.yaml');
  if (!fs.existsSync(p)) return [];
  const raw = yaml.parse(fs.readFileSync(p, 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const v = (raw as Record<string, unknown>)[adapter];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}
