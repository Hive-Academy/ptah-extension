import { Injectable, inject } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import { createExecutionChatMessage } from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';
import type {
  SendMessageOptions,
  SessionStatus,
  StreamingState,
} from '@ptah-extension/chat-types';
import { ConversationService } from './conversation.service';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';

/**
 * The ONE definition of "this tab is still generating".
 *
 * Two readers, and they must never disagree: `MessageDispatchService`, which
 * decides send-vs-queue, and the chat input's Stop button, which is the only
 * way out of the queue-only state this returns `true` for. Gate the affordance
 * on a different signal than the gate that creates the state and you get a tab
 * that can neither send nor stop (TASK_2026_382 review B5).
 *
 * Three sources, OR'd:
 *
 * 1. `status` — the root-turn phase written by the backend `turn_state` stream.
 * 2. `isStreamingTab` — the `_streamingTabIds` spinner set, which the SDK's
 *    pause/resume self-heal can leave set while `status` reverted to `loaded`.
 *    Routing a follow-up to `send()` there spins up a fresh AbortController and
 *    KILLS the in-flight stream.
 * 3. An UNSETTLED TREE — the condition the user can actually see, because the
 *    live bubble in the transcript is rendered from `streamingState`, not from
 *    the phase the other two read. A writer that clears the turn flags without
 *    settling the tree opens a window where the transcript shows a streaming
 *    bubble while the predicate says idle.
 *
 * ## The tree condition has a BOUNDED EXIT, and that is load-bearing
 *
 * `streamingState != null` alone is a latch, not a predicate.
 * `StreamingHandlerService` mints an empty `StreamingState` for events routed
 * to a tab that has none, only `message_start` ever sets `currentMessageId`,
 * and `MessageFinalizationService.finalizeCurrentMessage` early-returns on a
 * null `currentMessageId`. So one stray post-turn event — the late
 * `agent_progress` / `agent_completed` / `message_complete` that TASK_2026_360
 * documents as routine — used to pin a `loaded` tab into queue-only mode with
 * NO drain able to fire and no recovery short of a reload.
 *
 * A tree with no `currentMessageId` is a tree nothing can finalize, so it is
 * not a turn in flight — it is debris. Treat it as idle. A real streaming
 * window always has one: `message_start` sets it and it survives until
 * `applyFinalizedTurn` / `clearStreamingForLoaded` clears the turn.
 *
 * ## The `awaiting-background` / `sleeping` exclusion is also load-bearing
 *
 * `chat-types.ts` defines both as "agent itself is idle, USER INPUT REMAINS
 * ENABLED", with background tasks or session crons still running. A subagent's
 * next `message_start` builds a fresh `streamingState` there, so the field is
 * non-null while sending is correct by design — and queuing would strand the
 * message, because neither drain fires: the root-turn flush
 * (`streaming-handler.service.ts`) needs a `message_complete` with no
 * `parentToolUseId` (the root turn already ended, and subagent completions all
 * carry one), and `handleSessionStats` returns `null` whenever `streamingState`
 * is present. Do not widen this back to an unconditional check.
 *
 * The rest of the `SessionStatus` union needs no exclusion: `streaming` /
 * `resuming` are already caught by source 1; `fresh` / `draft` / `loaded` claim
 * no live tree, so a tree present under them IS the accidental window this
 * exists for; `switching` is a momentary UI transition during which a live tree
 * still ends with a root `message_complete`, so the queue drains.
 *
 * This is NOT the deleted TASK_2026_360 self-heal. That heuristic lived in the
 * streaming WRITE path and re-derived "the agent is busy" from event content,
 * re-lighting the spinner with nothing left to clear it. This reads tab state
 * that already exists and writes nothing.
 */
export function isTabBusyGenerating(input: {
  status: SessionStatus | null | undefined;
  streamingState: StreamingState | null | undefined;
  isStreamingTab: boolean;
}): boolean {
  const { status, streamingState, isStreamingTab } = input;
  const hasUnsettledTree =
    streamingState != null &&
    streamingState.currentMessageId != null &&
    status !== 'awaiting-background' &&
    status !== 'sleeping';
  return (
    status === 'streaming' ||
    status === 'resuming' ||
    hasUnsettledTree ||
    isStreamingTab
  );
}

/**
 * MessageDispatchService - Send-or-queue routing + slash-command guard.
 *
 * Responsibilities:
 * - sendOrQueueMessage: routes content to MessageSender or ConversationService.queueOrAppendMessage
 *   based on streaming state of the target tab; auto-denies in-flight permissions with the
 *   user's content as `deny_with_message` reason
 * - Blocks SDK-native slash commands (`/compact`, `/context`, `/cost`, `/review`) for
 *   non-Anthropic providers — those commands require Claude-specific model behaviour
 * - sendQueuedMessage: post-streaming queue flush via
 *   MessageSenderService.continueExistingSessionForQueueFlush, forwarding the
 *   stored queuedOptions (files + images + effort) so queued attachments reach
 *   the backend without aborting the previous stream's controller
 */
@Injectable({ providedIn: 'root' })
export class MessageDispatchService {
  private readonly tabManager = inject(TabManagerService);
  private readonly authState = inject(AuthStateService);
  private readonly messageSender = inject(MessageSenderService);
  private readonly conversation = inject(ConversationService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  /**
   * SDK-native slash commands whose output is only correct on a first-party
   * Anthropic connection. `/context` and `/cost` read from the runtime's
   * Anthropic context-window + pricing tables, which the SDK does not resolve
   * for non-`api.anthropic.com` base URLs (it falls back to a hardcoded 200k
   * window and has no pricing for third-party models) — so the numbers are
   * wrong on proxied providers (Copilot, Codex, Ollama, Kimi, LM Studio, …).
   *
   * `/compact` and `/review` are NOT here: both are summarization/review model
   * calls that route through the provider's own model via the translation
   * proxy, so they work for every provider.
   */
  private static readonly ANTHROPIC_ONLY_COMMANDS = new Set([
    'context',
    'cost',
  ]);

  /**
   * Smart send or queue routing
   * Delegates to MessageSenderService for streaming check, ConversationService for queue.
   */
  async sendOrQueueMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    if (this.isBlockedSlashCommand(content)) {
      this.showBlockedCommandWarning(content, options?.tabId);
      return;
    }
    const targetTabId = options?.tabId;
    // `tabs()` is the ACTIVE-WORKSPACE signal. An explicit `tabId` can name a
    // canvas tile or a tab parked in a background workspace, and `find` on
    // `tabs()` misses it — the predicate then silently read ANOTHER tab's
    // status while `MessageSenderService.send` appended the bubble to the
    // active tab, i.e. the wrong transcript (TASK_2026_382 W4). Resolve across
    // workspaces so the tab we judge is the tab we send to.
    const targetTab = targetTabId
      ? (this.tabManager.findTabByIdAcrossWorkspaces(targetTabId)?.tab ?? null)
      : null;
    const resolvedTabId = targetTabId ?? this.tabManager.activeTabId();
    const status = targetTab?.status ?? this.tabManager.activeTabStatus();
    /** The tab the bubble will actually land on — see `isStreaming` below. */
    const dispatchTab = targetTab ?? this.tabManager.activeTab();
    // One predicate, shared with the Stop button — see `isTabBusyGenerating`
    // for why each source is here and why the tree condition is bounded.
    const isStreaming = isTabBusyGenerating({
      status,
      streamingState: dispatchTab?.streamingState,
      isStreamingTab:
        resolvedTabId != null && this.tabManager.isTabStreaming(resolvedTabId),
    });

    if (isStreaming) {
      const activePermissions = this.permissionHandler.permissionRequests();
      if (activePermissions.length > 0) {
        for (const perm of activePermissions) {
          this.permissionHandler.handlePermissionResponse({
            id: perm.id,
            decision: 'deny_with_message',
            reason: content,
          });
        }
      }
      this.conversation.queueOrAppendMessage(content, options);
    } else {
      await this.messageSender.send(content, options);
    }
  }

  /**
   * Send queued message without interrupting current execution (graceful re-steering)
   *
   * Replaces interruptAndSend. Instead of aborting the current execution
   * (which kills running sub-agents), we simply send the queued message.
   * The SDK handles message queueing natively - agents continue running
   * while the new user message is processed in order.
   *
   * Routes through `MessageSenderService.continueExistingSessionForQueueFlush`
   * so the flush reuses the existing AbortController (if any) instead of
   * installing a fresh one — see the dedicated method for the rationale.
   *
   * @param tabId - Tab to send the queued message for
   * @param content - Message content to send
   */
  async sendQueuedMessage(tabId: string, content: string): Promise<void> {
    try {
      const tab = this.tabManager.tabs().find((t) => t.id === tabId);
      const sessionId = tab?.claudeSessionId;
      if (!sessionId) {
        // A queue flush only fires on turn-end, and a completed turn must have
        // a bound session. Reaching here means that invariant broke — rather
        // than silently starting a NEW conversation the user didn't ask for,
        // warn and leave the message queued so it survives for retry/restore.
        console.warn(
          '[ChatStore] sendQueuedMessage: no session bound at queue flush — keeping message queued',
          { tabId },
        );
        this.tabManager.setQueuedContent(tabId, content);
        return;
      }
      const queuedOptions = tab?.queuedOptions ?? undefined;
      this.tabManager.clearQueuedContentAndOptions(tabId);
      await this.messageSender.continueExistingSessionForQueueFlush(
        content,
        sessionId,
        { ...queuedOptions, tabId },
      );
    } catch (error) {
      console.error('[ChatStore] sendQueuedMessage failed:', error);
      this.tabManager.setQueuedContent(tabId, content);
    }
  }

  /**
   * Check if the message is a slash command whose output is inaccurate on the
   * current (non-Anthropic) provider.
   */
  private isBlockedSlashCommand(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('/')) return false;
    const spaceIdx = trimmed.indexOf(' ');
    const commandName =
      spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);

    if (!MessageDispatchService.ANTHROPIC_ONLY_COMMANDS.has(commandName))
      return false;
    if (this.authState.isLoading()) return false;

    const authMethod = this.authState.persistedAuthMethod();
    if (authMethod === 'apiKey' || authMethod === 'claudeCli') return false;

    return true;
  }

  /**
   * Show a warning message in chat when an SDK-native slash command
   * is used with a non-Anthropic provider.
   */
  private showBlockedCommandWarning(content: string, tabId?: string): void {
    const activeTabId = tabId ?? this.tabManager.activeTabId();
    if (!activeTabId) return;

    const activeTab = this.tabManager.tabs().find((t) => t.id === activeTabId);
    const genId = () =>
      `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const userMessage = createExecutionChatMessage({
      id: genId(),
      role: 'user',
      rawContent: content,
    });
    const commandName = content.trim().split(/\s/)[0];
    const warningMessage = createExecutionChatMessage({
      id: genId(),
      role: 'assistant',
      rawContent:
        `The \`${commandName}\` command reports context-window and cost figures ` +
        `from Anthropic's runtime tables, which aren't resolved for your current ` +
        `provider — so the numbers would be inaccurate.\n\n` +
        `It's available on a direct Anthropic connection (API key or Claude ` +
        `subscription) in **Settings > Authentication**. ` +
        `\`/compact\` and \`/review\` work on every provider.`,
    });

    this.tabManager.setMessages(activeTabId, [
      ...(activeTab?.messages ?? []),
      userMessage,
      warningMessage,
    ]);
  }
}
