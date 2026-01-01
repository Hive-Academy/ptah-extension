import {
  Component,
  inject,
  signal,
  computed,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
  afterNextRender,
  Injector,
  DestroyRef,
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
  private readonly destroyRef = inject(DestroyRef);

  /**
   * MutationObserver for auto-scroll behavior.
   * Watches DOM mutations to trigger scroll after recursive ExecutionNode tree completes.
   */
  private observer: MutationObserver | null = null;
  private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly SCROLL_DEBOUNCE_MS = 50;

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
    // Setup MutationObserver after initial render to watch for DOM changes
    // This replaces the effect-based approach for more reliable scroll timing
    afterNextRender(
      () => {
        this.setupMutationObserver();
      },
      { injector: this.injector }
    );

    // Cleanup on component destruction
    this.destroyRef.onDestroy(() => {
      this.cleanup();
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

  /**
   * Setup MutationObserver to watch for DOM changes in message container.
   * This ensures scroll happens after recursive ExecutionNode tree completes rendering.
   */
  private setupMutationObserver(): void {
    const container = this.messageContainerRef()?.nativeElement;
    if (!container || this.observer) return;

    this.observer = new MutationObserver(() => {
      this.scheduleScroll();
    });

    // Watch for any DOM changes in the container subtree
    this.observer.observe(container, {
      childList: true, // New nodes added/removed
      subtree: true, // Watch entire subtree (recursive components)
      characterData: true, // Text content changes (streaming text)
    });
  }

  /**
   * Schedule a scroll to bottom with debouncing.
   * Debouncing coalesces rapid DOM mutations during streaming into single scroll.
   */
  private scheduleScroll(): void {
    // Respect user scroll-up (reading history)
    if (this.userScrolledUp()) return;

    // Clear previous debounce (trailing debounce pattern)
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
    }

    // Schedule scroll after debounce period
    this.scrollTimeoutId = setTimeout(() => {
      this.scrollToBottom();
      this.scrollTimeoutId = null;
    }, this.SCROLL_DEBOUNCE_MS);
  }

  /**
   * Cleanup observer and timeout on component destruction.
   */
  private cleanup(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scrollTimeoutId) {
      clearTimeout(this.scrollTimeoutId);
      this.scrollTimeoutId = null;
    }
  }
}
