/**
 * ConversationService - Abort Logic
 *
 * Extracted from ChatStore to handle conversation-related operations:
 * - Aborting the current message (with optional sub-agent confirmation),
 *   returning the follow-ups the Stop withdrew to the composer
 *   (TASK_2026_884; queueing itself lives in `FollowUpQueueService`)
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { DestroyRef, Injectable, inject, signal, Injector } from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { MessageFinalizationService } from '@ptah-extension/chat-streaming';
import { FollowUpQueueService } from './follow-up-queue.service';
import { SessionLoaderService } from './session-loader.service';

interface AbortTarget {
  readonly tabId: string;
  readonly sessionId: SessionId;
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly messageFinalization = inject(MessageFinalizationService);
  private readonly followUps = inject(FollowUpQueueService);
  private readonly injector = inject(Injector); // For lazy injection to avoid circular dependency
  private readonly logger = inject(LoggingService);
  private readonly _isStopping = signal(false);
  readonly isStopping = this._isStopping.asReadonly();
  private readonly stopRequests = new Map<string, {
    readonly owner: symbol;
    readonly outcome: Promise<boolean>;
  }>();
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();
  /**
   * Turn key ({@link currentTurnKey}) of the last abort whose `chat:abort` RPC
   * was issued and answered successfully. A repeat Stop on that same turn skips
   * the RPC and idles the tab locally, because the backend has nothing left to
   * interrupt and will never emit the terminal `turn_state` (TASK_2026_367).
   *
   * It is turn-scoped, not session-scoped: a follow-up message reuses the same
   * session id, so a session-scoped marker would swallow the Stop of the NEXT
   * live turn and leave the backend running. It is also cleared whenever the
   * RPC throws or reports failure, so a retry after a transport failure still
   * reaches the backend.
   */
  private readonly _lastAbortedTurnKey = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(
      this.tabManager.onTabClosed(({ tabId }) => {
        this.messageFinalization.clearPendingPrompts(tabId);
      }),
    );
  }

  /** The host has confirmed this exact SDK session's stream and record ended. */
  retireEndedSessionPrompts(tabId: string, sessionId: string): void {
    this.messageFinalization.clearPendingPromptsForSession(tabId, sessionId);
  }

  private activeAbortTarget(): AbortTarget | null {
    const tab = this.tabManager.activeTab();
    return tab?.claudeSessionId ? { tabId: tab.id, sessionId: tab.claudeSessionId } : null;
  }

  private tabForTarget(target: AbortTarget): TabState | null {
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(target.tabId)?.tab;
    return tab?.claudeSessionId === target.sessionId ? tab : null;
  }

  /**
   * Identity of the streaming turn an abort targets.
   *
   * A follow-up message continues the SAME session (`chat:continue`), so the
   * session id alone cannot tell one turn from the next. The key combines the
   * session with the streaming message id of the running turn and the id of the
   * user bubble that started it. Either component can be absent on its own (no
   * assistant message has streamed yet; a tab whose messages are not loaded),
   * so both are used. A turn with neither is unidentified and returns null: the
   * abort then always reaches the backend, which is the safe direction.
   */
  private currentTurnKey(
    sessionId: SessionId,
    tab: TabState | null | undefined,
  ): string | null {
    const streamingMessageId = tab?.streamingState?.currentMessageId ?? null;
    const messages = tab?.messages ?? [];
    let lastUserMessageId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageId = messages[i].id;
        break;
      }
    }
    if (!streamingMessageId && !lastUserMessageId) return null;
    return `${sessionId}::${streamingMessageId ?? '-'}::${lastUserMessageId ?? '-'}`;
  }

  /**
   * Abort current message
   * Calls the backend to stop the turn and returns the follow-ups the Stop
   * withdrew (backend-confirmed first, then the ones the renderer held) to
   * the composer, in FIFO order
   *
   * Lifecycle ownership depends on whether the abort reached a live stream:
   *
   * - Success: partial streaming content is NOT finalized here. The backend's
   *   ordered abort `turn_state` (terminalReason `aborted_streaming`) arrives
   *   after the last chunk and `TurnStateApplier` finalizes + idles the tab.
   * - Failure (`{ success: false }` or the RPC throws): the backend could not
   *   interrupt a live session (e.g. `SessionNotActiveError`, or the request
   *   never reached it), so no broadcaster loop exists to emit a terminal
   *   `turn_state`. The local reset in `idleAbortedTabLocally` is the only
   *   thing that can clear the spinner. It is scoped to the tab that owned
   *   the aborted session at the time the abort was issued and is skipped if
   *   that tab's `claudeSessionId` changed while the RPC was in flight.
   */
  async abortCurrentMessage(): Promise<void> {
    const target = this.activeAbortTarget();
    if (target) await this.stopTarget(target, false);
  }

  private stopTarget(target: AbortTarget, confirm: boolean): Promise<boolean> {
    const key = JSON.stringify([target.tabId, target.sessionId]);
    // A second Stop for this exact target shares the owner's actual outcome.
    const existing = this.stopRequests.get(key);
    if (existing) return existing.outcome;
    if (!this.tabForTarget(target)) return Promise.resolve(false);

    const owner = Symbol('stop owner');
    this._isStopping.set(true);
    const outcome = (confirm ? this.confirmAndAbort(target) : this.abortCurrentMessageFor(target))
      .finally(() => {
        if (this.stopRequests.get(key)?.owner !== owner) return;
        this.stopRequests.delete(key);
        this._isStopping.set(this.stopRequests.size > 0);
      });
    this.stopRequests.set(key, { owner, outcome });
    return outcome;
  }

  private async abortCurrentMessageFor(target: AbortTarget): Promise<boolean> {
    try {
      const tab = this.tabForTarget(target);
      if (!tab) return false;
      const { tabId, sessionId } = target;
      const turnKey = this.currentTurnKey(sessionId, tab);

      // Taken before any await: once the turn ends, a held item would start
      // its own turn.
      const heldTexts = this.followUps.takeHeldForStop(tabId, sessionId);
      this.followUps.beginStop(sessionId);
      if (turnKey !== null && turnKey === this._lastAbortedTurnKey()) {
        this.followUps.restoreAfterStop(tabId, undefined, heldTexts);
        this.followUps.endStop(sessionId);
        this.idleAbortedTabLocally(target);
        return true;
      }

      this.tabManager.setLastTerminalReason(tabId, 'aborted_streaming');
      this._lastAbortedTurnKey.set(turnKey);
      let result: Awaited<
        ReturnType<typeof this.claudeRpcService.call<'chat:abort'>>
      >;
      try {
        result = await this.claudeRpcService.call('chat:abort', {
          sessionId,
        });
      } catch (error: unknown) {
        // Transport failure: the request may never have reached the backend,
        // so no ordered turn_state will ever arrive for this session, and a
        // later Stop on this same turn must be able to retry the RPC.
        this.logger.error('ConversationService', 'chat:abort RPC failed', error);
        this.followUps.restoreAfterStop(tabId, this.followUps.endStop(sessionId), heldTexts);
        this._lastAbortedTurnKey.set(null);
        this.idleAbortedTabLocally(target);
        return false;
      }

      // Only items the backend confirmed it withdrew: an item a turn had
      // already claimed is running and is not unsent.
      const pushedWithdrawals = this.followUps.endStop(sessionId);
      this.followUps.restoreAfterStop(
        tabId,
        result.data?.withdrawn ?? (!result.success ? pushedWithdrawals : undefined),
        heldTexts,
      );
      if (result.success) {
        this.messageFinalization.clearPendingPromptsForSession(tabId, sessionId);
      } else {
        this.logger.error('ConversationService', 'Failed to abort chat', result.error);
        // The backend had no live stream to interrupt (e.g. the session left
        // the SDK registry), so nothing will emit the terminal turn_state.
        // The abort did not take effect, so a retry must reach the backend.
        this._lastAbortedTurnKey.set(null);
        this.idleAbortedTabLocally(target);
      }
      // On success no finalize / markTabIdle here (TASK_2026_360, review F3):
      // the backend emits the ordered `idle` turn_state with terminalReason
      // 'aborted_streaming' after the last chunk (result -> settleTurn, or the
      // broadcaster's catch/finally -> forceIdle), and `TurnStateApplier`
      // finalizes and idles the tab from it. Only bookkeeping stays below.
      const resumableSubagents = result.data?.resumableSubagents;
      if (resumableSubagents && resumableSubagents.length > 0) {
        this.sessionLoader.setResumableSubagents(
          [...resumableSubagents],
          sessionId,
        );
        if (this.tabForTarget(target)) {
          this.messageFinalization.markAgentsAsInterruptedByToolCallIds(
            tabId,
            new Set(resumableSubagents.map((r) => r.toolCallId)),
          );
        }
      }
      return result.success;
    } catch (error) {
      this.logger.error('ConversationService', 'Failed to abort message', error);
      return false;
    }
  }

  /**
   * Failure-path fallback for {@link abortCurrentMessage}: no stream exists
   * to emit the terminal `turn_state`, so finalize + idle the tab locally.
   *
   * Session-scoped: the tab is re-resolved by id at call time and is left
   * untouched unless its `claudeSessionId` still equals the session the abort
   * was issued for, so a replacement query on the same tab is never reset.
   */
  private idleAbortedTabLocally(target: AbortTarget): void {
    const tab = this.tabForTarget(target);
    if (!tab) return;
    const { tabId } = target;
    if (tab.streamingState) {
      this.messageFinalization.finalizeCurrentMessage(tabId, true);
    }
    this.tabManager.markTabIdle(tabId);
  }

  /**
   * Abort with confirmation dialog when sub-agents are running
   *
   * Shows a warning dialog if sub-agents are actively running, giving the
   * user a chance to cancel the abort. If no agents are running or no
   * session exists, aborts immediately without confirmation.
   *
   * @returns true if aborted, false if user cancelled
   */
  async abortWithConfirmation(): Promise<boolean> {
    const target = this.activeAbortTarget();
    return target ? this.abortWithConfirmationFor(target.tabId, target.sessionId) : false;
  }

  async abortWithConfirmationFor(tabId: string, sessionId: SessionId): Promise<boolean> {
    const target: AbortTarget = { tabId, sessionId };
    return this.stopTarget(target, true);
  }

  private async confirmAndAbort(target: AbortTarget): Promise<boolean> {
    const { sessionId } = target;
    try {
      let agentCount = 0;
      let agentTypes = '';

      try {
        const result = await this.claudeRpcService.call('chat:running-agents', {
          sessionId,
        });
        const agents = result.data?.agents ?? [];
        agentCount = agents.length;
        agentTypes = agents.map((a) => a.agentType).join(', ');
      } catch (rpcError) {
        this.logger.warn('ConversationService', 'Running agents query failed', rpcError);
        return this.abortCurrentMessageFor(target);
      }

      if (agentCount === 0) {
        return this.abortCurrentMessageFor(target);
      }

      const confirmationDialog = this.injector.get(ConfirmationDialogService);
      const confirmed = await confirmationDialog.confirm({
        title: 'Stop Running Agents?',
        message: `${agentCount} agent(s) are still running (${agentTypes}). Stopping will interrupt their current work and any in-progress tool calls will be lost.`,
        confirmLabel: 'Stop All',
        cancelLabel: 'Keep Running',
        confirmStyle: 'warning',
      });

      if (confirmed) {
        return this.abortCurrentMessageFor(target);
      }
      return false;
    } catch (error) {
      this.logger.error('ConversationService', 'Abort confirmation failed', error);
      return this.abortCurrentMessageFor(target);
    }
  }
}
