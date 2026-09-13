import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  StateStorageCursorStaleError,
  StateStorageNotReadyError,
  StateStorageValueTooLargeError,
  hasStateStorageMaintenance,
  type IAsyncStateStorage,
  type IStateStorageMaintenance,
  type IStateStorageReadiness,
  type StateStorageArraySplitPlan,
  type StateStorageGetOptions,
  type StateStorageMigrationReceipt,
  type StateStorageReadinessState,
  type StateStorageSequencePage,
  type StateStorageSequenceReadOptions,
} from '@ptah-extension/platform-core';
import { WorkspaceAwareStateStorage } from './workspace-aware-state-storage';
import { WorkspaceContextManager } from './workspace-context-manager';

class ControlledStorage implements IStateStorageReadiness {
  private readonly data = new Map<string, unknown>();
  private state: StateStorageReadinessState;
  private resolveReady: (() => void) | null = null;
  private readonly ready: Promise<void>;

  constructor(isReady: boolean, entries: Record<string, unknown> = {}) {
    this.state = isReady ? { status: 'ready' } : { status: 'not-ready' };
    for (const [key, value] of Object.entries(entries))
      this.data.set(key, value);
    this.ready = isReady
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          this.resolveReady = resolve;
        });
  }

  markReady(): void {
    this.state = { status: 'ready' };
    this.resolveReady?.();
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }

  keys(): readonly string[] {
    if (this.state.status !== 'ready') throw new StateStorageNotReadyError();
    return [...this.data.keys()];
  }

  getReadinessState(): StateStorageReadinessState {
    return this.state;
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('WorkspaceAwareStateStorage readiness routing', () => {
  it('does not publish an unready delegate or fall back from it to default', async () => {
    const storages = new Map<string, ControlledStorage>();
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(storagePath === '/default', {
        source: storagePath,
      });
      storages.set(storagePath, storage);
      return storage;
    });
    proxy.addWorkspace('/workspace-a', '/storage-a');

    expect(() => proxy.setActiveWorkspace('/workspace-a')).toThrow(
      StateStorageNotReadyError,
    );
    expect(proxy.get('source')).toBe('/default');
    expect(proxy.getActiveWorkspacePath()).toBeNull();

    storages.get('/storage-a')?.markReady();
    await proxy.whenWorkspaceReady('/workspace-a');
    proxy.setActiveWorkspace('/workspace-a');
    expect(proxy.get('source')).toBe('/storage-a');
  });

  it('keeps the old workspace active until an async switch is ready', async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ptah-workspace-switch-'),
    );
    tmpDirs.push(root);
    const workspaceA = path.join(root, 'a');
    const workspaceB = path.join(root, 'b');
    await fs.mkdir(workspaceA);
    await fs.mkdir(workspaceB);

    const proxy = new WorkspaceAwareStateStorage(
      path.join(root, 'default-storage'),
      (storagePath) => {
        const storage = new ControlledStorage(
          storagePath.endsWith('default-storage'),
        );
        return storage;
      },
    );
    const manager = new WorkspaceContextManager(root, proxy);
    await manager.createWorkspace(workspaceA);
    const storageA = proxy.getStorageForWorkspace(
      path.resolve(workspaceA),
    ) as ControlledStorage;
    storageA.markReady();
    await manager.switchWorkspace(workspaceA);
    await proxy.update('owner', 'a');

    await manager.createWorkspace(workspaceB);
    const storageB = proxy.getStorageForWorkspace(
      path.resolve(workspaceB),
    ) as ControlledStorage;
    const switching = manager.switchWorkspace(workspaceB);
    await Promise.resolve();

    expect(manager.getActiveWorkspacePath()).toBe(path.resolve(workspaceA));
    await proxy.update('during-switch', 'a-only');
    expect(storageA.get('during-switch')).toBe('a-only');
    expect(() => storageB.get('during-switch')).toThrow(
      StateStorageNotReadyError,
    );

    storageB.markReady();
    await switching;
    expect(manager.getActiveWorkspacePath()).toBe(path.resolve(workspaceB));
    expect(proxy.get('owner')).toBeUndefined();
  });

  it('disposes a worker-backed delegate when its workspace is removed', () => {
    const dispose = jest.fn();
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(true) as ControlledStorage & {
        dispose?: () => void;
      };
      if (storagePath === '/worker-storage') storage.dispose = dispose;
      return storage;
    });
    proxy.addWorkspace('/workspace', '/worker-storage');

    proxy.removeWorkspace('/workspace');

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('forwards splitArrayValue to the active workspace delegate when maintenance is supported', async () => {
    const mockReceipt: StateStorageMigrationReceipt = {
      sourceKey: 'records',
      sourceSha256: 'abc',
      itemCount: 1,
      extractedValueCount: 1,
      droppedStdoutCount: 0,
      stdoutFallbackCount: 0,
      droppedBulkWithoutIdCount: 0,
      skippedItemCount: 0,
      committedGeneration: 2,
      commitId: 'commit-1',
    };
    const splitFn = jest.fn().mockResolvedValue(mockReceipt);
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(true) as ControlledStorage &
        Partial<IStateStorageMaintenance>;
      if (storagePath === '/maintenance-storage') {
        storage.splitArrayValue = splitFn;
      }
      return storage;
    });

    expect(hasStateStorageMaintenance(proxy)).toBe(true);

    proxy.addWorkspace('/workspace-m', '/maintenance-storage');
    proxy.setActiveWorkspace('/workspace-m');

    const plan: StateStorageArraySplitPlan = {
      kind: 'split-array-value',
      planVersion: 1,
      sourceKey: 'records',
      itemIdPath: ['id'],
      detailKeyPrefix: 'detail:',
      indexKey: 'records',
      indexSchemaVersion: 1,
      summaryFields: [{ sourcePath: ['id'] }],
    };

    const receipt = await proxy.splitArrayValue(plan);
    expect(receipt).toEqual(mockReceipt);
    expect(splitFn).toHaveBeenCalledWith(plan);
  });

  it('forwards getAsync options unchanged to an async delegate', async () => {
    const getAsync = jest.fn().mockResolvedValue({ id: 'detail' });
    const proxy = new WorkspaceAwareStateStorage('/default', (storagePath) => {
      const storage = new ControlledStorage(true) as ControlledStorage &
        Partial<IAsyncStateStorage>;
      if (storagePath === '/async-storage') {
        storage.getAsync = getAsync;
        storage.readJsonSequence = jest.fn();
        storage.replaceJsonSequence = jest.fn();
      }
      return storage;
    });
    proxy.addWorkspace('/workspace-async', '/async-storage');
    proxy.setActiveWorkspace('/workspace-async');

    const options: StateStorageGetOptions = {
      projection: { omit: [['cliSessions', '*', 'stdout']] },
    };
    const fallback = { id: 'fallback' };

    await expect(proxy.getAsync('detail', fallback, options)).resolves.toEqual({
      id: 'detail',
    });
    expect(getAsync).toHaveBeenCalledTimes(1);
    expect(getAsync.mock.calls[0][0]).toBe('detail');
    expect(getAsync.mock.calls[0][1]).toBe(fallback);
    expect(getAsync.mock.calls[0][2]).toBe(options);
  });

  it('applies the projection in memory when the delegate is synchronous', async () => {
    const stored = {
      id: 'detail',
      cliSessions: [{ agentId: 'a1', stdout: 'bulk', segments: [1] }],
    };
    const proxy = new WorkspaceAwareStateStorage(
      '/default',
      () => new ControlledStorage(true, { detail: stored }),
    );

    const result = await proxy.getAsync<typeof stored>('detail', undefined, {
      projection: {
        omit: [
          ['cliSessions', '*', 'stdout'],
          ['cliSessions', '*', 'segments'],
        ],
      },
    });

    expect(result).toEqual({ id: 'detail', cliSessions: [{ agentId: 'a1' }] });
    expect(stored.cliSessions[0].stdout).toBe('bulk');
    await expect(proxy.getAsync('detail')).resolves.toBe(stored);
  });

  it('throws when the active delegate does not support maintenance operations', async () => {
    const proxy = new WorkspaceAwareStateStorage('/default', () => {
      return new ControlledStorage(true);
    });

    const plan: StateStorageArraySplitPlan = {
      kind: 'split-array-value',
      planVersion: 1,
      sourceKey: 'records',
      itemIdPath: ['id'],
      detailKeyPrefix: 'detail:',
      indexKey: 'records',
      indexSchemaVersion: 1,
      summaryFields: [{ sourcePath: ['id'] }],
    };

    await expect(proxy.splitArrayValue(plan)).rejects.toThrow(
      'Active workspace state storage does not support maintenance operations',
    );
  });
});

describe('WorkspaceAwareStateStorage sync sequence reads', () => {
  type Item = { tag: string; value: { type: string; content: string } };

  function item(content: string): Item {
    return { tag: 'segment', value: { type: 'text', content } };
  }

  function proxyOver(entries: Record<string, unknown>): {
    proxy: WorkspaceAwareStateStorage;
    delegate: ControlledStorage;
  } {
    const delegate = new ControlledStorage(true, entries);
    return {
      proxy: new WorkspaceAwareStateStorage('/default', () => delegate),
      delegate,
    };
  }

  async function firstPage<T>(
    proxy: WorkspaceAwareStateStorage,
    key: string,
    options?: StateStorageSequenceReadOptions,
  ): Promise<StateStorageSequencePage<T>> {
    const sequence = proxy.readJsonSequence<T>(key, options);
    const pages = sequence[Symbol.asyncIterator]();
    try {
      const first = await pages.next();
      if (first.done) throw new Error('no page');
      return first.value;
    } finally {
      await pages.return?.(undefined);
    }
  }

  it('pages a sequence under both budgets and continues from the cursor', async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      item(`${i}${'x'.repeat(80)}`),
    );
    const { proxy } = proxyOver({ output: items });
    const options = {
      maxBytes: 4096,
      maxJsonBytes: 400,
      jsonEnvelopeBytes: 50,
    };

    const received: Item[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await firstPage<Item>(proxy, 'output', {
        ...options,
        cursor,
      });
      expect(page.items.length).toBeGreaterThan(0);
      expect(
        options.jsonEnvelopeBytes -
          2 +
          Buffer.byteLength(JSON.stringify(page.items), 'utf8'),
      ).toBeLessThanOrEqual(options.maxJsonBytes);
      expect(page.truncatedItems).toBeUndefined();
      received.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);

    expect(pages).toBeGreaterThan(1);
    expect(received).toEqual(items);

    const all: Item[] = [];
    for await (const page of proxy.readJsonSequence<Item>('output', options)) {
      all.push(...page.items);
    }
    expect(all).toEqual(items);
  });

  it('shrinks a single oversized item and reports it page-relative', async () => {
    const big = item('y'.repeat(5_000));
    const { proxy } = proxyOver({ output: [item('small'), big, item('tail')] });
    const options = { maxBytes: 1024, maxJsonBytes: 1024, maxItemBytes: 900 };

    const first = await firstPage<Item>(proxy, 'output', options);
    expect(first.items).toEqual([item('small')]);
    const second = await firstPage<Item>(proxy, 'output', {
      ...options,
      cursor: first.nextCursor ?? undefined,
    });

    expect(second.items).toHaveLength(1);
    expect(second.truncatedItems).toEqual([
      {
        index: 0,
        originalJsonBytes: Buffer.byteLength(JSON.stringify(big), 'utf8'),
      },
    ]);
    expect(second.items[0].value.content).toMatch(/\[truncated \d+ bytes\]$/);
    expect(
      Buffer.byteLength(JSON.stringify(second.items[0]), 'utf8'),
    ).toBeLessThanOrEqual(900);
    const third = await firstPage<Item>(proxy, 'output', {
      ...options,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third).toMatchObject({
      items: [item('tail')],
      nextCursor: null,
      done: true,
    });
  });

  it('fails an item that cannot be shrunk with StateStorageValueTooLargeError', async () => {
    const { proxy } = proxyOver({
      output: [{ values: Array.from({ length: 400 }, (_, i) => i) }],
    });

    await expect(
      firstPage(proxy, 'output', { maxBytes: 256, maxJsonBytes: 256 }),
    ).rejects.toBeInstanceOf(StateStorageValueTooLargeError);
  });

  it('rejects malformed, rewritten, out-of-range and absent-key cursors as stale', async () => {
    const items = Array.from({ length: 6 }, (_, i) => item(`${i}`.repeat(60)));
    const { proxy, delegate } = proxyOver({ output: items });
    const first = await firstPage<Item>(proxy, 'output', { maxJsonBytes: 200 });
    const cursor = first.nextCursor ?? '';
    expect(cursor).toMatch(/^s[0-9a-f]{16}\.\d+$/);

    await expect(
      firstPage(proxy, 'output', { cursor: 'garbage' }),
    ).rejects.toBeInstanceOf(StateStorageCursorStaleError);
    await expect(
      firstPage(proxy, 'output', { cursor: cursor.replace(/\.\d+$/, '.99') }),
    ).rejects.toBeInstanceOf(StateStorageCursorStaleError);

    await delegate.update('output', [...items, item('appended')]);
    await expect(firstPage(proxy, 'output', { cursor })).rejects.toBeInstanceOf(
      StateStorageCursorStaleError,
    );

    await delegate.update('output', undefined);
    await expect(firstPage(proxy, 'output', { cursor })).rejects.toBeInstanceOf(
      StateStorageCursorStaleError,
    );
    await expect(firstPage(proxy, 'output')).resolves.toMatchObject({
      items: [],
      nextCursor: null,
      done: true,
    });
  });

  it('refuses a value that is not a sequence', async () => {
    const { proxy } = proxyOver({ output: { segments: [] } });

    await expect(firstPage(proxy, 'output')).rejects.toThrow(
      'State storage value is not a sequence',
    );
  });
});
