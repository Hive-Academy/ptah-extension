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
        const effectiveReason =
          payload.terminalReason ?? lookup.tab.lastTerminalReason ?? null;
        // Snapshot the SDK turn-end fields onto the background partition. Status
        // defaults to 'loaded'; the `awaiting-background` flip (when background
        // work remains) is applied AFTER finalize via `markTabAwaitingBackground`
        // below so it survives finalize's own status microtask — exactly as the
        // active branch does.
        this.tabManager.updateBackgroundTab(lookup.tab.id, {
          pendingBackgroundTasks: payload.backgroundTasks,
          pendingSessionCrons: payload.sessionCrons,
          lastTerminalReason: effectiveReason,
          status: 'loaded',
        });
        // Promote the in-flight assistant reply from `streamingState` into the
        // persisted `messages` array. Without this a turn that completes while
        // its tab is backgrounded leaves its reply solely in `streamingState`,
        // which the reload sanitize nulls — silent data loss. `finalizeCurrentMessage`
        // is workspace-aware (resolves the owner across partitions) and writes
        // through the workspace-aware `applyFinalizedTurn` path.
        this.finalization.finalizeCurrentMessage(lookup.tab.id, isAborted);
        // `updateBackgroundTab` mutates only the partitioned TabState — it does
        // NOT touch the global `_streamingTabIds` visual set that drives the
        // tab-bar spinner. Without this the spinner stays lit forever once the
        // owning tab is backgrounded (turn started active → spinner lit → user
        // switched away → turn ends here with no markTabIdle). The active
        // branch below always pairs turn-end with `markTabIdle` regardless of
        // background work (awaiting-background is a separate indicator), so the
        // background branch mirrors that. `markTabIdle` keys purely on tab id,
        // so it is safe for a background tab.
        this.tabManager.markTabIdle(lookup.tab.id);
        if (hasBackgroundWork) {
          this.tabManager.markTabAwaitingBackground(lookup.tab.id);
        }
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
      const effectiveReason =
        payload.terminalReason ?? tab.lastTerminalReason ?? null;
      this.tabManager.setTurnEndedFields(tab.id, {
        pendingBackgroundTasks: payload.backgroundTasks,
        pendingSessionCrons: payload.sessionCrons,
        lastTerminalReason: effectiveReason,
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
        const transitionsToLoaded =
          lookup.tab.status === 'awaiting-background' && remaining === 0;
        if (transitionsToLoaded) {
          updates.status = 'loaded';
        }
        this.tabManager.updateBackgroundTab(lookup.tab.id, updates);
        // Only clear the spinner when this subagent-stop actually ends the
        // turn (awaiting-background → loaded with no remaining tasks). A
        // subagent ending mid-turn (tasks still running) must NOT clear the
        // parent turn's spinner.
        if (transitionsToLoaded) {
          this.tabManager.markTabIdle(lookup.tab.id);
        }
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
   *
   * When a foreground tab is bound to the session, finalizes as aborted and
   * routes the SDK error through `ChatLifecycleService.handleChatError` so the
   * error surface, reset semantics, and session refresh stay co-located.
   *
   * When no foreground tab is bound, the failure belongs to a background
   * workspace (or no tab at all): stamp the background tab's terminal state via
   * `updateBackgroundTab` and return. The foreground `handleChatError` channel
   * is intentionally skipped — its active-tab fallback would otherwise reset an
   * unrelated foreground tab for a failure that is not its own.
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
        // Promote the aborted turn's reply into `messages` (workspace-aware,
        // marks streaming nodes interrupted) so it survives reload — mirrors the
        // active branch's `finalizeCurrentMessage(tab.id, true)`.
        this.finalization.finalizeCurrentMessage(lookup.tab.id, true);
        // Clear the tab-bar spinner for the backgrounded tab — see the
        // handleTurnEnded background branch for why `updateBackgroundTab`
        // alone leaves `_streamingTabIds` (and thus the spinner) stuck.
        this.tabManager.markTabIdle(lookup.tab.id);
        return;
      }
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
