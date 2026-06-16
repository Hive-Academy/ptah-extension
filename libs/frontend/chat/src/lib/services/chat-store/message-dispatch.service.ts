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
 * Responsibilities:
 * - sendOrQueueMessage: routes content to MessageSender or ConversationService.queueOrAppendMessage
 *   based on streaming state of the target tab; auto-denies in-flight permissions with the
 *   user's content as `deny_with_message` reason
 * - Blocks SDK-native slash commands (`/compact`, `/context`, `/cost`, `/review`) for
 *   non-Anthropic providers â€” those commands require Claude-specific model behaviour
 * - sendQueuedMessage: post-streaming queue flush via MessageSender.send, forwarding the
 *   stored queuedOptions (files + images + effort) so queued attachments reach the backend
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
    const targetTab = targetTabId
      ? this.tabManager.tabs().find((t) => t.id === targetTabId)
      : null;
    const status = targetTab?.status ?? this.tabManager.activeTabStatus();
    const isStreaming = status === 'streaming' || status === 'resuming';

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
   * @param tabId - Tab to send the queued message for
   * @param content - Message content to send
   */
  async sendQueuedMessage(tabId: string, content: string): Promise<void> {
    try {
      const tab = this.tabManager.tabs().find((t) => t.id === tabId);
      const queuedOptions = tab?.queuedOptions ?? undefined;
      this.tabManager.clearQueuedContentAndOptions(tabId);
      await this.messageSender.send(content, { ...queuedOptions, tabId });
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
