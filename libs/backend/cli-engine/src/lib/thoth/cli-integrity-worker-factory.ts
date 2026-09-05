/**
 * CliIntegrityWorkerFactory — CLI host implementation of
 * `IIntegrityWorkerProcessFactory`. Spawns the bundled `integrity-worker.mjs`
 * in a `node:worker_threads` Worker (the headless CLI runs on plain Node and
 * has no Electron `utilityProcess`).
 *
 * Mirrors `ElectronIntegrityWorkerFactory` on the worker_threads transport.
 * The worker entry auto-detects the runtime and, absent `process.parentPort`,
 * falls back to `node:worker_threads` — so the SAME `integrity-worker.mjs`
 * drives both hosts.
 *
 * Two deliberate differences from `CliEmbedderWorkerFactory`:
 *
 * 1. No `init` message. The integrity worker is single-shot and takes its only
 *    input — the database path — on the `check` request that
 *    `SqliteIntegrityService` posts immediately after `spawn()`.
 * 2. No respawn or idle-teardown client behind it. One spawn, one reply, then
 *    the service kills it.
 */
import { Worker } from 'node:worker_threads';
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from '@ptah-extension/persistence-sqlite';

class CliIntegrityWorkerProcess implements IIntegrityWorkerProcess {
  constructor(private readonly worker: Worker) {}

  postMessage(msg: unknown): void {
    this.worker.postMessage(msg);
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    cb: ((msg: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      // worker_threads delivers the raw payload as the first arg.
      this.worker.on('message', cb as (msg: unknown) => void);
    } else {
      // worker_threads exit passes a numeric exit code.
      this.worker.on('exit', (code: number) =>
        (cb as (code: number | null) => void)(code),
      );
    }
  }

  kill(): void {
    void this.worker.terminate();
  }
}

export class CliIntegrityWorkerFactory implements IIntegrityWorkerProcessFactory {
  constructor(private readonly workerPath: string) {}

  spawn(): IIntegrityWorkerProcess {
    // `.mjs` is loaded as ESM by extension; `type: 'module'` mirrors
    // `CliEmbedderWorkerFactory`. Node's `WorkerOptions` type has no `type`
    // field, so cast (no `any`, no `@ts-ignore`) — same seam that factory uses.
    const worker = new Worker(this.workerPath, {
      type: 'module',
    } as unknown as ConstructorParameters<typeof Worker>[1]);
    return new CliIntegrityWorkerProcess(worker);
  }
}
