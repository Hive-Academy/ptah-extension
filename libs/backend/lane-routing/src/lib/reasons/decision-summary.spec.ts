import { GateResultSchema, PreflightResultSchema } from '../contracts/route-decide-result.schema';
import { gateSummary, preflightSummary } from './decision-summary';

const facts = { durationMs: 12, caller: 'system-one', model: 'nimble', timeoutMs: 60000, reused: false, outcomeFigures: 3 } as const;
const usage = { requests: 1, inputTokens: 5, outputTokens: 2, costUsd: null };

describe('decision summaries', () => {
  it('allows only preflight answer and usage fields', () => {
    const answer = { value: 'FEATURE', source: 'model', confidence: 0.8, fallbackCause: null, modelProposal: { option: 'o1', confidence: 0.7 } };
    const result = PreflightResultSchema.parse({ stage: 'pre-flight', taskType: answer,
      depth: { ...answer, value: 'Full' }, overallConfidence: 0.8,
      reasons: ['/secret/path request text'], usage });
    const summary = preflightSummary(result, facts);
    expect(summary).toMatchObject({ stage: 'pre-flight', requests: 1,
      answers: [expect.objectContaining({ question: 'taskType', value: 'FEATURE', proposal: 'o1' }),
        expect.objectContaining({ question: 'depth', value: 'Full' })] });
    expect(JSON.stringify(summary)).not.toMatch(/secret|reasons|baseUrl|apiKey|selection/);
  });

  it('logs only gate roster identifiers and aggregate counts', () => {
    const result = GateResultSchema.parse({ stage: 'gate-0.1', roster: [],
      overallSource: 'ranking', overallConfidence: null,
      excluded: [{ phaseId: 'p1', candidate: '/secret/path', rule: 'disabled' }],
      reasons: ['/secret/path request text'], usage });
    const summary = gateSummary(result, facts);
    expect(summary).toMatchObject({ stage: 'gate-0.1', outcomeFigures: 3, excluded: 1, phases: [] });
    expect(JSON.stringify(summary)).not.toMatch(/secret|reasons|excludedBy|baseUrl|apiKey/);
  });
});
