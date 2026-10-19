import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { BoardTaskLinkCaptureService } from './board-task-link-capture.service';

/** How long the bridge waits for the canvas to report the tile outcome. */
const CANVAS_TILE_TIMEOUT_MS = 5000;

const CANVAS_FULL_ERROR =
  'The canvas is full. Close a session and try again.';

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
 *     overlap — and waits (bounded) for the canvas to report the outcome;
 *     a refusal (tile cap) closes the new tab and resolves a failure,
 *  3. prefills the freshly created tab's composer so the user can review and
 *     edit the prompt before sending it,
 *  4. settles `request.resolve` and clears the bridge signal.
 *
 * When the request carries a `taskId`, the new tab is registered with
 * {@link BoardTaskLinkCaptureService} once the bridge keeps it (before the
 * prefill).
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
      const tiled = await this.awaitCanvasTile(
        this.appState.requestCanvasTab(tabId, workspacePath, name),
      );
      if (
        tiled === false &&
        this.tabManager.activeWorkspacePath !== workspacePath
      ) {
        // The canvas dropped the request because the workspace changed during
        // the wait. `closeTab` only searches the active workspace, so the tab
        // stays (empty, unprefilled) in the workspace it was created in.
        outcome = { success: false, error: WORKSPACE_CHANGED_ERROR };
        return;
      }
      if (tiled === false) {
        // Same workspace: the canvas refused the tile (cap reached): a prefill
        // would land on a surface nobody mounted. Close the empty tab and
        // report the failure instead.
        await this.tabManager.closeTab(tabId);
        outcome = { success: false, error: CANVAS_FULL_ERROR };
        return;
      }
      // `tiled` is true, or `'timeout'`: the canvas did not drain the request
      // in time (not mounted yet). The request stays queued and is adopted on
      // mount, so keep the prefill and report success.
      // A board start links the session to its task once the first send
      // resolves the real session id (TASK_2026_580). Registered only once the
      // tab is kept, so a refused launch leaves no pending pair behind.
      if (request.taskId) {
        this.boardTaskLinkCapture.expect(tabId, request.taskId);
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

  /** Race the canvas adoption outcome against {@link CANVAS_TILE_TIMEOUT_MS}. */
  private async awaitCanvasTile(
    adoption: Promise<boolean>,
  ): Promise<boolean | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), CANVAS_TILE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([adoption, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private deriveSessionName(request: ChatPromptRequest): string {
    const explicit = request.sessionName?.trim();
    if (explicit) return explicit;
    const fromPrompt = request.prompt.trim().slice(0, 50);
    return fromPrompt || 'Task';
  }
}
