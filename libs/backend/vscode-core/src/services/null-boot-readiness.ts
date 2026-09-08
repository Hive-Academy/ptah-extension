/**
 * NullBootReadinessProvider — null-object default for
 * `IBootReadinessProvider` (port in `platform-core`).
 *
 * Only the Electron host stages its boot behind a window: `BootCoordinator`
 * runs the heavy work after the window paints, so there is a real interval in
 * which the backend is `warming`. The VS Code extension host and the CLI have
 * no such interval — by the time anything can issue `boot:getReadiness` their
 * activation has already finished.
 *
 * So the honest answer for those hosts is a constant one, and registering it
 * under `PLATFORM_TOKENS.BOOT_READINESS` in the platform-agnostic bootstrap
 * guarantees the token ALWAYS resolves. The RPC handler can inject it
 * unconditionally, and no host can present an unregistered token.
 *
 * The Electron host registers `ElectronBootReadinessProvider` BEFORE this runs
 * and the `if (!container.isRegistered(...))` guard in
 * `register-platform-agnostic.ts` leaves it alone.
 */
import { injectable } from 'tsyringe';
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import type { BootReadinessChangedPayload } from '@ptah-extension/shared';

@injectable()
export class NullBootReadinessProvider implements IBootReadinessProvider {
  /**
   * Captured at construction rather than per call, so `startedAt` is stable
   * across reads and elapsed time in the renderer counts from something real
   * (the moment this host wired its services) instead of resetting to zero on
   * every poll.
   */
  private readonly startedAt = Date.now();

  /** No staged boot on this host: always settled, always ready. */
  getReadiness(): BootReadinessChangedPayload {
    return {
      readiness: 'ready',
      phase: 'settled',
      startedAt: this.startedAt,
    };
  }
}
