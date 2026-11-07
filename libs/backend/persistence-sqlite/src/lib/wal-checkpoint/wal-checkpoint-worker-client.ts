/**
 * One long-lived WAL checkpoint worker and at most one request in flight.
 *
 * Spawns the worker on the first request and again after it exits. A request
 * settles exactly once: on its reply, on the worker's exit, on its timeout or
 * on `dispose()`. A timeout kills the worker, because a checkpoint that never
 * answers may still hold SQLite's checkpointer lock; the OS releases the lock
 * with the process, and an interrupted checkpoint is crash-safe (the WAL stays
 * authoritative until the copied pages are synced).
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IWalCheckpointWorkerProcess,
  IWalCheckpointWorkerProcessFactory,
} from './wal-checkpoint-worker.port';
import {
  walCheckpointWorkerOutboundSchema,
  type WalCheckpointRequest,
  type WalCheckpointResult,
} from './wal-checkpoint-worker-protocol';

interface PendingCheckpoint {
  readonly requestId: number;
  readonly resolve: (result: WalCheckpointResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class WalCheckpointWorkerClient {
  private worker: IWalCheckpointWorkerProcess | null = null;
  private pending: PendingCheckpoint | null = null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly factory: IWalCheckpointWorkerProcessFactory,
    private readonly requestTimeoutMs: number,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  /** Checkpoint `dbPath` in the worker. Rejects with the worker's reason. */
  checkpoint(dbPath: string): Promise<WalCheckpointResult> {
    if (this.disposed) {
      return Promise.reject(new Error('WAL checkpoint worker is disposed'));
    }
    if (this.pending) {
      return Promise.reject(
        new Error('a WAL checkpoint is already in flight'),
      );
    }
    let worker: IWalCheckpointWorkerProcess;
    try {
      worker = this.ensureWorker();
    } catch (error: unknown) {
      return Promise.reject(toError(error));
    }
    const requestId = this.nextRequestId++;
    return new Promise<WalCheckpointResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(
          new Error(
            `WAL checkpoint timed out after ${this.requestTimeoutMs} ms`,
          ),
        );
        this.killWorker();
      }, this.requestTimeoutMs);
      // A pending checkpoint must never hold the process open at quit.
      timer.unref?.();
      this.pending = { requestId, resolve, reject, timer };
      const request: WalCheckpointRequest = {
        type: 'checkpoint',
        requestId,
        dbPath,
      };
      try {
        worker.postMessage(request);
      } catch (error: unknown) {
        this.failPending(toError(error));
        this.killWorker();
      }
    });
  }

  /** Kill the worker and reject a request in flight. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failPending(new Error('WAL checkpoint worker is disposed'));
    this.killWorker();
  }

  private ensureWorker(): IWalCheckpointWorkerProcess {
    if (this.worker) return this.worker;
    const worker = this.factory.spawn();
    worker.on('message', (msg: unknown) => this.onMessage(worker, msg));
    worker.on('exit', (code: number | null) => this.onExit(worker, code));
    this.worker = worker;
    return worker;
  }

  private onMessage(worker: IWalCheckpointWorkerProcess, msg: unknown): void {
    // A reply from a worker this client already replaced settles nothing.
    if (worker !== this.worker) return;
    const pending = this.pending;
    if (!pending) return;
    const parsed = walCheckpointWorkerOutboundSchema.safeParse(msg);
    if (!parsed.success) {
      this.failPending(
        new Error(`unrecognised WAL checkpoint reply: ${parsed.error.message}`),
      );
      return;
    }
    const reply = parsed.data;
    if (reply.type === 'checkpoint-error') {
      this.failPending(new Error(reply.message));
      return;
    }
    if (reply.requestId !== pending.requestId) {
      this.failPending(
        new Error(
          `WAL checkpoint reply for request ${reply.requestId}, expected ${pending.requestId}`,
        ),
      );
      return;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  private onExit(worker: IWalCheckpointWorkerProcess, code: number | null): void {
    if (worker !== this.worker) return;
    this.worker = null;
    this.failPending(
      new Error(`WAL checkpoint worker exited (code ${String(code)})`),
    );
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private killWorker(): void {
    const worker = this.worker;
    this.worker = null;
    try {
      worker?.kill();
    } catch (error: unknown) {
      this.logger.warn('[persistence-sqlite] WAL checkpoint worker kill failed', {
        error: toError(error).message,
      });
    }
  }
}
