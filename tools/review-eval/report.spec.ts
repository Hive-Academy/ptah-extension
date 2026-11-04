import { parseFixtureManifest } from './fixture-manifest.schema';
import { createQualityReport, writeQualityReport } from './report';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attestationSchema } from './isolation-attestation';

const manifest = parseFixtureManifest(require('./fixture-manifest.json'));
const rows = manifest.prs.flatMap(pr => pr.roots.map(root => ({ prNumber: pr.number, slot: root.slot,
  lens: 'correctness-lifecycle', kind: 'miss' as const })));
describe('quality report', () => {
  it('keeps 108 denominator and invalidates missing attestation', () => {
    const report = createQualityReport(manifest, rows, manifest.prs.map(pr => ({ prNumber: pr.number,
      acceptedCount: 0, suppressedCount: 1, attestation: null })));
    expect(report.denominator).toBe(108);
    expect(report.valid).toBe(false);
    expect(report.precision).toBeNull();
    expect(report.recall).toBeNull();
    expect(report.suppressed).toBe(15);
  });
  it('writes no credential values', async () => {
    const root = mkdtempSync(join(tmpdir(), 'review-report-'));
    try {
      const report = createQualityReport(manifest, rows, []);
      await writeQualityReport(report, join(root, 'quality.md'), join(root, 'quality.json'));
      expect(readFileSync(join(root, 'quality.md'), 'utf8')).toContain('CodeRabbit remains enabled');
      expect(readFileSync(join(root, 'quality.json'), 'utf8')).not.toMatch(/credential|api.?key|Bearer/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('invalidates a denied isolation probe that leaks', () => {
    const probes = ['gh', 'github', 'network', 'secret', 'mcp', 'postHeadRef'].map(name =>
      ({ name, denied: name !== 'network', detail: 'probe result' }));
    const attestation = attestationSchema.parse({ schemaVersion: 1, os: 'linux', kernel: 'test', bwrapVersion: 'test', namespaceId: '1', laneId: 'lane',
      snapshotHash: 'a'.repeat(64), reachableCommitsHash: 'b'.repeat(64), argvPolicyHash: 'c'.repeat(64),
      brokerPolicyHash: 'd'.repeat(64), codexVersion: 'test', mounts: [
        { source: '/src', target: '/work/src', readonly: true }, { source: '/out', target: '/work/out', readonly: false }],
      clearedEnvKeys: [], probes, modelCalls: 0, failures: [] });
    const report = createQualityReport(manifest, rows, manifest.prs.map(pr => ({ prNumber: pr.number,
      acceptedCount: 0, suppressedCount: 0, attestation })));
    expect(report.valid).toBe(false);
    expect(report.isolation[0].failures).toContain('Isolation probe failed: network');
  });
});
