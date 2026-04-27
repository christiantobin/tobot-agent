import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface PlatformStackProps extends cdk.StackProps {
  readonly stage: string;
}

/**
 * Front-door plane: Slack adapter, webhook adapter, allowlist + engaged-thread
 * tables, identity (Cognito by default, OIDC via config toggle).
 *
 * v0 scaffold — empty. Phase 1 fills in the Slack adapter end-to-end.
 */
export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);
    // intentionally empty
  }
}
