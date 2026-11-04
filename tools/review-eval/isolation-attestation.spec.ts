import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateIsolation, persistIsolationAttestation, runIsolationProbes } from './isolation-attestation';

const names = ['gh', 'github', 'network', 'secret', 'mcp', 'postHeadRef'] as const;
const good = {
  schemaVersion: 1, os: 'linux', kernel: 'fixture', bwrapVersion: 'fixture', namespaceId: 'fixture', laneId: 'lane',
  snapshotHash: 'a'.repeat(64), reachableCommitsHash: 'b'.repeat(64), argvPolicyHash: 'c'.repeat(64), brokerPolicyHash: 'd'.repeat(64),
  codexVersion: 'fixture', mounts: [{ source: 'fixture', target: '/work/src', readonly: true }, { source: 'fixture', target: '/work/out', readonly: false }],
  clearedEnvKeys: ['GH_TOKEN'], probes: names.map(name => ({ name, denied: true, detail: 'denied by fake probe' })), modelCalls: 1, failures: [],
};

describe('isolation attestation', () => {
  it('runs every denial with a fake probe runner and invalidates a probe error', async () => {
    const attempt = jest.fn(async (name: string) => {
      if (name === 'mcp') throw new Error('probe unavailable');
      return { denied: true, detail: 'denied' };
    });
    const probes = await runIsolationProbes({ attempt });
    expect(attempt).toHaveBeenCalledTimes(6);
    expect(evaluateIsolation({ ...good, probes }).valid).toBe(false);
  });
  it.each(names)('invalidates a leaked %s probe', name => {
    const value = { ...good, probes: good.probes.map(p => p.name === name ? { ...p, denied: false } : p) };
    expect(evaluateIsolation(value).valid).toBe(false);
  });
  it('invalidates missing probes, writeable source, and reported failures', () => {
    expect(evaluateIsolation({ ...good, probes: [] }).valid).toBe(false);
    expect(evaluateIsolation({ ...good, mounts: [{ source: 'fixture', target: '/work/src', readonly: false }] }).valid).toBe(false);
    expect(evaluateIsolation({ ...good, failures: ['broker unavailable'] }).valid).toBe(false);
  });
  it('persists outside the lane root with a hash and validity', () => {
    const root = mkdtempSync(join(tmpdir(), 'attestation-'));
    try {
      const output = join(root, 'attestation.json');
      const result = persistIsolationAttestation(good, output, join(root, 'lane'));
      expect(result.valid).toBe(true);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ valid: true, sha256: result.hash });
      expect(() => persistIsolationAttestation(good, join(root, 'lane', 'out.json'), join(root, 'lane'))).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
