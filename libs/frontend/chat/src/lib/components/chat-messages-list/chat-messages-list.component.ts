/**
 * Chat Messages List Component
 * Displays a list of Claude CLI messages with advanced features:
 * - Virtual scrolling for performance
 * - Message grouping and threading
 * - Smooth animations and transitions
 * - Auto-scroll to latest message
 * - Message selection and actions
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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SessionId, MessageId } from '@ptah-extension/shared';
import { ProcessedClaudeMessage } from '@ptah-extension/core';
import { ChatMessageContentComponent } from '../chat-messages/components/chat-message-content/chat-message-content.component';

interface MessageGroup {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly messages: readonly ProcessedClaudeMessage[];
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly isComplete: boolean;
}

@Component({
  selector: 'ptah-chat-messages-list',
  standalone: true,

  imports: [CommonModule, ChatMessageContentComponent],
  template: `
    <div
      class="chat-messages-list"
      #scrollContainer
      [class.auto-scroll]="autoScroll()"
      [class.has-messages]="hasMessages()"
      (scroll)="handleScroll($event)"
    >
      <!-- Loading State -->
      @if (loading()) {
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <span>Loading messages...</span>
      </div>
      }

      <!-- Empty State -->
      @if (!loading() && !hasMessages()) {
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <h3>No messages yet</h3>
        <p>Start a conversation with Claude to see messages here</p>
      </div>
      }

      <!-- Message Groups -->
      @if (hasMessages()) {
      <div class="message-groups">
        @for (group of messageGroups(); track trackByGroup($index, group)) {
        <div
          class="message-group"
          [class.user-group]="group.role === 'user'"
          [class.assistant-group]="group.role === 'assistant'"
          [class.system-group]="group.role === 'system'"
          [class.streaming]="!group.isComplete"
          [attr.data-group-id]="group.id"
        >
          <!-- Group Header -->
          @if (showGroupHeaders()) {
          <div class="group-header">
            <div class="group-avatar">
              <span class="role-icon">{{ getRoleIcon(group.role) }}</span>
            </div>
            <div class="group-meta">
              <span class="group-role">{{ group.role }}</span>
              <span class="group-timestamp">{{ formatGroupTime(group) }}</span>
              @if (group.messages.length > 1) {
              <span class="message-count"
                >{{ group.messages.length }} messages</span
              >
              }
            </div>
          </div>
          }

          <!-- Messages in Group -->
          <div class="group-messages">
            @for (message of group.messages; track trackByMessage($index,
            message)) {
            <div
              class="message-wrapper"
              [class.selected]="isSelected(message.id)"
              [attr.data-message-id]="message.id"
              (click)="handleMessageClick(message)"
            >
              <ptah-chat-message-content
                [message]="message"
                [showHeader]="!showGroupHeaders() || group.messages.length > 1"
                [enableImagePreviews]="enableImagePreviews()"
                (fileClicked)="handleFileClick($event)"
                (toolActionRequested)="handleToolAction($event)"
              />

              <!-- Message Actions -->
              @if (showMessageActions() && isSelected(message.id)) {
              <div class="message-actions">
                <button
                  class="action-btn copy-btn"
                  (click)="copyMessage(message, $event)"
                  title="Copy message"
                >
                  📋 Copy
                </button>
                @if (message.type === 'assistant') {
                <button
                  class="action-btn regenerate-btn"
                  (click)="regenerateMessage(message, $event)"
                  title="Regenerate response"
                >
                  🔄 Regenerate
                </button>
                }
                <button
                  class="action-btn export-btn"
                  (click)="exportMessage(message, $event)"
                  title="Export message"
                >
                  📤 Export
                </button>
              </div>
              }
            </div>
            }
          </div>
        </div>
        }
      </div>
      }

      <!-- Scroll to Bottom Button -->
      @if (!isAtBottom() && hasMessages()) {
      <button
        class="scroll-to-bottom"
        (click)="scrollToBottom()"
        [class.has-new-messages]="hasNewMessages()"
      >
        <span class="scroll-icon">↓</span>
        @if (hasNewMessages()) {
        <span class="new-messages-count">{{ newMessagesCount() }}</span>
        }
      </button>
      }
    </div>
  `,
  styleUrl: './chat-messages-list.component.scss',
})
export class ChatMessagesListComponent implements AfterViewInit {
  // Inputs
  readonly messages = input.required<readonly ProcessedClaudeMessage[]>();
  readonly sessionId = input<SessionId | null>(null);
  readonly loading = input(false);
  readonly autoScroll = input(true);
  readonly showGroupHeaders = input(false); // Hide headers for clean minimal look
  readonly showMessageActions = input(true);
  readonly enableImagePreviews = input(true);
  readonly maxGroupGapMinutes = input(5); // Group messages within X minutes

  // Outputs
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

  // ViewChild references
  readonly scrollContainer =
    viewChild<ElementRef<HTMLElement>>('scrollContainer');

  // Internal state
  private readonly selectedMessageId = signal<MessageId | null>(null);
  private readonly scrollPosition = signal({ top: 0, isAtBottom: true });
  readonly newMessagesCount = signal(0);
  private readonly lastSeenMessageCount = signal(0);

  // Computed properties
  readonly hasMessages = computed(() => this.messages().length > 0);

  readonly messageGroups = computed(() => {
    return this.groupMessages(this.messages());
  });

  readonly isAtBottom = computed(() => this.scrollPosition().isAtBottom);
  readonly hasNewMessages = computed(() => this.newMessagesCount() > 0);

  constructor() {
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

  // Message grouping logic
  private groupMessages(
    messages: readonly ProcessedClaudeMessage[]
  ): readonly MessageGroup[] {
    if (messages.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of messages) {
      const shouldStartNewGroup =
        !currentGroup ||
        currentGroup.role !== message.type ||
        message.timestamp - currentGroup.endTimestamp >
          this.maxGroupGapMinutes() * 60 * 1000;

      if (shouldStartNewGroup) {
        currentGroup = {
          id: `group-${message.id}`,
          role: message.type as 'user' | 'assistant' | 'system',
          messages: [message],
          startTimestamp: message.timestamp,
          endTimestamp: message.timestamp,
          isComplete: message.isComplete ?? true,
        };
        groups.push(currentGroup);
      } else if (currentGroup) {
        // TypeScript knows currentGroup is non-null here due to the condition
        const updatedGroup: MessageGroup = {
          ...currentGroup,
          messages: [...currentGroup.messages, message],
          endTimestamp: message.timestamp,
          isComplete:
            (currentGroup.isComplete ?? true) && (message.isComplete ?? true),
        };
        groups[groups.length - 1] = updatedGroup;
        currentGroup = updatedGroup;
      }
    }

    return groups;
  }

  // Tracking functions
  trackByGroup(index: number, group: MessageGroup): string {
    return group.id;
  }

  trackByMessage(index: number, message: ProcessedClaudeMessage): string {
    return message.id as string;
  }

  // Event handlers
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

  // Message actions
  async copyMessage(
    message: ProcessedClaudeMessage,
    event: Event
  ): Promise<void> {
    event.stopPropagation();

    // Extract text content from the message
    let textContent = '';
    for (const contentItem of message.content) {
      if (contentItem.type === 'text') {
        textContent += contentItem.text + '\n';
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

  // Scroll management
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

  // Helper methods
  isSelected(messageId: MessageId): boolean {
    return this.selectedMessageId() === messageId;
  }

  getRoleIcon(role: string): string {
    const icons: Record<string, string> = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
    };
    return icons[role] || '❓';
  }

  getRoleDisplayName(role: string): string {
    const names: Record<string, string> = {
      user: 'You',
      assistant: 'Claude',
      system: 'System',
    };
    return names[role] || role;
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
