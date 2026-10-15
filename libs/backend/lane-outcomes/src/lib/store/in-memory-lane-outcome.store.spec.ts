import { InMemoryLaneOutcomeStore } from './in-memory-lane-outcome.store';
import { heldReport, outcomeRow } from './store.test-support';

describe('InMemoryLaneOutcomeStore', () => {
  it('deduplicates records and receipts, and applies patches', async () => {
    const store = new InMemoryLaneOutcomeStore();
    expect(await store.insertIfAbsent(outcomeRow('a'))).toBe(true);
    expect(await store.insertIfAbsent(outcomeRow('a'))).toBe(false);
    expect(await store.update('a', { verdict: 'delivered' })).toBe(true);
    expect((await store.get('a'))?.verdict).toBe('delivered');
    const receipt = {
      reportId: 'r',
      runId: 'a',
      kind: 'review' as const,
      appliedAt: 1,
    };
    expect(await store.recordReceipt(receipt)).toBe(true);
    expect(await store.recordReceipt(receipt)).toBe(false);
  });

  it('counts 497 live holds out of 500 and clears expired holds before insertion', async () => {
    const store = new InMemoryLaneOutcomeStore();
    const now = Date.now();
    for (let i = 0; i < 500; i++)
      await store.holdReport(heldReport(i, now, i < 3));
    expect(await store.countHeldReports(now)).toBe(497);
    await store.holdReport(heldReport(500, now));
    expect(await store.countHeldReports(now)).toBe(498);
    expect(
      (await store.takeHeldReports('subagent:a', now)).some(
        (report) => report.reportId === 'report-0',
      ),
    ).toBe(false);
  });
});
