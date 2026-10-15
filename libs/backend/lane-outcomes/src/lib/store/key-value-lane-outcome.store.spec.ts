import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  KeyValueLaneOutcomeStore,
  LANE_OUTCOME_RECORDS_KEY,
} from './key-value-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';

function storage(): IStateStorage {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
    keys(): readonly string[] {
      return [...values.keys()];
    },
  };
}

describe('KeyValueLaneOutcomeStore', () => {
  it('persists rows and receipts over a new instance', async () => {
    const state = storage();
    const store = new KeyValueLaneOutcomeStore(state);
    await store.insertIfAbsent(outcomeRow('a'));
    await store.recordReceipt({
      reportId: 'r',
      runId: 'a',
      kind: 'review',
      appliedAt: Date.now(),
    });
    const reopened = new KeyValueLaneOutcomeStore(state);
    expect((await reopened.get('a'))?.runId).toBe('a');
    expect(await reopened.hasReceipt('r')).toBe(true);
    expect(state.keys()).toContain(LANE_OUTCOME_RECORDS_KEY);
  });

  it('counts only live holds and deletes expired ones before a new hold', async () => {
    const state = storage();
    const store = new KeyValueLaneOutcomeStore(state);
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport(heldReport(i, now, i < 3));
    expect(await store.countHeldReports(now)).toBe(497);
    await store.holdReport(heldReport(500, now));
    const reopened = new KeyValueLaneOutcomeStore(state);
    expect(await reopened.countHeldReports(now)).toBe(498);
    expect(
      (await reopened.takeHeldReports('subagent:a', now)).some(
        (report) => report.reportId === 'report-0',
      ),
    ).toBe(false);
  });
});
