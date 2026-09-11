import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StateStorageNotReadyError } from '@ptah-extension/platform-core';
import { ElectronStateStorage } from './electron-state-storage';
import {
  extractLargeStrings,
  type ElectronStateWorkerFactory,
  type ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import {
  ElectronStateWorkerProtocolError,
  assertElectronStateWorkerPayloadWithinBudget,
  parseElectronStateWorkerRequest,
} from './electron-state-storage-worker-protocol';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});

type MessageListener = (value: unknown) => void;
type ErrorListener = (error: Error) => void;
type ExitListener = (code: number) => void;

class InProcessWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];

  constructor(private readonly postedMessages: unknown[]) {}

  postMessage(value: unknown): void {
    assertElectronStateWorkerPayloadWithinBudget(value);
    this.postedMessages.push(value);
    queueMicrotask(() => {
      void this.runtime
        .handle(parseElectronStateWorkerRequest(value))
        .then((response) => {
          assertElectronStateWorkerPayloadWithinBudget(response);
          this.messageListeners.forEach((listener) => listener(response));
        })
        .catch((error: unknown) => {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          this.errorListeners.forEach((listener) => listener(normalized));
        });
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'message')
      this.messageListeners.push(listener as MessageListener);
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    if (event === 'exit') this.exitListeners.push(listener as ExitListener);
    return this;
  }

  async terminate(): Promise<number> {
    this.exitListeners.forEach((listener) => listener(0));
    return 0;
  }
}

class CrashOnFirstMessageWorker implements ElectronStateWorkerLike {
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];

  postMessage(): void {
    queueMicrotask(() => {
      this.errorListeners.forEach((listener) =>
        listener(new Error('injected worker crash')),
      );
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    if (event === 'exit') this.exitListeners.push(listener as ExitListener);
    return this;
  }

  async terminate(): Promise<number> {
    setTimeout(() => {
      this.exitListeners.forEach((listener) => listener(1));
    }, 0);
    return 1;
  }
}

class CrashAfterFirstMutationWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];

  postMessage(value: unknown): void {
    queueMicrotask(() => {
      const request = parseElectronStateWorkerRequest(value);
      void this.runtime.handle(request).then((response) => {
        if (request.type === 'update') {
          this.errorListeners.forEach((listener) =>
            listener(new Error('crash after durable mutation')),
          );
          return;
        }
        this.messageListeners.forEach((listener) => listener(response));
      });
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'message')
      this.messageListeners.push(listener as MessageListener);
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    return this;
  }

  async terminate(): Promise<number> {
    return 1;
  }
}

class CrashDuringSequenceWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];
  private appendCount = 0;

  constructor(
    private readonly crashOnAppendIndex: number,
    private readonly postedMessages: unknown[],
  ) {}

  postMessage(value: unknown): void {
    assertElectronStateWorkerPayloadWithinBudget(value);
    this.postedMessages.push(value);
    queueMicrotask(() => {
      try {
        const request = parseElectronStateWorkerRequest(value);
        if (request.type === 'append-json-sequence-items') {
          this.appendCount++;
          if (this.appendCount === this.crashOnAppendIndex) {
            this.errorListeners.forEach((listener) =>
              listener(new Error('crash during sequence streaming')),
            );
            return;
          }
        }
        void this.runtime.handle(request).then((response) => {
          assertElectronStateWorkerPayloadWithinBudget(response);
          this.messageListeners.forEach((listener) => listener(response));
        });
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.errorListeners.forEach((listener) => listener(normalized));
      }
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'message')
      this.messageListeners.push(listener as MessageListener);
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    if (event === 'exit') this.exitListeners.push(listener as ExitListener);
    return this;
  }

  async terminate(): Promise<number> {
    this.exitListeners.forEach((listener) => listener(1));
    return 1;
  }
}

class CrashOnFirstScalarPageWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];
  private crashed = false;

  constructor(
    private readonly postedMessages: unknown[],
    private readonly shouldCrash: boolean = true,
  ) {}

  postMessage(value: unknown): void {
    assertElectronStateWorkerPayloadWithinBudget(value);
    this.postedMessages.push(value);
    queueMicrotask(() => {
      try {
        const request = parseElectronStateWorkerRequest(value);
        if (
          this.shouldCrash &&
          !this.crashed &&
          request.type === 'append-scalar-write-page'
        ) {
          this.crashed = true;
          this.errorListeners.forEach((listener) =>
            listener(new Error('crash during scalar write')),
          );
          return;
        }
        void this.runtime.handle(request).then((response) => {
          assertElectronStateWorkerPayloadWithinBudget(response);
          this.messageListeners.forEach((listener) => listener(response));
        });
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.errorListeners.forEach((listener) => listener(normalized));
      }
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'message')
      this.messageListeners.push(listener as MessageListener);
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    if (event === 'exit') this.exitListeners.push(listener as ExitListener);
    return this;
  }

  async terminate(): Promise<number> {
    this.exitListeners.forEach((listener) => listener(1));
    return 1;
  }
}

class CrashOnSequenceSliceWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];
  private crashed = false;

  constructor(
    private readonly postedMessages: unknown[],
    private readonly shouldCrash: boolean = true,
  ) {}

  postMessage(value: unknown): void {
    assertElectronStateWorkerPayloadWithinBudget(value);
    this.postedMessages.push(value);
    queueMicrotask(() => {
      try {
        const request = parseElectronStateWorkerRequest(value);
        if (
          this.shouldCrash &&
          !this.crashed &&
          request.type === 'append-json-string-slice'
        ) {
          this.crashed = true;
          this.errorListeners.forEach((listener) =>
            listener(new Error('crash during sequence string slice streaming')),
          );
          return;
        }
        void this.runtime.handle(request).then((response) => {
          assertElectronStateWorkerPayloadWithinBudget(response);
          this.messageListeners.forEach((listener) => listener(response));
        });
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.errorListeners.forEach((listener) => listener(normalized));
      }
    });
  }

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'exit', listener: ExitListener): this;
  on(
    event: 'message' | 'error' | 'exit',
    listener: MessageListener | ErrorListener | ExitListener,
  ): this {
    if (event === 'message')
      this.messageListeners.push(listener as MessageListener);
    if (event === 'error') this.errorListeners.push(listener as ErrorListener);
    if (event === 'exit') this.exitListeners.push(listener as ExitListener);
    return this;
  }

  async terminate(): Promise<number> {
    this.exitListeners.forEach((listener) => listener(1));
    return 1;
  }
}

const tmpDirs: string[] = [];

async function makeFixture(value: unknown): Promise<{
  dir: string;
  legacyPath: string;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-worker-host-'));
  tmpDirs.push(dir);
  const legacyPath = path.join(dir, 'workspace-state.json');
  await fs.writeFile(legacyPath, JSON.stringify(value), 'utf8');
  return { dir, legacyPath };
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('ElectronStateStorage worker host', () => {
  it('is not ready synchronously and hydrates large arrays/strings in bounded messages', async () => {
    const longText = 'é'.repeat(90_000);
    const items = Array.from({ length: 4_000 }, (_, index) => ({
      index,
      text: index === 3999 ? longText : `item-${index}`,
    }));
    const { dir } = await makeFixture({ items });
    const postedMessages: unknown[] = [];
    const factory: ElectronStateWorkerFactory = () =>
      new InProcessWorker(postedMessages);
    const parse = jest.spyOn(JSON, 'parse');
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });

    expect(fsSync.readFileSync).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();

    expect(() => storage.get('items')).toThrow(StateStorageNotReadyError);
    expect(() => storage.keys()).toThrow(StateStorageNotReadyError);
    await expect(storage.update('unsafe-default', true)).rejects.toBeInstanceOf(
      StateStorageNotReadyError,
    );
    await storage.whenReady();

    expect(storage.get<typeof items>('items')).toEqual(items);
    expect(storage.get('unsafe-default')).toBeUndefined();
    for (const message of postedMessages) {
      expect(() =>
        assertElectronStateWorkerPayloadWithinBudget(message),
      ).not.toThrow();
    }
    await storage.dispose();
  });

  it('writes a sequence with transferable string slices and survives restart', async () => {
    const { dir } = await makeFixture({ values: [] });
    const postedMessages: unknown[] = [];
    const factory: ElectronStateWorkerFactory = () =>
      new InProcessWorker(postedMessages);
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await storage.whenReady();
    const expected = [{ id: 'one', output: 'x'.repeat(100_000) }];
    await storage.update('values', expected);
    await storage.dispose();

    const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await restarted.whenReady();
    expect(restarted.get('values')).toEqual(expected);
    expect(
      postedMessages.some(
        (message) =>
          (message as { type?: string }).type === 'append-json-string-slice',
      ),
    ).toBe(true);
    await restarted.dispose();
  });

  it('restarts once when the worker crashes during initialization', async () => {
    const { dir } = await makeFixture({ value: 'safe' });
    let created = 0;
    const factory: ElectronStateWorkerFactory = () => {
      created++;
      return created === 1
        ? new CrashOnFirstMessageWorker()
        : new InProcessWorker([]);
    };
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
      maxRestartAttempts: 1,
    });

    await expect(storage.whenReady()).resolves.toBeUndefined();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(storage.get('value')).toBe('safe');
    expect(created).toBe(2);
    await storage.dispose();
  });

  it('reinitializes and safely retries when a worker exits after committing a mutation', async () => {
    const { dir } = await makeFixture({ value: 'before' });
    let created = 0;
    const factory: ElectronStateWorkerFactory = () => {
      created++;
      return created === 1
        ? new CrashAfterFirstMutationWorker()
        : new InProcessWorker([]);
    };
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
      maxRestartAttempts: 1,
    });
    await storage.whenReady();

    await expect(storage.update('value', 'after')).resolves.toBeUndefined();
    expect(storage.get('value')).toBe('after');
    expect(created).toBe(2);
    await storage.dispose();
  });

  it('executes a generic array split before publishing readiness', async () => {
    const { dir } = await makeFixture({
      records: [
        { id: 'a', title: 'Alpha', nested: [{ id: 'n1', output: [1, 2] }] },
      ],
    });
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
      migrations: [
        {
          kind: 'split-array-value',
          planVersion: 1,
          sourceKey: 'records',
          itemIdPath: ['id'],
          detailKeyPrefix: 'detail:',
          indexKey: 'records',
          indexSchemaVersion: 1,
          summaryFields: [{ sourcePath: ['id'] }, { sourcePath: ['title'] }],
          nestedExtractions: [
            {
              sourceArrayPath: ['nested'],
              itemIdPath: ['id'],
              destinationKeyPrefix: 'output:',
              fields: [{ sourcePath: ['output'] }],
              onMissingId: 'retain-source',
              conflictPolicy: {
                kind: 'prefer-longer-arrays',
                fields: ['output'],
              },
            },
          ],
        },
      ],
    });

    await storage.whenReady();
    expect(storage.get('records')).toEqual({
      schemaVersion: 1,
      items: [{ id: 'a', title: 'Alpha' }],
    });
    expect(storage.get('output:n1')).toEqual({ output: [1, 2] });
    expect(storage.get<{ nested: unknown[] }>('detail:a')?.nested).toEqual([
      { id: 'n1' },
    ]);
    const current = JSON.parse(
      await fs.readFile(
        path.join(dir, 'workspace-state.v2', 'CURRENT'),
        'utf8',
      ),
    ) as { mutationEpoch: number };
    expect(current.mutationEpoch).toBe(0);
    await storage.dispose();
  });

  it('keeps excluded split details and output off the main thread cache', async () => {
    const { dir } = await makeFixture({
      records: [
        { id: 'a', title: 'Alpha', nested: [{ id: 'n1', output: [1, 2] }] },
      ],
    });
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
      cacheExcludeKeyPrefixes: ['detail:', 'output:'],
      migrations: [
        {
          kind: 'split-array-value',
          planVersion: 1,
          sourceKey: 'records',
          itemIdPath: ['id'],
          detailKeyPrefix: 'detail:',
          indexKey: 'records',
          indexSchemaVersion: 1,
          summaryFields: [{ sourcePath: ['id'] }, { sourcePath: ['title'] }],
          nestedExtractions: [
            {
              sourceArrayPath: ['nested'],
              itemIdPath: ['id'],
              destinationKeyPrefix: 'output:',
              fields: [{ sourcePath: ['output'] }],
              destinationFormat: {
                kind: 'tagged-sequence',
                fields: [{ sourcePath: ['output'], tag: 'output' }],
              },
              onMissingId: 'retain-source',
              conflictPolicy: {
                kind: 'prefer-longer-arrays',
                fields: ['output'],
              },
            },
          ],
        },
      ],
    });

    await storage.whenReady();
    expect(storage.get('records')).toEqual({
      schemaVersion: 1,
      items: [{ id: 'a', title: 'Alpha' }],
    });
    expect(storage.get('detail:a')).toBeUndefined();
    expect(storage.get('output:n1')).toBeUndefined();
    await expect(storage.getAsync('detail:a')).resolves.toEqual({
      id: 'a',
      title: 'Alpha',
      nested: [{ id: 'n1' }],
    });
    const pages = [];
    for await (const page of storage.readJsonSequence('output:n1', {
      maxBytes: 1024,
    })) {
      pages.push(...page.items);
    }
    expect(pages).toEqual([
      { tag: 'output', value: 1 },
      { tag: 'output', value: 2 },
    ]);
    await storage.dispose();
  });

  it('retains nested items with missing or blank ids in the source detail during split', async () => {
    const { dir } = await makeFixture({
      records: [
        {
          id: 'a',
          title: 'Alpha',
          nested: [
            { id: 'n1', output: [1, 2] },
            { id: '', output: [3, 4] },
            { output: [5, 6] },
          ],
        },
      ],
    });
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
      migrations: [
        {
          kind: 'split-array-value',
          planVersion: 1,
          sourceKey: 'records',
          itemIdPath: ['id'],
          detailKeyPrefix: 'detail:',
          indexKey: 'records',
          indexSchemaVersion: 1,
          summaryFields: [{ sourcePath: ['id'] }, { sourcePath: ['title'] }],
          nestedExtractions: [
            {
              sourceArrayPath: ['nested'],
              itemIdPath: ['id'],
              destinationKeyPrefix: 'output:',
              fields: [{ sourcePath: ['output'] }],
              onMissingId: 'retain-source',
              conflictPolicy: {
                kind: 'prefer-longer-arrays',
                fields: ['output'],
              },
            },
          ],
        },
      ],
    });

    await storage.whenReady();
    expect(storage.get('records')).toEqual({
      schemaVersion: 1,
      items: [{ id: 'a', title: 'Alpha' }],
    });
    expect(storage.get('output:n1')).toEqual({ output: [1, 2] });
    expect(storage.get('output:')).toBeUndefined();
    const detail = storage.get<{ nested: unknown[] }>('detail:a');
    expect(detail?.nested).toEqual([
      { id: 'n1' },
      { id: '', output: [3, 4] },
      { output: [5, 6] },
    ]);
    await storage.dispose();
  });

  it('fails closed when a split source item has no usable id', async () => {
    const { dir } = await makeFixture({
      records: [{ id: '', title: 'Missing ID' }],
    });
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
      migrations: [
        {
          kind: 'split-array-value',
          planVersion: 1,
          sourceKey: 'records',
          itemIdPath: ['id'],
          detailKeyPrefix: 'detail:',
          indexKey: 'records',
          indexSchemaVersion: 1,
          summaryFields: [{ sourcePath: ['id'] }],
        },
      ],
    });

    await expect(storage.whenReady()).rejects.toThrow();
    await storage.dispose();
  });

  it('aborts sequence write on worker crash without committing suffix and allows subsequent full retry', async () => {
    const { dir } = await makeFixture({ seq: [{ id: 'initial-1' }] });
    const receivedMessages: unknown[] = [];
    let workerCount = 0;
    const factory: ElectronStateWorkerFactory = () => {
      workerCount++;
      return workerCount === 1
        ? new CrashDuringSequenceWorker(2, receivedMessages)
        : new InProcessWorker(receivedMessages);
    };

    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
      maxRestartAttempts: 1,
    });
    await storage.whenReady();

    let yieldedCount = 0;
    async function* makeChunks() {
      yieldedCount++;
      yield { items: [{ id: 'item-1' }] };
      yieldedCount++;
      yield { items: [{ id: 'item-2' }] };
      yieldedCount++;
      yield { items: [{ id: 'item-3' }] };
    }

    // Must reject due to worker crash on item 2
    await expect(
      storage.replaceJsonSequence('seq', makeChunks()),
    ).rejects.toThrow();

    // Verify worker crashed and iterator was NOT consumed past crash
    expect(yieldedCount).toBe(2);

    // Suffix must NOT be committed: read sequence back through storage (which uses a fresh worker)
    const itemsAfterCrash: unknown[] = [];
    for await (const page of storage.readJsonSequence('seq')) {
      itemsAfterCrash.push(...page.items);
    }
    expect(itemsAfterCrash).toEqual([{ id: 'initial-1' }]);

    // Retry with a fresh complete iterable
    async function* makeFreshChunks() {
      yield { items: [{ id: 'item-1' }] };
      yield { items: [{ id: 'item-2' }] };
      yield { items: [{ id: 'item-3' }] };
    }
    await expect(
      storage.replaceJsonSequence('seq', makeFreshChunks()),
    ).resolves.toBeUndefined();

    const itemsAfterRetry: unknown[] = [];
    for await (const page of storage.readJsonSequence('seq')) {
      itemsAfterRetry.push(...page.items);
    }
    expect(itemsAfterRetry).toEqual([
      { id: 'item-1' },
      { id: 'item-2' },
      { id: 'item-3' },
    ]);

    await storage.dispose();
  });

  it('round-trips an oversize scalar string > 256 KiB within protocol message budget and survives restart', async () => {
    const { dir } = await makeFixture({});
    const postedMessages: unknown[] = [];
    const factory: ElectronStateWorkerFactory = () =>
      new InProcessWorker(postedMessages);
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await storage.whenReady();

    // Multi-byte UTF-8 string well above 256 KiB
    const largeString = 'Hello-🌍-世界-'.repeat(25_000);
    expect(Buffer.byteLength(largeString, 'utf8')).toBeGreaterThan(256 * 1024);

    await storage.update('doc', largeString);
    expect(storage.get('doc')).toBe(largeString);

    // Verify all messages stayed strictly within budget
    expect(postedMessages.length).toBeGreaterThan(0);
    for (const msg of postedMessages) {
      expect(() =>
        assertElectronStateWorkerPayloadWithinBudget(msg),
      ).not.toThrow();
    }
    expect(
      postedMessages.some(
        (m) => (m as { type?: string }).type === 'begin-scalar-write',
      ),
    ).toBe(true);
    expect(
      postedMessages.some(
        (m) => (m as { type?: string }).type === 'append-scalar-write-page',
      ),
    ).toBe(true);
    expect(
      postedMessages.some(
        (m) => (m as { type?: string }).type === 'commit-scalar-write',
      ),
    ).toBe(true);

    await storage.dispose();

    // Restart and verify durable hydration
    const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await restarted.whenReady();
    expect(restarted.get('doc')).toBe(largeString);
    await restarted.dispose();
  });

  it('round-trips an oversize plain object > 256 KiB within protocol message budget and survives restart', async () => {
    const { dir } = await makeFixture({});
    const postedMessages: unknown[] = [];
    const factory: ElectronStateWorkerFactory = () =>
      new InProcessWorker(postedMessages);
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await storage.whenReady();

    // Large object with 1,500 properties, total size > 300 KiB
    const largeObject: Record<
      string,
      { id: number; title: string; meta: { ok: boolean; desc: string } }
    > = {};
    for (let i = 0; i < 2500; i++) {
      largeObject[`item_${i}`] = {
        id: i,
        title: `Entity number ${i} with extra text padding to ensure payload size`,
        meta: { ok: i % 2 === 0, desc: `Description for entity ${i}` },
      };
    }
    expect(
      Buffer.byteLength(JSON.stringify(largeObject), 'utf8'),
    ).toBeGreaterThan(256 * 1024);

    await storage.update('catalog', largeObject);
    expect(storage.get('catalog')).toEqual(largeObject);

    // Verify all messages stayed strictly within budget
    for (const msg of postedMessages) {
      expect(() =>
        assertElectronStateWorkerPayloadWithinBudget(msg),
      ).not.toThrow();
    }
    expect(
      postedMessages.some(
        (m) => (m as { type?: string }).type === 'append-scalar-write-page',
      ),
    ).toBe(true);

    await storage.dispose();

    const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
    });
    await restarted.whenReady();
    expect(restarted.get('catalog')).toEqual(largeObject);
    await restarted.dispose();
  });

  it('safely restarts and retries a large scalar write when worker crashes during page streaming', async () => {
    const { dir } = await makeFixture({ doc: 'prior' });
    let created = 0;
    const factory: ElectronStateWorkerFactory = () => {
      created++;
      return created === 1
        ? new CrashOnFirstScalarPageWorker([], true)
        : new InProcessWorker([]);
    };
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
      maxRestartAttempts: 1,
    });
    await storage.whenReady();

    const largeString = 'Text-block-'.repeat(30_000);
    await expect(storage.update('doc', largeString)).resolves.toBeUndefined();
    expect(created).toBe(2);
    expect(storage.get('doc')).toBe(largeString);

    await storage.dispose();

    const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
    });
    await restarted.whenReady();
    expect(restarted.get('doc')).toBe(largeString);
    await restarted.dispose();
  });

  it('fails closed when scalar write exceeds max restart attempts and preserves prior state', async () => {
    const { dir } = await makeFixture({ doc: 'prior-valid' });
    const factory: ElectronStateWorkerFactory = () =>
      new CrashOnFirstScalarPageWorker([], true);
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: factory,
      maxRestartAttempts: 1,
    });
    await storage.whenReady();

    const largeString = 'Never-written-'.repeat(30_000);
    await expect(storage.update('doc', largeString)).rejects.toThrow();

    expect(storage.get('doc')).toBe('prior-valid');

    await storage.dispose();

    const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker([]),
    });
    await restarted.whenReady();
    expect(restarted.get('doc')).toBe('prior-valid');
    await restarted.dispose();
  });

  describe('Finding 1: large-scalar streaming and preflight rejection of unsupported/non-plain/cyclic values', () => {
    it('extractLargeStrings rejects Date instead of treating it as an empty object', () => {
      expect(() => extractLargeStrings(new Date())).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => extractLargeStrings({ date: new Date() })).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => extractLargeStrings([new Date()])).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('extractLargeStrings rejects cyclic structures without call stack overflow', () => {
      const cycle: Record<string, unknown> = {};
      cycle['self'] = cycle;
      expect(() => extractLargeStrings(cycle)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );

      const arrayCycle: unknown[] = [];
      arrayCycle.push(arrayCycle);
      expect(() => extractLargeStrings(arrayCycle)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('extractLargeStrings accepts null-prototype plain objects', () => {
      const nullProto = Object.create(null);
      nullProto.str = 'normal';
      nullProto.large = 'L'.repeat(40_000);
      const result = extractLargeStrings(nullProto);
      expect(result.strings.length).toBe(1);
      expect(result.strings[0].path).toEqual(['large']);
      expect((result.value as Record<string, unknown>)['str']).toBe('normal');
      expect((result.value as Record<string, unknown>)['large']).toBe('');
    });

    it('extractLargeStrings extracts a large root string item with empty path', () => {
      const largeStr = 'R'.repeat(40_000);
      const result = extractLargeStrings(largeStr);
      expect(result.value).toBe('');
      expect(result.strings.length).toBe(1);
      expect(result.strings[0].path).toEqual([]);
      expect(result.strings[0].totalBytes).toBe(40_000);
    });

    it('update() rejects Date deterministically, does not update cache, and restart reveals no divergent value', async () => {
      const { dir } = await makeFixture({ prior: 'untouched' });
      const factory: ElectronStateWorkerFactory = () => new InProcessWorker([]);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      // Scalar Date update
      await expect(storage.update('testDate', new Date())).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('testDate')).toBeUndefined();
      expect(storage.get('prior')).toBe('untouched');

      // Nested Date update
      await expect(
        storage.update('testNestedDate', { created: new Date(), count: 1 }),
      ).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('testNestedDate')).toBeUndefined();

      // Sequence with Date
      await expect(storage.update('testDateSeq', [new Date()])).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('testDateSeq')).toBeUndefined();

      await storage.dispose();

      // Restart must not reveal any divergent persisted value
      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('testDate')).toBeUndefined();
      expect(restarted.get('testNestedDate')).toBeUndefined();
      expect(restarted.get('testDateSeq')).toBeUndefined();
      expect(restarted.get('prior')).toBe('untouched');
      await restarted.dispose();
    });

    it('update() rejects cyclic objects, does not update cache, and preserves prior state', async () => {
      const { dir } = await makeFixture({ prior: 'safe-state' });
      const factory: ElectronStateWorkerFactory = () => new InProcessWorker([]);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const cyclicObj: Record<string, unknown> = {};
      cyclicObj['self'] = cyclicObj;

      await expect(storage.update('cycleKey', cyclicObj)).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('cycleKey')).toBeUndefined();

      await expect(storage.update('cycleSeq', [cyclicObj])).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('cycleSeq')).toBeUndefined();

      await storage.dispose();

      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('cycleKey')).toBeUndefined();
      expect(restarted.get('cycleSeq')).toBeUndefined();
      expect(restarted.get('prior')).toBe('safe-state');
      await restarted.dispose();
    });

    it('update() rejects non-plain objects such as class instances', async () => {
      const { dir } = await makeFixture({});
      const factory: ElectronStateWorkerFactory = () => new InProcessWorker([]);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      class DomainEntity {
        constructor(readonly id: number) {}
      }

      await expect(
        storage.update('entity', new DomainEntity(42)),
      ).rejects.toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(storage.get('entity')).toBeUndefined();
      await storage.dispose();
    });

    it('supports null-prototype plain objects across update, cache, and restart', async () => {
      const { dir } = await makeFixture({});
      const factory: ElectronStateWorkerFactory = () => new InProcessWorker([]);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const nullProto = Object.create(null);
      nullProto.prop = 'value';
      nullProto.nested = { deep: true };

      await storage.update('nullProtoKey', nullProto);
      expect(storage.get('nullProtoKey')).toEqual({
        prop: 'value',
        nested: { deep: true },
      });

      const nullProtoSeq = [nullProto];
      await storage.update('nullProtoSeqKey', nullProtoSeq);
      expect(storage.get('nullProtoSeqKey')).toEqual([
        { prop: 'value', nested: { deep: true } },
      ]);

      await storage.dispose();

      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('nullProtoKey')).toEqual({
        prop: 'value',
        nested: { deep: true },
      });
      expect(restarted.get('nullProtoSeqKey')).toEqual([
        { prop: 'value', nested: { deep: true } },
      ]);
      await restarted.dispose();
    });
  });

  it('accepts a shared-DAG direct update and preserves its JSON value', async () => {
    const { dir } = await makeFixture({});
    const postedMessages: unknown[] = [];
    const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
      workerPath: 'in-process-test-worker',
      workerFactory: () => new InProcessWorker(postedMessages),
    });
    await storage.whenReady();

    const shared = { enabled: true };
    await storage.update('preferences', { left: shared, right: shared });

    expect(storage.get('preferences')).toEqual({
      left: { enabled: true },
      right: { enabled: true },
    });
    expect(
      postedMessages.some(
        (message) => (message as { type?: string }).type === 'update',
      ),
    ).toBe(true);
    await storage.dispose();
  });

  describe('sequence string-slice ordering', () => {
    it('rejects out-of-order, gapped, and overlapping sequence slices deterministically', async () => {
      const { dir, legacyPath } = await makeFixture({});
      const runtime = new ElectronStateWorkerRuntime();
      const ready = await runtime.handle({
        type: 'initialize',
        operationId: 1,
        legacyFilePath: legacyPath,
        v2RootPath: path.join(dir, 'workspace-state.v2'),
        migrations: [],
      });
      expect(ready.type).toBe('ready');

      const cases = [
        { name: 'out-of-order', firstOffset: 2, secondOffset: undefined },
        { name: 'gapped', firstOffset: 0, secondOffset: 3 },
        { name: 'overlapping', firstOffset: 0, secondOffset: 1 },
      ] as const;
      let operationId = 2;
      for (const [index, testCase] of cases.entries()) {
        const sequenceId = `00000000-0000-4000-8000-00000000000${index + 1}`;
        await runtime.handle({
          type: 'begin-json-sequence-write',
          operationId: operationId++,
          sequenceId,
          key: testCase.name,
        });
        await runtime.handle({
          type: 'append-json-sequence-items',
          operationId: operationId++,
          sequenceId,
          items: [''],
        });
        const first = await runtime.handle({
          type: 'append-json-string-slice',
          operationId: operationId++,
          sequenceId,
          itemIndex: 0,
          path: [],
          byteOffset: testCase.firstOffset,
          totalBytes: 4,
          bytes: new Uint8Array([65, 66]),
        });
        if (testCase.secondOffset === undefined) {
          expect(first).toMatchObject({ type: 'failure', code: 'io-failed' });
          continue;
        }
        expect(first).toMatchObject({ type: 'success' });
        const second = await runtime.handle({
          type: 'append-json-string-slice',
          operationId: operationId++,
          sequenceId,
          itemIndex: 0,
          path: [],
          byteOffset: testCase.secondOffset,
          totalBytes: 4,
          bytes: new Uint8Array([67, 68]),
        });
        expect(second).toMatchObject({ type: 'failure', code: 'io-failed' });
      }
    });
  });

  describe('Finding 2: sequence replacement with large root strings', () => {
    it('round-trips UTF-8 scalar slices without whole-string Buffer.from on the main thread', async () => {
      const { dir } = await makeFixture({});
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: () => new InProcessWorker([]),
      });
      await storage.whenReady();
      const largeString = 'a😀界'.repeat(80_000);
      const from = jest.spyOn(Buffer, 'from');

      await storage.update('utf8-doc', largeString);

      expect(
        from.mock.calls.some(
          ([input]) => typeof input === 'string' && input === largeString,
        ),
      ).toBe(false);
      expect(storage.get('utf8-doc')).toBe(largeString);
      from.mockRestore();
      await storage.dispose();
    });

    it('round-trips one large root string item, streams slices, and survives restart', async () => {
      const { dir } = await makeFixture({});
      const postedMessages: unknown[] = [];
      const factory: ElectronStateWorkerFactory = () =>
        new InProcessWorker(postedMessages);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const largeRootString = 'RootStringContent-'.repeat(8_000); // ~144 KiB
      const expected = [largeRootString];

      await storage.update('rootSequence', expected);
      expect(storage.get('rootSequence')).toEqual(expected);

      // Verify all worker messages are strictly within the 256 KiB budget
      for (const msg of postedMessages) {
        expect(() =>
          assertElectronStateWorkerPayloadWithinBudget(msg),
        ).not.toThrow();
      }

      // Verify append-json-string-slice was sent with an empty root path []
      const stringSliceMessages = postedMessages.filter(
        (m) =>
          (m as { type?: string }).type === 'append-json-string-slice' &&
          Array.isArray((m as { path?: unknown }).path) &&
          (m as { path: unknown[] }).path.length === 0,
      );
      expect(stringSliceMessages.length).toBeGreaterThan(1);

      await storage.dispose();

      // Readback after restart
      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('rootSequence')).toEqual(expected);
      await restarted.dispose();
    });

    it('round-trips multiple large root strings, preserving order and exact content', async () => {
      const { dir } = await makeFixture({});
      const postedMessages: unknown[] = [];
      const factory: ElectronStateWorkerFactory = () =>
        new InProcessWorker(postedMessages);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const string0 = 'Alpha-'.repeat(10_000); // ~60 KiB
      const string1 = 'Bravo-'.repeat(12_000); // ~72 KiB
      const string2 = 'Charlie-'.repeat(9_000); // ~72 KiB
      const expected = [string0, string1, string2];

      await storage.update('multiRootSeq', expected);
      expect(storage.get('multiRootSeq')).toEqual(expected);

      for (const msg of postedMessages) {
        expect(() =>
          assertElectronStateWorkerPayloadWithinBudget(msg),
        ).not.toThrow();
      }

      await storage.dispose();

      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('multiRootSeq')).toEqual(expected);
      await restarted.dispose();
    });

    it('round-trips mixed items (large root strings, objects, primitives, nested large strings) preserving semantics and order', async () => {
      const { dir } = await makeFixture({});
      const postedMessages: unknown[] = [];
      const factory: ElectronStateWorkerFactory = () =>
        new InProcessWorker(postedMessages);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const largeRoot1 = 'FirstLargeRoot-'.repeat(6_000);
      const largeRoot2 = 'SecondLargeRoot-'.repeat(7_000);
      const nestedLarge = 'NestedLargeProp-'.repeat(5_000);

      const mixed = [
        largeRoot1,
        { id: 1, label: 'small-object', active: true },
        largeRoot2,
        { payload: { details: nestedLarge }, count: 99 },
        null,
        false,
        12345,
      ];

      await storage.update('mixedArray', mixed);
      expect(storage.get('mixedArray')).toEqual(mixed);

      for (const msg of postedMessages) {
        expect(() =>
          assertElectronStateWorkerPayloadWithinBudget(msg),
        ).not.toThrow();
      }

      await storage.dispose();

      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await restarted.whenReady();
      expect(restarted.get('mixedArray')).toEqual(mixed);
      await restarted.dispose();
    });

    it('aborts cleanly and preserves prior state if worker crashes during sequence string slice streaming', async () => {
      const { dir } = await makeFixture({
        seqDoc: ['prior-safe-item-1', 'prior-safe-item-2'],
      });
      const postedMessages: unknown[] = [];
      const factory: ElectronStateWorkerFactory = () =>
        new CrashOnSequenceSliceWorker(postedMessages, true);
      const storage = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: factory,
      });
      await storage.whenReady();

      const largeRoot = 'WillFailMidway-'.repeat(10_000);
      await expect(storage.update('seqDoc', [largeRoot])).rejects.toThrow();

      // Prior state in memory remains untouched
      expect(storage.get('seqDoc')).toEqual([
        'prior-safe-item-1',
        'prior-safe-item-2',
      ]);

      await storage.dispose();

      // Readback after restart preserves prior valid state (uncommitted write never reached disk)
      const restarted = new ElectronStateStorage(dir, 'workspace-state.json', {
        workerPath: 'in-process-test-worker',
        workerFactory: () => new InProcessWorker([]),
      });
      await restarted.whenReady();
      expect(restarted.get('seqDoc')).toEqual([
        'prior-safe-item-1',
        'prior-safe-item-2',
      ]);
      await restarted.dispose();
    });
  });
});

