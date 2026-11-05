import { CandidateFindingSchema } from '@ptah-extension/review-contracts';
import { FindingIdentityService } from './finding-identity.service';

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const finding = CandidateFindingSchema.parse({
  schemaVersion: 1, lens: 'correctness-lifecycle', title: 'Missing guard',
  failureMode: 'Null input crashes', affectedBehavior: 'Request fails', scenario: 'Null input',
  path: 'src/service.ts', line: 10, evidence: [{ path: 'src/service.ts', line: 10, excerpt: 'use(value)' }],
  affectedCaller: null, severity: 'Major', category: 'functional', confidence: 0.9,
  suggestedDiff: null, fixPrompt: 'Add a guard',
});
const candidate = { candidateId: 'candidate-1', finding, symbol: 'Service.run' };
const prior = { findingId: id, path: finding.path, symbol: 'Service.run', category: finding.category, status: 'open' as const };
const verdict = (relation: 'same' | 'distinct' | 'uncertain', reason: string) => ({
  candidateId: candidate.candidateId, priorFindingId: relation === 'same' ? id : null, relation,
  evidence: { path: finding.path, symbol: 'Service.run', behavior: 'Request fails on null input', reason },
});

describe('FindingIdentityService', () => {
  const service = new FindingIdentityService();

  it('shortlists by path, symbol and category despite line drift', () => {
    expect(service.shortlist({ ...candidate, finding: { ...finding, line: 80 } }, [prior])).toEqual([prior]);
    expect(service.shortlist(candidate, [{ ...prior, symbol: 'Other.run' }])).toEqual([]);
  });

  it('deduplicates a reworded same bug but assigns a distinct same-symbol bug a new ULID', () => {
    const reworded = { ...candidate, finding: { ...finding, title: 'Unhandled empty request', line: 80 } };
    expect(service.decide(reworded, [prior], verdict('same', 'Same null branch and failing caller'))).toEqual({ kind: 'existing', findingId: id });
    const distinct = service.decide(candidate, [prior], verdict('distinct', 'Different timeout branch'), 12345);
    expect(distinct.kind).toBe('new');
    expect(distinct.findingId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(distinct.findingId).not.toBe(id);
  });

  it('keeps uncertain identity out of new roots and rejects unshortlisted matches', () => {
    expect(service.decide(candidate, [prior], verdict('uncertain', 'Insufficient code evidence'))).toEqual({ kind: 'uncertain', findingId: null });
    expect(() => service.decide(candidate, [], verdict('same', 'Same'))).toThrow('outside the shortlist');
  });
});
