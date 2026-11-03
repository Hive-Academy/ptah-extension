import type { IStateStorage } from '@ptah-extension/platform-core';
import { reportEffectOf } from '../write/report-effect';
import {
  KeyValueLaneOutcomeStore,
  LANE_OUTCOME_RECORDS_KEY,
} from './key-value-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';
import { testLogger } from '../write/pipeline.test-support';

function storage() {
  const values = new Map<string, unknown>();
  let rejectNext = false;
  let writes = 0;
  const state: IStateStorage = {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      if (rejectNext) {
        rejectNext = false;
        throw new Error('update rejected');
      }
      values.set(key, value);
      writes++;
    },
    keys(): readonly string[] {
      return [...values.keys()];
    },
  };
  return {
    state,
    reject: () => {
      rejectNext = true;
    },
    writes: () => writes,
  };
}

describe('KeyValueLaneOutcomeStore', () => {
  it('persists guarded classification and null-only joins across reload', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    await store.insertIfAbsent({
      ...outcomeRow('pending'),
      taskKind: null,
      taskKindSource: 'unclassified',
      subagentSessionId: 'original',
      parentSessionId: null,
      workspaceRoot: null,
    });
    expect(await store.setClassifiedTaskKind('missing', 'review')).toBe(false);
    expect(await store.setClassifiedTaskKind('pending', 'implement')).toBe(true);
    expect(await store.setClassifiedTaskKind('pending', 'review')).toBe(false);
    const join = {
      subagentSessionId: 'replacement',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    };
    expect(await store.fillMissingSubagentJoin('missing', join)).toBe(false);
    expect(await store.fillMissingSubagentJoin('pending', join)).toBe(true);
    expect(await store.fillMissingSubagentJoin('pending', join)).toBe(false);
    const reopened = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect(await reopened.get('pending')).toMatchObject({
      taskKind: 'implement',
      taskKindSource: 'classified',
      subagentSessionId: 'original',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    });
    await reopened.insertIfAbsent({
      ...outcomeRow('explicit'),
      taskKind: 'review',
      taskKindSource: 'explicit',
    });
    expect(await reopened.setClassifiedTaskKind('explicit', 'implement')).toBe(false);
    expect((await new KeyValueLaneOutcomeStore(memory.state, testLogger()).get('explicit'))?.taskKind)
      .toBe('review');
  });

  it('keeps valid snapshot rows and warns once for malformed rows', async () => {
    const memory = storage();
    await memory.state.update(LANE_OUTCOME_RECORDS_KEY, {
      rows: [outcomeRow('subagent:valid'), { runId: 'bad' }],
      receipts: [],
      held: [],
      budgetStopped: [],
    });
    const logger = testLogger();
    const store = new KeyValueLaneOutcomeStore(memory.state, logger);
    expect(await store.get('subagent:valid')).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'Lane outcome snapshot entries skipped',
      {
        rows: 1,
        receipts: 0,
        held: 0,
        budgetStopped: 0,
        code: 'ZOD_VALIDATION',
      },
    );
  });

  it('starts empty on an unreadable snapshot', async () => {
    const memory = storage();
    await memory.state.update(LANE_OUTCOME_RECORDS_KEY, 'garbage');
    const logger = testLogger();
    const store = new KeyValueLaneOutcomeStore(memory.state, logger);
    expect(await store.get('subagent:valid')).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
  it('round-trips subagent session identifiers through persisted state', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    const row = {
      ...outcomeRow('subagent:session'),
      subagentSessionId: 'session',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    };
    await store.insertIfAbsent(row);
    const reopened = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect(await reopened.get(row.runId)).toMatchObject({
      subagentSessionId: 'session',
      parentSessionId: 'parent',
      workspaceRoot: '/workspace',
    });
  });
  it('joins in held order in one update and replays without a write', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
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
    const before = memory.writes();
    const joined = await store.insertStopWithHeldReports(
      { ...outcomeRow('subagent:a'), startedAt: now - 2000 },
      now,
      reportEffectOf,
    );
    expect(memory.writes() - before).toBe(1);
    expect(joined.joined.map((r) => r.reportId)).toEqual([
      'report-1',
      'report-2',
    ]);
    expect(joined.invalid.map((r) => r.reportId)).toEqual(['report-3']);
    expect(await store.get('subagent:a')).toMatchObject({
      verdict: 'delivered',
      reviseRounds: 1,
    });
    expect(await store.hasReceipt('report-1')).toBe(true);
    expect(await store.hasReceipt('report-2')).toBe(true);
    const writes = memory.writes();
    expect(
      (
        await store.insertStopWithHeldReports(
          outcomeRow('subagent:a'),
          now,
          reportEffectOf,
        )
      ).joined,
    ).toEqual([]);
    expect(memory.writes()).toBe(writes);
  });

  it('restores row, holds and receipts when the join update rejects', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    const now = Date.now();
    await store.holdReport(heldReport(1, now));
    memory.reject();
    await expect(
      store.insertStopWithHeldReports(
        outcomeRow('subagent:a'),
        now,
        reportEffectOf,
      ),
    ).rejects.toThrow('update rejected');
    expect(await store.get('subagent:a')).toBeNull();
    expect(await store.listHeldReports(now)).toHaveLength(1);
    expect(await store.hasReceipt('report-1')).toBe(false);
    const reopened = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect(await reopened.listHeldReports(now)).toHaveLength(1);
  });

  it('returns duplicate, missing and invalid without an update; revises once', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    const now = Date.now();
    const review = {
      ...heldReport(3, now),
      kind: 'review' as const,
      payload: '{"verdict":"revise"}',
    };
    let writes = memory.writes();
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('missing');
    expect(memory.writes()).toBe(writes);
    await store.insertIfAbsent(outcomeRow('subagent:a'));
    writes = memory.writes();
    expect(
      await store.applyReportWithReceipt(
        { ...review, payload: '{' },
        now,
        reportEffectOf,
      ),
    ).toBe('invalid');
    expect(memory.writes()).toBe(writes);
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('applied');
    writes = memory.writes();
    expect(
      await store.applyReportWithReceipt(review, now, reportEffectOf),
    ).toBe('duplicate');
    expect(memory.writes()).toBe(writes);
    expect((await store.get('subagent:a'))?.reviseRounds).toBe(1);
  });

  it('persists markers, flags, rows, receipts and holds across restart', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    const now = Date.now();
    await store.markBudgetStopped('subagent:a', now);
    expect(await store.countHeldReports(now)).toBe(0);
    expect(await store.hasHeldDeliverables('subagent:a', now)).toBe(false);
    expect(await store.listHeldReports(now)).toEqual([]);
    await store.holdReport(heldReport(1, now));
    expect(await store.listHeldReports(now)).toHaveLength(1);
    expect(await store.listHeldReports(now)).toHaveLength(1);
    const reopened = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect(await reopened.listHeldReports(now)).toHaveLength(1);
    expect(
      (
        await reopened.insertStopWithHeldReports(
          outcomeRow('subagent:a'),
          now,
          reportEffectOf,
        )
      ).budgetStopped,
    ).toBe(true);
    expect((await reopened.get('subagent:a'))?.budgetStopped).toBe(true);
    expect(await reopened.hasReceipt('report-1')).toBe(true);
    await reopened.insertIfAbsent(outcomeRow('b'));
    expect(await reopened.markBudgetStopped('b', now)).toBe('applied');
    const final = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect((await final.get('b'))?.budgetStopped).toBe(true);
    expect(memory.state.keys()).toContain(LANE_OUTCOME_RECORDS_KEY);
  });

  it('expires holds including markers and keeps the 497 plus one capacity case', async () => {
    const store = new KeyValueLaneOutcomeStore(storage().state, testLogger());
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport(heldReport(i, now, i < 3));
    expect(await store.countHeldReports(now)).toBe(497);
    await store.holdReport(heldReport(500, now));
    expect(await store.countHeldReports(now)).toBe(498);
    expect(
      (await store.listHeldReports(now)).some((r) => r.reportId === 'report-0'),
    ).toBe(false);
    await store.markBudgetStopped('marker', now);
    const expired = await store.expireHeldReports(now + 86_400_001);
    expect(expired).toHaveLength(499);
    expect(expired.some((r) => r.kind === 'budget-stop')).toBe(true);
  });

  it('evicts the oldest row with its receipt and flag above 2000 rows', async () => {
    const memory = storage();
    const store = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    const now = Date.now();
    await store.insertIfAbsent({ ...outcomeRow('old'), endedAt: now - 2001 });
    await store.markBudgetStopped('old', now);
    await store.applyReportWithReceipt(
      { ...heldReport(5, now), runId: 'old' },
      now,
      reportEffectOf,
    );
    for (let i = 0; i < 2000; i++)
      await store.insertIfAbsent({
        ...outcomeRow(`new-${i}`),
        endedAt: now - 2000 + i,
      });
    const reopened = new KeyValueLaneOutcomeStore(memory.state, testLogger());
    expect(await reopened.get('old')).toBeNull();
    expect(await reopened.hasReceipt('report-5')).toBe(false);
    const snapshot = memory.state.get<{ budgetStopped: string[] }>(
      LANE_OUTCOME_RECORDS_KEY,
    );
    expect(snapshot?.budgetStopped).not.toContain('old');
  });
});
