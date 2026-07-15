/**
 * CliEmbedderWorkerFactory — CLI host implementation of
 * `IEmbedderWorkerProcessFactory`. Spawns the bundled `embedder-worker.mjs` in a
 * `node:worker_threads` Worker (the headless CLI runs on plain Node and has no
 * Electron `utilityProcess`) and sends the `init` config (model cache dir)
 * immediately, before any request.
 *
 * Mirrors `ElectronEmbedderWorkerFactory` but on the worker_threads transport.
 * The worker entry auto-detects the runtime and, absent `process.parentPort`,
 * falls back to `node:worker_threads` — so the SAME `embedder-worker.mjs` drives
 * both hosts. The `EmbedderWorkerClient` owns respawn / idle-teardown /
 * crash-loop; this factory owns Worker construction + init config.
 */
import { Worker } from 'node:worker_threads';
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
  EmbedderWorkerInitMessage,
} from '@ptah-extension/memory-curator';

class CliEmbedderWorkerProcess implements IEmbedderWorkerProcess {
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

export class CliEmbedderWorkerFactory implements IEmbedderWorkerProcessFactory {
  constructor(
    private readonly workerPath: string,
    private readonly modelCacheDir: string | null,
  ) {}

  spawn(): IEmbedderWorkerProcess {
    // `.mjs` is loaded as ESM by extension; `type: 'module'` mirrors the
    // pre-migration client construction. Node's `WorkerOptions` type has no
    // `type` field, so cast (no `any`, no `@ts-ignore`) — same seam the old
    // client used. `workerData` is intentionally dropped: config now arrives
    // via the `init` message, identically to the Electron transport.
    const worker = new Worker(this.workerPath, {
      type: 'module',
    } as unknown as ConstructorParameters<typeof Worker>[1]);
    const init: EmbedderWorkerInitMessage = {
      type: 'init',
      modelCacheDir: this.modelCacheDir,
    };
    worker.postMessage(init);
    return new CliEmbedderWorkerProcess(worker);
  }
}
