/**
 * SessionHandoffChainStore (TASK_2026_876).
 *
 * A synchronous double has no `getAsync` and no `whenReady`. An async double
 * must not see `get`, and must not see `update` before `whenReady` resolves.
 * A workspace-scoped double must not fall through to the active store.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import {
  HANDOFF_CHAIN_LINK_CAP,
  HANDOFF_CHAIN_STORAGE_KEY,
  SessionHandoffChainStore,
} from './session-handoff-chain.store';

const A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const C = 'cccccccc-dddd-4eee-8fff-000000000000';
const D = 'dddddddd-eeee-4fff-8000-111111111111';

function logger(): Logger {
  return {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function syncStorage(): IStateStorage & {
  snapshot: () => unknown;
  update: jest.Mock<Promise<void>, [string, unknown]>;
} {
  const values = new Map<string, unknown>();
  const get = <T>(key: string): T | undefined =>
    values.get(key) as T | undefined;
  const update = jest.fn(
    async (key: string, value: unknown): Promise<void> => {
      values.set(key, value);
    },
  );
  return {
    get,
    update,
    keys: () => [...values.keys()],
    snapshot: () => values.get(HANDOFF_CHAIN_STORAGE_KEY),
  };
}

describe('SessionHandoffChainStore', () => {
  it('appends an edge and a new instance reads the same document, root first', async () => {
    const storage = syncStorage();
    const log = logger();
    const first = new SessionHandoffChainStore(log, storage);
    await first.append(A, B, '/work/repo/');
    await first.append(B, C, '\\work\\repo');

    const second = new SessionHandoffChainStore(log, storage);
    await expect(second.read(A, '/work/repo')).resolves.toEqual([A, B, C]);
    await expect(second.read(B, '/work/repo')).resolves.toEqual([A, B, C]);
    await expect(second.read(C, '/work/repo')).resolves.toEqual([A, B, C]);
    expect(storage.snapshot()).toEqual({
      schemaVersion: 1,
      links: [
        expect.objectContaining({ fromSessionId: A, toSessionId: B }),
        expect.objectContaining({ fromSessionId: B, toSessionId: C }),
      ],
    });
  });

  it('lists a later hop on every member and a branch by link time', async () => {
    const storage = syncStorage();
    const store = new SessionHandoffChainStore(logger(), storage);
    await store.append(A, B);
    await store.append(B, C);
    await store.append(C, D);
    await expect(store.read(D)).resolves.toEqual([A, B, C, D]);
    await expect(store.read(A)).resolves.toEqual([A, B, C, D]);

    const branch = new SessionHandoffChainStore(logger(), syncStorage());
    const now = Date.now;
    let clock = 1_000;
    Date.now = () => clock;
    try {
      clock = 1;
      await branch.append(A, B);
      clock = 2;
      await branch.append(A, C);
    } finally {
      Date.now = now;
    }
    await expect(branch.read(C)).resolves.toEqual([A, B, C]);
  });

  it('serializes overlapping appends and persists both immutable edges', async () => {
    const storage = syncStorage();
    const original = storage.update.getMockImplementation();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    storage.update.mockImplementationOnce(async (key: string, value: unknown) => {
      await gate;
      await original?.(key, value);
    });
    const store = new SessionHandoffChainStore(logger(), storage);
    const first = store.append(A, B, '/repo');
    await Promise.resolve();
    const second = store.append(B, C, '/repo');
    release();
    await Promise.all([first, second]);
    const fresh = new SessionHandoffChainStore(logger(), storage);
    await expect(fresh.read(A, '/repo')).resolves.toEqual([A, B, C]);
  });

  it('rejects cyclic edges while preserving branches', async () => {
    const store = new SessionHandoffChainStore(logger(), syncStorage());
    await store.append(A, B);
    await store.append(A, C);
    await store.append(B, A);
    await expect(store.read(A)).resolves.toEqual([A, B, C]);
  });

  it('drops cyclic edges from a stored document', async () => {
    const storage = syncStorage();
    await storage.update(HANDOFF_CHAIN_STORAGE_KEY, {
      schemaVersion: 1,
      links: [
        { fromSessionId: A, toSessionId: B, at: 1 },
        { fromSessionId: B, toSessionId: C, at: 2 },
        { fromSessionId: C, toSessionId: A, at: 3 },
      ],
    });
    const store = new SessionHandoffChainStore(logger(), storage);
    await expect(store.read(A)).resolves.toEqual([A, B, C]);
  });

  it('treats a malformed document as empty and keeps a later in-memory edge', async () => {
    const storage = syncStorage();
    await storage.update(HANDOFF_CHAIN_STORAGE_KEY, {
      schemaVersion: 2,
      links: 'nope',
    });
    const log = logger();
    const store = new SessionHandoffChainStore(log, storage);
    await expect(store.read(A)).resolves.toEqual([]);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('rejected'),
      expect.any(Error),
    );

    await store.append(A, B);
    await expect(store.read(B)).resolves.toEqual([A, B]);
    expect(storage.snapshot()).toEqual(
      expect.objectContaining({
        links: [expect.objectContaining({ fromSessionId: A, toSessionId: B })],
      }),
    );
  });

  it('keeps a rejected write in memory and retries it on the next read', async () => {
    const storage = syncStorage();
    storage.update.mockRejectedValueOnce(new Error('disk full'));
    const log = logger();
    const store = new SessionHandoffChainStore(log, storage);
    await expect(store.append(A, B, '/repo')).resolves.toBeUndefined();
    await expect(store.read(A, '/repo')).resolves.toEqual([A, B]);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('remains in memory'),
      expect.any(Error),
    );
    expect(storage.update).toHaveBeenCalledTimes(2);
    expect(storage.snapshot()).toEqual(
      expect.objectContaining({
        links: [expect.objectContaining({ fromSessionId: A, toSessionId: B })],
      }),
    );
  });

  it('does not call get, and does not call update before whenReady', async () => {
    let ready = false;
    let updateBeforeReady = false;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        ready = true;
        resolve();
      };
    });
    const get = jest.fn(() => {
      throw new Error('sync get');
    });
    const update = jest.fn(async () => {
      if (!ready) updateBeforeReady = true;
    });
    const storage = {
      get,
      update,
      keys: () => [],
      getAsync: jest.fn(async () => undefined),
      readJsonSequence: jest.fn(),
      replaceJsonSequence: jest.fn(),
      getReadinessState: () => ({ status: 'not-ready' as const }),
      whenReady: jest.fn(() => gate),
    };
    const store = new SessionHandoffChainStore(
      logger(),
      storage as unknown as IStateStorage,
    );
    const pending = store.append(A, B, '/repo');
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    release();
    await pending;
    expect(updateBeforeReady).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(storage.getAsync).toHaveBeenCalledWith(HANDOFF_CHAIN_STORAGE_KEY);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('keeps a whenReady rejection in memory and does not call update', async () => {
    const update = jest.fn();
    const storage = {
      get: jest.fn(() => {
        throw new Error('sync get');
      }),
      update,
      keys: () => [],
      getAsync: jest.fn(async () => undefined),
      readJsonSequence: jest.fn(),
      replaceJsonSequence: jest.fn(),
      getReadinessState: () => ({
        status: 'recovery-required' as const,
        reason: 'manifest-invalid' as const,
      }),
      whenReady: jest.fn(async () => {
        throw new Error('recovery-required');
      }),
    };
    const store = new SessionHandoffChainStore(
      logger(),
      storage as unknown as IStateStorage,
    );
    await store.append(A, B);
    await expect(store.read(B)).resolves.toEqual([A, B]);
    expect(update).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('does not write workspace A into workspace B or the active store when A has no scope', async () => {
    const active = syncStorage();
    const workspaceB = syncStorage();
    const scoped = {
      get: active.get,
      update: active.update,
      keys: active.keys,
      getStorageForWorkspace: jest.fn((path: string) =>
        path === '/b' ? workspaceB : undefined,
      ),
      getAllWorkspacePaths: () => ['/b'],
    };
    const store = new SessionHandoffChainStore(
      logger(),
      scoped as unknown as IStateStorage,
    );
    await store.append(A, B, '/a');
    await expect(store.read(A, '/b')).resolves.toEqual([]);
    await expect(store.read(B, '/a')).resolves.toEqual([A, B]);
    expect(active.update).not.toHaveBeenCalled();
    expect(workspaceB.update).not.toHaveBeenCalled();
  });

  it('ignores a duplicate pair, rejects a bad id, and drops the oldest link once', async () => {
    const storage = syncStorage();
    const log = logger();
    const store = new SessionHandoffChainStore(log, storage);
    const seen: string[] = [];
    store.onLinkWritten((link) => {
      seen.push(link.toSessionId);
      if (link.toSessionId === B) throw new Error('listener blew up');
    });
    await store.append(A, B);
    await store.append(A, B);
    await store.append('not-a-uuid', B);
    expect(seen).toEqual([B]);
    expect(storage.update).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('listener failed'),
      expect.any(Error),
    );

    const ids = Array.from({ length: HANDOFF_CHAIN_LINK_CAP + 2 }, (_, index) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    );
    const capped = new SessionHandoffChainStore(log, syncStorage());
    for (let index = 0; index < ids.length - 1; index++) {
      const from = ids[index];
      const to = ids[index + 1];
      if (!from || !to) throw new Error('id');
      await capped.append(from, to);
    }
    const newest = ids[ids.length - 1];
    const oldest = ids[0];
    if (!newest || !oldest) throw new Error('id');
    await expect(capped.read(newest)).resolves.not.toContain(oldest);
    await expect(capped.read(newest)).resolves.toContain(newest);
    const capLogs = (log.warn as jest.Mock).mock.calls.filter(([message]) =>
      String(message).includes('oldest'),
    );
    expect(capLogs).toHaveLength(1);
  });
});
