/**
 * Enhanced Chat Messages List Component
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
  ViewChild,
  ElementRef,
  AfterViewInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ClaudeMessageContentComponent } from './claude-message-content.component';
import { ProcessedClaudeMessage, SessionId, MessageId } from '@ptah-extension/shared';

interface MessageGroup {
  id: string;
  role: 'user' | 'assistant' | 'system';
  messages: ProcessedClaudeMessage[];
  startTimestamp: number;
  endTimestamp: number;
  isComplete: boolean;
}

@Component({
  selector: 'app-enhanced-chat-messages-list',
  standalone: true,
  imports: [CommonModule, ClaudeMessageContentComponent],

  template: `
    <div
      class="enhanced-chat-messages-list"
      #scrollContainer
      [class.auto-scroll]="autoScroll()"
      [class.has-messages]="hasMessages()"
      (scroll)="handleScroll($event)"
    >
      <!-- Loading State -->
      <div class="loading-state" *ngIf="loading()">
        <div class="loading-spinner"></div>
        <span>Loading messages...</span>
      </div>

      <!-- Empty State -->
      <div class="empty-state" *ngIf="!loading() && !hasMessages()">
        <div class="empty-icon">💬</div>
        <h3>No messages yet</h3>
        <p>Start a conversation with Claude to see messages here</p>
      </div>

      <!-- Message Groups -->
      <div class="message-groups" *ngIf="hasMessages()">
        <div
          *ngFor="let group of messageGroups(); trackBy: trackByGroup"
          class="message-group"
          [class.user-group]="group.role === 'user'"
          [class.assistant-group]="group.role === 'assistant'"
          [class.system-group]="group.role === 'system'"
          [class.streaming]="!group.isComplete"
          [attr.data-group-id]="group.id"
        >
          <!-- Group Header -->
          <div class="group-header" *ngIf="showGroupHeaders()">
            <div class="group-avatar">
              <span class="role-icon">{{ getRoleIcon(group.role) }}</span>
            </div>
            <div class="group-meta">
              <span class="group-role">{{ group.role }}</span>
              <span class="group-timestamp">{{ formatGroupTime(group) }}</span>
              <span class="message-count" *ngIf="group.messages.length > 1">
                {{ group.messages.length }} messages
              </span>
            </div>
          </div>

          <!-- Messages in Group -->
          <div class="group-messages">
            <div
              *ngFor="let message of group.messages; trackBy: trackByMessage"
              class="message-wrapper"
              [class.selected]="isSelected(message.id)"
              [attr.data-message-id]="message.id"
              (click)="handleMessageClick(message)"
            >
              <app-claude-message-content
                [message]="message"
                [showHeader]="!showGroupHeaders() || group.messages.length > 1"
                [enableImagePreviews]="enableImagePreviews()"
                (fileClicked)="handleFileClick($event)"
                (toolActionRequested)="handleToolAction($event)"
              >
              </app-claude-message-content>

              <!-- Message Actions -->
              <div class="message-actions" *ngIf="showMessageActions() && isSelected(message.id)">
                <button
                  class="action-btn copy-btn"
                  (click)="copyMessage(message, $event)"
                  title="Copy message"
                >
                  📋 Copy
                </button>
                <button
                  class="action-btn regenerate-btn"
                  *ngIf="message.role === 'assistant'"
                  (click)="regenerateMessage(message, $event)"
                  title="Regenerate response"
                >
                  🔄 Regenerate
                </button>
                <button
                  class="action-btn export-btn"
                  (click)="exportMessage(message, $event)"
                  title="Export message"
                >
                  📤 Export
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Scroll to Bottom Button -->
      <button
        class="scroll-to-bottom"
        *ngIf="!isAtBottom() && hasMessages()"
        (click)="scrollToBottom()"
        [class.has-new-messages]="hasNewMessages()"
      >
        <span class="scroll-icon">↓</span>
        <span class="new-messages-count" *ngIf="hasNewMessages()">
          {{ newMessagesCount() }}
        </span>
      </button>

      <!-- Typing Indicators -->
      <div class="typing-indicators" *ngIf="hasTypingIndicators()">
        <div
          *ngFor="let indicator of typingIndicators()"
          class="typing-indicator"
          [class]="indicator.role"
        >
          <div class="typing-avatar">
            <span>{{ getRoleIcon(indicator.role) }}</span>
          </div>
          <div class="typing-animation">
            <div class="typing-dots"><span></span><span></span><span></span></div>
            <span class="typing-text">{{ indicator.text }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrl: './enhanced-chat-messages-list.component.scss',
})
export class EnhancedChatMessagesListComponent implements AfterViewInit {
  // Inputs
  readonly messages = input.required<readonly ProcessedClaudeMessage[]>();
  readonly sessionId = input<SessionId | null>(null);
  readonly loading = input(false);
  readonly autoScroll = input(true);
  readonly showGroupHeaders = input(true);
  readonly showMessageActions = input(true);
  readonly enableImagePreviews = input(true);
  readonly maxGroupGapMinutes = input(5); // Group messages within X minutes

  // Outputs
  readonly messageClicked = output<ProcessedClaudeMessage>();
  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{ tool: string; action: string; data?: any }>();
  readonly messageActioned = output<{ action: string; message: ProcessedClaudeMessage }>();
  readonly scrolledToTop = output<void>();

  // ViewChild references
  @ViewChild('scrollContainer', { static: false })
  scrollContainer?: ElementRef<HTMLElement>;

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

  readonly typingIndicators = computed(() => {
    const streamingMessages = this.messages().filter((m) => m.isStreaming);
    return streamingMessages.map((m) => ({
      role: m.role,
      text: `${this.getRoleDisplayName(m.role)} is typing...`,
      messageId: m.id,
    }));
  });

  readonly hasTypingIndicators = computed(() => this.typingIndicators().length > 0);

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
  private groupMessages(messages: readonly ProcessedClaudeMessage[]): MessageGroup[] {
    if (messages.length === 0) return [];

    const groups: MessageGroup[] = [];
    let currentGroup: MessageGroup | null = null;

    for (const message of messages) {
      const shouldStartNewGroup =
        !currentGroup ||
        currentGroup.role !== message.role ||
        message.timestamp - currentGroup.endTimestamp > this.maxGroupGapMinutes() * 60 * 1000;

      if (shouldStartNewGroup) {
        currentGroup = {
          id: `group-${message.id}`,
          role: message.role,
          messages: [message],
          startTimestamp: message.timestamp,
          endTimestamp: message.timestamp,
          isComplete: message.isComplete,
        };
        groups.push(currentGroup);
      } else if (currentGroup) {
        currentGroup.messages.push(message);
        currentGroup.endTimestamp = message.timestamp;
        currentGroup.isComplete = currentGroup.isComplete && message.isComplete;
      }
    }

    return groups;
  }

  // Tracking functions
  trackByGroup(index: number, group: MessageGroup): string {
    return group.id;
  }

  trackByMessage(index: number, message: ProcessedClaudeMessage): MessageId {
    return message.id;
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
    this.selectedMessageId.set(this.selectedMessageId() === message.id ? null : message.id);
    this.messageClicked.emit(message);
  }

  handleFileClick(filePath: string): void {
    this.fileClicked.emit(filePath);
  }

  handleToolAction(action: { tool: string; action: string; data?: any }): void {
    this.toolActionRequested.emit(action);
  }

  // Message actions
  async copyMessage(message: ProcessedClaudeMessage, event: Event): Promise<void> {
    event.stopPropagation();

    // Extract text content from the message
    let textContent = '';
    for (const content of message.content) {
      if (content.type === 'text') {
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

  // Scroll management
  scrollToBottom(): void {
    if (this.scrollContainer) {
      const element = this.scrollContainer.nativeElement;
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
    if (this.scrollContainer) {
      const element = this.scrollContainer.nativeElement;

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
    const diffMinutes = Math.floor((now.getTime() - startTime.getTime()) / (1000 * 60));

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
