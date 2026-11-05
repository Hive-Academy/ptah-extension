import { Injectable, inject } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  MessageId,
  type PermissionRequest,
} from '@ptah-extension/shared';
import {
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  MessageSenderService,
  type SendOutcome,
} from '../message-sender.service';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { FollowUpQueueService } from './follow-up-queue.service';
import { isTabBusyGenerating } from './tab-busy';

/**
 * MessageDispatchService - Send-or-queue routing + slash-command guard.
 *
 * Responsibilities:
 * - sendOrQueueMessage: a tab that can take a turn now gets a normal send
 *   (MessageSender); a busy tab, one held by the Command Center send lock, or
 *   one with follow-ups already waiting hands the message to
 *   `FollowUpQueueService`, which gives it to the backend queue of the
 *   captured session at once (TASK_2026_884). Busy: the tab's in-flight
 *   permissions are auto-denied with the user's content as the
 *   `deny_with_message` reason.
 * - Blocks SDK-native slash commands (`/context`, `/cost`) for
 *   non-Anthropic providers — those commands require Claude-specific runtime
 *   tables.
 */
@Injectable({ providedIn: 'root' })
export class MessageDispatchService {
  private readonly tabManager = inject(TabManagerService);
  private readonly authState = inject(AuthStateService);
  private readonly messageSender = inject(MessageSenderService);
  private readonly followUps = inject(FollowUpQueueService);
  private readonly permissionHandler = inject(PermissionHandlerService);
  private readonly sendLock = inject(CommandCenterSendLockService);

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
   *
   * Resolves with the outcome. A queued message resolves at once with
   * `success: true` and its `queued` identity, before any RPC, so the
   * composer clears; its delivery or failure is reported through
   * `QueuedFollowUpStore`. A blocked slash command or a rejected send
   * resolves `success: false`, after the in-transcript notice.
   */
  async sendOrQueueMessage(
    content: string,
    options?: SendMessageOptions & { ownerToken?: string },
  ): Promise<SendOutcome> {
    if (this.isBlockedSlashCommand(content)) {
      this.showBlockedCommandWarning(content, options?.tabId);
      return {
        success: false,
        error: 'This command is not available for the current provider.',
      };
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

    if (
      resolvedTabId != null &&
      (isStreaming ||
        this.sendLock.isHeld(resolvedTabId, options?.ownerToken) ||
        // Something is already waiting: a normal send would overtake it.
        this.followUps.hasPending(resolvedTabId))
    ) {
      // The message steers ITS tab's turn, so only that tab's pending prompts
      // are answered with it. The queue is global: denying every request would
      // reject another session's prompt with this tab's text as the reason.
      for (const perm of isStreaming
        ? this.permissionHandler.permissionRequests()
        : []) {
        if (!this.isPermissionForTab(perm, resolvedTabId, dispatchTab)) {
          continue;
        }
        this.permissionHandler.handlePermissionResponse({
          id: perm.id,
          decision: 'deny_with_message',
          reason: content,
        });
      }
      const queued = this.followUps.enqueue(resolvedTabId, content, options);
      return queued
        ? { success: true, queued }
        : { success: false, error: 'Invalid message content' };
    }
    const previousTerminalReason = dispatchTab?.lastTerminalReason;
    const outcome = await this.messageSender.send(content, options);
    if (outcome?.cancelled === true) {
      if (resolvedTabId) {
        this.restoreCancelledSend(resolvedTabId, previousTerminalReason);
      }
      return outcome;
    }
    if (outcome?.errorAlreadyShown === true) return outcome;
    if (outcome && !outcome.success && resolvedTabId) {
      this.showSendFailure(
        resolvedTabId,
        outcome.error,
        outcome.errorIsFullText === true,
      );
    }
    return outcome;
  }

  private restoreCancelledSend(
    tabId: string,
    previousTerminalReason: TabState['lastTerminalReason'],
  ): void {
    this.tabManager.markLoaded(tabId);
    this.tabManager.markTabIdle(tabId);
    this.tabManager.setLastTerminalReason(
      tabId,
      previousTerminalReason ?? null,
    );
  }

  /**
   * Whether a pending prompt belongs to the tab a message is dispatched to.
   * Routing precedence: the prompt's own `tabId` (authoritative), then the
   * router's resolved target tabs, then its `sessionId` (which can carry the tab
   * id, as in `PermissionHandlerService.cleanupSession`). A prompt with no
   * routing at all is shown globally, so it is treated as the active tab's.
   */
  /**
   * Whether a pending permission prompt belongs to the tab: the prompts
   * {@link sendOrQueueMessage} answers (denies) when it queues a message on
   * it. Reactive: reads the prompt list and the prompt routing revision.
   */
  hasPendingPermissionForTab(tabId: string): boolean {
    this.permissionHandler.routingTargetRevision();
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab ?? null;
    return this.permissionHandler
      .permissionRequests()
      .some((perm) => this.isPermissionForTab(perm, tabId, tab));
  }

  private isPermissionForTab(
    perm: PermissionRequest,
    tabId: string | null,
    tab: TabState | null,
  ): boolean {
    if (!tabId) return false;
    if (perm.tabId) return perm.tabId === tabId;
    const targets = this.permissionHandler.targetTabsFor(perm.id);
    if (targets.length > 0) return targets.includes(tabId);
    if (perm.sessionId) {
      return (
        perm.sessionId === tabId || perm.sessionId === tab?.claudeSessionId
      );
    }
    return tabId === this.tabManager.activeTabId();
  }

  /**
   * Append the send-failure bubble. `fullText` shows `error` verbatim, for an
   * outcome whose text is complete copy (`SendOutcome.errorIsFullText`).
   */
  private showSendFailure(
    tabId: string,
    error?: string,
    fullText = false,
  ): void {
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    if (!tab) return;
    // Existing transcript channel; rendered through the normal markdown path.
    this.tabManager.setMessages(tabId, [
      ...tab.messages,
      createExecutionChatMessage({
        id: MessageId.create(),
        role: 'assistant',
        rawContent:
          fullText && error
            ? error
            : `Message delivery failed. ${error ?? 'Please retry.'}`,
      }),
    ]);
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
