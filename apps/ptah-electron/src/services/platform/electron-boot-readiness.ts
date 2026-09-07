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
 * It owns no state of its own. Registered as a VALUE in `bootstrap.ts` (the
 * coordinator is constructed in `main.ts`, before the container exists), which
 * also overrides `vscode-core`'s `NullBootReadinessProvider` — last
 * registration wins in tsyringe.
 */
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import type { BootReadinessChangedPayload } from '@ptah-extension/shared';
import type { BootCoordinator } from '../../activation/boot-coordinator';

export class ElectronBootReadinessProvider implements IBootReadinessProvider {
  /**
   * Typed as `Pick<…>` rather than the whole coordinator: this adapter reads
   * one method, and narrowing it here keeps the boot lifecycle's other surface
   * (abort, the persistence gate, the warmup barrier) out of reach.
   */
  constructor(
    private readonly coordinator: Pick<BootCoordinator, 'snapshot'>,
  ) {}

  getReadiness(): BootReadinessChangedPayload {
    return this.coordinator.snapshot();
  }
}
