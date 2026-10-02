/**
 * Unit spec for {@link TurnChangeSetStore}: round-trip under the session's own
 * key, the 100-per-session bound, serialized appends, remove, and tolerance
 * of a malformed stored value.
 */

import 'reflect-metadata';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { TurnChangeSet } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import {
  MAX_CHANGE_SETS_PER_SESSION,
  TurnChangeSetStore,
  turnChangeSetsKey,
} from './turn-change-set.store';

class MemoryStorage implements IStateStorage {
  readonly data = new Map<string, unknown>();
  failNextUpdate = false;

  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    // Yield first, as a real backend does, so interleaving is observable.
    await Promise.resolve();
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new Error('disk full');
    }
    // `update(key, undefined)` deletes the key, as the real backends do.
    if (value === undefined) {
      this.data.delete(key);
      return;
    }
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }

  keys(): readonly string[] {
    return [...this.data.keys()];
  }
}

function changeSet(
  sessionId: string,
  turnEndedAt: number,
  overrides: Partial<TurnChangeSet> = {},
): TurnChangeSet {
  return {
    sessionId,
    workspaceRoot: '/repo',
    turnStartedAt: turnEndedAt - 10,
    turnEndedAt,
    files: [{ path: 'a.ts', status: 'M', additions: 1, deletions: 2 }],
    truncatedCount: 0,
    totals: { files: 1, additions: 1, deletions: 2 },
    countsUnavailable: false,
    ...overrides,
  };
}

describe('TurnChangeSetStore', () => {
  let storage: MemoryStorage;
  let logger: { warn: jest.Mock };
  let store: TurnChangeSetStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    logger = { warn: jest.fn() };
    store = new TurnChangeSetStore(storage, logger as unknown as Logger);
  });

  it('uses the key ptah.turnChangeSets:<sessionId>', () => {
    expect(turnChangeSetsKey('s1')).toBe('ptah.turnChangeSets:s1');
  });

  it('round-trips appended change sets, oldest first, per session', async () => {
    const first = changeSet('s1', 100, { baselineMissing: true });
    const second = changeSet('s1', 200, {
      files: [
        { path: 'b.ts', origPath: 'a.ts', status: 'R', additions: null, deletions: null },
      ],
      countsUnavailable: true,
    });
    await store.append(first);
    await store.append(second);
    await store.append(changeSet('s2', 300));

    expect(await store.list('s1')).toEqual([first, second]);
    expect(await store.list('s2')).toHaveLength(1);
    expect(storage.keys()).toEqual(
      expect.arrayContaining(['ptah.turnChangeSets:s1', 'ptah.turnChangeSets:s2']),
    );
  });

  it('returns no change sets for an unknown session', async () => {
    expect(await store.list('nobody')).toEqual([]);
  });

  it(`keeps only the most recent ${MAX_CHANGE_SETS_PER_SESSION} per session`, async () => {
    for (let i = 1; i <= MAX_CHANGE_SETS_PER_SESSION + 5; i++) {
      await store.append(changeSet('s1', i));
    }
    const listed = await store.list('s1');
    expect(listed).toHaveLength(MAX_CHANGE_SETS_PER_SESSION);
    expect(listed[0].turnEndedAt).toBe(6);
    expect(listed[listed.length - 1].turnEndedAt).toBe(
      MAX_CHANGE_SETS_PER_SESSION + 5,
    );
  });

  it('keeps every record when appends for one session overlap', async () => {
    await Promise.all([
      store.append(changeSet('s1', 1)),
      store.append(changeSet('s1', 2)),
      store.append(changeSet('s1', 3)),
    ]);
    expect((await store.list('s1')).map((c) => c.turnEndedAt)).toEqual([
      1, 2, 3,
    ]);
  });

  it('rejects when storage fails, and the next append still succeeds', async () => {
    storage.failNextUpdate = true;
    await expect(store.append(changeSet('s1', 1))).rejects.toThrow('disk full');
    await store.append(changeSet('s1', 2));
    expect((await store.list('s1')).map((c) => c.turnEndedAt)).toEqual([2]);
  });

  it('remove deletes only that session\'s key', async () => {
    await store.append(changeSet('s1', 1));
    await store.append(changeSet('s2', 2));

    await store.remove('s1');

    expect(storage.keys()).toEqual(['ptah.turnChangeSets:s2']);
    expect(await store.list('s1')).toEqual([]);
    expect(await store.list('s2')).toHaveLength(1);
  });

  it('remove runs after an in-flight append, so the append cannot re-create the key', async () => {
    const appended = store.append(changeSet('s1', 1));
    const removed = store.remove('s1');
    await Promise.all([appended, removed]);
    expect(storage.keys()).toEqual([]);
  });

  it('remove of an unknown session resolves and writes nothing', async () => {
    await expect(store.remove('nobody')).resolves.toBeUndefined();
    expect(storage.keys()).toEqual([]);
  });

  it('remove rejects when storage fails', async () => {
    await store.append(changeSet('s1', 1));
    storage.failNextUpdate = true;
    await expect(store.remove('s1')).rejects.toThrow('disk full');
  });

  it('treats a malformed stored value as no records and drops bad entries', async () => {
    storage.data.set(turnChangeSetsKey('s1'), 'garbage');
    expect(await store.list('s1')).toEqual([]);

    storage.data.set(turnChangeSetsKey('s2'), {
      schemaVersion: 1,
      changeSets: [changeSet('s2', 1), { sessionId: 's2' }, null],
    });
    expect(await store.list('s2')).toEqual([changeSet('s2', 1)]);

    storage.data.set(turnChangeSetsKey('s3'), {
      schemaVersion: 99,
      changeSets: [changeSet('s3', 1)],
    });
    expect(await store.list('s3')).toEqual([]);
  });

  it('warns with the count of stored records the shape guard drops', async () => {
    storage.data.set(turnChangeSetsKey('s1'), {
      schemaVersion: 1,
      changeSets: [changeSet('s1', 1), { sessionId: 's1' }, null],
    });
    await store.list('s1');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('dropped 2 stored change set(s)');
    expect(logger.warn.mock.calls[0][0]).toContain('sessionId=s1');

    storage.data.set(turnChangeSetsKey('s3'), {
      schemaVersion: 99,
      changeSets: [changeSet('s3', 1), changeSet('s3', 2)],
    });
    await store.list('s3');
    expect(logger.warn.mock.calls[1][0]).toContain('dropped 2 stored change set(s)');
  });

  it('does not warn when nothing is stored or every record is valid', async () => {
    await store.list('nobody');
    await store.append(changeSet('s1', 1));
    await store.list('s1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reads through getAsync when the storage is asynchronous', async () => {
    const stored = { schemaVersion: 1, changeSets: [changeSet('s1', 1)] };
    const asyncStorage = Object.assign(new MemoryStorage(), {
      getAsync: jest.fn(async () => stored),
      readJsonSequence: jest.fn(),
      replaceJsonSequence: jest.fn(),
    });
    const asyncStore = new TurnChangeSetStore(
      asyncStorage,
      logger as unknown as Logger,
    );
    expect(await asyncStore.list('s1')).toEqual(stored.changeSets);
    expect(asyncStorage.getAsync).toHaveBeenCalledWith(
      'ptah.turnChangeSets:s1',
    );
  });
});
