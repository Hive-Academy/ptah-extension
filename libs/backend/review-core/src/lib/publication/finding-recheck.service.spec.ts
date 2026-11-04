import { FindingRecheckService } from './finding-recheck.service';

const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const sha = 'a'.repeat(40);
const input = {
  findingId: id, status: 'open', headSha: sha, checkedHeadSha: sha, verdict: 'fixed',
  identity: { candidateId: 'recheck-1', priorFindingId: id, relation: 'same',
    evidence: { path: 'src/service.ts', symbol: 'Service.run', behavior: 'Null input handled', reason: 'Guard verified' } },
  failurePathEvidence: 'The failing caller now receives a handled response.',
};

describe('FindingRecheckService', () => {
  const service = new FindingRecheckService();
  it('addresses only a confirmed fix and does not repeat an addressed follow-up', () => {
    expect(service.decide(input)).toBe('addressed');
    expect(service.decide({ ...input, status: 'addressed' })).toBe('uncertain');
    expect(service.decide({ ...input, checkedHeadSha: 'b'.repeat(40) })).toBe('uncertain');
  });
  it('links a confirmed regression and leaves an unchanged failure open', () => {
    expect(service.decide({ ...input, status: 'addressed', verdict: 'still_present' })).toBe('reopened');
    expect(service.decide({ ...input, verdict: 'still_present' })).toBe('still_open');
    expect(service.decide({ ...input, identity: { ...input.identity, relation: 'uncertain' } })).toBe('uncertain');
  });
});
