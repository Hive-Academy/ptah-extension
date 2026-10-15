import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  appendEntries,
  KeyValueOutcomeJournal,
  OUTCOME_JOURNAL_KEY,
  OUTCOME_JOURNAL_LIMIT,
} from './key-value-outcome-journal';

class MemoryState implements IStateStorage {
  readonly values = new Map<string, unknown>();
  fail = false;
  writes = 0;

  get<T>(key: string, fallback?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? fallback;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.writes++;
    if (this.fail) throw new Error('update failed');
    this.values.set(key, structuredClone(value));
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

describe('KeyValueOutcomeJournal', () => {
  it('numbers accepted entries and counts every capacity refusal', () => {
    const value = {
      nextSeq: 8,
      entries: Array.from({ length: OUTCOME_JOURNAL_LIMIT - 1 }, (_, i) => ({
        seq: i + 1,
        op: i,
      })),
      droppedAtCapacity: 2,
      heldRuns: [],
    };
    const result = appendEntries(value, [10, 11, 12]);
    expect(result.accepted).toEqual([true, false, false]);
    expect(result.value.entries.at(-1)).toEqual({ seq: 8, op: 10 });
    expect(result.value.nextSeq).toBe(9);
    expect(result.value.droppedAtCapacity).toBe(4);
    expect(
      appendEntries(
        { nextSeq: 1, entries: [], droppedAtCapacity: 0, heldRuns: [] },
        [1, 2],
      ).value.entries.map((entry) => entry.seq),
    ).toEqual([1, 2]);
  });

  it('recovers valid entries from a damaged journal', async () => {
    const storage = new MemoryState();
    await storage.update(OUTCOME_JOURNAL_KEY, {
      nextSeq: 3,
      entries: [
        { seq: 2, op: 'kept' },
        { seq: 'bad', op: 'lost' },
      ],
      droppedAtCapacity: 0,
      heldRuns: [],
    });
    const journal = new KeyValueOutcomeJournal<string>(storage);
    expect(journal.droppedOnRead).toBe(1);
    expect(journal.snapshot().entries).toEqual([{ seq: 2, op: 'kept' }]);
    await storage.update(OUTCOME_JOURNAL_KEY, 'garbage');
    const empty = new KeyValueOutcomeJournal<string>(storage);
    expect(empty.droppedOnRead).toBe(1);
    expect(empty.snapshot().entries).toEqual([]);
  });
  it('survives restart with FIFO order and a durable refusal count', async () => {
    const storage = new MemoryState();
    await storage.update(OUTCOME_JOURNAL_KEY, {
      nextSeq: 5001,
      entries: Array.from({ length: 5000 }, (_, i) => ({ seq: i + 1, op: i })),
      droppedAtCapacity: 0,
      heldRuns: [],
    });
    const journal = new KeyValueOutcomeJournal<number>(storage);
    expect(await journal.append(5000)).toBe(false);
    const reopened = new KeyValueOutcomeJournal<number>(storage);
    expect(reopened.snapshot().entries).toHaveLength(5000);
    expect(reopened.snapshot().entries[0].op).toBe(0);
    expect(reopened.snapshot().entries[4999].op).toBe(4999);
    expect(reopened.snapshot().droppedAtCapacity).toBe(1);
  });

  it('does not acknowledge a rejected update', async () => {
    const storage = new MemoryState();
    const journal = new KeyValueOutcomeJournal<number>(storage);
    storage.fail = true;
    await expect(journal.append(1)).rejects.toThrow('update failed');
    expect(journal.snapshot().entries).toEqual([]);
    expect(storage.values.has(OUTCOME_JOURNAL_KEY)).toBe(false);
  });

  it('prunes expired held reports and preserves the unexpired count', async () => {
    const storage = new MemoryState();
    const journal = new KeyValueOutcomeJournal<number>(storage, 100);
    await journal.update(
      (value) => ({
        ...value,
        heldRuns: [
          { runId: 'subagent:z', expiresAt: 200, holdExpiries: [90, 200] },
        ],
      }),
      100,
    );
    expect(
      new KeyValueOutcomeJournal<number>(storage, 100).snapshot().heldRuns,
    ).toEqual([{ runId: 'subagent:z', expiresAt: 200, holdExpiries: [200] }]);
    expect(
      new KeyValueOutcomeJournal<number>(storage, 201).snapshot().heldRuns,
    ).toEqual([]);
  });
});
