import {
  hostDeliverablesReportId,
  reportEffectOf,
} from '../write/report-effect';
import type { HeldOutcomeReport } from './lane-outcome.store';
import { InMemoryLaneOutcomeStore } from './in-memory-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';

describe('InMemoryLaneOutcomeStore', () => {
  it('matches normalized workspace and child paths, including worktrees', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const roots = ['D:\\Repo\\', 'd:/repo/src', 'D:/REPO/.claude-worktrees/task', 'd:/repository'];
    for (const [index, root] of roots.entries()) await store.insertIfAbsent({ ...outcomeRow(String(index)), laneId: 'lane', workspaceRoot: root });
    expect((await store.listByLane('lane', 0, 'd:/repo/')).map((row) => row.runId).sort()).toEqual(['0', '1', '2']);
    expect((await store.listRecent(0, 'D:\\REPO')).map((row) => row.runId).sort()).toEqual(['0', '1', '2']);
  });
  it('scopes lane and role reads while retaining null-root history', async () => {
    const store = new InMemoryLaneOutcomeStore();
    for (const [id, root] of [['same', '/ws'], ['other', '/other'], ['legacy', null]] as const) {
      await store.insertIfAbsent({ ...outcomeRow(id), laneId: 'lane', role: 'backend-developer', workspaceRoot: root });
    }
    expect((await store.listByLane('lane', 0, '/ws')).map((row) => row.runId).sort()).toEqual(['legacy', 'same']);
    expect((await store.listByRoles(['backend-developer'], 0, '/ws')).map((row) => row.runId).sort()).toEqual(['legacy', 'same']);
  });
  it('classifies only a kindless unclassified row', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent({
      ...outcomeRow('pending'),
      taskKind: null,
      taskKindSource: 'unclassified',
    });
    expect(await store.setClassifiedTaskKind('missing', 'review')).toBe(false);
    expect(await store.setClassifiedTaskKind('pending', 'implement')).toBe(true);
    expect(await store.get('pending')).toMatchObject({
      taskKind: 'implement',
      taskKindSource: 'classified',
    });
    expect(await store.setClassifiedTaskKind('pending', 'review')).toBe(false);
    await store.insertIfAbsent({
      ...outcomeRow('explicit'),
      taskKind: 'review',
      taskKindSource: 'explicit',
    });
    expect(await store.setClassifiedTaskKind('explicit', 'implement')).toBe(false);
    expect((await store.get('explicit'))?.taskKind).toBe('review');
    await store.insertIfAbsent({
      ...outcomeRow('protected'),
      taskKind: null,
      taskKindSource: 'mapped',
    });
    expect(await store.setClassifiedTaskKind('protected', 'implement')).toBe(false);
    expect((await store.get('protected'))?.taskKindSource).toBe('mapped');
  });

  it('fills only absent join fields and reports a genuine change', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const join = {
      subagentSessionId: 'new-session',
      parentSessionId: 'parent',
      workspaceRoot: '/new',
    };
    expect(await store.fillMissingSubagentJoin('missing', join)).toBe(false);
    await store.insertIfAbsent({
      ...outcomeRow('joined'),
      subagentSessionId: 'original',
      parentSessionId: null,
      workspaceRoot: null,
    });
    expect(await store.fillMissingSubagentJoin('joined', join)).toBe(true);
    expect(await store.get('joined')).toMatchObject({
      subagentSessionId: 'original',
      parentSessionId: 'parent',
      workspaceRoot: '/new',
    });
    expect(await store.fillMissingSubagentJoin('joined', join)).toBe(false);
  });

  it.each([
    ['failed', 'crash', 'failed'],
    ['no-deliverable', 'crash', 'no-deliverable'],
    ['unverified', null, 'delivered'],
  ] as const)(
    'applies deliverables to a lane with %s verdict and %s class',
    async (verdict, failureClass, expected) => {
      const store = new InMemoryLaneOutcomeStore();
      await store.insertIfAbsent({
        ...outcomeRow('lane:case'),
        executorKind: 'cli',
        laneId: 'lane',
        verdict,
        failureClass,
      });
      const report = {
        ...heldReport(401, Date.now()),
        runId: 'lane:case',
        payload: JSON.stringify({
          checks: [{ exists: true, bytes: 1, mtimeMs: null }],
          taskKind: 'implement',
          taskId: 'task-401',
        }),
      };
      expect(
        await store.applyReportWithReceipt(report, Date.now(), reportEffectOf),
      ).toBe('applied');
      expect(await store.get('lane:case')).toMatchObject({
        verdict: expected,
        failureClass,
        deliverablesDeclaredAt: expect.any(Number),
        taskId: 'task-401',
      });
      expect(await store.hasReceipt(report.reportId)).toBe(true);
    },
  );

  it('updates the subagent verdict on deliverables', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent({
      ...outcomeRow('subagent:case'),
      verdict: 'failed',
    });
    const report = { ...heldReport(402, Date.now()), runId: 'subagent:case' };
    expect(
      await store.applyReportWithReceipt(report, Date.now(), reportEffectOf),
    ).toBe('applied');
    expect((await store.get('subagent:case'))?.verdict).toBe('delivered');
  });
  it('round-trips subagent session identifiers', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const row = {
      ...outcomeRow('subagent:session'),
      subagentSessionId: 'session',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    };
    await store.insertIfAbsent(row);
    expect(await store.get(row.runId)).toMatchObject({
      subagentSessionId: 'session',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    });
  });
  it('joins deliverables then revise in held order, receipts once, replay no-op', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    const deliverables = heldReport(1, now);
    const review = {
      ...heldReport(2, now),
      kind: 'review' as const,
      payload: '{"verdict":"revise"}',
      heldAt: now,
    };
    await store.holdReport(review);
    await store.holdReport(deliverables);
    await store.holdReport({
      ...heldReport(3, now),
      heldAt: now + 1,
      payload: '{',
    });
    const first = await store.insertStopWithHeldReports(
      { ...outcomeRow('subagent:a'), startedAt: now - 2000 },
      now,
      reportEffectOf,
    );
    expect(first.joined.map((r) => r.reportId)).toEqual([
      'report-1',
      'report-2',
    ]);
    expect(first.invalid.map((r) => r.reportId)).toEqual(['report-3']);
    expect(await store.get('subagent:a')).toMatchObject({
      verdict: 'delivered',
      reviseRounds: 1,
    });
    expect(await store.hasReceipt('report-1')).toBe(true);
    expect(await store.hasReceipt('report-2')).toBe(true);
    expect(
      (
        await store.insertStopWithHeldReports(
          outcomeRow('subagent:a'),
          now,
          reportEffectOf,
        )
      ).joined,
    ).toEqual([]);
    expect((await store.get('subagent:a'))?.reviseRounds).toBe(1);
  });

  it('rolls back a resolver throw mid-join', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    await store.holdReport(heldReport(1, now));
    await store.holdReport(heldReport(2, now));
    let calls = 0;
    await expect(
      store.insertStopWithHeldReports(
        outcomeRow('subagent:a'),
        now,
        (row, report) => {
          if (++calls === 2) throw new Error('fault');
          return reportEffectOf(row, report);
        },
      ),
    ).rejects.toThrow('fault');
    expect(await store.get('subagent:a')).toBeNull();
    expect(await store.listHeldReports(now)).toHaveLength(2);
    expect(await store.hasReceipt('report-1')).toBe(false);
  });

  it('returns duplicate, missing and invalid without writing; revise once', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    const review = {
      ...heldReport(3, now),
      kind: 'review' as const,
      payload: '{"verdict":"revise"}',
    };
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('missing');
    await store.insertIfAbsent(outcomeRow('subagent:a'));
    expect(
      await store.applyReportWithReceipt(
        { ...review, payload: '{' },
        now,
        reportEffectOf,
      ),
    ).toBe('invalid');
    expect(await store.hasReceipt(review.reportId)).toBe(false);
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('applied');
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('duplicate');
    expect((await store.get('subagent:a'))?.reviseRounds).toBe(1);
  });

  it('applies budget stops before and after insert, excluding markers from hold views', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    expect(await store.markBudgetStopped('subagent:a', now)).toBe('held');
    expect(await store.markBudgetStopped('subagent:a', now)).toBe('duplicate');
    expect(await store.countHeldReports(now)).toBe(0);
    expect(await store.hasHeldDeliverables('subagent:a', now)).toBe(false);
    expect(await store.listHeldReports(now)).toEqual([]);
    expect(
      (
        await store.insertStopWithHeldReports(
          outcomeRow('subagent:a'),
          now,
          reportEffectOf,
        )
      ).budgetStopped,
    ).toBe(true);
    expect((await store.get('subagent:a'))?.budgetStopped).toBe(true);
    await store.insertIfAbsent(outcomeRow('b'));
    expect(await store.markBudgetStopped('b', now)).toBe('applied');
    expect((await store.get('b'))?.budgetStopped).toBe(true);
  });

  it('lists holds without deleting and returns expired reports including markers', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    const report = heldReport(1, now);
    await store.holdReport(report);
    await store.markBudgetStopped('budget-only', now);
    expect(await store.listHeldReports(now)).toEqual([report]);
    expect(await store.listHeldReports(now)).toEqual([report]);
    expect(
      (await store.expireHeldReports(now + 86_400_001))
        .map((r) => r.kind)
        .sort(),
    ).toEqual(['budget-stop', 'deliverables']);
    expect(await store.listHeldReports(now)).toEqual([]);
  });

  it('keeps the 497 plus one live-hold capacity case', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport(heldReport(i, now, i < 3));
    expect(await store.countHeldReports(now)).toBe(497);
    await store.holdReport(heldReport(500, now));
    expect(await store.countHeldReports(now)).toBe(498);
    expect(
      (await store.listHeldReports(now)).some((r) => r.reportId === 'report-0'),
    ).toBe(false);
  });
});

describe('InMemoryLaneOutcomeStore host-observed deliverables', () => {
  const runId = 'subagent:host';
  const deliverables = (
    reportId: string,
    payload: Record<string, unknown>,
    heldAt: number,
  ): HeldOutcomeReport => ({
    reportId,
    runId,
    kind: 'deliverables',
    payload: JSON.stringify(payload),
    heldAt,
    expiresAt: heldAt + 60_000,
  });
  const missing = [{ exists: false, bytes: 0, mtimeMs: null }];
  const written = [{ exists: true, bytes: 3, mtimeMs: null }];
  const host = (heldAt: number) =>
    deliverables(
      hostDeliverablesReportId(runId),
      { checks: missing, origin: 'host' },
      heldAt,
    );
  const explicit = (heldAt: number) =>
    deliverables('explicit-1', { checks: written }, heldAt);

  it('applies a host report to an undeclared row', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow(runId));
    const now = Date.now();
    expect(
      await store.applyReportWithReceipt(host(now), now, reportEffectOf),
    ).toBe('applied');
    expect(await store.get(runId)).toMatchObject({
      verdict: 'no-deliverable',
      deliverablesDeclaredAt: now,
    });
  });

  it('lets an explicit report after a host report set the verdict', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow(runId));
    const now = Date.now();
    await store.applyReportWithReceipt(host(now), now, reportEffectOf);
    expect(
      await store.applyReportWithReceipt(
        explicit(now + 1),
        now + 1,
        reportEffectOf,
      ),
    ).toBe('applied');
    expect((await store.get(runId))?.verdict).toBe('delivered');
  });

  it('leaves an explicitly declared row unchanged on a later host report', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow(runId));
    const now = Date.now();
    await store.applyReportWithReceipt(explicit(now), now, reportEffectOf);
    const before = await store.get(runId);
    await store.applyReportWithReceipt(host(now + 1), now + 1, reportEffectOf);
    expect(await store.get(runId)).toEqual(before);
    expect(before?.verdict).toBe('delivered');
  });

  it('keeps an explicit report held before the stop over the host report', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    await store.holdReport(explicit(now - 10));
    const stop = await store.insertStopWithHeldReports(
      outcomeRow(runId),
      now,
      reportEffectOf,
    );
    expect(stop.joined.map((r) => r.reportId)).toEqual(['explicit-1']);
    await store.applyReportWithReceipt(host(now + 1), now + 1, reportEffectOf);
    expect((await store.get(runId))?.verdict).toBe('delivered');
  });

  it('keeps a classified failed verdict on a host report and still receipts it', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent({
      ...outcomeRow(runId),
      verdict: 'failed',
      failureClass: 'timeout',
    });
    const before = await store.get(runId);
    const now = Date.now();
    const hostWritten = deliverables(
      hostDeliverablesReportId(runId),
      { checks: written, origin: 'host' },
      now,
    );
    expect(
      await store.applyReportWithReceipt(hostWritten, now, reportEffectOf),
    ).toBe('applied');
    expect(await store.get(runId)).toEqual(before);
    expect(await store.hasReceipt(hostDeliverablesReportId(runId))).toBe(true);
    // An explicit report keeps its current behaviour on a subagent row.
    await store.applyReportWithReceipt(
      explicit(now + 1),
      now + 1,
      reportEffectOf,
    );
    expect((await store.get(runId))?.verdict).toBe('delivered');
  });

  it('receipts a repeated host report once', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow(runId));
    const now = Date.now();
    expect(
      await store.applyReportWithReceipt(host(now), now, reportEffectOf),
    ).toBe('applied');
    expect(
      await store.applyReportWithReceipt(
        host(now + 1),
        now + 1,
        reportEffectOf,
      ),
    ).toBe('duplicate');
    expect(await store.hasReceipt(hostDeliverablesReportId(runId))).toBe(true);
  });

  it('rejects an unknown origin without writing', async () => {
    const store = new InMemoryLaneOutcomeStore();
    await store.insertIfAbsent(outcomeRow(runId));
    const now = Date.now();
    const agentClaim = deliverables(
      'claim-1',
      { checks: written, origin: 'agent' },
      now,
    );
    expect(
      await store.applyReportWithReceipt(agentClaim, now, reportEffectOf),
    ).toBe('invalid');
    expect(await store.get(runId)).toMatchObject({
      verdict: 'unverified',
      deliverablesDeclaredAt: null,
    });
    expect(await store.hasReceipt('claim-1')).toBe(false);
  });
});
