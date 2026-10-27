/**
 * ElectronBootReadinessProvider — the Electron host's answer to
 * `IBootReadinessProvider` (port in `platform-core`).
 *
 * Electron is the only host with a staged boot: `BootCoordinator` runs the
 * heavy work behind the window, so there is a real interval in which SQLite is
 * not open and the renderer can already issue RPC. The coordinator already
 * holds that state; this adapter is only the seam that lets the
 * runtime-agnostic `boot:getReadiness` handler read it without importing the
 * app.
 *
 * It also attaches the latest `boot:progress` snapshot of every started step
 * (TASK_2026_721). The publisher replays them on `did-finish-load`, but that
 * replay can reach the page before Angular's `message` listener exists, and a
 * window replaced after every step finished gets none; the pull covers both.
 *
 * It owns no state of its own. Registered as a VALUE in `bootstrap.ts` (the
 * coordinator is constructed in `main.ts`, before the container exists), which
 * also overrides `vscode-core`'s `NullBootReadinessProvider` — last
 * registration wins in tsyringe.
 */
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import type { BootGetReadinessResult } from '@ptah-extension/shared';
import type { BootCoordinator } from '../../activation/boot-coordinator';
import type { BootProgressPublisher } from '../../activation/boot-progress-publisher';

export class ElectronBootReadinessProvider implements IBootReadinessProvider {
  /**
   * Typed as `Pick<…>` rather than the whole coordinator and publisher: this
   * adapter reads one method of each, and narrowing them here keeps the boot
   * lifecycle's other surface (abort, the persistence gate, the warmup
   * barrier, step transitions) out of reach.
   */
  constructor(
    private readonly coordinator: Pick<BootCoordinator, 'snapshot'>,
    private readonly progress: Pick<BootProgressPublisher, 'snapshots'>,
  ) {}

  getReadiness(): BootGetReadinessResult {
    return { ...this.coordinator.snapshot(), steps: this.progress.snapshots() };
  }
}
