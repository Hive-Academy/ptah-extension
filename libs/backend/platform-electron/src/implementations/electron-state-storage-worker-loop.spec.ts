import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ElectronStateStorageWorkerHost,
  type ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import {
  createElectronStateWorkerMessageLoop,
  type ElectronStateWorkerMessagePort,
} from './electron-state-storage-worker-loop';
import {
  parseElectronStateWorkerResponse,
  type ElectronStateWorkerRequest,
  type ElectronStateWorkerResponse,
} from './electron-state-storage-worker-protocol';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

interface Posted {
  readonly value: unknown;
  readonly transferList?: ArrayBuffer[];
}

function recordingPort(options: { failFirstPosts?: number } = {}): {
  port: ElectronStateWorkerMessagePort;
  posted: Posted[];
  terminations: () => number;
  waitFor(count: number): Promise<void>;
  waitForTermination(): Promise<void>;
} {
  const posted: Posted[] = [];
  let failures = options.failFirstPosts ?? 0;
  let terminations = 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  const terminationWaiters: Array<() => void> = [];
  return {
    posted,
    terminations: () => terminations,
    port: {
      postMessage(value, transferList) {
        if (failures > 0) {
          failures--;
          throw new Error('DataCloneError');
        }
        posted.push({ value, transferList });
        for (const waiter of [...waiters]) {
          if (posted.length >= waiter.count) {
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve();
          }
        }
      },
      terminate() {
        terminations++;
        terminationWaiters.splice(0).forEach((resolve) => resolve());
      },
    },
    waitFor(count) {
      if (posted.length >= count) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },
    waitForTermination() {
      if (terminations > 0) return Promise.resolve();
      return new Promise((resolve) => terminationWaiters.push(resolve));
    },
  };
}

type MessageListener = (value: unknown) => void;
type ErrorListener = (error: Error) => void;
type ExitListener = (code: number) => void;

interface FaultyTransport {
  failWorkerPosts: number;
  terminations: number;
}

class LoopWorker implements ElectronStateWorkerLike {
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];
  private readonly listener: (input: unknown) => void;

  constructor(transport: FaultyTransport) {
    this.listener = createElectronStateWorkerMessageLoop(
      new ElectronStateWorkerRuntime(),
      {
        postMessage: (value) => {
          if (transport.failWorkerPosts > 0) {
            transport.failWorkerPosts--;
            throw new Error('DataCloneError');
          }
          const cloned = structuredClone(value);
          queueMicrotask(() =>
            this.messageListeners.forEach((listener) => listener(cloned)),
          );
        },
        terminate: () => {
          transport.terminations++;
          queueMicrotask(() =>
            this.exitListeners.forEach((listener) => listener(1)),
          );
        },
      },
    );
  }

  postMessage(value: unknown): void {
    const cloned = structuredClone(value);
    queueMicrotask(() => this.listener(cloned));
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
    return 0;
  }
}

async function within<T>(promise: Promise<T>, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`still pending after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function scriptedHandler(
  script: (
    request: ElectronStateWorkerRequest,
  ) => Promise<ElectronStateWorkerResponse>,
): { handle: typeof script } {
  return { handle: script };
}

describe('createElectronStateWorkerMessageLoop', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  const tmpDirs: string[] = [];

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(async () => {
    process.off('unhandledRejection', onUnhandled);
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('fails only the request whose response exceeds the budget and keeps serving', async () => {
    const { port, posted, waitFor } = recordingPort();
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) =>
        request.operationId === 1
          ? {
              type: 'value',
              operationId: 1,
              found: true,
              value: 'x'.repeat(200_000),
            }
          : { type: 'value', operationId: request.operationId, found: false },
      ),
      port,
    );

    listener({ type: 'get', operationId: 1, key: 'huge' });
    listener({ type: 'get', operationId: 2, key: 'small' });
    await waitFor(2);
    await new Promise((resolve) => setImmediate(resolve));

    expect(posted.map((entry) => entry.value)).toEqual([
      { type: 'failure', operationId: 1, code: 'response-too-large' },
      { type: 'value', operationId: 2, found: false },
    ]);
    expect(unhandled).toEqual([]);
  });

  it('turns a handler rejection and an invalid response into internal-error for that operation only', async () => {
    const { port, posted, waitFor } = recordingPort();
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => {
        if (request.operationId === 1) throw new Error('boom');
        if (request.operationId === 2) {
          return {
            type: 'json-sequence-page',
            operationId: 2,
            items: [],
            nextCursor: 'next',
            done: true,
            approximateBytes: 0,
          };
        }
        return { type: 'success', operationId: request.operationId };
      }),
      port,
    );

    listener({ type: 'delete', operationId: 1, key: 'a' });
    listener({ type: 'delete', operationId: 2, key: 'b' });
    listener({ type: 'delete', operationId: 3, key: 'c' });
    await waitFor(3);

    expect(posted.map((entry) => entry.value)).toEqual([
      { type: 'failure', operationId: 1, code: 'internal-error' },
      { type: 'failure', operationId: 2, code: 'internal-error' },
      { type: 'success', operationId: 3 },
    ]);
    for (const entry of posted) {
      expect(() => parseElectronStateWorkerResponse(entry.value)).not.toThrow();
    }
    expect(unhandled).toEqual([]);
  });

  it('answers an invalid request with invalid-request and continues', async () => {
    const { port, posted, waitFor } = recordingPort();
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'success',
        operationId: request.operationId,
      })),
      port,
    );

    listener({ type: 'get', operationId: 4, key: '' });
    listener('not even an object');
    listener({ type: 'delete', operationId: 5, key: 'ok' });
    await waitFor(3);

    expect(posted.map((entry) => entry.value)).toEqual([
      { type: 'failure', operationId: 4, code: 'invalid-request' },
      { type: 'failure', operationId: 1, code: 'invalid-request' },
      { type: 'success', operationId: 5 },
    ]);
  });

  it('reports an undelivered read result as internal-error and keeps serving', async () => {
    const { port, posted, waitFor, terminations } = recordingPort({
      failFirstPosts: 1,
    });
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'value',
        operationId: request.operationId,
        found: false,
      })),
      port,
    );
    listener({ type: 'get', operationId: 1, key: 'a' });
    listener({ type: 'get', operationId: 2, key: 'b' });
    await waitFor(2);

    expect(posted.map((entry) => entry.value)).toEqual([
      { type: 'failure', operationId: 1, code: 'internal-error' },
      { type: 'value', operationId: 2, found: false },
    ]);
    expect(terminations()).toBe(0);
    expect(unhandled).toEqual([]);
  });

  it.each([
    { type: 'update', operationId: 1, key: 'a', value: 1 },
    { type: 'delete', operationId: 1, key: 'a' },
    {
      type: 'commit-json-sequence-write',
      operationId: 1,
      sequenceId: '00000000-0000-4000-8000-000000000001',
    },
    {
      type: 'commit-scalar-write',
      operationId: 1,
      writeId: '00000000-0000-4000-8000-000000000002',
    },
  ])(
    'reports an undelivered $type success as a landed commit-failed',
    async (request) => {
      const { port, posted, waitFor } = recordingPort({ failFirstPosts: 1 });
      const listener = createElectronStateWorkerMessageLoop(
        scriptedHandler(async (incoming) => ({
          type: 'success',
          operationId: incoming.operationId,
        })),
        port,
      );
      listener(request);
      await waitFor(1);

      expect(posted[0].value).toEqual({
        type: 'failure',
        operationId: 1,
        code: 'commit-failed',
        landed: true,
      });
      expect(() =>
        parseElectronStateWorkerResponse(posted[0].value),
      ).not.toThrow();
    },
  );

  it('re-sends an undelivered failure response unchanged', async () => {
    const { port, posted, waitFor } = recordingPort({ failFirstPosts: 1 });
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'failure',
        operationId: request.operationId,
        code: 'commit-failed',
        landed: false,
      })),
      port,
    );
    listener({ type: 'update', operationId: 1, key: 'a', value: 1 });
    await waitFor(1);

    expect(posted[0].value).toEqual({
      type: 'failure',
      operationId: 1,
      code: 'commit-failed',
      landed: false,
    });
  });

  it('terminates when even the failure response cannot be delivered and serves nothing after', async () => {
    const { port, posted, terminations, waitForTermination } = recordingPort({
      failFirstPosts: 2,
    });
    const handled: number[] = [];
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => {
        handled.push(request.operationId);
        return { type: 'success', operationId: request.operationId };
      }),
      port,
    );
    listener({ type: 'delete', operationId: 1, key: 'a' });
    listener({ type: 'delete', operationId: 2, key: 'b' });
    await within(waitForTermination());
    await new Promise((resolve) => setImmediate(resolve));

    expect(terminations()).toBe(1);
    expect(handled).toEqual([1]);
    expect(posted).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it('terminates when an invalid-request failure cannot be delivered', async () => {
    const { port, terminations, waitForTermination } = recordingPort({
      failFirstPosts: 1,
    });
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'success',
        operationId: request.operationId,
      })),
      port,
    );
    listener('not even an object');
    await within(waitForTermination());

    expect(terminations()).toBe(1);
  });

  it('keeps request order across slow and fast handlers', async () => {
    const { port, posted, waitFor } = recordingPort();
    const listener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => {
        if (request.operationId === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return { type: 'success', operationId: request.operationId };
      }),
      port,
    );

    listener({ type: 'delete', operationId: 1, key: 'slow' });
    listener({ type: 'delete', operationId: 2, key: 'fast' });
    await waitFor(2);

    expect(
      posted.map(
        (entry) => (entry.value as { operationId: number }).operationId,
      ),
    ).toEqual([1, 2]);
  });

  it('transfers string slice buffers on paged scalar responses from the real runtime', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-worker-loop-'));
    tmpDirs.push(dir);
    const legacyFilePath = path.join(dir, 'state.json');
    await fs.writeFile(
      legacyFilePath,
      JSON.stringify({ doc: 'y'.repeat(300_000) }),
      'utf8',
    );
    const { port, posted, waitFor } = recordingPort();
    const listener = createElectronStateWorkerMessageLoop(
      new ElectronStateWorkerRuntime(),
      port,
    );

    listener({
      type: 'initialize',
      operationId: 1,
      legacyFilePath,
      v2RootPath: path.join(dir, 'state.v2'),
      migrations: [],
    });
    listener({ type: 'get', operationId: 2, key: 'doc' });
    await waitFor(2);

    const paged = posted[1];
    expect((paged.value as { type: string }).type).toBe('value-paged');
    expect(paged.transferList?.length).toBeGreaterThan(0);
    expect(unhandled).toEqual([]);
  });

  describe('through the real host', () => {
    async function makeHost(
      transport: FaultyTransport,
      maxRestartAttempts?: number,
    ): Promise<ElectronStateStorageWorkerHost> {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-loop-host-'));
      tmpDirs.push(dir);
      const legacyFilePath = path.join(dir, 'state.json');
      await fs.writeFile(
        legacyFilePath,
        JSON.stringify({ doc: 'old', other: 1 }),
        'utf8',
      );
      const host = new ElectronStateStorageWorkerHost({
        workerPath: 'in-process-loop-worker',
        legacyFilePath,
        v2RootPath: path.join(dir, 'state.v2'),
        workerFactory: () => new LoopWorker(transport),
        ...(maxRestartAttempts !== undefined ? { maxRestartAttempts } : {}),
      });
      await within(host.start());
      return host;
    }

    it.each([
      { label: 'update', value: 'new' as const, expected: 'new' },
      { label: 'delete', value: undefined, expected: undefined },
    ])(
      'refreshes the cache when a committed $label result is not delivered',
      async ({ value, expected }) => {
        const transport: FaultyTransport = {
          failWorkerPosts: 0,
          terminations: 0,
        };
        const host = await makeHost(transport);
        expect(await within(host.get('doc'))).toBe('old');

        transport.failWorkerPosts = 1;
        await expect(within(host.update('doc', value))).rejects.toThrow(
          'commit-failed',
        );

        expect(await within(host.get('doc'))).toBe(expected);
        expect(host.getRecoveryReason()).toBeNull();
        expect(transport.terminations).toBe(0);

        await within(host.update('other', 2));
        expect(await within(host.get('other'))).toBe(2);
        expect(await within(host.get('doc'))).toBe(expected);
        await host.dispose();
        expect(unhandled).toEqual([]);
      },
    );

    it('rejects the pending update and serves the next read after restart when no response can be delivered', async () => {
      const transport: FaultyTransport = {
        failWorkerPosts: 0,
        terminations: 0,
      };
      const host = await makeHost(transport, 0);

      transport.failWorkerPosts = 2;
      await expect(within(host.update('doc', 'new'))).rejects.toThrow(
        'State storage worker exited with code 1',
      );
      expect(transport.terminations).toBe(1);

      expect(await within(host.get('doc'))).toBe('new');
      expect(host.getRecoveryReason()).toBeNull();
      await host.dispose();
      expect(unhandled).toEqual([]);
    });

    it('retries the update on a restarted worker when restarts are allowed', async () => {
      const transport: FaultyTransport = {
        failWorkerPosts: 0,
        terminations: 0,
      };
      const host = await makeHost(transport);

      transport.failWorkerPosts = 2;
      await within(host.update('doc', 'new'));
      expect(transport.terminations).toBe(1);

      expect(await within(host.get('doc'))).toBe('new');
      await host.dispose();
      expect(unhandled).toEqual([]);
    });
  });
});
