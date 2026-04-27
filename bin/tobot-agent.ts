#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PlatformStack } from '../lib/platform-stack';
import { AgentStack } from '../lib/agent-stack';

const app = new cdk.App();

const env = {
  region: process.env.CDK_DEFAULT_REGION ?? 'us-west-2',
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

const stage = app.node.tryGetContext('stage') ?? 'dev';

const platform = new PlatformStack(app, `TobotAgent-Platform-${stage}`, {
  env,
  stage,
});

const agent = new AgentStack(app, `TobotAgent-AgentCore-${stage}`, {
  env,
  stage,
});

// Cross-stack wiring lands when the slack-bridge needs the runtime ARN and the
// runtime needs the allowlist table name. Phase 0 keeps both stacks empty.
void platform;
void agent;
