import { reportEffectOf } from '../write/report-effect';
import { InMemoryLaneOutcomeStore } from './in-memory-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';

describe('InMemoryLaneOutcomeStore', () => {
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
