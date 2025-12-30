import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ElementRef,
  effect,
  ChangeDetectionStrategy,
  afterNextRender,
  Injector,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { PermissionBadgeComponent } from '../molecules/permission-badge.component';
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
  imports: [
    NgOptimizedImage,
    MessageBubbleComponent,
    ChatInputComponent,
    PermissionBadgeComponent,
    ChatEmptyStateComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);
  private readonly injector = inject(Injector);

  /**
   * Signal-based viewChild (Angular 20+ pattern)
   * Replaces @ViewChild decorator for better reactivity
   */
  private readonly messageContainerRef =
    viewChild<ElementRef<HTMLElement>>('messageContainer');

  /**
   * Auto-scroll state as signal for reactive tracking.
   * Disabled when user scrolls up, re-enabled when user scrolls to bottom.
   */
  private readonly userScrolledUp = signal(false);

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
   *
   * TASK_2025_100 FIX: Include pendingStats from streamingState so stats display
   * during/after streaming before finalization. Stats may arrive before finalization
   * and should be shown immediately.
   */
  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this.chatStore.currentExecutionTrees();
    if (trees.length === 0) return [];

    // Get pendingStats from the active tab's streamingState
    const activeTab = this.chatStore.activeTab();
    const pendingStats = activeTab?.streamingState?.pendingStats;

    return trees.map((tree) =>
      createExecutionChatMessage({
        id: tree.id,
        role: 'assistant',
        streamingState: tree,
        sessionId: this.chatStore.currentSessionId() ?? undefined,
        // TASK_2025_100: Include pending stats in streaming message
        ...(pendingStats && {
          tokens: pendingStats.tokens,
          cost: pendingStats.cost,
          duration: pendingStats.duration,
        }),
      })
    );
  });

  /**
   * TASK_2025_096 FIX: Track total node count across all execution trees.
   * This ensures auto-scroll triggers when children are added to existing trees,
   * not just when new trees are created.
   *
   * Previously, effect only tracked `currentTrees.length` which doesn't change
   * when children/tools are added to existing message trees.
   */
  private readonly totalNodeCount = computed(() => {
    const trees = this.chatStore.currentExecutionTrees();
    return trees.reduce((sum, tree) => sum + this.countNodes(tree), 0);
  });

  /**
   * Count total nodes in an execution tree (recursive)
   */
  private countNodes(node: { children?: readonly unknown[] }): number {
    const childCount =
      node.children?.reduce<number>(
        (sum: number, child) =>
          sum + this.countNodes(child as { children?: readonly unknown[] }),
        0
      ) ?? 0;
    return 1 + childCount;
  }

  constructor() {
    // Effect: Auto-scroll when messages change or streaming content changes
    effect(() => {
      // Track these signals to trigger effect
      const messages = this.chatStore.messages();
      const isStreaming = this.chatStore.isStreaming();
      const nodeCount = this.totalNodeCount(); // Track content depth, not just tree count

      // Only auto-scroll if user hasn't manually scrolled up
      if (
        !this.userScrolledUp() &&
        (messages.length > 0 || isStreaming || nodeCount > 0)
      ) {
        // Use afterNextRender instead of setTimeout for proper lifecycle handling
        // This ensures DOM is ready and provides automatic cleanup
        afterNextRender(
          () => {
            this.scrollToBottom();
          },
          { injector: this.injector }
        );
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
    this.userScrolledUp.set(!isNearBottom);
  }

  /**
   * Cancel queued message (user-requested cancellation)
   */
  cancelQueue(): void {
    this.chatStore.clearQueuedContent();
    console.log('[ChatViewComponent] Queued content cancelled by user');
  }

  private scrollToBottom(): void {
    const containerRef = this.messageContainerRef();
    if (!containerRef) return;

    const container = containerRef.nativeElement;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth',
    });
  }
}
