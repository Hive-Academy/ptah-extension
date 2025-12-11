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
import { LucideAngularModule, Square } from 'lucide-angular';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { PermissionRequestCardComponent } from '../molecules/permission-request-card.component';
import { SetupStatusWidgetComponent } from '../molecules/setup-status-widget.component';
import { ChatStore } from '../../services/chat.store';
import { VSCodeService } from '@ptah-extension/core';
import { createExecutionChatMessage } from '@ptah-extension/shared';

/**
 * ChatViewComponent - Main chat view with message list and welcome screen
 *
 * Complexity Level: 2 (Template with auto-scroll and mode selection)
 * Patterns: Signal-based state, Auto-scroll behavior, Composition
 *
 * Features:
 * - Scrollable message list with smart auto-scroll
 * - "Let's build" welcome screen with Vibe/Spec mode selection
 * - Mode selection state management
 *
 * Auto-scroll behavior:
 * - Scrolls to bottom when new messages arrive
 * - Scrolls to bottom when streaming starts
 * - Disables auto-scroll when user scrolls up manually
 * - Re-enables when user scrolls back to bottom
 *
 * SOLID Principles:
 * - Single Responsibility: Chat view display and mode selection
 * - Composition: Uses MessageBubble and ChatInput components
 */
@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [
    NgOptimizedImage,
    LucideAngularModule,
    MessageBubbleComponent,
    ChatInputComponent,
    PermissionRequestCardComponent,
    SetupStatusWidgetComponent,
  ],
  templateUrl: './chat-view.component.html',
  styleUrl: './chat-view.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatViewComponent {
  readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);

  // Stop button icon
  readonly SquareIcon = Square;

  @ViewChild('messageContainer') messageContainer?: ElementRef<HTMLElement>;

  // Auto-scroll is enabled by default, disabled when user scrolls up
  private userScrolledUp = false;

  // Welcome screen mode selection (Vibe/Spec)
  private readonly _selectedMode = signal<'vibe' | 'spec'>('vibe');
  readonly selectedMode = this._selectedMode.asReadonly();

  /**
   * Ptah icon URI for skeleton avatar placeholder
   */
  readonly ptahIconUri = computed(() => this.vscodeService.getPtahIconUri());

  /**
   * Computed signal that creates a temporary ExecutionChatMessage
   * from the currentExecutionTree for live streaming display.
   *
   * This allows the message-bubble component to render the in-progress
   * execution tree without waiting for finalization.
   */
  readonly streamingMessage = computed(() => {
    const tree = this.chatStore.currentExecutionTree();
    if (!tree) return null;

    return createExecutionChatMessage({
      id: tree.id,
      role: 'assistant',
      executionTree: tree,
      sessionId: this.chatStore.currentSessionId() ?? undefined,
    });
  });

  constructor() {
    // Effect: Auto-scroll when messages change or streaming state changes
    effect(() => {
      // Track these signals to trigger effect
      const messages = this.chatStore.messages();
      const isStreaming = this.chatStore.isStreaming();
      const currentTree = this.chatStore.currentExecutionTree();

      // Only auto-scroll if user hasn't manually scrolled up
      if (
        !this.userScrolledUp &&
        (messages.length > 0 || isStreaming || currentTree)
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

  selectMode(mode: 'vibe' | 'spec'): void {
    this._selectedMode.set(mode);
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
