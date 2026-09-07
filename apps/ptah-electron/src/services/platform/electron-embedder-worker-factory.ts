/**
 * ElectronEmbedderWorkerFactory — host implementation of
 * `IEmbedderWorkerProcessFactory`. Spawns the bundled `embedder-worker.mjs` in
 * an Electron `utilityProcess` (its own OS process, so a native ONNX abort
 * kills only the child) and sends the `init` config (model cache dir)
 * immediately, before any request.
 */
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
  EmbedderWorkerInitMessage,
} from '@ptah-extension/memory-curator';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export class ElectronEmbedderWorkerFactory implements IEmbedderWorkerProcessFactory {
  constructor(
    private readonly workerPath: string,
    private readonly modelCacheDir: string | null,
  ) {}

  spawn(): IEmbedderWorkerProcess {
    const child = ElectronUtilityWorkerProcess.fork(
      this.workerPath,
      'ptah-embedder-worker',
    );
    const init: EmbedderWorkerInitMessage = {
      type: 'init',
      modelCacheDir: this.modelCacheDir,
    };
    // Queued by Electron until the child's parent port is ready; delivered
    // before the first request the client posts synchronously after spawn().
    child.postMessage(init);
    return child;
  }
}
