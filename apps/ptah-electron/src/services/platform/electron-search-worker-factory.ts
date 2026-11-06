/**
 * ElectronSearchWorkerFactory — host implementation of `ISearchWorkerFactory`.
 * Forks the bundled `search-worker.mjs` in an Electron `utilityProcess`, so
 * memory and code-symbol search run their synchronous SQLite reads off the
 * main thread. `SearchWorkerClient` posts the `init` message and owns
 * timeouts, respawn and backoff.
 */
import type {
  ISearchWorkerFactory,
  ISearchWorkerProcess,
  SearchWorkerDatabaseConfig,
} from '@ptah-extension/memory-curator';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export class ElectronSearchWorkerFactory implements ISearchWorkerFactory {
  /**
   * @param workerPath absolute path of `search-worker.mjs` (beside `main.mjs`).
   * @param dbPath the live database the worker opens read-only.
   * @param resolveVecPath the sqlite-vec binary the main connection loaded,
   *   read at each spawn; `undefined` makes the worker search lexically only.
   */
  constructor(
    private readonly workerPath: string,
    private readonly dbPath: string,
    private readonly resolveVecPath: () => string | undefined,
  ) {}

  spawn(): ISearchWorkerProcess {
    return ElectronUtilityWorkerProcess.fork(this.workerPath, 'ptah-sqlite-search');
  }

  databaseConfig(): SearchWorkerDatabaseConfig {
    return { dbPath: this.dbPath, vecPath: this.resolveVecPath() };
  }
}
