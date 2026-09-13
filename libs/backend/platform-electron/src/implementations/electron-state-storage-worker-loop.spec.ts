import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createElectronStateWorkerMessageLoop } from './electron-state-storage-worker-loop';
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
  port: { postMessage(value: unknown, transferList?: ArrayBuffer[]): void };
  posted: Posted[];
  waitFor(count: number): Promise<void>;
} {
  const posted: Posted[] = [];
  let failures = options.failFirstPosts ?? 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  return {
    posted,
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
    },
    waitFor(count) {
      if (posted.length >= count) return Promise.resolve();
      return new Promise((resolve) => waiters.push({ count, resolve }));
    },
  };
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

  it('reports a post failure as internal-error and swallows a second post failure', async () => {
    const first = recordingPort({ failFirstPosts: 1 });
    const firstListener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'success',
        operationId: request.operationId,
      })),
      first.port,
    );
    firstListener({ type: 'delete', operationId: 1, key: 'a' });
    await first.waitFor(1);
    expect(first.posted[0].value).toEqual({
      type: 'failure',
      operationId: 1,
      code: 'internal-error',
    });

    const second = recordingPort({ failFirstPosts: 2 });
    const secondListener = createElectronStateWorkerMessageLoop(
      scriptedHandler(async (request) => ({
        type: 'success',
        operationId: request.operationId,
      })),
      second.port,
    );
    secondListener({ type: 'delete', operationId: 1, key: 'a' });
    secondListener({ type: 'delete', operationId: 2, key: 'b' });
    await second.waitFor(1);

    expect(second.posted.map((entry) => entry.value)).toEqual([
      { type: 'success', operationId: 2 },
    ]);
    expect(unhandled).toEqual([]);
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
});
