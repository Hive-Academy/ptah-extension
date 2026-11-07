/**
 * ElectronTreeSitterWorkerFactory — host implementation of
 * `ITreeSitterWorkerFactory`. Forks the bundled `tree-sitter-worker.mjs` in
 * an Electron `utilityProcess`, so web-tree-sitter's synchronous WASM parsing
 * and queries run off the main thread. `TreeSitterWorkerClient` owns the
 * queue, timeouts and respawn.
 */
import type {
  ITreeSitterWorkerFactory,
  ITreeSitterWorkerProcess,
} from '@ptah-extension/workspace-intelligence';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export class ElectronTreeSitterWorkerFactory implements ITreeSitterWorkerFactory {
  /** @param workerPath absolute path of `tree-sitter-worker.mjs` (beside `main.mjs`). */
  constructor(private readonly workerPath: string) {}

  spawn(): ITreeSitterWorkerProcess {
    return ElectronUtilityWorkerProcess.fork(this.workerPath, 'ptah-tree-sitter');
  }
}
