import {
  OutcomeReportArgsSchema,
  LaneOutcomeRowSchema,
} from './lane-outcome.schema';
import { outcomeRow } from './store/store.test-support';

describe('outcome schemas', () => {
  it('accepts only exact report targets and bounded paths', () => {
    expect(
      OutcomeReportArgsSchema.safeParse({
        kind: 'deliverables',
        target: { runId: 'subagent:a' },
        paths: ['src/a.ts'],
      }).success,
    ).toBe(true);
    expect(
      OutcomeReportArgsSchema.safeParse({
        kind: 'review',
        target: { agentId: 'a' },
        verdict: 'revise',
      }).success,
    ).toBe(true);
    expect(
      OutcomeReportArgsSchema.safeParse({
        kind: 'review',
        target: { subagent: 'a' },
        verdict: 'revise',
      }).success,
    ).toBe(false);
    expect(
      OutcomeReportArgsSchema.safeParse({
        kind: 'deliverables',
        target: { runId: 'a' },
        paths: Array(21).fill('a'),
      }).success,
    ).toBe(false);
  });

  it('rejects invalid persistent rows', () => {
    expect(LaneOutcomeRowSchema.safeParse(outcomeRow('r')).success).toBe(true);
    expect(
      LaneOutcomeRowSchema.safeParse({ ...outcomeRow('r'), model: '' }).success,
    ).toBe(false);
    expect(
      LaneOutcomeRowSchema.safeParse({ ...outcomeRow('r'), inputTokens: -1 })
        .success,
    ).toBe(false);
  });
});
