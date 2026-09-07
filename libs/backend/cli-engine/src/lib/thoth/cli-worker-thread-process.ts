/**
 * CliWorkerThreadProcess — the one `node:worker_threads` handle behind every
 * worker-process port this host implements.
 *
 * `IIntegrityWorkerProcess` (persistence-sqlite) and `IEmbedderWorkerProcess`
 * (memory-curator) each declare the SAME four members locally, on purpose: each
 * lib owns its port so neither has to learn about the other. That left the CLI
 * side of both identical, and it was copied twice. This class is that side,
 * once — the CLI counterpart of the Electron host's
 * `ElectronUtilityWorkerProcess`, which cannot be shared with it because that
 * one lives in `apps/ptah-electron` and imports `electron`.
 *
 * It deliberately declares no `implements` clause: the two interfaces are
 * structurally identical, so each factory's `spawn()` return type is what checks
 * the shape, against the declaration its own lib owns.
 */
import { Worker } from 'node:worker_threads';

export class CliWorkerThreadProcess {
  /**
   * Construct the Worker and wrap it. `.mjs` is loaded as ESM by extension;
   * `type: 'module'` mirrors the pre-migration client construction. Node's
   * `WorkerOptions` type has no `type` field, so cast (no `any`, no
   * `@ts-ignore`) — the same seam the old client used.
   */
  static fork(workerPath: string): CliWorkerThreadProcess {
    return new CliWorkerThreadProcess(
      new Worker(workerPath, {
        type: 'module',
      } as unknown as ConstructorParameters<typeof Worker>[1]),
    );
  }

  private constructor(private readonly worker: Worker) {}

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
