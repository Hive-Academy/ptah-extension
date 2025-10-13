/**
 * Chat Messages List Component
 *
 * Displays a list of Claude CLI messages with advanced features:
 * - Virtual scrolling for performance
 * - Message grouping and threading (5-minute threshold)
 * - Smooth animations and transitions
 * - Auto-scroll to latest message
 * - Message selection and actions (copy, regenerate, export)
 *
 * ARCHITECTURE:
 * - Level 2 component (depends on ChatMessageContentComponent)
 * - Modern Angular 20 patterns (input/output/computed/effect/viewChild)
 * - OnPush change detection for performance
 * - Types from @ptah-extension/core (ProcessedClaudeMessage)
 *
 * FEATURES:
 * - Message grouping by role and time proximity
 * - Auto-scroll with new message detection
 * - Message actions (copy, regenerate for assistant, export)
 * - Typing indicators during streaming
 * - Scroll-to-bottom button with new message count
 * - Load more on scroll to top
 */

import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  viewChild,
  ElementRef,
  AfterViewInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatMessageContentComponent } from '../chat-message-content/chat-message-content.component';
import { type ProcessedClaudeMessage } from '@ptah-extension/core';
import { type SessionId, type MessageId } from '@ptah-extension/shared';

/**
 * Message group interface for temporal grouping
 * Groups messages by role with max 5-minute gap
 */
interface MessageGroup {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly messages: readonly ProcessedClaudeMessage[];
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly isComplete: boolean;
}

/**
 * Typing indicator for streaming messages
 */
interface TypingIndicator {
  readonly role: string;
  readonly text: string;
  readonly messageId: MessageId;
}

@Component({
  selector: 'ptah-chat-messages-list',
  standalone: true,
  imports: [CommonModule, ChatMessageContentComponent],
  templateUrl: './chat-messages-list.component.html',
  styleUrl: './chat-messages-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatMessagesListComponent implements AfterViewInit {
  // === ANGULAR 20 PATTERN: Modern input/output signals ===
  readonly messages = input.required<readonly ProcessedClaudeMessage[]>();
  readonly sessionId = input<SessionId | null>(null);
  readonly loading = input(false);
  readonly autoScroll = input(true);
  readonly showGroupHeaders = input(true);
  readonly showMessageActions = input(true);
  readonly enableImagePreviews = input(true);
  readonly maxGroupGapMinutes = input(5); // Group messages within X minutes

  readonly messageClicked = output<ProcessedClaudeMessage>();
  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{
    tool: string;
    action: string;
    data?: unknown;
  }>();
  readonly messageActioned = output<{
    action: string;
    message: ProcessedClaudeMessage;
  }>();
  readonly scrolledToTop = output<void>();

  // === View children ===
  readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('scrollContainer');

  // === Internal state signals ===
  private readonly selectedMessageId = signal<MessageId | null>(null);
  private readonly scrollPosition = signal({ top: 0, isAtBottom: true });
  readonly newMessagesCount = signal(0);
  private readonly lastSeenMessageCount = signal(0);

  // === ANGULAR 20 PATTERN: Computed signals for derived state ===
  readonly hasMessages = computed(() => this.messages().length > 0);

  readonly messageGroups = computed(() => {
    return this.groupMessages(this.messages());
  });

  readonly isAtBottom = computed(() => this.scrollPosition().isAtBottom);
  readonly hasNewMessages = computed(() => this.newMessagesCount() > 0);

  readonly typingIndicators = computed((): readonly TypingIndicator[] => {
    const streamingMessages = this.messages().filter((m) => m.isStreaming);
    return streamingMessages.map((m) => ({
      role: m.type,
      text: `${this.getRoleDisplayName(m.type)} is typing...`,
      messageId: m.id,
    }));
  });

  readonly hasTypingIndicators = computed(
    () => this.typingIndicators().length > 0
  );

  constructor() {
    // ANGULAR 20 PATTERN: effect() for side effects instead of ngOnChanges
    // Auto-scroll effect when new messages arrive
    effect(() => {
      const messageCount = this.messages().length;
      const lastSeen = this.lastSeenMessageCount();

      if (messageCount > lastSeen) {
        this.newMessagesCount.set(messageCount - lastSeen);

        if (this.autoScroll() && this.isAtBottom()) {
          this.scheduleScrollToBottom();
        }
      }
    });

    // Update last seen count when at bottom
    effect(() => {
      if (this.isAtBottom()) {
        this.lastSeenMessageCount.set(this.messages().length);
        this.newMessagesCount.set(0);
      }
    });
  }

  ngAfterViewInit(): void {
    this.setupScrollListener();
    this.scrollToBottom();
  }

  // === Message grouping logic ===
  private groupMessages(
    messages: readonly ProcessedClaudeMessage[]
  ): readonly MessageGroup[] {
    if (messages.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: {
      id: string;
      role: 'user' | 'assistant' | 'system';
      messages: ProcessedClaudeMessage[];
      startTimestamp: number;
      endTimestamp: number;
      isComplete: boolean;
    } | null = null;

    for (const message of messages) {
      const shouldStartNewGroup =
        !currentGroup ||
        currentGroup.role !== message.type ||
        message.timestamp - currentGroup.endTimestamp >
          this.maxGroupGapMinutes() * 60 * 1000;

      if (shouldStartNewGroup) {
        currentGroup = {
          id: `group-${message.id}`,
          role: message.type,
          messages: [message],
          startTimestamp: message.timestamp,
          endTimestamp: message.timestamp,
          isComplete: message.isComplete || false,
        };
        groups.push(currentGroup);
      } else if (currentGroup) {
        currentGroup.messages.push(message);
        currentGroup.endTimestamp = message.timestamp;
        currentGroup.isComplete =
          currentGroup.isComplete && (message.isComplete || false);
      }
    }

    return groups;
  }

  // === Tracking functions for performance ===
  trackByGroup(_index: number, group: MessageGroup): string {
    return group.id;
  }

  trackByMessage(_index: number, message: ProcessedClaudeMessage): MessageId {
    return message.id;
  }

  // === Event handlers ===
  handleScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const scrollTop = element.scrollTop;
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;

    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px threshold

    this.scrollPosition.set({
      top: scrollTop,
      isAtBottom,
    });

    // Load more messages when scrolled to top
    if (scrollTop === 0) {
      this.scrolledToTop.emit();
    }
  }

  handleMessageClick(message: ProcessedClaudeMessage): void {
    this.selectedMessageId.set(
      this.selectedMessageId() === message.id ? null : message.id
    );
    this.messageClicked.emit(message);
  }

  handleFileClick(filePath: string): void {
    this.fileClicked.emit(filePath);
  }

  handleToolAction(action: {
    tool: string;
    action: string;
    data?: unknown;
  }): void {
    this.toolActionRequested.emit(action);
  }

  // === Message actions ===
  async copyMessage(
    message: ProcessedClaudeMessage,
    event: Event
  ): Promise<void> {
    event.stopPropagation();

    // Extract text content from the message
    let textContent = '';
    for (const content of message.content) {
      if (content.type === 'text' && 'text' in content) {
        textContent += content.text + '\n';
      }
    }

    try {
      await navigator.clipboard.writeText(textContent.trim());
      this.messageActioned.emit({ action: 'copy', message });
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  }

  regenerateMessage(message: ProcessedClaudeMessage, event: Event): void {
    event.stopPropagation();
    this.messageActioned.emit({ action: 'regenerate', message });
  }

  exportMessage(message: ProcessedClaudeMessage, event: Event): void {
    event.stopPropagation();
    this.messageActioned.emit({ action: 'export', message });
  }

  // === Scroll management ===
  scrollToBottom(): void {
    const container = this.scrollContainer();
    if (container) {
      const element = container.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  private scheduleScrollToBottom(): void {
    // Use requestAnimationFrame for smooth scrolling
    requestAnimationFrame(() => {
      this.scrollToBottom();
    });
  }

  private setupScrollListener(): void {
    const container = this.scrollContainer();
    if (container) {
      const element = container.nativeElement;

      // Throttle scroll events for performance
      let scrollTimeout: number;
      element.addEventListener('scroll', () => {
        if (scrollTimeout) {
          clearTimeout(scrollTimeout);
        }
        scrollTimeout = window.setTimeout(() => {
          const syntheticEvent = new Event('scroll');
          Object.defineProperty(syntheticEvent, 'target', {
            value: element,
            enumerable: true,
          });
          this.handleScroll(syntheticEvent);
        }, 16); // ~60fps
      });
    }
  }

  // === Helper methods ===
  isSelected(messageId: MessageId): boolean {
    return this.selectedMessageId() === messageId;
  }

  getRoleIcon(role: string): string {
    const icons = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
    };
    return icons[role as keyof typeof icons] || '❓';
  }

  getRoleDisplayName(role: string): string {
    const names = {
      user: 'You',
      assistant: 'Claude',
      system: 'System',
    };
    return names[role as keyof typeof names] || role;
  }

  formatGroupTime(group: MessageGroup): string {
    const startTime = new Date(group.startTimestamp);
    const now = new Date();
    const diffMinutes = Math.floor(
      (now.getTime() - startTime.getTime()) / (1000 * 60)
    );

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    } else if (diffMinutes < 24 * 60) {
      const hours = Math.floor(diffMinutes / 60);
      return `${hours}h ago`;
    } else {
      return startTime.toLocaleDateString();
    }
  }
}
