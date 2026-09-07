/**
 * ElectronIntegrityWorkerFactory — host implementation of
 * `IIntegrityWorkerProcessFactory`. Spawns the bundled `integrity-worker.mjs`
 * in an Electron `utilityProcess` so the `quick_check` pragma reads the
 * gigabyte database in its OWN OS process: the measured 20-26 s cold cost then
 * lands on a process that is holding nothing up, instead of inside
 * `openAndMigrate` where every renderer IPC reply queued behind it
 * (TASK_2026_380).
 *
 * Mirrors `ElectronEmbedderWorkerFactory` on the same transport, with one
 * deliberate difference: this factory posts NO `init` message. The integrity
 * worker is single-shot and takes its only input — the database path — on the
 * `check` request `SqliteIntegrityService` sends immediately after `spawn()`.
 * See `IIntegrityWorkerProcessFactory` in `persistence-sqlite`.
 */
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from '@ptah-extension/persistence-sqlite';
import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

export class ElectronIntegrityWorkerFactory implements IIntegrityWorkerProcessFactory {
  constructor(private readonly workerPath: string) {}

  spawn(): IIntegrityWorkerProcess {
    return ElectronUtilityWorkerProcess.fork(
      this.workerPath,
      'ptah-integrity-worker',
    );
  }
}
