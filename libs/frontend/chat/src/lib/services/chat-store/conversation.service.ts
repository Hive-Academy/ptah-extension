/**
 * ConversationService - Queue and Abort Logic
 *
 * Extracted from ChatStore to handle conversation-related operations:
 * - Queueing/appending content while a turn is streaming
 * - Aborting the current message (with optional sub-agent confirmation)
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import {
  DestroyRef,
  Injectable,
  inject,
  signal,
  Injector,
} from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { SessionId } from '@ptah-extension/shared';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { MessageFinalizationService } from '@ptah-extension/chat-streaming';
import { MessageValidationService } from '../message-validation.service';
import { SessionLoaderService } from './session-loader.service';

/**
 * The backend's slash-command test (`SlashCommandInterceptor.isSlashCommand`):
 * a message is routed as a command only when it STARTS with one.
 */
const SLASH_COMMAND = /^\/[a-zA-Z]/;

/** A slash command waiting behind a tab's queued text. */
interface HeldCommand {
  readonly content: string;
  /** `true` once it is the tab's queued message, `false` when dropped. */
  readonly settle: (queued: boolean) => void;
}

/** A tab's held commands and the queued text the first one waits behind. */
interface HeldCommands {
  behind: string;
  readonly commands: HeldCommand[];
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly messageFinalization = inject(MessageFinalizationService);
  private readonly validator = inject(MessageValidationService);
  private readonly injector = inject(Injector); // For lazy injection to avoid circular dependency
  private readonly _isStopping = signal(false);
  readonly isStopping = this._isStopping.asReadonly();
  private readonly _isAutoSending = signal(false);
  readonly isAutoSending = this._isAutoSending.asReadonly();
  private readonly _queueRestoreSignal = signal<{
    tabId: string;
    content: string;
  } | null>(null);
  readonly queueRestoreSignal = this._queueRestoreSignal.asReadonly();
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

  /**
   * Slash commands queued while the tab already had queued text, per tab,
   * oldest first (TASK_2026_655). Appended to that text, a command would no
   * longer start the message and would be sent as plain text, so each one
   * waits as its own turn: once the text in front of it is sent, it becomes
   * the tab's queued message ({@link releaseHeldCommand}).
   */
  private readonly heldCommands = new Map<string, HeldCommands>();

  constructor() {
    // A closed or force-closed tab never flushes the text its held commands
    // wait behind, so they settle as dropped. A `reset` (`/clear`) keeps the
    // tab, so its queue path ({@link releaseHeldCommand}) still settles them.
    inject(DestroyRef).onDestroy(
      this.tabManager.onTabClosed(({ tabId, kind }) => {
        if (kind !== 'reset') this.dropHeldCommands(tabId);
      }),
    );
  }

  /**
   * Clear the queue restore signal after content has been consumed by ChatInputComponent.
   * Must be called after restoration to prevent the effect from re-firing
   * on every activeTab() change.
   */
  clearQueueRestoreSignal(): void {
    this._queueRestoreSignal.set(null);
  }

  /**
   * Get current session ID from active tab
   */
  private currentSessionId(): SessionId | null {
    return this.tabManager.activeTab()?.claudeSessionId ?? null;
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
   * Queue or append message content to active tab
   * If content already queued, append with newline separator.
   * Options (files, images, effort) are stored only for the first queued message;
   * subsequent appends are text-only.
   *
   * Exception: a slash command is not appended to queued text. It is held as
   * its own turn behind that text, and the returned promise settles `true`
   * when it becomes the tab's queued message, or `false` when it is dropped.
   * Every other call returns `null`.
   */
  public queueOrAppendMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<boolean> | null {
    const targetTabId = options?.tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return null;
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[ConversationService] Invalid queue content: ${validation.reason}`,
      );
      return null;
    }
    const sanitized = this.validator.sanitize(content);

    const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
    const existingQueue = targetTab?.queuedContent?.trim() ?? '';

    if (
      SLASH_COMMAND.test(sanitized.trim()) &&
      (existingQueue || this.heldCommands.has(targetTabId))
    ) {
      return this.holdCommand(targetTabId, sanitized, existingQueue);
    }

    if (existingQueue) {
      this.tabManager.setQueuedContent(
        targetTabId,
        `${existingQueue}\n${sanitized}`,
      );
    } else if (options) {
      this.tabManager.setQueuedContentAndOptions(
        targetTabId,
        sanitized,
        options,
      );
    } else {
      this.tabManager.setQueuedContent(targetTabId, sanitized);
    }
    return null;
  }

  private holdCommand(
    tabId: string,
    content: string,
    behind: string,
  ): Promise<boolean> {
    return new Promise<boolean>((settle) => {
      const held = this.heldCommands.get(tabId);
      if (held) {
        held.commands.push({ content, settle });
      } else {
        this.heldCommands.set(tabId, {
          behind,
          commands: [{ content, settle }],
        });
      }
    });
  }

  /**
   * Make the tab's oldest held command its queued message, so it is sent as
   * its own turn when the running turn ends.
   *
   * - `sent`: the queued text a flush just delivered. When it is not the text
   *   the command waited behind (with any text appended to it), the queue was
   *   reset in between, and the held commands are dropped instead of sent.
   * - Omitted `sent`: the user removed the queued text (cancel or edit).
   *
   * When newer text was queued meanwhile, the command keeps waiting behind it.
   */
  releaseHeldCommand(tabId: string, sent?: string): void {
    const held = this.heldCommands.get(tabId);
    if (!held) return;
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    if (!tab || (sent !== undefined && !sent.trim().startsWith(held.behind))) {
      this.dropHeldCommands(tabId);
      return;
    }
    const waiting = tab.queuedContent?.trim();
    if (waiting) {
      held.behind = waiting;
      return;
    }
    const [next, ...rest] = held.commands;
    // The removed text's attachments must not travel with the command.
    this.tabManager.clearQueuedContentAndOptions(tabId);
    this.tabManager.setQueuedContent(tabId, next.content);
    if (rest.length > 0) {
      this.heldCommands.set(tabId, { behind: next.content, commands: rest });
    } else {
      this.heldCommands.delete(tabId);
    }
    next.settle(true);
  }

  /**
   * Drop the tab's held commands, after a Stop, a failed turn or a tab close:
   * like the queued text, they must not be sent on their own later.
   */
  dropHeldCommands(tabId: string): void {
    const held = this.heldCommands.get(tabId);
    if (!held) return;
    this.heldCommands.delete(tabId);
    for (const command of held.commands) command.settle(false);
  }

  /**
   * Clear queued content and options for a specific tab or the active tab.
   * @param tabId - Optional tab ID. Falls back to active tab if not provided.
   */
  public clearQueuedContent(tabId?: string): void {
    const targetTabId = tabId ?? this.tabManager.activeTabId();
    if (!targetTabId) return;

    this.tabManager.resetQueuedContentAndOptions(targetTabId);
  }

  /**
   * Abort current message
   * Handles queued content restoration and calls backend to stop Claude CLI process
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
    try {
      if (this._isStopping()) {
        return;
      }
      this._isStopping.set(true);

      if (!this.claudeRpcService) {
        console.warn('[ConversationService] RPC service not initialized');
        this._isStopping.set(false);
        return;
      }

      const sessionId = this.currentSessionId();
      console.log('[ConversationService] Attempting to abort session:', {
        sessionId,
        activeTabId: this.tabManager.activeTabId(),
        claudeSessionId: this.tabManager.activeTab()?.claudeSessionId,
      });
      if (!sessionId) {
        console.warn('[ConversationService] No active session to abort');
        this._isStopping.set(false);
        return;
      }
      const activeTab = this.tabManager.activeTab();
      const abortedTabId = activeTab?.id ?? null;

      const turnKey = this.currentTurnKey(sessionId, activeTab);

      if (turnKey !== null && turnKey === this._lastAbortedTurnKey()) {
        console.log(
          '[ConversationService] Turn already aborted, idling tab locally:',
          turnKey,
        );
        this.idleAbortedTabLocally(abortedTabId, sessionId);
        return;
      }

      const queuedContent = activeTab?.queuedContent;

      if (activeTab) {
        this.tabManager.setLastTerminalReason(
          activeTab.id,
          'aborted_streaming',
        );
      }

      if (queuedContent && queuedContent.trim()) {
        this._queueRestoreSignal.set({
          tabId: activeTab.id,
          content: queuedContent,
        });
        this.clearQueuedContent();
      }
      if (activeTab) this.dropHeldCommands(activeTab.id);
      console.log(
        '[ConversationService] Calling chat:abort RPC for session:',
        sessionId,
      );
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
        console.error('[ConversationService] chat:abort RPC failed:', error);
        this._lastAbortedTurnKey.set(null);
        this.idleAbortedTabLocally(abortedTabId, sessionId);
        return;
      }

      if (result.success) {
        console.log(
          '[ConversationService] chat:abort succeeded for session:',
          sessionId,
        );
      } else {
        console.error(
          '[ConversationService] Failed to abort chat:',
          result.error,
        );
        // The backend had no live stream to interrupt (e.g. the session left
        // the SDK registry), so nothing will emit the terminal turn_state.
        // The abort did not take effect, so a retry must reach the backend.
        this._lastAbortedTurnKey.set(null);
        this.idleAbortedTabLocally(abortedTabId, sessionId);
      }
      // On success no finalize / markTabIdle here (TASK_2026_360, review F3):
      // the backend emits the ordered `idle` turn_state with terminalReason
      // 'aborted_streaming' after the last chunk (result -> settleTurn, or the
      // broadcaster's catch/finally -> forceIdle), and `TurnStateApplier`
      // finalizes and idles the tab from it. Only bookkeeping stays below.
      const activeTabId = this.tabManager.activeTabId();
      const resumableSubagents = result.data?.resumableSubagents;
      if (resumableSubagents && resumableSubagents.length > 0) {
        console.log(
          '[ConversationService] chat:abort returned resumable subagents:',
          resumableSubagents.length,
        );
        this.sessionLoader.setResumableSubagents(
          [...resumableSubagents],
          sessionId,
        );
        if (activeTabId) {
          this.messageFinalization.markAgentsAsInterruptedByToolCallIds(
            activeTabId,
            new Set(resumableSubagents.map((r) => r.toolCallId)),
          );
        }
      }
    } catch (error) {
      console.error('[ConversationService] Failed to abort message:', error);
    } finally {
      this._isStopping.set(false);
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
  private idleAbortedTabLocally(
    tabId: string | null,
    sessionId: SessionId,
  ): void {
    if (!tabId) return;
    const tab = this.tabManager.tabs().find((t) => t.id === tabId);
    if (!tab || tab.claudeSessionId !== sessionId) {
      console.log(
        '[ConversationService] Skipping local abort reset — tab no longer owns session:',
        { tabId, sessionId, currentSessionId: tab?.claudeSessionId ?? null },
      );
      return;
    }
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
    if (this._isStopping()) {
      return false;
    }

    try {
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;

      if (!sessionId) {
        console.log(
          '[ConversationService] abortWithConfirmation: no session, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }
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
        console.warn(
          '[ConversationService] abortWithConfirmation: RPC failed, falling back to immediate abort',
          rpcError,
        );
        await this.abortCurrentMessage();
        return true;
      }

      if (agentCount === 0) {
        console.log(
          '[ConversationService] abortWithConfirmation: no running agents, aborting immediately',
        );
        await this.abortCurrentMessage();
        return true;
      }
      console.log(
        '[ConversationService] abortWithConfirmation: showing confirmation for',
        agentCount,
        'running agents',
      );

      const confirmationDialog = this.injector.get(ConfirmationDialogService);
      const confirmed = await confirmationDialog.confirm({
        title: 'Stop Running Agents?',
        message: `${agentCount} agent(s) are still running (${agentTypes}). Stopping will interrupt their current work and any in-progress tool calls will be lost.`,
        confirmLabel: 'Stop All',
        cancelLabel: 'Keep Running',
        confirmStyle: 'warning',
      });

      if (confirmed) {
        console.log(
          '[ConversationService] abortWithConfirmation: user confirmed, aborting',
        );
        await this.abortCurrentMessage();
        return true;
      }

      console.log(
        '[ConversationService] abortWithConfirmation: user cancelled, keeping agents running',
      );
      return false;
    } catch (error) {
      console.error(
        '[ConversationService] abortWithConfirmation failed, falling back to immediate abort:',
        error,
      );
      await this.abortCurrentMessage();
      return true;
    }
  }
}
