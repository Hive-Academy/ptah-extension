import { Injectable, effect, inject, untracked } from '@angular/core';
import { AppStateManager, type ChatPromptRequest } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';

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
 *  1. creates + activates a fresh tab (both single and grid layouts — in grid
 *     mode the canvas adopts the tab as a tile when it mounts on the view
 *     switch via `restoreCanvasTilesFromTabs`),
 *  2. navigates to the chat surface,
 *  3. submits the prompt through the normal send path (`MessageSenderService`
 *     → `chat:start`; the backend `SlashCommandInterceptor` routes a
 *     `/ptah-core:orchestrate …` prompt to `executeSlashCommandQuery`),
 *  4. settles `request.resolve` and clears the bridge signal.
 *
 * `request.cwd` (worktree path) is carried for session/worktree association;
 * phase-1 sends run against the standard workspace root (the existing
 * `chat:start` mechanics), so the field is preserved but does not yet override
 * the send workspace — the worktree is created and left in place by the caller.
 */
@Injectable({ providedIn: 'root' })
export class TaskPromptBridgeService {
  private readonly appState = inject(AppStateManager);
  private readonly tabManager = inject(TabManagerService);
  private readonly messageSender = inject(MessageSenderService);

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
      // Adopt the send's structured outcome so a *structural* chat:start failure
      // (transport OK but `data.success === false` — AUTH_REQUIRED, model
      // unavailable, license gate) resolves as failure, not the default success
      // — otherwise the Tasks board flips to a phantom `in_progress` on a session
      // that never started (TASK_2026_157 F-D2). A thrown error is still caught
      // below.
      outcome = await this.messageSender.send(request.prompt, { tabId });
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
