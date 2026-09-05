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
import electron, { type UtilityProcess } from 'electron';

const { utilityProcess } = electron;
import type {
  IIntegrityWorkerProcess,
  IIntegrityWorkerProcessFactory,
} from '@ptah-extension/persistence-sqlite';

class ElectronIntegrityWorkerProcess implements IIntegrityWorkerProcess {
  constructor(private readonly child: UtilityProcess) {}

  postMessage(msg: unknown): void {
    this.child.postMessage(msg);
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    cb: ((msg: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.child.on('message', cb as (msg: unknown) => void);
    } else {
      // Electron's `exit` carries a numeric code; the port's callback is
      // widened to `number | null` because worker_threads can deliver null.
      this.child.on('exit', (code: number) =>
        (cb as (code: number | null) => void)(code),
      );
    }
  }

  kill(): void {
    this.child.kill();
  }
}

export class ElectronIntegrityWorkerFactory implements IIntegrityWorkerProcessFactory {
  constructor(private readonly workerPath: string) {}

  spawn(): IIntegrityWorkerProcess {
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: 'ptah-integrity-worker',
    });
    return new ElectronIntegrityWorkerProcess(child);
  }
}
