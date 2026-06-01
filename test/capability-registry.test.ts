import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isReadCapability,
  resolveAssumeRoleArns,
  loadCapabilityRegistry,
  type CapabilityRegistry,
} from '../lib/capability-registry';

describe('isReadCapability', () => {
  it.each([
    ['iot:read', true],
    ['s3:read:my-bucket', true],
    ['dynamodb:write:table', false],
    ['iot:write', false],
    ['justonepart', false],
    ['', false],
  ])('%s -> %s', (cap, expected) => {
    expect(isReadCapability(cap)).toBe(expected);
  });
});

describe('resolveAssumeRoleArns', () => {
  const registry: CapabilityRegistry = {
    autoGrantReads: true,
    defaultRegion: 'us-west-2',
    envs: ['dev', 'prod'],
    bindings: {
      'iot:write': {
        capability: 'iot:write',
        roleArn: undefined,
        envs: { dev: 'arn:aws:iam::111:role/dev', prod: 'arn:aws:iam::222:role/prod' },
      },
      'dynamodb:write:t': {
        capability: 'dynamodb:write:t',
        roleArn: 'arn:aws:iam::111:role/single',
        envs: {},
      },
    },
  };

  it('excludes *:read capabilities when auto_grant_reads is on', () => {
    expect(resolveAssumeRoleArns(['iot:read'], registry).size).toBe(0);
  });

  it('returns the single role_arn for a non-env binding', () => {
    expect([...resolveAssumeRoleArns(['dynamodb:write:t'], registry)]).toEqual([
      'arn:aws:iam::111:role/single',
    ]);
  });

  it('returns every per-env role arn for an env binding', () => {
    expect(resolveAssumeRoleArns(['iot:write'], registry)).toEqual(
      new Set(['arn:aws:iam::111:role/dev', 'arn:aws:iam::222:role/prod']),
    );
  });

  it('deduplicates across multiple capabilities sharing a role', () => {
    const shared: CapabilityRegistry = {
      ...registry,
      bindings: {
        a: { capability: 'a', roleArn: 'arn:role/x', envs: {} },
        b: { capability: 'b', roleArn: 'arn:role/x', envs: {} },
      },
    };
    expect(resolveAssumeRoleArns(['a', 'b'], shared).size).toBe(1);
  });

  it('throws on an unbound non-read capability', () => {
    expect(() => resolveAssumeRoleArns(['lambda:invoke:fn'], registry)).toThrow(
      /not bound/,
    );
  });

  it('requires binding for a read when auto_grant_reads is off', () => {
    const strict: CapabilityRegistry = { ...registry, autoGrantReads: false };
    expect(() => resolveAssumeRoleArns(['iot:read'], strict)).toThrow(/not bound/);
  });
});

describe('loadCapabilityRegistry', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caps-'));
    fs.mkdirSync(path.join(dir, 'config'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(contents: string): void {
    fs.writeFileSync(path.join(dir, 'config', 'capabilities.yaml'), contents);
  }

  it('returns the empty registry when the file is absent', () => {
    const reg = loadCapabilityRegistry(dir);
    expect(reg.autoGrantReads).toBe(true);
    expect(Object.keys(reg.bindings)).toHaveLength(0);
  });

  it('parses defaults, envs, and both binding shapes', () => {
    writeConfig(`
defaults:
  auto_grant_reads: false
  region: eu-west-1
envs: [dev, prod]
capabilities:
  iot:write:
    envs:
      dev: arn:aws:iam::111:role/dev
      prod: arn:aws:iam::222:role/prod
  s3:write:b:
    role_arn: arn:aws:iam::111:role/s3
`);
    const reg = loadCapabilityRegistry(dir);
    expect(reg.autoGrantReads).toBe(false);
    expect(reg.defaultRegion).toBe('eu-west-1');
    expect(reg.envs).toEqual(['dev', 'prod']);
    expect(reg.bindings['iot:write'].envs.prod).toBe('arn:aws:iam::222:role/prod');
    expect(reg.bindings['s3:write:b'].roleArn).toBe('arn:aws:iam::111:role/s3');
  });

  it('rejects a binding that references an env outside the envs[] list', () => {
    writeConfig(`
envs: [dev]
capabilities:
  iot:write:
    envs:
      staging: arn:aws:iam::111:role/x
`);
    expect(() => loadCapabilityRegistry(dir)).toThrow(/not in the top-level envs/);
  });

  it('rejects a binding with neither role_arn nor envs', () => {
    writeConfig(`
capabilities:
  iot:write:
    description: oops
`);
    expect(() => loadCapabilityRegistry(dir)).toThrow(/neither/);
  });
});
