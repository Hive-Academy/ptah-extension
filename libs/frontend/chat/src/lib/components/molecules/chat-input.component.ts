import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ChatStore } from '../../services/chat.store';

/**
 * ChatInputComponent - Message input with send button
 *
 * Complexity Level: 1 (Simple input component)
 * Patterns: Signal-based state, Composition
 *
 * Features:
 * - DaisyUI textarea with send button
 * - Shift+Enter for newlines, Enter to send
 * - Clear input after send
 * - Disable during streaming
 * - Auto-resize textarea
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles message input
 * - Dependency Inversion: Injects ChatStore abstraction
 */
@Component({
  selector: 'ptah-chat-input',
  standalone: true,
  template: `
    <div class="flex items-end gap-2 p-4 bg-base-100">
      <!-- Textarea -->
      <textarea
        #inputElement
        class="textarea textarea-bordered flex-1 min-h-[2.5rem] max-h-[10rem] resize-none"
        placeholder="Type your message... (Shift+Enter for new line)"
        [value]="currentMessage()"
        (input)="handleInput($event)"
        (keydown)="handleKeyDown($event)"
        [disabled]="isDisabled()"
        rows="1"
      ></textarea>

      <!-- Send Button -->
      <button
        class="btn btn-primary"
        [disabled]="!canSend()"
        (click)="handleSend()"
        type="button"
      >
        @if (chatStore.isStreaming()) {
        <span class="loading loading-spinner loading-sm"></span>
        } @else {
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
        </svg>
        }
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  readonly chatStore = inject(ChatStore);

  // Local state
  private readonly _currentMessage = signal('');

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();

  // Computed
  readonly isDisabled = computed(() => this.chatStore.isStreaming());
  readonly canSend = computed(
    () => this.currentMessage().trim().length > 0 && !this.isDisabled()
  );

  /**
   * Handle input change
   */
  handleInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this._currentMessage.set(target.value);

    // Auto-resize textarea
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
  }

  /**
   * Handle keyboard shortcuts
   * - Enter: Send message
   * - Shift+Enter: New line
   */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  /**
   * Send message to ChatStore
   */
  async handleSend(): Promise<void> {
    const content = this.currentMessage().trim();
    if (!content || this.isDisabled()) return;

    try {
      await this.chatStore.sendMessage(content);
      this._currentMessage.set('');

      // Reset textarea height
      const textarea = document.querySelector(
        'textarea'
      ) as HTMLTextAreaElement;
      if (textarea) {
        textarea.style.height = 'auto';
      }
    } catch (error) {
      console.error('[ChatInputComponent] Failed to send message:', error);
    }
  }
}
