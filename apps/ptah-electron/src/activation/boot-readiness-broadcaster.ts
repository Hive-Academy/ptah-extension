/**
 * The boot readiness push side.
 *
 * `BootCoordinator` owns the STATE and deliberately owns nothing else: every
 * import in that file is `import type`, which is what keeps it loadable under
 * ts-jest with no Electron runtime. Reaching a renderer needs a container, so
 * that half lives here and is handed to the coordinator as a plain callback.
 *
 * Three properties matter and each has a reason:
 *
 * - **Lazy resolution.** `TOKENS.WEBVIEW_MANAGER` is registered in
 *   `bootstrap.ts`, and the first phase transitions fire later but from code
 *   that has no way to know that. Resolving per emit — guarded by
 *   `isRegistered`, the same idiom as `register-shared-rpc-handlers.ts` — means
 *   a broadcaster wired before the manager exists still works once it does.
 * - **Duck-typed surface.** Only `broadcastMessage` is needed, and typing it
 *   structurally (as `boot-heavy-services.ts` already does) keeps this file off
 *   the manager's much larger contract.
 * - **Swallowed failures.** The window can be closed, the container can be mid
 *   teardown. A push that cannot land is a lost display update, and the boot it
 *   was narrating must continue regardless.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { BootReadinessChangedPayload } from '@ptah-extension/shared';

/** The one method this file needs from `WebviewManager`. */
interface BroadcastSurface {
  broadcastMessage: (type: string, payload: unknown) => Promise<void>;
}

/**
 * Build the emitter `BootCoordinator.onReadinessChange` expects.
 *
 * Never throws, so it is safe to call from inside `setPhase` on the boot's
 * critical path.
 */
export function createBootReadinessBroadcaster(
  container: DependencyContainer,
): (payload: BootReadinessChangedPayload) => void {
  return (payload: BootReadinessChangedPayload): void => {
    try {
      if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) return;
      const webviewManager = container.resolve<BroadcastSurface>(
        TOKENS.WEBVIEW_MANAGER,
      );
      // `void`, not awaited: the caller is a synchronous state transition on
      // the boot path. A rejection is caught here so it cannot surface as an
      // unhandled rejection in the main process.
      void webviewManager
        .broadcastMessage(MESSAGE_TYPES.BOOT_READINESS_CHANGED, payload)
        .catch((error: unknown) => {
          console.warn(
            '[BootReadiness] broadcast rejected (non-fatal):',
            error instanceof Error ? error.message : String(error),
          );
        });
    } catch (error: unknown) {
      console.warn(
        '[BootReadiness] broadcast failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}
