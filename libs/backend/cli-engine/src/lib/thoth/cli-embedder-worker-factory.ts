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
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
  EmbedderWorkerInitMessage,
} from '@ptah-extension/memory-curator';
import { CliWorkerThreadProcess } from './cli-worker-thread-process';

export class CliEmbedderWorkerFactory implements IEmbedderWorkerProcessFactory {
  constructor(
    private readonly workerPath: string,
    private readonly modelCacheDir: string | null,
  ) {}

  spawn(): IEmbedderWorkerProcess {
    // `workerData` is intentionally dropped: config now arrives via the `init`
    // message, identically to the Electron transport.
    const worker = CliWorkerThreadProcess.fork(this.workerPath);
    const init: EmbedderWorkerInitMessage = {
      type: 'init',
      modelCacheDir: this.modelCacheDir,
    };
    worker.postMessage(init);
    return worker;
  }
}
