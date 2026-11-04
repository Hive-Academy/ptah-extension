import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { attestationSchema, evaluateIsolation } from './isolation-attestation';
import type { FixtureManifest } from './fixture-manifest.schema';
import type { MatchRow } from './match-findings';

const replayResultSchema = z.object({ prNumber: z.number().int().positive(), acceptedCount: z.number().int().nonnegative(),
  suppressedCount: z.number().int().nonnegative(), attestation: attestationSchema.nullable() }).strict();
export type ReplaySummary = z.infer<typeof replayResultSchema>;
export interface QualityReport { valid: boolean; denominator: 108; matched: number; missed: number; extra: number;
  disputed: number; suppressed: number; precision: number | null; recall: number | null;
  perLens: Record<string, { matched: number; missed: number; extra: number; precision: number | null; recall: number | null }>;
  isolation: { prNumber: number; valid: boolean; hash: string | null; failures: string[] }[] }
const ratio = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null;
export function createQualityReport(manifest: FixtureManifest, rows: readonly MatchRow[], input: readonly ReplaySummary[]): QualityReport {
  if (manifest.expectedRoots !== 108) throw new Error('Expected 108 roots');
  const summaries = input.map(value => replayResultSchema.parse(value));
  const isolation = summaries.map(value => {
    if (!value.attestation) return { prNumber: value.prNumber, valid: false, hash: null, failures: ['Missing attestation'] };
    const outcome = evaluateIsolation(value.attestation);
    return { prNumber: value.prNumber, valid: outcome.valid, hash: outcome.hash,
      failures: outcome.failures.map(failure => failure.startsWith('Isolation probe failed:') || failure === 'Mount policy failed'
        ? failure : 'Attestation-reported isolation failure') };
  });
  const perLens: QualityReport['perLens'] = {};
  for (const row of rows) {
    const lens = perLens[row.lens] ?? { matched: 0, missed: 0, extra: 0, precision: null, recall: null };
    if (row.kind === 'match') lens.matched++;
    if (row.kind === 'miss') lens.missed++;
    if (row.kind === 'extra') lens.extra++;
    perLens[row.lens] = lens;
  }
  for (const lens of Object.values(perLens)) {
    lens.precision = ratio(lens.matched, lens.matched + lens.extra);
    lens.recall = ratio(lens.matched, lens.matched + lens.missed);
  }
  const matched = rows.filter(row => row.kind === 'match').length;
  const missed = rows.filter(row => row.kind === 'miss').length;
  const extra = rows.filter(row => row.kind === 'extra').length;
  const disputed = rows.filter(row => row.kind === 'disputed').length;
  const valid = summaries.length === manifest.prs.length && isolation.every(value => value.valid) &&
    rows.filter(row => row.slot !== undefined).length === 108;
  if (!valid) for (const lens of Object.values(perLens)) { lens.precision = null; lens.recall = null; }
  return { valid, denominator: 108, matched, missed, extra, disputed,
    suppressed: summaries.reduce((sum, value) => sum + value.suppressedCount, 0),
    precision: valid ? ratio(matched, matched + extra) : null, recall: valid ? matched / 108 : null,
    perLens, isolation };
}
export async function writeQualityReport(report: QualityReport, markdownPath: string, jsonPath: string): Promise<void> {
  const safe = JSON.stringify(report, null, 2) + '\n';
  const lines = ['# Review replay quality', '', `Score: ${report.valid ? 'valid' : 'INVALID'}`,
    `Roots: ${report.denominator}; matched: ${report.matched}; missed: ${report.missed}; disputed: ${report.disputed}; extra: ${report.extra}`,
    `Precision: ${report.precision ?? 'invalid'}; recall: ${report.recall ?? 'invalid'}; suppressed: ${report.suppressed}`, '',
    '| Lens | Matched | Missed | Extra | Precision | Recall |', '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.perLens).map(([name, value]) => `| ${name} | ${value.matched} | ${value.missed} | ${value.extra} | ${value.precision ?? 'n/a'} | ${value.recall ?? 'n/a'} |`),
    '', '## Isolation', ...report.isolation.map(item => `- PR ${item.prNumber}: ${item.valid ? 'valid' : 'INVALID'}; sha256 ${item.hash ?? 'missing'}; ${item.failures.join(', ') || 'all probes denied'}`),
    '', 'CodeRabbit remains enabled; these scores compare review quality and do not gate publication.', ''];
  await writeFile(markdownPath, lines.join('\n'), { flag: 'wx', mode: 0o600 });
  await writeFile(jsonPath, safe, { flag: 'wx', mode: 0o600 });
}
