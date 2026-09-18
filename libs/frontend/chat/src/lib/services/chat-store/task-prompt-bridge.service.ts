import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';

/**
 * TaskPromptBridgeService — consumes {@link AppStateManager.chatPromptRequest}.
 *
 * The standalone Tasks board (`@ptah-extension/tasks-ui`) launches an
 * orchestration run without importing the chat lib: it sets a
 * {@link ChatPromptRequest} on the root {@link AppStateManager} signal bridge
 * (same inversion as `CanvasSessionRequest` / `HarnessWorkflowRequest`), and
 * this service — provided in root and kept alive by the {@link ChatStore}
 * facade — reacts to it.
 *
 * On each request it:
 *  1. creates + activates a fresh tab,
 *  2. navigates to the chat surface; in grid layout it also fires
 *     {@link AppStateManager.requestCanvasTab} so an ALREADY-mounted canvas
 *     adopts the new tab as a tile (F-D3) — a fresh mount is covered by the
 *     canvas's own `restoreCanvasTilesFromTabs`, and `adoptTab` dedups the
 *     overlap; single layout has no canvas so the request is skipped,
 *  3. prefills the freshly created tab's composer so the user can review and
 *     edit the prompt before sending it,
 *  4. settles `request.resolve` and clears the bridge signal.
 *
 * Worktree isolation remains agent-managed (F-D1): the prefilled orchestrate
 * prompt carries the directive so the agent can isolate its implementation
 * work after the user reviews and sends it.
 */
@Injectable({ providedIn: 'root' })
export class TaskPromptBridgeService {
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);

  /** Re-entrancy guard: one launch at a time (clearing the signal re-fires). */
  private processing = false;

  constructor() {
    effect(() => {
      const request = this.appState.chatPromptRequest();
      if (!request) return;
      untracked(() => {
        void this.consume(request);
      });
    });
  }

  private async consume(request: ChatPromptRequest): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    let outcome: { success: boolean; error?: string } = { success: true };
    try {
      const name = this.deriveSessionName(request);
      const tabId = this.tabManager.createTab(name);
      // Navigate to chat FIRST so a grid-layout canvas mounts and adopts the
      // freshly created tab as a tile before its stream starts.
      this.appState.setCurrentView('chat');
      // In grid layout, ALSO ask the canvas to adopt this tab as a tile (F-D3).
      // `restoreCanvasTilesFromTabs` covers a FRESH canvas mount, but when the
      // canvas is already mounted (no remount / no workspace switch) nothing
      // adopts a newly-created tab — this bridge closes that gap. The canvas
      // effect's `adoptTab` dedups, so a double-adopt on a fresh mount is safe;
      // single layout has no canvas mounted, so we skip the request there.
      const gridLayout = this.appState.layoutMode() === 'grid';
      if (gridLayout) {
        this.appState.requestCanvasTab(tabId, name);
      }
      // Only canvas tiles have SESSION_CONTEXT. In single layout, null scopes
      // the request to the main panel, which is already showing this active tab.
      this.appState.requestComposerPrefill(
        request.prompt,
        gridLayout ? tabId : null,
      );
    } catch (error: unknown) {
      outcome = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      request.resolve?.(outcome);
      this.appState.clearChatPromptRequest();
      this.processing = false;
    }
  }

  private deriveSessionName(request: ChatPromptRequest): string {
    const explicit = request.sessionName?.trim();
    if (explicit) return explicit;
    const fromPrompt = request.prompt.trim().slice(0, 50);
    return fromPrompt || 'Task';
  }
}
