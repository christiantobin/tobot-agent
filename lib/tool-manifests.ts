/**
 * Manifest reader used by AgentStack.
 *
 * Walks `tools/{tool}/tool.yaml` at synth time and returns a normalized
 * representation that the stack uses to:
 *   - aggregate IAM PolicyStatements onto the agent task role,
 *   - resolve capabilities to assume-role grants (via capability-registry),
 *   - create empty Secrets Manager shells + grant read,
 *   - inject env vars (literal + secret ARNs) into the runtime container.
 *
 * Schema is documented in tools/MANIFEST.md.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

export interface ManifestIamStatement {
  readonly actions: string[];
  readonly resources: string[];
}

export interface ManifestSecret {
  /** Logical secret short-name. CDK turns this into `tobot-agent/{name}-{stage}`. */
  readonly name: string;
  readonly description?: string;
  /** Env var the secret's ARN gets injected as inside the container. */
  readonly env: string;
}

export interface ToolManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly module?: string;
  readonly entrypoints?: string[];
  readonly autoRegister: boolean;
  readonly iam: ManifestIamStatement[];
  readonly secrets: ManifestSecret[];
  readonly env: Record<string, string>;
  /**
   * Capability names this tool needs. Resolved against
   * config/capabilities.yaml at synth time. Synth fails loudly if any
   * name isn't bound (and isn't satisfied by auto_grant_reads).
   */
  readonly capabilities: string[];
  /** Absolute path to the directory containing tool.yaml. */
  readonly dir: string;
}

/**
 * Read and validate every tool.yaml under {repoRoot}/tools/{*}/tool.yaml.
 *
 * Throws on any malformed manifest — synth fails loudly rather than
 * silently dropping a tool's IAM grant.
 *
 * Directories whose names begin with `_` are treated as templates /
 * examples and skipped (matches the convention in tools/MANIFEST.md
 * and discovery.py).
 */
export function loadToolManifests(repoRoot: string): ToolManifest[] {
  const toolsDir = path.join(repoRoot, 'tools');
  if (!fs.existsSync(toolsDir)) return [];

  const manifests: ToolManifest[] = [];
  for (const entry of fs.readdirSync(toolsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;
    const dir = path.join(toolsDir, entry.name);
    const manifestPath = path.join(dir, 'tool.yaml');
    if (!fs.existsSync(manifestPath)) continue;

    const raw = yaml.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`tool.yaml in ${dir} did not parse to a YAML mapping`);
    }
    const m = raw as Record<string, unknown>;
    if (typeof m.name !== 'string' || !m.name) {
      throw new Error(`tool.yaml in ${dir} is missing a string \`name\``);
    }

    manifests.push({
      name: m.name,
      version: typeof m.version === 'string' ? m.version : undefined,
      description: typeof m.description === 'string' ? m.description : undefined,
      module: typeof m.module === 'string' ? m.module : undefined,
      entrypoints: Array.isArray(m.entrypoints)
        ? m.entrypoints.filter((x): x is string => typeof x === 'string')
        : undefined,
      autoRegister: m.auto_register === undefined ? true : Boolean(m.auto_register),
      iam: parseIam(m.iam, manifestPath),
      secrets: parseSecrets(m.secrets, manifestPath),
      env: parseEnv(m.env, manifestPath),
      capabilities: parseCapabilities(m.capabilities, manifestPath),
      dir,
    });
  }

  manifests.sort((a, b) => a.name.localeCompare(b.name));
  return manifests;
}

function parseIam(value: unknown, manifestPath: string): ManifestIamStatement[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: \`iam\` must be a list`);
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${manifestPath}: iam[${idx}] must be a mapping`);
    }
    const e = entry as Record<string, unknown>;
    const actions = Array.isArray(e.actions)
      ? e.actions.filter((x): x is string => typeof x === 'string')
      : [];
    const resources = Array.isArray(e.resources)
      ? e.resources.filter((x): x is string => typeof x === 'string')
      : [];
    if (actions.length === 0 || resources.length === 0) {
      throw new Error(
        `${manifestPath}: iam[${idx}] needs non-empty actions[] and resources[]`,
      );
    }
    return { actions, resources };
  });
}

function parseSecrets(value: unknown, manifestPath: string): ManifestSecret[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: \`secrets\` must be a list`);
  }
  return value.map((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${manifestPath}: secrets[${idx}] must be a mapping`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || !e.name) {
      throw new Error(`${manifestPath}: secrets[${idx}] missing string \`name\``);
    }
    if (typeof e.env !== 'string' || !e.env) {
      throw new Error(`${manifestPath}: secrets[${idx}] missing string \`env\``);
    }
    return {
      name: e.name,
      description: typeof e.description === 'string' ? e.description : undefined,
      env: e.env,
    };
  });
}

function parseCapabilities(value: unknown, manifestPath: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${manifestPath}: \`capabilities\` must be a list of capability names`);
  }
  return value.map((v, idx) => {
    if (typeof v !== 'string' || !v) {
      throw new Error(`${manifestPath}: capabilities[${idx}] must be a non-empty string`);
    }
    return v;
  });
}

function parseEnv(value: unknown, manifestPath: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${manifestPath}: \`env\` must be a mapping of string→string`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(`${manifestPath}: env.${k} must be a string`);
    }
    out[k] = v;
  }
  return out;
}
