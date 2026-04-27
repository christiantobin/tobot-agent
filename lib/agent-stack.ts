import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AgentStackProps extends cdk.StackProps {
  readonly stage: string;
}

/**
 * Agent plane: AgentCore Runtime container, Gateway shell, scope-registry
 * override table, session table.
 *
 * v0 scaffold — empty. Phase 1 fills in the runtime + Gateway + a hello-world
 * tool registered as a Lambda target.
 */
export class AgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);
    // intentionally empty
  }
}
