import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';

/**
 * How long the canvas may take to drain the tile request. Past it the request
 * is removed from the queue (it can never be adopted later) and settles false.
 */
const CANVAS_TILE_TIMEOUT_MS = 5000;

/**
 * Same-workspace failure: the canvas refused the tile (cap) or did not drain
 * the request in time. The outcome is one boolean, so the message holds for
 * both.
 */
const CANVAS_NOT_OPENED_ERROR =
  'The session did not open on the canvas. If the canvas is full, close a session and try again.';

const WORKSPACE_CHANGED_ERROR =
  'The workspace changed before the session opened. It stays in the previous workspace.';

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
 *     overlap — and waits for the outcome; the request carries a 5 s removal
 *     timeout, so a refusal (tile cap) or a request the canvas did not drain
 *     in time closes the new tab and resolves a failure,
 *  3. prefills the freshly created tab's composer so the user can review and
 *     edit the prompt before sending it,
 *  4. settles `request.resolve` and clears the bridge signal.
 *
 * The webview does not link the session to the task: the prefilled prompt
 * starts with `/orchestrate <taskId>`, and the host links the session once the
 * user sends it (TASK_2026_854, rule R3).
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
      const workspacePath = this.tabManager.activeWorkspacePath;
      // Bounded: a request the canvas has not drained within the timeout is
      // removed from the queue and settles false, so a late cap refusal can
      // never follow a prefill.
      const tiled = await this.appState.requestCanvasTab(
        tabId,
        workspacePath,
        name,
        undefined,
        { timeoutMs: CANVAS_TILE_TIMEOUT_MS },
      );
      if (!tiled && this.tabManager.activeWorkspacePath !== workspacePath) {
        // The canvas dropped the request because the workspace changed during
        // the wait. `closeTab` only searches the active workspace, so the tab
        // stays (empty, unprefilled) in the workspace it was created in.
        outcome = { success: false, error: WORKSPACE_CHANGED_ERROR };
        return;
      }
      if (!tiled) {
        // Same workspace: the canvas refused the tile (cap reached) or did not
        // drain the request in time. A prefill would land on a tab with no
        // tile, so close the empty tab and report the failure instead.
        await this.tabManager.closeTab(tabId);
        outcome = { success: false, error: CANVAS_NOT_OPENED_ERROR };
        return;
      }
      // The prefill is scoped to this tab's tile (its SESSION_CONTEXT).
      this.appState.requestComposerPrefill(request.prompt, tabId);
    } catch (error: unknown) {
      outcome = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      request.resolve?.(outcome);
      // A launch that arrived during the canvas wait replaced this request in
      // the single-slot signal and was skipped by the guard: keep it and run
      // it now instead of clearing it unanswered.
      const next = this.appState.chatPromptRequest();
      if (next === request) this.appState.clearChatPromptRequest();
      this.processing = false;
      if (next && next !== request) void this.consume(next);
    }
  }

  private deriveSessionName(request: ChatPromptRequest): string {
    const explicit = request.sessionName?.trim();
    if (explicit) return explicit;
    const fromPrompt = request.prompt.trim().slice(0, 50);
    return fromPrompt || 'Task';
  }
}
