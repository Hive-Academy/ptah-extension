/**
 * The worker first-ready handshake must be BOUNDED.
 *
 * Before TASK_2026_411 neither `send()` nor `whenReady()` had a timeout
 * anywhere, so a worker that accepted `initialize` and never answered left
 * `ElectronStateStorage.whenReady()` pending forever. In the Electron host that
 * promise is the boot gate (`bootstrap.ts`), so the app sat on the static
 * preparing shell with no log line, no error and no crash — indistinguishable
 * from a hang, and the exact shape of failure the e2e suite burned its budget
 * against.
 *
 * Fake timers are scoped to the two expiry specs rather than declared for the
 * file: Jest's fake clock also replaces `queueMicrotask`, which is how the
 * in-process worker below delivers its replies, so the happy-path spec must run
 * on the real clock.
 */

import 'reflect-metadata';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { StateStorageRecoveryRequiredError } from '@ptah-extension/platform-core';

import { ElectronStateStorage } from './electron-state-storage';
import type {
  ElectronStateWorkerFactory,
  ElectronStateWorkerLike,
} from './electron-state-storage-worker-host';
import { parseElectronStateWorkerRequest } from './electron-state-storage-worker-protocol';
import { ElectronStateWorkerRuntime } from './electron-state-storage-worker-runtime';

type MessageListener = (value: unknown) => void;
type ErrorListener = (error: Error) => void;
type ExitListener = (code: number) => void;

/** Accepts every message and never replies — a worker that has gone silent. */
function silentWorkerFactory(): {
  factory: ElectronStateWorkerFactory;
  terminated: () => number;
} {
  let terminations = 0;
  const factory: ElectronStateWorkerFactory = (): ElectronStateWorkerLike => {
    const worker: ElectronStateWorkerLike = {
      postMessage: () => {
        /* swallowed: the reply never comes */
      },
      on: (() => worker) as ElectronStateWorkerLike['on'],
      unref: () => {
        /* no-op */
      },
      terminate: async () => {
        terminations++;
        return 0;
      },
    };
    return worker;
  };
  return { factory, terminated: () => terminations };
}

/** Drives the REAL worker runtime in-process, so the happy path is genuine. */
class InProcessWorker implements ElectronStateWorkerLike {
  private readonly runtime = new ElectronStateWorkerRuntime();
  private readonly messageListeners: MessageListener[] = [];
  private readonly errorListeners: ErrorListener[] = [];
  private readonly exitListeners: ExitListener[] = [];

  postMessage(value: unknown): void {
    queueMicrotask(() => {
      void this.runtime
        .handle(parseElectronStateWorkerRequest(value))
        .then((response) => {
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

/**
 * The host reaches its `setTimeout` only after the request chain has scheduled
 * `ensureInitialized`. Advancing the fake clock before that point advances past
 * a timer that does not exist yet, and the spec then waits forever.
 */
async function flushUntilHandshakeArmed(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('ElectronStateStorage — bounded worker handshake', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    jest.useRealTimers();
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop();
      if (!dir) continue;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ptah-electron-handshake-'),
    );
    tmpDirs.push(dir);
    return dir;
  }

  it('fails with a typed recovery error instead of hanging forever', async () => {
    const dir = await makeTempDir();
    const { factory, terminated } = silentWorkerFactory();
    jest.useFakeTimers();

    const storage = new ElectronStateStorage(dir, 'state.json', {
      workerPath: '/fake/worker.mjs',
      workerFactory: factory,
      handshakeTimeoutMs: 1_000,
    });

    const ready = storage.whenReady();
    let settled = false;
    void ready.then(
      () => (settled = true),
      () => (settled = true),
    );

    await flushUntilHandshakeArmed();
    // Still pending on the far side of the armed budget — without this the
    // spec would also pass against an implementation that rejected instantly
    // for an unrelated reason.
    expect(settled).toBe(false);

    jest.advanceTimersByTime(1_000);

    await expect(ready).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
    await expect(ready).rejects.toMatchObject({
      reason: 'worker-unresponsive',
    });
    // The unresponsive worker is reaped, not left running beside a store the
    // host has already given up on.
    expect(terminated()).toBe(1);
  });

  it('surfaces the failure through the readiness state the host reads', async () => {
    const dir = await makeTempDir();
    const { factory } = silentWorkerFactory();
    jest.useFakeTimers();

    const storage = new ElectronStateStorage(dir, 'state.json', {
      workerPath: '/fake/worker.mjs',
      workerFactory: factory,
      handshakeTimeoutMs: 500,
    });

    const ready = storage.whenReady();
    await flushUntilHandshakeArmed();
    jest.advanceTimersByTime(500);

    await expect(ready).rejects.toBeInstanceOf(
      StateStorageRecoveryRequiredError,
    );
    // `main.ts` renders the recovery shell off exactly this reason string.
    expect(storage.getReadinessState()).toEqual({
      status: 'recovery-required',
      reason: 'worker-unresponsive',
    });
  });

  it('does not fail a handshake that completes inside the budget', async () => {
    const dir = await makeTempDir();

    const storage = new ElectronStateStorage(dir, 'state.json', {
      workerPath: '/fake/worker.mjs',
      workerFactory: () => new InProcessWorker(),
      handshakeTimeoutMs: 60_000,
    });

    await expect(storage.whenReady()).resolves.toBeUndefined();
    expect(storage.getReadinessState()).toEqual({ status: 'ready' });

    await storage.dispose();
  });
});
