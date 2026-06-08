import { Injectable, inject } from '@angular/core';
import {
  SessionId,
  type SdkAssistantMessageError,
  type SdkSubagentEndedPayload,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import {
  TabManagerService,
  type BackgroundAgentId,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import {
  BackgroundAgentStore,
  MessageFinalizationService,
} from '@ptah-extension/chat-streaming';
import { ChatLifecycleService } from './chat-lifecycle.service';

const SDK_ERROR_MESSAGES: Readonly<Record<SdkAssistantMessageError, string>> = {
  authentication_failed:
    'Authentication failed. Check your API key in Settings.',
  rate_limit: 'Rate limited by Anthropic. Wait a moment and try again.',
  oauth_org_not_allowed:
    "This organization is not allowed to access Anthropic's API.",
  billing_error: 'Billing error. Check your Anthropic account.',
  invalid_request: 'Invalid request to Anthropic API.',
  model_not_found: 'Model not found. Check your model selection in Settings.',
  server_error: 'Anthropic server error. Try again shortly.',
  max_output_tokens: 'Maximum output tokens reached.',
  unknown: 'An unknown error occurred.',
};

/**
 * TurnEndHandlerService - Owns the SDK `Stop` / `StopFailure` / `SubagentStop`
 * turn-end pivot.
 *
 * Responsibilities:
 * - Resolve tabs bound to the payload's sessionId and fan out turn-end
 *   side-effects (no-tab-bound case warns and no-ops).
 * - Persist the SDK snapshot (`pendingBackgroundTasks`, `pendingSessionCrons`,
 *   `lastTerminalReason`) onto each bound tab so later batches (Phase 3 UI,
 *   streaming-handler safety-net) can read them.
 * - Finalize the in-flight assistant message via
 *   `MessageFinalizationService.finalizeCurrentMessage(tabId, isAborted)`.
 * - Pivot the tab status: `'awaiting-background'` when the Stop snapshot
 *   reports in-flight background tasks, else `'loaded'` via the visual
 *   `markTabIdle` path (Phase 2 behavior preserved when no background work).
 * - Reconcile `BackgroundAgentStore` + per-tab `pendingBackgroundTasks` on
 *   each SubagentStop and flip `'awaiting-background' → 'loaded'` when the
 *   SDK reports zero remaining background tasks.
 *
 * StopFailure path reuses `ChatLifecycleService.handleChatError` for the
 * user-facing error surface so the existing 3-tier tab routing + state reset
 * remains the single error-rendering channel. The raw SDK error code is
 * mapped to a user-readable string via `formatTurnFailedError`.
 */
@Injectable({ providedIn: 'root' })
export class TurnEndHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly finalization = inject(MessageFinalizationService);
  private readonly lifecycle = inject(ChatLifecycleService);
  private readonly backgroundAgents = inject(BackgroundAgentStore);

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
    const isAborted =
      payload.terminalReason !== 'completed' && payload.terminalReason !== null;
    const hasBackgroundWork = payload.backgroundTasks.length > 0;
    if (tabs.length === 0) {
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        payload.sessionId,
      );
      if (lookup) {
        this.tabManager.updateBackgroundTab(lookup.tab.id, {
          pendingBackgroundTasks: payload.backgroundTasks,
          pendingSessionCrons: payload.sessionCrons,
          lastTerminalReason: payload.terminalReason,
          status: hasBackgroundWork ? 'awaiting-background' : 'loaded',
        });
        return;
      }
      console.warn('[ChatStore] handleTurnEnded: no tab bound to sessionId', {
        sessionId: payload.sessionId,
        terminalReason: payload.terminalReason,
        backgroundTaskCount: payload.backgroundTasks.length,
        sessionCronCount: payload.sessionCrons.length,
      });
      return;
    }
    for (const tab of tabs) {
      this.tabManager.setTurnEndedFields(tab.id, {
        pendingBackgroundTasks: payload.backgroundTasks,
        pendingSessionCrons: payload.sessionCrons,
        lastTerminalReason: payload.terminalReason,
      });
      this.finalization.finalizeCurrentMessage(tab.id, isAborted);
      this.tabManager.markTabIdle(tab.id);
      if (hasBackgroundWork) {
        this.tabManager.markTabAwaitingBackground(tab.id);
      }
    }
  }

  /**
   * Handle the `session:subagentEnded` push (backend `SubagentStop` SDK hook).
   * Reconciles `BackgroundAgentStore` with the stopped agent and applies the
   * SDK's authoritative `backgroundTasks` snapshot onto every bound tab.
   *
   * Status-transition matrix (`tab.status` before → after):
   *   `awaiting-background` + remaining === 0 → `loaded`
   *   `awaiting-background` + remaining > 0   → `awaiting-background` (snapshot only)
   *   `loaded`                                → `loaded` (idempotent snapshot)
   *   `streaming`                             → `streaming` (race: Stop pending)
   *   `resuming` / `fresh` / `draft`          → unchanged (snapshot only)
   */
  handleSubagentEnded(payload: SdkSubagentEndedPayload): void {
    const sessionId = SessionId.from(payload.sessionId);
    const tabs = this.tabManager.findTabsBySessionId(sessionId);
    const agentKey = payload.agentId as BackgroundAgentId;
    const knownEntry = this.backgroundAgents.findByAgentId(agentKey);
    const resolvedToolCallId = knownEntry?.toolCallId ?? '';
    this.backgroundAgents.onStopped({
      id: `subagent-stopped-${payload.agentId}-${payload.timestamp}`,
      eventType: 'background_agent_stopped',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      messageId: '',
      toolCallId: resolvedToolCallId,
      agentId: payload.agentId,
      agentType: payload.agentType,
    });
    const remaining = payload.backgroundTasks.length;
    if (tabs.length === 0) {
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        payload.sessionId,
      );
      if (lookup) {
        const updates: Partial<TabState> = {
          pendingBackgroundTasks: payload.backgroundTasks,
        };
        if (lookup.tab.status === 'awaiting-background' && remaining === 0) {
          updates.status = 'loaded';
        }
        this.tabManager.updateBackgroundTab(lookup.tab.id, updates);
        return;
      }
      console.warn(
        '[ChatStore] handleSubagentEnded: no tab bound to sessionId',
        { sessionId: payload.sessionId, agentId: payload.agentId },
      );
      return;
    }
    for (const tab of tabs) {
      this.tabManager.setPendingBackgroundTasks(
        tab.id,
        payload.backgroundTasks,
      );
      if (tab.status === 'awaiting-background' && remaining === 0) {
        this.tabManager.markLoaded(tab.id);
      }
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
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        payload.sessionId,
      );
      if (lookup) {
        this.tabManager.updateBackgroundTab(lookup.tab.id, {
          lastTerminalReason: payload.terminalReason,
          status: 'loaded',
        });
      } else {
        console.warn(
          '[ChatStore] handleTurnFailed: no tab bound to sessionId',
          {
            sessionId: payload.sessionId,
            terminalReason: payload.terminalReason,
            error: payload.error,
          },
        );
      }
    } else {
      for (const tab of tabs) {
        this.tabManager.setLastTerminalReason(tab.id, payload.terminalReason);
        this.finalization.finalizeCurrentMessage(tab.id, true);
        this.tabManager.markTabIdle(tab.id);
      }
    }
    const errorMessage = this.formatTurnFailedError(payload);
    this.lifecycle.handleChatError({
      sessionId: payload.sessionId,
      error: errorMessage,
    });
  }

  /**
   * Map an SDK `StopFailure` payload to a user-readable error string.
   * Falls back to the `'unknown'` mapping for any code not present in the
   * `SDK_ERROR_MESSAGES` table; appends `errorDetails` in parentheses when
   * the SDK provides additional context.
   */
  private formatTurnFailedError(payload: SdkTurnFailedPayload): string {
    const friendly =
      SDK_ERROR_MESSAGES[payload.error] ?? SDK_ERROR_MESSAGES.unknown;
    if (payload.errorDetails) {
      return `${friendly} (${payload.errorDetails})`;
    }
    return friendly;
  }
}
