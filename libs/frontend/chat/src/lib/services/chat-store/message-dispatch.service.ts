import { Injectable, inject } from '@angular/core';
import { AuthStateService } from '@ptah-extension/core';
import { createExecutionChatMessage } from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageSenderService } from '../message-sender.service';
import type { SendMessageOptions } from '@ptah-extension/chat-types';
import { ConversationService } from './conversation.service';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';

/**
 * MessageDispatchService - Send-or-queue routing + slash-command guard.
 *
 * Responsibilities (carved from ChatStore in Wave C7g):
 * - sendOrQueueMessage: routes content to MessageSender or ConversationService.queueOrAppendMessage
 *   based on streaming state of the target tab; auto-denies in-flight permissions with the
 *   user's content as `deny_with_message` reason
 * - Blocks SDK-native slash commands (`/compact`, `/context`, `/cost`, `/review`) for
 *   non-Anthropic providers â€” those commands require Claude-specific model behaviour
 * - sendQueuedMessage: post-streaming queue flush via ConversationService.continueConversation
 *   (NOT MessageSender.send, which would refuse during streaming)
 */
@Injectable({ providedIn: 'root' })
export class MessageDispatchService {
  private readonly tabManager = inject(TabManagerService);
  private readonly authState = inject(AuthStateService);
  private readonly messageSender = inject(MessageSenderService);
  private readonly conversation = inject(ConversationService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  /**
   * SDK-native slash commands that only work with direct Anthropic API.
   * These commands are handled internally by the Claude Agent SDK and require
   * Claude-specific model behavior. Third-party providers (Ollama, Kimi,
   * Copilot, Codex, LM Studio, etc.) don't support them.
   */
  private static readonly SDK_NATIVE_COMMANDS = new Set([
    'compact',
    'context',
    'cost',
    'review',
  ]);

  /**
   * Smart send or queue routing
   * Delegates to MessageSenderService for streaming check, ConversationService for queue
   * (TASK_2025_054 Batch 3 - eliminates callback indirection)
   */
  async sendOrQueueMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    // TASK_2025_COMPACT_FIX: Block SDK-native slash commands for non-Anthropic providers.
    // Commands like /compact, /context, /cost are handled internally by the Claude Agent SDK
    // and require Claude-specific model behavior. Third-party providers don't support them
    // and sending them causes the session to hang indefinitely.
    if (this.isBlockedSlashCommand(content)) {
      this.showBlockedCommandWarning(content, options?.tabId);
      return;
    }

    // Check target tab's streaming state â€” use explicit tabId if provided (canvas tile)
    const targetTabId = options?.tabId;
    const targetTab = targetTabId
      ? this.tabManager.tabs().find((t) => t.id === targetTabId)
      : null;
    const status = targetTab?.status ?? this.tabManager.activeTabStatus();
    const isStreaming = status === 'streaming' || status === 'resuming';

    if (isStreaming) {
      // Auto-deny active permissions with the user's message as context.
      // Uses deny_with_message (not hard deny) so the session continues
      // rather than being killed â€” the user's intent is "no, do this instead".
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

      // Queue the message with full options via ConversationService
      this.conversation.queueOrAppendMessage(content, options);
    } else {
      // Send normally via MessageSender
      await this.messageSender.send(content, options);
    }
  }

  /**
   * Send queued message without interrupting current execution (graceful re-steering)
   *
   * TASK_2025_185: Replaces interruptAndSend. Instead of aborting the current
   * execution (which kills running sub-agents), we simply send the queued message.
   * The SDK handles message queueing natively - agents continue running while
   * the new user message is processed in order.
   *
   * @param tabId - Tab to send the queued message for
   * @param content - Message content to send
   */
  async sendQueuedMessage(tabId: string, content: string): Promise<void> {
    try {
      // Retrieve stored options before clearing
      const tab = this.tabManager.tabs().find((t) => t.id === tabId);
      const queuedOptions = tab?.queuedOptions ?? undefined;

      // Clear the queue and options before sending
      this.tabManager.clearQueuedContentAndOptions(tabId);

      // TASK_2025_185: Call continueConversation directly instead of messageSender.send().
      // messageSender.send() checks tab.status === 'loaded' which is false during streaming,
      // causing it to incorrectly start a NEW conversation instead of continuing the existing one.
      // Pass files from stored options (effort is set at session config level, not per-message for continue).
      // Pass explicit tabId so the user message is added to the correct tab even if the user
      // switched tabs before the queued message fires.
      await this.conversation.continueConversation(
        content,
        queuedOptions?.files,
        tabId,
      );
    } catch (error) {
      console.error('[ChatStore] sendQueuedMessage failed:', error);
      // On error, restore content to queue so user doesn't lose it
      this.tabManager.setQueuedContent(tabId, content);
    }
  }

  /**
   * Check if the message is an SDK-native slash command that won't work
   * with the current (non-Anthropic) provider.
   */
  private isBlockedSlashCommand(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('/')) return false;

    // Extract command name (e.g., "/compact foo" â†’ "compact")
    const spaceIdx = trimmed.indexOf(' ');
    const commandName =
      spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);

    if (!MessageDispatchService.SDK_NATIVE_COMMANDS.has(commandName))
      return false;

    // If auth state hasn't loaded yet, don't block â€” let the backend decide.
    // Blocking on stale defaults would incorrectly reject commands before auth state is known.
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

    // Add the user message so it's visible in the chat
    const userMessage = createExecutionChatMessage({
      id: genId(),
      role: 'user',
      rawContent: content,
    });

    // Add a warning assistant message
    const commandName = content.trim().split(/\s/)[0];
    const warningMessage = createExecutionChatMessage({
      id: genId(),
      role: 'assistant',
      rawContent:
        `The \`${commandName}\` command is a built-in Claude Agent SDK feature ` +
        `that only works with direct Anthropic authentication (API key).\n\n` +
        `Your current provider does not support this command. ` +
        `To use SDK commands like \`/compact\`, \`/context\`, \`/cost\`, and \`/review\`, ` +
        `switch to a direct Anthropic connection in **Settings > Authentication**.`,
    });

    this.tabManager.setMessages(activeTabId, [
      ...(activeTab?.messages ?? []),
      userMessage,
      warningMessage,
    ]);
  }
}
