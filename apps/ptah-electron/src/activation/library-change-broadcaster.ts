/**
 * The `library:changed` push side (TASK_2026_701 B11, A12).
 *
 * The Electron user-layer pass is the one place that knows a Library refresh
 * for a workspace has finished, so it is the one sender of this signal. VS Code
 * and the CLI never broadcast it (D3: the Library is desktop-only).
 *
 * Same three properties as `boot-readiness-broadcaster.ts`, for the same
 * reasons:
 *
 * - **Lazy resolution.** `TOKENS.WEBVIEW_MANAGER` is registered in
 *   `bootstrap.ts`; the first user-layer pass can be requested before that.
 *   Resolving per push, guarded by `isRegistered`, means an early pass simply
 *   has nobody to tell.
 * - **Duck-typed surface.** Only `broadcastMessage` is needed.
 * - **Swallowed failures.** A push that cannot land is a lost display update;
 *   the pass it reports has already finished and its requesters must still
 *   settle.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { LibraryChangedPayload } from '@ptah-extension/shared';

/** The one method this file needs from `WebviewManager`. */
interface BroadcastSurface {
  broadcastMessage: (type: string, payload: unknown) => Promise<void>;
}

/**
 * Push `library:changed` to every renderer.
 *
 * Never throws and never waits: the caller is the tail of a coalesced pass,
 * which must settle its requesters whether or not a window is listening.
 */
export function broadcastLibraryChanged(
  container: DependencyContainer,
  payload: LibraryChangedPayload,
): void {
  try {
    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) return;
    const webviewManager = container.resolve<BroadcastSurface>(
      TOKENS.WEBVIEW_MANAGER,
    );
    // `void`, not awaited: a rejection is caught here so it cannot surface as
    // an unhandled rejection in the main process.
    void webviewManager
      .broadcastMessage(MESSAGE_TYPES.LIBRARY_CHANGED, payload)
      .catch((error: unknown) => {
        console.warn(
          '[Ptah Electron] library:changed broadcast rejected (non-fatal):',
          error instanceof Error ? error.message : String(error),
        );
      });
  } catch (error: unknown) {
    console.warn(
      '[Ptah Electron] library:changed broadcast failed (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}
