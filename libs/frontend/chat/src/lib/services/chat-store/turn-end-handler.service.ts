import { Injectable, inject } from '@angular/core';
import {
  SessionId,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageFinalizationService } from '@ptah-extension/chat-streaming';
import { ChatLifecycleService } from './chat-lifecycle.service';

/**
 * TurnEndHandlerService - Owns the SDK `Stop` / `StopFailure` turn-end pivot.
 *
 * Responsibilities:
 * - Resolve tabs bound to the payload's sessionId and fan out turn-end
 *   side-effects (no-tab-bound case warns and no-ops).
 * - Persist the SDK snapshot (`pendingBackgroundTasks`, `pendingSessionCrons`,
 *   `lastTerminalReason`) onto each bound tab so later batches (Phase 3 UI,
 *   streaming-handler safety-net) can read them.
 * - Finalize the in-flight assistant message via
 *   `MessageFinalizationService.finalizeCurrentMessage(tabId, isAborted)`.
 * - Flip the tab to idle via `TabManagerService.markTabIdle(tabId)`.
 *
 * Phase 2 always settles the tab to its existing idle status; the
 * `awaiting-background` distinction lives in Phase 3.
 *
 * StopFailure path reuses `ChatLifecycleService.handleChatError` for the
 * user-facing error surface so the existing 3-tier tab routing + state reset
 * remains the single error-rendering channel.
 */
@Injectable({ providedIn: 'root' })
export class TurnEndHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly lifecycle = inject(ChatLifecycleService);

  /**
   * Handle the `session:turnEnded` push (backend `Stop` SDK hook). Fans out to
   * every tab bound to the payload's session id; stamps the SDK snapshot,
   * finalizes the in-flight message, and marks each tab idle. `isAborted` is
   * derived from `terminalReason`: any non-`completed` non-null value counts.
   */
  handleTurnEnded(payload: SdkTurnEndedPayload): void {
    const tabs = this.tabManager.findTabsBySessionId(
      SessionId.from(payload.sessionId),
    );
    if (tabs.length === 0) {
      console.warn('[ChatStore] handleTurnEnded: no tab bound to sessionId', {
        sessionId: payload.sessionId,
        terminalReason: payload.terminalReason,
        backgroundTaskCount: payload.backgroundTasks.length,
        sessionCronCount: payload.sessionCrons.length,
      });
      return;
    }
    const isAborted =
      payload.terminalReason !== 'completed' && payload.terminalReason !== null;
    for (const tab of tabs) {
      this.tabManager.setTurnEndedFields(tab.id, {
        pendingBackgroundTasks: payload.backgroundTasks,
        pendingSessionCrons: payload.sessionCrons,
        lastTerminalReason: payload.terminalReason,
      });
      this.finalization.finalizeCurrentMessage(tab.id, isAborted);
      this.tabManager.markTabIdle(tab.id);
    }
  }

  /**
   * Handle the `session:turnFailed` push (backend `StopFailure` SDK hook).
   * Always finalizes as aborted and routes the SDK error through the
   * existing `ChatLifecycleService.handleChatError` channel so the error
   * surface, reset semantics, and session refresh stay co-located.
   */
  handleTurnFailed(payload: SdkTurnFailedPayload): void {
    const tabs = this.tabManager.findTabsBySessionId(
      SessionId.from(payload.sessionId),
    );
    if (tabs.length === 0) {
      console.warn('[ChatStore] handleTurnFailed: no tab bound to sessionId', {
        sessionId: payload.sessionId,
        terminalReason: payload.terminalReason,
        error: payload.error,
      });
      return;
    }
    for (const tab of tabs) {
      this.tabManager.setLastTerminalReason(tab.id, payload.terminalReason);
      this.finalization.finalizeCurrentMessage(tab.id, true);
      this.tabManager.markTabIdle(tab.id);
    }
    const errorMessage = this.formatError(payload);
    this.lifecycle.handleChatError({
      sessionId: payload.sessionId,
      error: errorMessage,
    });
  }

  private formatError(payload: SdkTurnFailedPayload): string {
    const base = payload.error ?? 'unknown';
    if (payload.errorDetails) {
      return `${base}: ${payload.errorDetails}`;
    }
    return base;
  }
}
