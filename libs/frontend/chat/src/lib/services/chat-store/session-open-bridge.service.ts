import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type SessionOpenRequest } from '@ptah-extension/core';
import { SessionLoaderService } from './session-loader.service';

/**
 * SessionOpenBridgeService — consumes {@link AppStateManager.sessionOpenRequest}.
 *
 * The standalone Tasks board (`@ptah-extension/tasks-ui`) opens an existing
 * session without importing the chat lib: it calls
 * {@link AppStateManager.requestOpenSession}, and this service — provided in
 * root and kept alive by the `ChatStore` facade — reacts to it with the same
 * routing as the sidebar's `AppShellComponent.onSessionClick`:
 *  - navigate to the chat surface;
 *  - grid layout → {@link AppStateManager.requestCanvasSession} (the canvas
 *    opens or focuses a tile);
 *  - single layout → `switchSession` (focus the open tab, or load it).
 *
 * Each request is cleared before it is routed, so the effect re-running (the
 * clear itself, or a later layout change) never reopens it.
 *
 * It calls {@link SessionLoaderService.switchSession} rather than
 * `ChatStore.switchSession` (a pure delegate) because `ChatStore` injects
 * this service eagerly; injecting `ChatStore` back would be a DI cycle.
 */
@Injectable({ providedIn: 'root' })
export class SessionOpenBridgeService {
  private readonly appState = inject(AppStateManager);
  private readonly sessionLoader = inject(SessionLoaderService);

  constructor() {
    effect(() => {
      const request = this.appState.sessionOpenRequest();
      if (!request) return;
      untracked(() => this.consume(request));
    });
  }

  private consume(request: SessionOpenRequest): void {
    this.appState.clearSessionOpenRequest(request);
    this.appState.setCurrentView('chat');

    if (this.appState.layoutMode() === 'grid') {
      void this.appState.requestCanvasSession(request.sessionId, request.name);
      return;
    }

    // A deleted or unloadable session fails inside switchSession, which
    // already settles the tab; log the rejection so it is not unhandled.
    this.sessionLoader.switchSession(request.sessionId).catch((error) => {
      console.error(
        '[SessionOpenBridgeService] Failed to open session:',
        request.sessionId,
        error,
      );
    });
  }
}
