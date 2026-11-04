import { ReviewOutputParser } from './review-output.parser';

const sha = 'a'.repeat(40);
describe('ReviewOutputParser', () => {
  const parser = new ReviewOutputParser();
  it('rejects malformed and extra-key output', () => {
    expect(() => parser.parseLens('{', sha)).toThrow('Malformed lane JSON');
    expect(() => parser.parseLens(JSON.stringify({ schemaVersion: 1, headSha: sha, findings: [], coverage: [], extra: true }), sha)).toThrow();
  });
  it('checks head and verifier family', () => {
    expect(() => parser.parseLens(JSON.stringify({ schemaVersion: 1, headSha: 'b'.repeat(40), findings: [], coverage: [] }), sha)).toThrow('head mismatch');
    const verdict = { schemaVersion: 1, candidateId: 'c', headSha: sha, verdict: 'disproved', checkedEvidence: [{ path: 'src/a.ts', line: 1, observation: 'No call' }], reason: 'No caller', confidence: 0.9, verifierFamily: 'same' };
    expect(() => parser.parseVerdict(JSON.stringify(verdict), sha, 'other')).toThrow('identity mismatch');
    expect(parser.parseVerdictBatch(JSON.stringify([verdict]), sha, 'same')).toHaveLength(1);
    expect(() => parser.parseVerdictBatch(JSON.stringify([verdict, verdict]), sha, 'same')).toThrow('Duplicate verifier candidate ID');
  });
  it('validates semantic identity and defaults missing or invalid relations to uncertain', () => {
    const verdict = { schemaVersion: 1, candidateId: 'c', headSha: sha, verdict: 'accepted',
      checkedEvidence: [{ path: 'src/a.ts', line: 1, observation: 'Confirmed' }],
      reason: 'Confirmed', confidence: 0.9, verifierFamily: 'same' };
    const priorFindingId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    expect(parser.parseVerdictBatch(JSON.stringify([{ ...verdict, identity: {
      relation: 'same', priorFindingId, reason: 'Same behavior after rewording' } }]), sha, 'same')[0].identity)
      .toMatchObject({ relation: 'same', priorFindingId });
    expect(parser.parseVerdictBatch(JSON.stringify([verdict]), sha, 'same')[0].identity.relation).toBe('uncertain');
    expect(parser.parseVerdictBatch(JSON.stringify([{ ...verdict, identity: {
      relation: 'same', priorFindingId: null, reason: 'Invalid' } }]), sha, 'same')[0].identity.relation)
      .toBe('uncertain');
  });
});
