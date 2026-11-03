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
  });
});
