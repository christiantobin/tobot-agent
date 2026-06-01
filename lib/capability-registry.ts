/**
 * Loader + resolver for config/capabilities.yaml — the capability binding
 * registry for this deployment.
 *
 * Tools declare what they need in domain language (`capabilities:
 * [iot:read]`); this file binds those names to actual IAM roles in your
 * topology. The CDK stack uses it at synth time to grant sts:AssumeRole;
 * the runtime (Python) reads the same file at first call to mint
 * sessions.
 *
 * Two resolution shapes are supported:
 *   - Single binding:  capabilities.<name>.role_arn
 *   - Per-env binding: capabilities.<name>.envs.<env>
 *
 * Read-only capabilities (verb segment === "read") can be implicitly
 * satisfied by `defaults.auto_grant_reads: true` — in that case the
 * hub task role is given a wide read policy directly, no AssumeRole
 * needed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

export interface CapabilityBinding {
  readonly capability: string;
  /** Single binding (or null if per-env). */
  readonly roleArn?: string;
  /** Per-env bindings (or empty). */
  readonly envs: Record<string, string>;
}

export interface CapabilityRegistry {
  readonly autoGrantReads: boolean;
  readonly defaultRegion: string;
  readonly envs: string[];
  readonly bindings: Record<string, CapabilityBinding>;
}

const EMPTY_REGISTRY: CapabilityRegistry = {
  autoGrantReads: true,
  defaultRegion: 'us-west-2',
  envs: [],
  bindings: {},
};

export function loadCapabilityRegistry(repoRoot: string): CapabilityRegistry {
  const p = path.join(repoRoot, 'config', 'capabilities.yaml');
  if (!fs.existsSync(p)) return EMPTY_REGISTRY;
  const raw = yaml.parse(fs.readFileSync(p, 'utf8'));
  if (raw === null || raw === undefined) return EMPTY_REGISTRY;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${p}: expected a YAML mapping at the top level`);
  }
  const root = raw as Record<string, unknown>;
  const defaults = (root.defaults ?? {}) as Record<string, unknown>;
  const autoGrantReads =
    defaults.auto_grant_reads === undefined ? true : Boolean(defaults.auto_grant_reads);
  const defaultRegion =
    typeof defaults.region === 'string' && defaults.region ? defaults.region : 'us-west-2';

  const envs: string[] = Array.isArray(root.envs)
    ? (root.envs as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const bindings: Record<string, CapabilityBinding> = {};
  const rawCaps = (root.capabilities ?? {}) as Record<string, unknown>;
  if (rawCaps && typeof rawCaps === 'object' && !Array.isArray(rawCaps)) {
    for (const [name, value] of Object.entries(rawCaps)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${p}: capabilities.${name} must be a mapping`);
      }
      const v = value as Record<string, unknown>;
      const roleArn = typeof v.role_arn === 'string' ? v.role_arn : undefined;
      const perEnv: Record<string, string> = {};
      if (v.envs && typeof v.envs === 'object' && !Array.isArray(v.envs)) {
        for (const [envName, envRole] of Object.entries(v.envs as Record<string, unknown>)) {
          if (typeof envRole !== 'string' || !envRole) {
            throw new Error(`${p}: capabilities.${name}.envs.${envName} must be a string ARN`);
          }
          if (envs.length > 0 && !envs.includes(envName)) {
            throw new Error(
              `${p}: capabilities.${name} binds env "${envName}" which is not in the top-level envs[] list (${envs.join(', ')})`,
            );
          }
          perEnv[envName] = envRole;
        }
      }
      if (!roleArn && Object.keys(perEnv).length === 0) {
        throw new Error(
          `${p}: capabilities.${name} has neither \`role_arn\` nor non-empty \`envs:\` — at least one is required`,
        );
      }
      bindings[name] = { capability: name, roleArn, envs: perEnv };
    }
  }

  return { autoGrantReads, defaultRegion, envs, bindings };
}

/** True if a capability name ends in `:read` (or `read:<scope>`). */
export function isReadCapability(name: string): boolean {
  const parts = name.split(':');
  return parts.length >= 2 && parts[1] === 'read';
}

/**
 * For each capability a tool declares, return the set of role ARNs the
 * hub task role needs sts:AssumeRole on. Capabilities satisfied by
 * auto-grant-reads are excluded (the stack handles them with an inline
 * policy instead). Throws on capabilities that can't be resolved.
 */
export function resolveAssumeRoleArns(
  capabilities: string[],
  registry: CapabilityRegistry,
): Set<string> {
  const arns = new Set<string>();
  for (const cap of capabilities) {
    if (registry.autoGrantReads && isReadCapability(cap)) {
      // Satisfied by the auto-granted read policy on the hub role.
      continue;
    }
    const binding = registry.bindings[cap];
    if (!binding) {
      throw new Error(
        `capability "${cap}" is not bound in config/capabilities.yaml ` +
          `(and is not a *:read with auto_grant_reads=true). ` +
          `Add a binding before declaring this capability in a tool.`,
      );
    }
    if (binding.roleArn) arns.add(binding.roleArn);
    for (const arn of Object.values(binding.envs)) arns.add(arn);
  }
  return arns;
}
