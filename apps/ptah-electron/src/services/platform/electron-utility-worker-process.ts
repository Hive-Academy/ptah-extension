/**
 * ElectronUtilityWorkerProcess — the one `utilityProcess` handle behind every
 * worker-process port this host implements.
 *
 * `IIntegrityWorkerProcess` (persistence-sqlite), `IEmbedderWorkerProcess`
 * (memory-curator) and `IVoiceWorkerProcess` (voice-providers) each declare the
 * SAME four members locally, on purpose: each lib owns its port so none of them
 * has to learn about the others. That leaves the Electron side of all three
 * identical, and it was copied three times. This class is that side, once.
 *
 * It deliberately declares no `implements` clause. Naming one of the three ports
 * would pick a winner among peers and drag that lib's import into a file the
 * other two also use; the three interfaces are structurally identical, so each
 * factory's `spawn()` return type is what checks the shape — at three call
 * sites, against three separate declarations.
 */
import electron, { type UtilityProcess } from 'electron';

const { utilityProcess } = electron;

export class ElectronUtilityWorkerProcess {
  /**
   * Fork `workerPath` into its own OS process under `serviceName` (the label
   * Electron shows for the child) and wrap it.
   */
  static fork(
    workerPath: string,
    serviceName: string,
  ): ElectronUtilityWorkerProcess {
    return new ElectronUtilityWorkerProcess(
      utilityProcess.fork(workerPath, [], { serviceName }),
    );
  }

  private constructor(private readonly child: UtilityProcess) {}

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
