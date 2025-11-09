import { Injectable, signal, computed } from '@angular/core';
import {
  StrictChatSession,
  StrictChatMessage,
  MessageId,
} from '@ptah-extension/shared';
import type { ProcessedClaudeMessage } from './claude-message-transformer.service';

export interface ChatState {
  currentSession: StrictChatSession | null;
  messages: readonly StrictChatMessage[];
  claudeMessages: readonly ProcessedClaudeMessage[];
  lastUpdated: number;
}

/**
 * Chat State Service - Centralized Chat State Management
 *
 * Responsibilities:
 * - Manage current session state
 * - Store and update message collections
 * - Handle Claude message collections
 * - Provide reactive state updates via signals
 * - Maintain state consistency and history
 *
 * Extracted from ChatService for single responsibility principle
 *
 * **Modern Angular Patterns**:
 * - Pure signal-based state management
 * - No BehaviorSubject or manual subscriptions
 * - Readonly signals for immutability
 * - Computed signals for derived state
 * - No manual cleanup needed (signals are managed by Angular)
 */
@Injectable({
  providedIn: 'root',
})
export class ChatStateService {
  // Private state signals
  private readonly _currentSession = signal<StrictChatSession | null>(null);
  private readonly _messages = signal<readonly StrictChatMessage[]>([]);
  private readonly _claudeMessages = signal<readonly ProcessedClaudeMessage[]>(
    []
  );
  private readonly _lastUpdated = signal<number>(Date.now());

  // Public readonly signals
  readonly currentSession = this._currentSession.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly claudeMessages = this._claudeMessages.asReadonly();
  readonly lastUpdated = this._lastUpdated.asReadonly();

  // Computed state
  readonly chatState = computed(
    (): ChatState => ({
      currentSession: this._currentSession(),
      messages: this._messages(),
      claudeMessages: this._claudeMessages(),
      lastUpdated: this._lastUpdated(),
    })
  );

  readonly hasMessages = computed(() => {
    return this._messages().length > 0 || this._claudeMessages().length > 0;
  });

  readonly messageCount = computed(() => ({
    total: this._messages().length + this._claudeMessages().length,
    strict: this._messages().length,
    claude: this._claudeMessages().length,
  }));

  readonly sessionInfo = computed(() => {
    const session = this._currentSession();
    if (!session) return null;

    return {
      id: session.id,
      name: session.name,
      messageCount: this.messageCount().total,
      lastActivity: session.lastActiveAt || session.createdAt,
      hasTokenUsage: !!session.tokenUsage,
    };
  });

  // Session management
  setCurrentSession(session: StrictChatSession | null): void {
    this._currentSession.set(session);
    this.updateTimestamp();
  }

  updateSession(updates: Partial<StrictChatSession>): void {
    const currentSession = this._currentSession();
    if (!currentSession) return;

    this._currentSession.set({
      ...currentSession,
      ...updates,
      lastActiveAt: Date.now(),
    });
    this.updateTimestamp();
  }

  // Message management
  setMessages(messages: readonly StrictChatMessage[]): void {
    this._messages.set(messages);
    this.updateTimestamp();
  }

  addMessage(message: StrictChatMessage): void {
    const currentMessages = this._messages();
    this._messages.set([...currentMessages, message]);
    this.updateTimestamp();
  }

  updateMessage(
    messageId: MessageId,
    updates: Partial<StrictChatMessage>
  ): void {
    const currentMessages = this._messages();
    const updatedMessages = currentMessages.map((msg) =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );
    this._messages.set(updatedMessages);
    this.updateTimestamp();
  }

  removeMessage(messageId: MessageId): void {
    const currentMessages = this._messages();
    const filteredMessages = currentMessages.filter(
      (msg) => msg.id !== messageId
    );
    this._messages.set(filteredMessages);
    this.updateTimestamp();
  }

  clearMessages(): void {
    this._messages.set([]);
    this.updateTimestamp();
  }

  // Claude message management
  setClaudeMessages(messages: readonly ProcessedClaudeMessage[]): void {
    this._claudeMessages.set(messages);
    this.updateTimestamp();
  }

  addClaudeMessage(message: ProcessedClaudeMessage): void {
    const currentMessages = this._claudeMessages();
    this._claudeMessages.set([...currentMessages, message]);
    this.updateTimestamp();
  }

  updateClaudeMessage(
    messageId: MessageId,
    updates: Partial<ProcessedClaudeMessage>
  ): void {
    const currentMessages = this._claudeMessages();
    const updatedMessages = currentMessages.map((msg) =>
      msg.id === messageId ? { ...msg, ...updates } : msg
    );
    this._claudeMessages.set(updatedMessages);
    this.updateTimestamp();
  }

  removeClaudeMessage(messageId: MessageId): void {
    const currentMessages = this._claudeMessages();
    const filteredMessages = currentMessages.filter(
      (msg) => msg.id !== messageId
    );
    this._claudeMessages.set(filteredMessages);
    this.updateTimestamp();
  }

  clearClaudeMessages(): void {
    this._claudeMessages.set([]);
    this.updateTimestamp();
  }

  // Message queries
  findMessage(messageId: MessageId): StrictChatMessage | null {
    return this._messages().find((msg) => msg.id === messageId) || null;
  }

  findClaudeMessage(messageId: MessageId): ProcessedClaudeMessage | null {
    return this._claudeMessages().find((msg) => msg.id === messageId) || null;
  }

  getMessagesByType(
    type: 'user' | 'assistant' | 'system'
  ): StrictChatMessage[] {
    return this._messages().filter((msg) => msg.type === type);
  }

  getRecentMessages(count: number): StrictChatMessage[] {
    const messages = this._messages();
    return messages.slice(Math.max(0, messages.length - count));
  }

  getMessagesInTimeRange(
    startTime: number,
    endTime: number
  ): StrictChatMessage[] {
    return this._messages().filter(
      (msg) => msg.timestamp >= startTime && msg.timestamp <= endTime
    );
  }

  // State utilities
  getStateSnapshot(): ChatState {
    return this.chatState();
  }

  restoreState(state: ChatState): void {
    this._currentSession.set(state.currentSession);
    this._messages.set(state.messages);
    this._claudeMessages.set(state.claudeMessages);
    this.updateTimestamp();
  }

  resetState(): void {
    this._currentSession.set(null);
    this._messages.set([]);
    this._claudeMessages.set([]);
    this.updateTimestamp();
  }

  // Message merging and synchronization
  mergeMessages(newMessages: readonly StrictChatMessage[]): void {
    const currentMessages = this._messages();
    const messageMap = new Map(currentMessages.map((msg) => [msg.id, msg]));

    // Merge new messages, updating existing ones
    newMessages.forEach((newMsg) => {
      messageMap.set(newMsg.id, newMsg);
    });

    // Convert back to array and sort by timestamp
    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );

    this._messages.set(mergedMessages);
    this.updateTimestamp();
  }

  mergeClaudeMessages(newMessages: readonly ProcessedClaudeMessage[]): void {
    const currentMessages = this._claudeMessages();
    const messageMap = new Map(currentMessages.map((msg) => [msg.id, msg]));

    // Merge new messages, updating existing ones
    newMessages.forEach((newMsg) => {
      messageMap.set(newMsg.id, newMsg);
    });

    // Convert back to array and sort by timestamp
    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
    );

    this._claudeMessages.set(mergedMessages);
    this.updateTimestamp();
  }

  // Streaming message handling
  upsertStreamingMessage(message: ProcessedClaudeMessage): void {
    const currentMessages = this._claudeMessages();
    const existingIndex = currentMessages.findIndex(
      (msg) => msg.id === message.id
    );

    if (existingIndex >= 0) {
      // Update existing message
      const updatedMessages = [...currentMessages];
      updatedMessages[existingIndex] = message;
      this._claudeMessages.set(updatedMessages);
    } else {
      // Add new message
      this._claudeMessages.set([...currentMessages, message]);
    }

    this.updateTimestamp();
  }

  // Private methods
  private updateTimestamp(): void {
    this._lastUpdated.set(Date.now());
  }
}
