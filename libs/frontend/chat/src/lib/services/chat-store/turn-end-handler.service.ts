import { Injectable, inject } from '@angular/core';
import {
  SessionId,
  type SdkAssistantMessageError,
  type SdkSubagentEndedPayload,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import {
  ConversationRegistry,
  TabSessionBinding,
  TabManagerService,
  type BackgroundAgentId,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { BackgroundAgentStore } from '@ptah-extension/chat-streaming';
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
 * TurnEndHandlerService - Consumes the SDK `Stop` / `StopFailure` /
 * `SubagentStop` hook pushes for their SNAPSHOT fields only.
 *
 * Since TASK_2026_360 the turn boundary is the backend `turn_state` event,
 * delivered in the chunk stream and applied by `TurnStateApplier`. That event
 * owns finalization, `status`, the tab-bar spinner and workspace liveness. The
 * hook pushes travel on a separate channel with no ordering guarantee against
 * the chunks, so nothing here may touch `status` or the spinner any more.
 *
 * What remains:
 * - `handleTurnEnded`: stamp `pendingBackgroundTasks` / `pendingSessionCrons`
 *   / `lastTerminalReason` on every bound tab (the Stop hook fires before the
 *   final assistant message is pulled, so this is the earliest the snapshot
 *   is known).
 * - `handleSubagentEnded`: reconcile `BackgroundAgentStore` for a KNOWN
 *   background agent and stamp the SDK's "who is still running" snapshot. A
 *   foreground subagent is not a background agent and is not stopped here.
 * - `handleTurnFailed`: stamp `lastTerminalReason` and route the SDK error
 *   through `ChatLifecycleService.handleChatError` (the single error surface).
 */
@Injectable({ providedIn: 'root' })
export class TurnEndHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly lifecycle = inject(ChatLifecycleService);
  private readonly backgroundAgents = inject(BackgroundAgentStore);
  private readonly conversations = inject(ConversationRegistry);
  private readonly sessionBinding = inject(TabSessionBinding);

  /**
   * True when the session is owned by a SURFACE rather than a tab — the harness
   * / New Project workflow, the wizard, any non-tab host.
   *
   * Those flows never create a `TabState`: they claim a `SurfaceId`, and their
   * turn-end effects (liveness, transcript) are driven by the surface path in
   * `ChatMessageHandler` + `StreamRouter` before this service is ever called.
   * Both tab lookups therefore come back empty for them, which used to fire
   * "no tab bound to sessionId" on every single workflow turn — a warning that
   * was never true and that drowned the case it exists to report, an event for
   * a session nothing at all is listening to.
   */
  private isSurfaceOwned(sessionId: string): boolean {
    const record = this.conversations.findContainingSession(
      sessionId as ClaudeSessionId,
    );
    return record ? this.sessionBinding.hasBoundSurfaces(record.id) : false;
  }

  /**
   * Handle the `session:turnEnded` push (backend `Stop` SDK hook). Stamps the
   * SDK snapshot on every tab bound to the payload's session id — active
   * workspace first, background partition as the fallback. No status write.
   */
  handleTurnEnded(payload: SdkTurnEndedPayload): void {
    const tabs = this.tabManager.findTabsBySessionId(
      SessionId.from(payload.sessionId),
    );
    if (tabs.length === 0) {
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        payload.sessionId,
      );
      if (lookup) {
        const effectiveReason =
          payload.terminalReason ?? lookup.tab.lastTerminalReason ?? null;
        this.tabManager.updateBackgroundTab(lookup.tab.id, {
          pendingBackgroundTasks: payload.backgroundTasks,
          pendingSessionCrons: payload.sessionCrons,
          lastTerminalReason: effectiveReason,
        });
        return;
      }
      if (!this.isSurfaceOwned(payload.sessionId)) {
        console.warn('[ChatStore] handleTurnEnded: no tab bound to sessionId', {
          sessionId: payload.sessionId,
          terminalReason: payload.terminalReason,
          backgroundTaskCount: payload.backgroundTasks.length,
          sessionCronCount: payload.sessionCrons.length,
        });
      }
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
    }
  }

  /**
   * Handle the `session:subagentEnded` push (backend `SubagentStop` SDK hook).
   * Stops the matching entry in `BackgroundAgentStore` when the agent is a
   * known BACKGROUND agent, and applies the SDK's authoritative
   * `backgroundTasks` snapshot onto every bound tab. The
   * `awaiting-background → loaded` flip is the backend's call: it arrives as
   * an `idle` `turn_state` once the registry sees no remaining tasks.
   */
  handleSubagentEnded(payload: SdkSubagentEndedPayload): void {
    const sessionId = SessionId.from(payload.sessionId);
    const tabs = this.tabManager.findTabsBySessionId(sessionId);
    const agentKey = payload.agentId as BackgroundAgentId;
    const knownEntry = this.backgroundAgents.findByAgentId(agentKey);
    if (knownEntry) {
      this.backgroundAgents.onStopped({
        id: `subagent-stopped-${payload.agentId}-${payload.timestamp}`,
        eventType: 'background_agent_stopped',
        timestamp: payload.timestamp,
        sessionId: payload.sessionId,
        messageId: '',
        toolCallId: knownEntry.toolCallId,
        agentId: payload.agentId,
        agentType: payload.agentType,
      });
    }
    if (tabs.length === 0) {
      const lookup = this.tabManager.findTabBySessionIdAcrossWorkspaces(
        payload.sessionId,
      );
      if (lookup) {
        this.tabManager.updateBackgroundTab(lookup.tab.id, {
          pendingBackgroundTasks: payload.backgroundTasks,
        });
        return;
      }
      if (!this.isSurfaceOwned(payload.sessionId)) {
        console.warn(
          '[ChatStore] handleSubagentEnded: no tab bound to sessionId',
          { sessionId: payload.sessionId, agentId: payload.agentId },
        );
      }
      return;
    }
    for (const tab of tabs) {
      this.tabManager.setPendingBackgroundTasks(
        tab.id,
        payload.backgroundTasks,
      );
    }
  }

  /**
   * Handle the `session:turnFailed` push (backend `StopFailure` SDK hook).
   *
   * When a foreground tab is bound to the session, stamps the terminal reason
   * and routes the SDK error through `ChatLifecycleService.handleChatError` so
   * the error surface, reset semantics, and session refresh stay co-located.
   * Finalization of the aborted reply is done by the `failed` `turn_state`.
   *
   * When no foreground tab is bound, the failure belongs to a background
   * workspace (or no tab at all): stamp the background tab's terminal reason
   * via `updateBackgroundTab` and return. The foreground `handleChatError`
   * channel is intentionally skipped — its active-tab fallback would otherwise
   * reset an unrelated foreground tab for a failure that is not its own.
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
        });
        return;
      }
      if (!this.isSurfaceOwned(payload.sessionId)) {
        console.warn(
          '[ChatStore] handleTurnFailed: no tab bound to sessionId',
          {
            sessionId: payload.sessionId,
            terminalReason: payload.terminalReason,
            error: payload.error,
          },
        );
      }
      return;
    }
    for (const tab of tabs) {
      this.tabManager.setLastTerminalReason(tab.id, payload.terminalReason);
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
