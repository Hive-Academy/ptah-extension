import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { PermissionRequestCardComponent } from '../molecules/permission-request-card.component';
import { ChatEmptyStateComponent } from '../molecules/chat-empty-state.component';
import { ChatStore } from '../../services/chat.store';
import { VSCodeService } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  ExecutionChatMessage,
} from '@ptah-extension/shared';

/**
 * ChatViewComponent - Main chat view with message list and Egyptian themed welcome
 *
 * Complexity Level: 2 (Template with auto-scroll and empty state composition)
 * Patterns: Signal-based state, Auto-scroll behavior, Composition
 *
 * Features:
 * - Scrollable message list with smart auto-scroll
 * - Egyptian themed empty state (ChatEmptyStateComponent)
 * - Permission request handling
 * - Queued content indicator
 *
 * Auto-scroll behavior:
 * - Scrolls to bottom when new messages arrive
 * - Scrolls to bottom when streaming starts
 * - Disables auto-scroll when user scrolls up manually
 * - Re-enables when user scrolls back to bottom
 *
 * SOLID Principles:
 * - Single Responsibility: Chat view display and message orchestration
 * - Composition: Uses MessageBubble, ChatInput, and ChatEmptyState components
 */
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [
    NgOptimizedImage,
    MessageBubbleComponent,
    ChatInputComponent,
    PermissionRequestCardComponent,
    ChatEmptyStateComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);

  @ViewChild('messageContainer') messageContainer?: ElementRef<HTMLElement>;

  // Auto-scroll is enabled by default, disabled when user scrolls up
  private userScrolledUp = false;

  /**
   * Ptah icon URI for skeleton avatar placeholder
   */
  readonly ptahIconUri = computed(() => this.vscodeService.getPtahIconUri());

  /**
   * TASK_2025_096 FIX: Computed signal that creates ExecutionChatMessages
   * from ALL currentExecutionTrees (not just the first one).
   *
   * When Claude uses tools, the SDK sends multiple assistant messages in one turn:
   * - Message 1: Contains tool calls (e.g., Glob)
   * - Message 2: Contains follow-up text and more tools after tool results
   *
   * Previously, only the first tree was rendered, causing subsequent messages to be LOST!
   * Now we return ALL trees as messages so they can all be rendered.
   */
  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this.chatStore.currentExecutionTrees();
    if (trees.length === 0) return [];

    return trees.map((tree) =>
      createExecutionChatMessage({
        id: tree.id,
        role: 'assistant',
        streamingState: tree,
        sessionId: this.chatStore.currentSessionId() ?? undefined,
      })
    );
  });

  constructor() {
    // Effect: Auto-scroll when messages change or streaming state changes
    effect(() => {
      // Track these signals to trigger effect
      const messages = this.chatStore.messages();
      const isStreaming = this.chatStore.isStreaming();
      const currentTrees = this.chatStore.currentExecutionTrees();

      // Only auto-scroll if user hasn't manually scrolled up
      if (
        !this.userScrolledUp &&
        (messages.length > 0 || isStreaming || currentTrees.length > 0)
      ) {
        // Use setTimeout to ensure DOM has updated
        setTimeout(() => this.scrollToBottom(), 0);
      }
    });
  }

  /**
   * Handle scroll events on message container
   * Detects if user has scrolled up to disable auto-scroll
   */
  onScroll(event: Event): void {
    const container = event.target as HTMLElement;
    if (!container) return;

    // Check if user is near the bottom (within 100px threshold)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;

    // If user scrolled up, disable auto-scroll
    // If user scrolled back to bottom, re-enable auto-scroll
    this.userScrolledUp = !isNearBottom;
  }

  /**
   * Cancel queued message (user-requested cancellation)
   */
  cancelQueue(): void {
    this.chatStore.clearQueuedContent();
    console.log('[ChatViewComponent] Queued content cancelled by user');
  }

  private scrollToBottom(): void {
    if (!this.messageContainer) return;

    const container = this.messageContainer.nativeElement;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }
}
