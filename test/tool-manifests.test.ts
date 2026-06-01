import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadToolManifests } from '../lib/tool-manifests';

describe('loadToolManifests', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifests-'));
    fs.mkdirSync(path.join(root, 'tools'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeTool(name: string, yaml: string): void {
    const dir = path.join(root, 'tools', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tool.yaml'), yaml);
  }

  it('returns [] when there is no tools directory', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'no-tools-'));
    expect(loadToolManifests(empty)).toEqual([]);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('parses a full manifest into the normalized shape', () => {
    writeTool(
      'demo',
      `
name: demo
version: 1.2.3
description: a demo tool
module: tool
entrypoints: [run, inspect]
capabilities: [iot:read, dynamodb:write:t]
tags: [destructive]
secrets:
  - name: api-key
    env: DEMO_KEY_ARN
    description: upstream key
env:
  DEMO_BASE: https://example.com
iam:
  - actions: [ses:SendEmail]
    resources: ['*']
`,
    );
    const [m] = loadToolManifests(root);
    expect(m.name).toBe('demo');
    expect(m.version).toBe('1.2.3');
    expect(m.entrypoints).toEqual(['run', 'inspect']);
    expect(m.capabilities).toEqual(['iot:read', 'dynamodb:write:t']);
    expect(m.secrets[0]).toEqual({
      name: 'api-key',
      env: 'DEMO_KEY_ARN',
      description: 'upstream key',
    });
    expect(m.env).toEqual({ DEMO_BASE: 'https://example.com' });
    expect(m.iam[0]).toEqual({ actions: ['ses:SendEmail'], resources: ['*'] });
    expect(m.autoRegister).toBe(true);
  });

  it('skips template directories prefixed with underscore', () => {
    writeTool('_template', 'name: _template\n');
    writeTool('real', 'name: real\n');
    const names = loadToolManifests(root).map((m) => m.name);
    expect(names).toEqual(['real']);
  });

  it('sorts manifests by name', () => {
    writeTool('zeta', 'name: zeta\n');
    writeTool('alpha', 'name: alpha\n');
    expect(loadToolManifests(root).map((m) => m.name)).toEqual(['alpha', 'zeta']);
  });

  it('honors auto_register: false', () => {
    writeTool('manual', 'name: manual\nauto_register: false\n');
    expect(loadToolManifests(root)[0].autoRegister).toBe(false);
  });

  it('throws on a manifest missing a name', () => {
    writeTool('bad', 'version: 1\n');
    expect(() => loadToolManifests(root)).toThrow(/missing a string `name`/);
  });

  it('throws on a malformed iam block', () => {
    writeTool('bad', 'name: bad\niam:\n  - actions: []\n    resources: []\n');
    expect(() => loadToolManifests(root)).toThrow(/non-empty actions/);
  });
});
