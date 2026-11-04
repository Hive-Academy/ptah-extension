import { outcomeRow, heldReport } from '../store/store.test-support';
import { deliverablesVerdictOf, reportEffectOf } from './report-effect';
import {
  DeliverablesPayloadSchema,
  deterministicReviewReportId,
  hostDeliverablesReportId,
  isSelfReview,
  reviewerIdentity,
} from './report-effect';
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
        taskKind:
          source === null || source === 'unclassified'
            ? null
            : ('review' as const),
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
      expect(applied.taskKind).toBe(
        source === 'explicit' ? 'review' : 'implement',
      );
      expect(applied.taskKindSource).toBe('explicit');
    },
  );

  it.each(['explicit', 'mapped', 'classified', 'unclassified', null] as const)(
    'keeps %s provenance when the report omits kind',
    (source) => {
      const row = {
        ...outcomeRow('subagent:no-kind'),
        taskKind:
          source === null || source === 'unclassified'
            ? null
            : ('review' as const),
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
    expect(deterministicReviewReportId('reviewed', 'reviewer')).toBe(
      'review:reviewed|reviewer',
    );
    expect(deterministicReviewReportId('reviewed', 'reviewer')).toBe(
      deterministicReviewReportId('reviewed', 'reviewer'),
    );
    expect(deterministicReviewReportId('reviewed', 'other')).not.toBe(
      deterministicReviewReportId('reviewed', 'reviewer'),
    );
  });

  it('reduces a reviewer run id to its agent', () => {
    expect(reviewerIdentity('agent-r:2026-10-31T10:00:00.000Z')).toBe(
      'agent-r',
    );
    expect(reviewerIdentity('agent-r:2026-10-31T10:00:00Z')).toBe('agent-r');
    expect(reviewerIdentity('subagent:agent-r')).toBe('agent-r');
    expect(reviewerIdentity('agent-r')).toBe('agent-r');
    expect(reviewerIdentity('lane:reviewer')).toBe('lane:reviewer');
  });

  it('pairs host capture and tool reports of one reviewer agent', () => {
    const host = deterministicReviewReportId(
      'lane:target',
      'agent-r:2026-10-31T10:00:00.000Z',
    );
    expect(deterministicReviewReportId('lane:target', 'agent-r')).toBe(host);
    expect(
      deterministicReviewReportId(
        'lane:target',
        'agent-r:2026-10-31T11:00:00.000Z',
      ),
    ).toBe(host);
  });

  it('detects a review of the reviewer agent own run', () => {
    expect(isSelfReview('agent-r:2026-10-31T09:00:00.000Z', 'agent-r')).toBe(
      true,
    );
    expect(
      isSelfReview('subagent:agent-r', 'agent-r:2026-10-31T10:00:00Z'),
    ).toBe(true);
    expect(isSelfReview('lane:target', 'agent-r')).toBe(false);
  });
});

describe('host-origin deliverables', () => {
  const checks = [{ exists: true, bytes: 1, mtimeMs: null }];
  const effectOf = (payload: Record<string, unknown>) =>
    reportEffectOf(
      { ...outcomeRow('subagent:host'), budgetStopped: false },
      {
        ...heldReport(1, 100),
        runId: 'subagent:host',
        payload: JSON.stringify(payload),
      },
    );

  it('maps origin host to hostObserved', () => {
    expect(effectOf({ checks, origin: 'host' })).toMatchObject({
      kind: 'deliverables',
      verdict: 'delivered',
      hostObserved: true,
    });
    expect(effectOf({ checks })).not.toHaveProperty('hostObserved');
  });

  it.each(['agent', 'Host', '', null, true])('rejects origin %p', (origin) => {
    expect(
      DeliverablesPayloadSchema.safeParse({ checks, origin }).success,
    ).toBe(false);
    expect(effectOf({ checks, origin })).toBeNull();
  });

  it('builds one deterministic host report id per run', () => {
    expect(hostDeliverablesReportId('subagent:a')).toBe(
      'deliverables:host:subagent:a',
    );
    expect(hostDeliverablesReportId('subagent:a')).not.toBe(
      hostDeliverablesReportId('subagent:b'),
    );
  });

  it('skips a host effect on a declared row and applies it otherwise', () => {
    const effect = effectOf({
      checks: [{ exists: false, bytes: 0, mtimeMs: null }],
      origin: 'host',
    });
    if (effect === null) throw new Error('expected an effect');
    const declared = {
      ...outcomeRow('subagent:host'),
      verdict: 'delivered' as const,
      deliverablesDeclaredAt: 50,
    };
    expect(applyOutcomeEffect(declared, effect)).toBe(declared);
    expect(
      applyOutcomeEffect(outcomeRow('subagent:host'), effect).verdict,
    ).toBe('no-deliverable');
  });
});
