#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PlatformStack } from '../lib/platform-stack';
import { AgentStack } from '../lib/agent-stack';
import { Shared } from '../lib/shared';

const app = new cdk.App();

const env = {
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const stage = app.node.tryGetContext('stage') ?? 'dev';

const shared: Shared = { region: env.region, stage };

const platform = new PlatformStack(app, `TobotAgent-Platform-${stage}`, {
  env,
  stage,
});

const agent = new AgentStack(app, `TobotAgent-AgentCore-${stage}`, {
  env,
  shared,
});

// Cross-stack wiring. CDK resolves the AGENT_RUNTIME_ARN env injection
// + the grantInvoke as a CloudFormation export/import pair, which means
// platform must deploy AFTER agent the first time. `cdk deploy --all`
// handles that automatically via the dependency edge below.
platform.wireAgentRuntime(agent.runtime);
platform.addDependency(agent);
