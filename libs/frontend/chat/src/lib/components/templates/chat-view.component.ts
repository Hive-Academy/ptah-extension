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
import { LucideAngularModule, Bell } from 'lucide-angular';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input/chat-input.component';
import { PermissionBadgeComponent } from '../molecules/permissions/permission-badge.component';
import { QuestionCardComponent } from '../molecules/question-card.component';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { SessionStatsSummaryComponent } from '../molecules/session/session-stats-summary.component';
// TASK_2025_109: ResumeNotificationBannerComponent removed - now uses context injection
import { CompactionNotificationComponent } from '../molecules/notifications/compaction-notification.component';
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
 * - Session stats summary (cost, tokens, duration, agents)
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
    LucideAngularModule,
    MessageBubbleComponent,
    ChatInputComponent,
    PermissionBadgeComponent,
    QuestionCardComponent,
    ChatEmptyStateComponent,
    SessionStatsSummaryComponent,
    // TASK_2025_109: ResumeNotificationBannerComponent removed - now uses context injection
    CompactionNotificationComponent,
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

  /** Lucide icon reference for template binding */
  protected readonly BellIcon = Bell;

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

  /** Signal-based viewChild for chat input (TASK_2025_174: prompt suggestion fill) */
  private readonly chatInputRef = viewChild(ChatInputComponent);

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
   *
   * DEDUPLICATION FIX: Finalized messages use tree.id (event id) NOT messageId,
   * so we can properly match and filter out already-finalized trees.
   */
  readonly streamingMessages = computed((): ExecutionChatMessage[] => {
    const trees = this.chatStore.currentExecutionTrees();
    if (trees.length === 0) return [];

    // Get pendingStats from the active tab's streamingState
    const activeTab = this.chatStore.activeTab();
    const pendingStats = activeTab?.streamingState?.pendingStats;

    // DEDUPLICATION: Get IDs of already finalized messages to filter out.
    // CRITICAL: Finalized messages now use tree.id (message_start event id),
    // not messageId, so IDs match between streaming trees and finalized messages.
    const finalizedMessageIds = new Set(
      this.chatStore.messages().map((msg) => msg.id)
    );

    // Filter out trees that are already finalized
    const nonFinalizedTrees = trees.filter(
      (tree) => !finalizedMessageIds.has(tree.id)
    );

    if (nonFinalizedTrees.length === 0) return [];

    return nonFinalizedTrees.map((tree) =>
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
   * Handle prompt selection from empty state - fill chat input (TASK_2025_174)
   * Uses ChatInputComponent.restoreContentToInput which handles focus and auto-resize.
   */
  handlePromptSelected(promptText: string): void {
    const chatInput = this.chatInputRef();
    if (chatInput) {
      chatInput.restoreContentToInput(promptText);
    }
  }

  /**
   * Cancel queued message (user-requested cancellation)
   */
  cancelQueue(): void {
    this.chatStore.clearQueuedContent();
    console.log('[ChatViewComponent] Queued content cancelled by user');
  }

  // TASK_2025_109: onResumeAll method removed - Resume banner no longer needed
  // Subagent resumption is now handled via context injection in chat:continue RPC.

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
      // Re-check condition - user may have scrolled up during debounce period
      if (!this.userScrolledUp()) {
        this.scrollToBottom();
      }
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
