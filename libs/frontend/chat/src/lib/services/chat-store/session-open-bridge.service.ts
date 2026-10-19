import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type SessionOpenRequest } from '@ptah-extension/core';

/**
 * SessionOpenBridgeService — consumes {@link AppStateManager.sessionOpenRequest}.
 *
 * The standalone Tasks board (`@ptah-extension/tasks-ui`) opens an existing
 * session without importing the chat lib: it calls
 * {@link AppStateManager.requestOpenSession}, and this service — provided in
 * root and kept alive by the `ChatStore` facade — reacts to it with the same
 * routing as every other session opener:
 *  - navigate to the chat surface;
 *  - {@link AppStateManager.requestCanvasSession} (the canvas opens or focuses
 *    a tile).
 *
 * Each request is cleared before it is routed, so the effect re-running (the
 * clear itself) never reopens it.
 */
@Injectable({ providedIn: 'root' })
export class SessionOpenBridgeService {
  private readonly appState = inject(AppStateManager);

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
    void this.appState.requestCanvasSession(request.sessionId, request.name);
  }
}
