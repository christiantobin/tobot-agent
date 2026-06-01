/**
 * TobotGatewayTarget — a thin wrapper around the underlying alpha
 * AgentCore Gateway target constructs.
 *
 * The Tobot Agent stack provisions an empty AgentCore Gateway. External
 * teams register their tools as targets on that gateway, from their own
 * CDK apps in their own repos / AWS accounts. This construct is what
 * they instantiate to do so.
 *
 * Three target shapes are supported:
 *   - Lambda — author writes a Lambda + tool schema; Gateway
 *     MCP-wraps it transparently.
 *   - OpenAPI — author provides an OpenAPI 3 schema referencing their
 *     HTTPS API (S3-hosted, inline, or asset).
 *   - Smithy  — author provides a Smithy model.
 *
 * Usage (Lambda example, in a consumer's CDK app):
 *
 *   ```ts
 *   import * as cdk from 'aws-cdk-lib';
 *   import {
 *     Gateway,
 *     ToolSchema,
 *   } from '@aws-cdk/aws-bedrock-agentcore-alpha';
 *   import { TobotGatewayTarget } from 'tobot-agent/lib/constructs';
 *
 *   const gateway = Gateway.fromGatewayAttributes(this, 'TobotGateway', {
 *     gatewayArn: cdk.Fn.importValue('TobotAgent-GatewayArn-prod'),
 *     gatewayId:  cdk.Fn.importValue('TobotAgent-GatewayId-prod'),
 *     // ...remaining required attrs filled in from the alpha module.
 *   });
 *
 *   new TobotGatewayTarget(this, 'MyTeamsTools', {
 *     gateway,
 *     kind: 'lambda',
 *     lambdaFunction: myLambda,
 *     toolSchema: ToolSchema.fromInline({ ... }),
 *     description: 'My team\'s incident-response tools.',
 *   });
 *   ```
 *
 * Status: stub. The CDK alpha module already exposes the underlying
 * `GatewayTarget` + `*TargetConfiguration` primitives. This wrapper
 * exists to (a) keep the public API of tobot-agent stable if the
 * alpha module rev-breaks, (b) give consumers a single import surface,
 * and (c) be the place where Tobot-specific defaults (tagging, IAM
 * hardening, scope-registry integration) land later.
 */
import { Construct } from 'constructs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';

export type TobotGatewayTargetKind = 'lambda' | 'openapi' | 'smithy';

export interface TobotGatewayTargetBaseProps {
  /**
   * The gateway this target attaches to. Get this with
   * `Gateway.fromGatewayAttributes(this, 'Id', { ... })`. The Tobot
   * Agent stack exports the necessary attribute values as CFN
   * outputs (`TobotAgent-GatewayArn-<stage>`,
   * `TobotAgent-GatewayId-<stage>`).
   */
  readonly gateway: agentcore.IGateway;
  /** Optional name. Defaults to the construct id. */
  readonly gatewayTargetName?: string;
  /** Optional human description. Shows up in Gateway listings. */
  readonly description?: string;
}

export interface TobotLambdaTargetProps extends TobotGatewayTargetBaseProps {
  readonly kind: 'lambda';
  readonly lambdaFunction: IFunction;
  readonly toolSchema: agentcore.ToolSchema;
}

export interface TobotOpenApiTargetProps extends TobotGatewayTargetBaseProps {
  readonly kind: 'openapi';
  readonly apiSchema: agentcore.ApiSchema;
  /**
   * Validate the OpenAPI schema at synth. Defaults true. S3-hosted
   * schemas can't be validated at synth time regardless.
   */
  readonly validateOpenApiSchema?: boolean;
}

export interface TobotSmithyTargetProps extends TobotGatewayTargetBaseProps {
  readonly kind: 'smithy';
  readonly smithyModel: agentcore.ApiSchema;
}

export type TobotGatewayTargetProps =
  | TobotLambdaTargetProps
  | TobotOpenApiTargetProps
  | TobotSmithyTargetProps;

/**
 * Register a tool target on the Tobot Agent gateway.
 *
 * The wrapper builds the right `*TargetConfiguration` for the chosen
 * kind, then instantiates a single `GatewayTarget`. Consumers don't
 * have to learn the configuration-class taxonomy — they just pass
 * Lambda function / OpenAPI schema / Smithy model directly.
 */
export class TobotGatewayTarget extends Construct {
  public readonly target: agentcore.GatewayTarget;

  constructor(scope: Construct, id: string, props: TobotGatewayTargetProps) {
    super(scope, id);

    const targetConfiguration =
      props.kind === 'lambda'
        ? agentcore.LambdaTargetConfiguration.create(
            props.lambdaFunction,
            props.toolSchema,
          )
        : props.kind === 'openapi'
          ? agentcore.OpenApiTargetConfiguration.create(
              props.apiSchema,
              props.validateOpenApiSchema,
            )
          : agentcore.SmithyTargetConfiguration.create(props.smithyModel);

    this.target = new agentcore.GatewayTarget(this, 'Target', {
      gateway: props.gateway,
      gatewayTargetName: props.gatewayTargetName,
      description: props.description,
      targetConfiguration,
    });
  }
}
