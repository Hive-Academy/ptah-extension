import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { BoardTaskLinkCaptureService } from './board-task-link-capture.service';

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
 *  2. navigates to the chat surface and fires
 *     {@link AppStateManager.requestCanvasTab} so an ALREADY-mounted canvas
 *     adopts the new tab as a tile (F-D3) — a fresh mount is covered by the
 *     canvas's own `restoreCanvasTilesFromTabs`, and `adoptTab` dedups the
 *     overlap,
 *  3. prefills the freshly created tab's composer so the user can review and
 *     edit the prompt before sending it,
 *  4. settles `request.resolve` and clears the bridge signal.
 *
 * When the request carries a `taskId`, the new tab is registered with
 * {@link BoardTaskLinkCaptureService} right after it is created.
 *
 * Worktree isolation remains agent-managed (F-D1): the prefilled orchestrate
 * prompt carries the directive so the agent can isolate its implementation
 * work after the user reviews and sends it.
 */
@Injectable({ providedIn: 'root' })
export class TaskPromptBridgeService {
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly boardTaskLinkCapture = inject(BoardTaskLinkCaptureService);

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
      // A board start links the session to its task once the first send
      // resolves the real session id (TASK_2026_580).
      if (request.taskId) {
        this.boardTaskLinkCapture.expect(tabId, request.taskId);
      }
      // Navigate to chat FIRST so the canvas mounts and adopts the freshly
      // created tab as a tile before its stream starts.
      this.appState.setCurrentView('chat');
      // ALSO ask the canvas to adopt this tab as a tile (F-D3).
      // `restoreCanvasTilesFromTabs` covers a FRESH canvas mount, but when the
      // canvas is already mounted (no remount / no workspace switch) nothing
      // adopts a newly-created tab — this bridge closes that gap. The canvas
      // effect's `adoptTab` dedups, so a double-adopt on a fresh mount is safe.
      // The request carries the workspace the fresh tab lives in (the active
      // one at creation time), so a canvas that mounts only later — after a
      // workspace switch — drops it instead of tiling this tab into another
      // workspace's grid.
      this.appState.requestCanvasTab(
        tabId,
        this.tabManager.activeWorkspacePath,
        name,
      );
      // The prefill is scoped to this tab's tile (its SESSION_CONTEXT).
      this.appState.requestComposerPrefill(request.prompt, tabId);
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
