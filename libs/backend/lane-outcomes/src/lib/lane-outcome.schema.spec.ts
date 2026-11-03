import {
  OutcomeReportArgsSchema,
  LaneOutcomeRowSchema,
} from './lane-outcome.schema';
import { outcomeRow } from './store/store.test-support';
import { OUTCOME_TASK_KIND_SOURCES } from '@ptah-extension/shared';

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

  it.each(OUTCOME_TASK_KIND_SOURCES)('round-trips %s provenance', (source) => {
    const parsed = LaneOutcomeRowSchema.parse({
      ...outcomeRow('source-row'),
      taskKindSource: source,
    });
    expect(parsed.taskKindSource).toBe(source);
  });

  it('decodes null and missing provenance on legacy rows', () => {
    expect(
      LaneOutcomeRowSchema.parse({
        ...outcomeRow('legacy-null'),
        taskKind: null,
        taskKindSource: null,
      }).taskKindSource,
    ).toBeNull();
    const { taskKindSource: _omitted, ...legacy } = outcomeRow('legacy-missing');
    expect(LaneOutcomeRowSchema.parse(legacy).taskKindSource).toBeNull();
    expect(
      LaneOutcomeRowSchema.safeParse({
        ...outcomeRow('invalid-source'),
        taskKindSource: 'guessed',
      }).success,
    ).toBe(false);
  });

  it('accepts a bounded reviewer run only on review reports', () => {
    const review = {
      kind: 'review',
      target: { runId: 'reviewed' },
      verdict: 'approved',
    } as const;
    expect(OutcomeReportArgsSchema.parse({ ...review, reviewerRunId: 'r' }))
      .toMatchObject({ reviewerRunId: 'r' });
    expect(
      OutcomeReportArgsSchema.parse({
        ...review,
        reviewerRunId: 'r'.repeat(200),
      }),
    ).toMatchObject({ reviewerRunId: 'r'.repeat(200) });
    for (const reviewerRunId of ['', 'r'.repeat(201)]) {
      expect(
        OutcomeReportArgsSchema.safeParse({ ...review, reviewerRunId }).success,
      ).toBe(false);
    }
    expect(
      OutcomeReportArgsSchema.safeParse({
        kind: 'deliverables',
        target: { runId: 'reviewed' },
        paths: [],
        reviewerRunId: 'reviewer',
      }).success,
    ).toBe(false);
  });
});
