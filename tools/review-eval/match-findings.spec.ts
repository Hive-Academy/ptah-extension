import { parseFixtureManifest } from './fixture-manifest.schema';
import { matchFindings, findingKey } from './match-findings';
import type { CandidateFinding } from '@ptah-extension/review-contracts';

const manifest = parseFixtureManifest(require('./fixture-manifest.json'));
const finding: CandidateFinding = { schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Retry loses pending work',
  failureMode: 'Retry loses pending work', affectedBehavior: 'Pending work is discarded', scenario: 'Retry after failure',
  path: 'src/retry.ts', line: 10, evidence: [{ path: 'src/retry.ts', line: 10, excerpt: 'discard' }],
  affectedCaller: null, severity: 'Major', category: 'functional', confidence: 0.9, suggestedDiff: null, fixPrompt: 'Preserve work' };
const roots = manifest.prs.flatMap(pr => pr.roots.map(root => ({ prNumber: pr.number, slot: root.slot,
  path: 'src/retry.ts', line: 10, lens: 'correctness-lifecycle', category: 'functional',
  summary: 'Retry loses pending work', disposition: 'confirmed' as const })));
describe('semantic matching', () => {
  it('classifies match, miss, extra and disputed with 108 root rows', () => {
    const prNumber = manifest.prs[0].number;
    const rows = matchFindings(manifest, { version: manifest.adjudicationVersion, roots,
      extras: [{ prNumber, findingKey: findingKey({ ...finding, path: 'src/other.ts' }), disposition: 'actionable' }] },
    [{ prNumber, finding }, { prNumber, finding: { ...finding, path: 'src/other.ts' } },
      { prNumber, finding: { ...finding, path: 'src/unknown.ts' } }]);
    expect(rows.filter(row => row.slot !== undefined)).toHaveLength(108);
    expect(rows.some(row => row.kind === 'match')).toBe(true);
    expect(rows.some(row => row.kind === 'miss')).toBe(true);
    expect(rows.some(row => row.kind === 'extra')).toBe(true);
    expect(rows.some(row => row.kind === 'disputed')).toBe(true);
  });
});
