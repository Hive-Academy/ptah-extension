/**
 * ElectronWalCheckpointWorkerFactory — host implementation of
 * `IWalCheckpointWorkerProcessFactory`. Forks the bundled
 * `wal-checkpoint-worker.mjs` in an Electron `utilityProcess`, so the WAL
 * checkpoint (copy frames into the database file, then fsync it) runs in its
 * own OS process instead of inside a COMMIT on the main thread
 * (main-loop-sync-blocks fix 11). The worker is long-lived and takes the
 * database path on each request, so no `init` message is posted.
 */
import type {
  IWalCheckpointWorkerProcess,
  IWalCheckpointWorkerProcessFactory,
} from '@ptah-extension/persistence-sqlite';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export const WAL_CHECKPOINT_WORKER_FILE = 'wal-checkpoint-worker.mjs';

export class ElectronWalCheckpointWorkerFactory implements IWalCheckpointWorkerProcessFactory {
  constructor(private readonly workerPath: string) {}

  spawn(): IWalCheckpointWorkerProcess {
    return ElectronUtilityWorkerProcess.fork(
      this.workerPath,
      'ptah-wal-checkpoint-worker',
    );
  }
}
