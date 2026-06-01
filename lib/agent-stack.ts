import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as yaml from 'yaml';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import { Shared } from './shared';
import { loadToolManifests, ToolManifest } from './tool-manifests';
import {
  isReadCapability,
  loadCapabilityRegistry,
  resolveAssumeRoleArns,
} from './capability-registry';
import { slackAllowlistTableName } from './conventions';

export interface AgentStackProps extends cdk.StackProps {
  readonly shared: Shared;
}

/**
 * Agent plane: AgentCore Runtime container, session table, manifest
 * aggregation (IAM + secrets + env + capability bindings).
 *
 * Per-tool concerns come from manifests under tools/{tool}/tool.yaml —
 * see tools/MANIFEST.md. Adding a new tool means dropping a folder
 * under tools/; this stack does not require an edit per new tool.
 *
 * Per-deployment concerns (model id, capability bindings, identity)
 * come from config/*.yaml. Adding a new deployment topology means
 * editing config, not stacks.
 */
export class AgentStack extends cdk.Stack {
  public readonly runtime: agentcore.Runtime;
  public readonly gateway: agentcore.Gateway;
  public readonly sessionTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    const repoRoot = path.join(__dirname, '..');
    const models = loadModelsConfig(repoRoot);
    const manifests = loadToolManifests(repoRoot);
    const capabilityRegistry = loadCapabilityRegistry(repoRoot);

    // --- Session table -------------------------------------------------
    this.sessionTable = new dynamodb.Table(this, 'AgentSessionsTable', {
      tableName: `tobot-agent-sessions-${props.shared.stage}`,
      partitionKey: { name: 'thread_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires_at',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Manifest aggregation: secrets ---------------------------------
    const secretEnv: Record<string, string> = {};
    const secretsToGrant: secrets.ISecret[] = [];
    for (const manifest of manifests) {
      for (const decl of manifest.secrets) {
        const construct = new secrets.Secret(this, secretLogicalId(manifest, decl), {
          secretName: `tobot-agent/${decl.name}-${props.shared.stage}`,
          description: decl.description ?? `Tool secret for ${manifest.name}. Populate manually.`,
        });
        secretEnv[decl.env] = construct.secretArn;
        secretsToGrant.push(construct);
      }
    }

    // --- Manifest aggregation: literal env vars ------------------------
    const literalEnv: Record<string, string> = {};
    for (const manifest of manifests) {
      for (const [k, v] of Object.entries(manifest.env)) {
        literalEnv[k] = v;
      }
    }

    // --- Container build context ---------------------------------------
    const artifact = agentcore.AgentRuntimeArtifact.fromAsset(repoRoot, {
      file: 'agent-runtime/Dockerfile',
      // AgentCore requires linux/arm64.
      platform: { platform: 'linux/arm64' },
    });

    const allowlistTableName = slackAllowlistTableName(props.shared.stage);
    const allowlistTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/${allowlistTableName}`;

    // --- AgentCore Gateway (MCP tool registry) ------------------------
    // Provisioned here so a single deploy gives you the full surface:
    // in-tree tools (manifest-driven) AND an empty Gateway shell ready
    // for external teams to register MCP/Lambda/OpenAPI targets against.
    // Default authorizer = Cognito (per SPEC); default protocol = MCP.
    //
    // The runtime consumes the Gateway at invocation time: it opens an
    // MCP session (GATEWAY_URL below) and merges the Gateway's tools with
    // the in-tree manifest tools (see agent-runtime/gateway_tools.py).
    // Degrades gracefully — if GATEWAY_URL is empty the agent runs with
    // in-tree tools only.
    this.gateway = new agentcore.Gateway(this, 'TobotAgentGateway', {
      gatewayName: `tobot-agent-gateway-${props.shared.stage}`,
      description: `Tobot Agent MCP tool registry (${props.shared.stage})`,
    });

    this.runtime = new agentcore.Runtime(this, 'TobotAgentRuntime', {
      runtimeName: `tobot_agent_${props.shared.stage}`,
      description: `Tobot Agent on AgentCore Runtime (model: ${models.agent})`,
      agentRuntimeArtifact: artifact,
      environmentVariables: {
        SESSION_TABLE_NAME: this.sessionTable.tableName,
        ALLOWLIST_TABLE_NAME: allowlistTableName,
        BEDROCK_AGENT_MODEL: models.agent,
        BEDROCK_CLASSIFIER_MODEL: models.classifier,
        // The runtime opens an MCP session to GATEWAY_URL and merges the
        // Gateway's tools with in-tree tools. Empty-friendly: if the URL
        // is blank the runtime skips the Gateway and uses in-tree tools.
        GATEWAY_ID: this.gateway.gatewayId,
        GATEWAY_ARN: this.gateway.gatewayArn,
        GATEWAY_URL: this.gateway.gatewayUrl ?? '',
        ...secretEnv,
        ...literalEnv,
      },
    });

    const execRole = this.runtime.role;

    // --- Platform-level IAM -------------------------------------------
    // Bedrock Converse on the configured model. We grant against a
    // wildcard inference-profile in the deployer's account so swapping
    // the model in config/models.yaml doesn't require a stack policy
    // rewrite. The model id is still pinned via env var.
    execRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:*::foundation-model/*`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }),
    );

    this.sessionTable.grantReadWriteData(execRole);

    // Admin tools (allowlist management) read + write the Slack
    // allowlist table that PlatformStack owns. We IAM-grant on the
    // physical name (shared via lib/conventions.ts) rather than the
    // CDK construct, which keeps this stack standalone for synth/
    // diff purposes.
    execRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:DeleteItem',
          'dynamodb:Query',
        ],
        resources: [allowlistTableArn],
      }),
    );

    // --- Per-tool IAM -------------------------------------------------
    for (const manifest of manifests) {
      for (const stmt of manifest.iam) {
        execRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: stmt.actions,
            resources: stmt.resources,
          }),
        );
      }
    }

    // --- Per-tool secret read grants ----------------------------------
    for (const secret of secretsToGrant) {
      secret.grantRead(execRole);
    }

    // --- Capability resolution: assume-role grants --------------------
    // Aggregate every capability declared across every manifest. The
    // resolver throws if any capability is unbound (and isn't covered
    // by auto_grant_reads). Synth fails loudly rather than silently
    // shipping a tool that 403s at runtime.
    const declaredCapabilities = new Set<string>();
    for (const manifest of manifests) {
      for (const cap of manifest.capabilities) declaredCapabilities.add(cap);
    }
    const assumeRoleArns = resolveAssumeRoleArns(
      Array.from(declaredCapabilities),
      capabilityRegistry,
    );
    if (assumeRoleArns.size > 0) {
      execRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['sts:AssumeRole'],
          resources: Array.from(assumeRoleArns).sort(),
        }),
      );
    }

    // --- Capability resolution: auto-granted reads --------------------
    // If any declared capability is a *:read and the registry has
    // auto_grant_reads on, give the hub task role a wide read policy.
    // This is the "reads for free" lane — tools doing only reads need
    // zero binding in capabilities.yaml.
    if (capabilityRegistry.autoGrantReads) {
      const hasReadCap = Array.from(declaredCapabilities).some(isReadCapability);
      if (hasReadCap) {
        execRole.addToPrincipalPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: AUTO_READ_ACTIONS,
            // Wide by design — adopters who want narrower reads should
            // flip auto_grant_reads off and bind explicitly.
            resources: ['*'],
          }),
        );
      }
    }

    // --- Outputs ------------------------------------------------------
    new cdk.CfnOutput(this, 'AgentRuntimeArn', {
      value: this.runtime.agentRuntimeArn,
      exportName: `TobotAgent-RuntimeArn-${props.shared.stage}`,
      description: 'Wire this ARN into your front-door adapter (Slack bridge, webhook handler).',
    });

    new cdk.CfnOutput(this, 'SessionTableName', {
      value: this.sessionTable.tableName,
      description: 'DynamoDB table for thread-keyed conversation history.',
    });

    new cdk.CfnOutput(this, 'DiscoveredTools', {
      value: manifests.map((m) => m.name).join(',') || '(none)',
      description: 'Tools auto-discovered from tools/*/tool.yaml at synth time.',
    });

    new cdk.CfnOutput(this, 'BoundCapabilities', {
      value: Array.from(declaredCapabilities).sort().join(',') || '(none)',
      description: 'Capabilities declared across tools, resolved against capabilities.yaml.',
    });

    new cdk.CfnOutput(this, 'GatewayArn', {
      value: this.gateway.gatewayArn,
      exportName: `TobotAgent-GatewayArn-${props.shared.stage}`,
      description:
        'AgentCore Gateway ARN. Consumer stacks reference this to register Lambda/OpenAPI/MCP tool targets via TobotGatewayTarget.',
    });

    new cdk.CfnOutput(this, 'GatewayId', {
      value: this.gateway.gatewayId,
      exportName: `TobotAgent-GatewayId-${props.shared.stage}`,
      description: 'AgentCore Gateway short id.',
    });
  }
}

/**
 * Wide read actions auto-granted to the hub task role when ANY tool
 * declares a *:read capability AND the registry has auto_grant_reads on.
 *
 * Designed for the solo / single-account adopter who values setup speed
 * over per-tool isolation. Adopters with stricter requirements should
 * flip the flag off and bind reads explicitly.
 */
const AUTO_READ_ACTIONS = [
  // Identity / sanity
  'sts:GetCallerIdentity',

  // S3
  's3:GetObject',
  's3:ListBucket',
  's3:GetBucketLocation',

  // DynamoDB
  'dynamodb:GetItem',
  'dynamodb:Query',
  'dynamodb:Scan',
  'dynamodb:DescribeTable',
  'dynamodb:ListTables',

  // Lambda
  'lambda:GetFunction',
  'lambda:ListFunctions',

  // IoT
  'iot:DescribeThing',
  'iot:ListThings',
  'iot:ListThingPrincipals',
  'iot:ListAttachedPolicies',
  'iot:DescribeCertificate',
  'iot:DescribeEndpoint',

  // CloudWatch Logs
  'logs:DescribeLogGroups',
  'logs:DescribeLogStreams',
  'logs:FilterLogEvents',
  'logs:GetLogEvents',
  'logs:StartQuery',
  'logs:GetQueryResults',

  // Glue
  'glue:GetDatabase',
  'glue:GetDatabases',
  'glue:GetTable',
  'glue:GetTables',
  'glue:GetPartition',
  'glue:GetPartitions',

  // Secrets Manager (read of own-account secrets — for tools that fetch
  // their own API keys; the framework-managed secrets are already
  // explicitly granted).
  'secretsmanager:DescribeSecret',
  'secretsmanager:ListSecrets',
];

function loadModelsConfig(repoRoot: string): { agent: string; classifier: string } {
  const p = path.join(repoRoot, 'config', 'models.yaml');
  const defaults = {
    agent: 'us.anthropic.claude-opus-4-7',
    classifier: 'us.anthropic.claude-haiku-4-5-20251001',
  };
  if (!fs.existsSync(p)) return defaults;
  const raw = yaml.parse(fs.readFileSync(p, 'utf8'));
  if (!raw || typeof raw !== 'object') return defaults;
  const r = raw as Record<string, unknown>;
  return {
    agent: typeof r.agent === 'string' && r.agent ? r.agent : defaults.agent,
    classifier:
      typeof r.classifier === 'string' && r.classifier ? r.classifier : defaults.classifier,
  };
}

/**
 * Stable-ish CDK logical id for a manifest-declared secret. Includes the
 * tool name + secret name so renaming either is a clean re-create
 * rather than CFN logical-id churn across unrelated tools.
 */
function secretLogicalId(manifest: ToolManifest, decl: { name: string }): string {
  const camel = (s: string) =>
    s
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');
  return `Secret${camel(manifest.name)}${camel(decl.name)}`;
}
