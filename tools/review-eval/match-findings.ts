import { CandidateFindingSchema, type CandidateFinding } from '@ptah-extension/review-contracts';
import type { FixtureManifest } from './fixture-manifest.schema';
import { parseAdjudication } from './adjudication.schema';

export interface ProducedFinding { prNumber: number; finding: CandidateFinding }
export interface MatchRow { prNumber: number; slot?: number; findingKey?: string; lens: string; kind: 'match' | 'miss' | 'extra' | 'disputed'; similarity?: number }
export const findingKey = (finding: CandidateFinding): string => `${finding.path}:${finding.line ?? 0}:${finding.lens}:${finding.title}`;
function tokens(text: string): Set<string> { return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []); }
function similarity(a: string, b: string): number {
  const left = tokens(a); const right = tokens(b);
  const overlap = [...left].filter(token => right.has(token)).length;
  return overlap / Math.max(1, left.size + right.size - overlap);
}
/** One-to-one matching. Path, nearby line and semantic terms all contribute; ties stay disputed. */
export function matchFindings(manifest: FixtureManifest, adjudicationInput: unknown, produced: readonly ProducedFinding[]): MatchRow[] {
  const adjudication = parseAdjudication(adjudicationInput, manifest.adjudicationVersion);
  const roots = manifest.prs.flatMap(pr => pr.roots.map(root => ({ prNumber: pr.number, root })));
  const annotations = new Map(adjudication.roots.map(root => [`${root.prNumber}:${root.slot}`, root]));
  const candidates = produced.map(item => ({ prNumber: item.prNumber, finding: CandidateFindingSchema.parse(item.finding) }));
  const used = new Set<number>(); const rows: MatchRow[] = [];
  for (const { prNumber, root } of roots) {
    const reference = annotations.get(`${prNumber}:${root.slot}`);
    if (!reference) throw new Error(`Missing adjudication for ${prNumber}:${root.slot}`);
    const scored = candidates.map((candidate, index) => {
      if (used.has(index) || candidate.prNumber !== prNumber || candidate.finding.path !== reference.path) return { index, score: 0 };
      const line = candidate.finding.line ?? candidate.finding.evidence[0]?.line ?? 0;
      const distance = Math.abs(line - reference.line);
      const semantic = similarity(reference.summary, `${candidate.finding.title} ${candidate.finding.failureMode} ${candidate.finding.affectedBehavior}`);
      const category = candidate.finding.category === reference.category || candidate.finding.lens === reference.lens;
      return { index, score: distance <= 5 && category ? semantic : 0 };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0]; const tied = scored[1] && best && best.score >= 0.3 && scored[1].score === best.score;
    if (best && best.score >= 0.3 && !tied) {
      used.add(best.index);
      rows.push({ prNumber, slot: root.slot, findingKey: findingKey(candidates[best.index].finding), lens: reference.lens,
        kind: reference.disposition === 'disputed' ? 'disputed' : 'match', similarity: best.score });
    } else rows.push({ prNumber, slot: root.slot, lens: reference.lens, kind: tied || reference.disposition === 'disputed' ? 'disputed' : 'miss' });
  }
  for (const [index, candidate] of candidates.entries()) if (!used.has(index)) {
    const key = findingKey(candidate.finding);
    const review = adjudication.extras.find(item => item.prNumber === candidate.prNumber && item.findingKey === key);
    rows.push({ prNumber: candidate.prNumber, findingKey: key, lens: candidate.finding.lens,
      kind: review?.disposition === 'actionable' ? 'extra' : 'disputed' });
  }
  return rows;
}
