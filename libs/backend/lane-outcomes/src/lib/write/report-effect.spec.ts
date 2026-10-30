import { outcomeRow, heldReport } from '../store/store.test-support';
import { deliverablesVerdictOf, reportEffectOf } from './report-effect';
import { deterministicReviewReportId } from './report-effect';
import { applyOutcomeEffect } from '../store/lane-outcome.store';
import { OUTCOME_TASK_KIND_SOURCES } from '@ptah-extension/shared';

describe('reportEffectOf', () => {
  const check = { exists: true, bytes: 1, mtimeMs: 100 };
  it.each([
    ['no checks', [], 100, 'unverified'],
    ['all delivered', [check], 100, 'delivered'],
    ['zero bytes', [{ ...check, bytes: 0 }], 100, 'no-deliverable'],
    ['missing file', [{ ...check, exists: false }], 100, 'no-deliverable'],
    ['old mtime', [{ ...check, mtimeMs: 99 }], 100, 'no-deliverable'],
    ['null mtime', [{ ...check, mtimeMs: null }], 100, 'delivered'],
    ['null start', [{ ...check, mtimeMs: 99 }], null, 'delivered'],
  ] as const)('%s verdict parity', (_name, checks, startedAt, expected) => {
    expect(deliverablesVerdictOf(checks, startedAt)).toBe(expected);
  });

  it('rejects bad JSON and extra paths without throwing', () => {
    const row = { ...outcomeRow('subagent:a'), budgetStopped: false };
    const report = heldReport(1, 100);
    expect(reportEffectOf(row, { ...report, payload: '{' })).toBeNull();
    expect(
      reportEffectOf(row, {
        ...report,
        payload: JSON.stringify({ checks: [], paths: ['/secret'] }),
      }),
    ).toBeNull();
    expect(
      reportEffectOf(row, {
        ...report,
        payload: JSON.stringify({
          checks: [{ exists: true, bytes: -1, mtimeMs: 100 }],
        }),
      }),
    ).toBeNull();
  });

  it.each([...OUTCOME_TASK_KIND_SOURCES, null])(
    'applies report kind with existing %s provenance',
    (source) => {
      const row = {
        ...outcomeRow('subagent:precedence'),
        taskKind: source === null || source === 'unclassified' ? null : 'review' as const,
        taskKindSource: source,
      };
      const effect = reportEffectOf(
        { ...row, budgetStopped: false },
        {
          ...heldReport(10, 100),
          payload: JSON.stringify({ checks: [], taskKind: 'implement' }),
        },
      );
      expect(effect).not.toBeNull();
      if (effect === null) return;
      const applied = applyOutcomeEffect(row, effect);
      expect(applied.taskKind).toBe(source === 'explicit' ? 'review' : 'implement');
      expect(applied.taskKindSource).toBe('explicit');
    },
  );

  it.each(['explicit', 'mapped', 'classified', 'unclassified', null] as const)(
    'keeps %s provenance when the report omits kind',
    (source) => {
      const row = {
        ...outcomeRow('subagent:no-kind'),
        taskKind: source === null || source === 'unclassified' ? null : 'review' as const,
        taskKindSource: source,
      };
      const effect = reportEffectOf(
        { ...row, budgetStopped: false },
        heldReport(11, 100),
      );
      expect(effect).not.toBeNull();
      if (effect === null) return;
      const applied = applyOutcomeEffect(row, effect);
      expect(applied.taskKind).toBe(row.taskKind);
      expect(applied.taskKindSource).toBe(source);
    },
  );

  it('uses both run IDs for stable review receipt identity', () => {
    expect(deterministicReviewReportId('reviewed', 'reviewer'))
      .toBe('review:reviewed|reviewer');
    expect(deterministicReviewReportId('reviewed', 'reviewer'))
      .toBe(deterministicReviewReportId('reviewed', 'reviewer'));
    expect(deterministicReviewReportId('reviewed', 'other'))
      .not.toBe(deterministicReviewReportId('reviewed', 'reviewer'));
  });
});
