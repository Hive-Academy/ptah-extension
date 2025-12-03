import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Send, Zap } from 'lucide-angular';
import { ChatStore } from '../../services/chat.store';
import { AutopilotStateService } from '@ptah-extension/core';
import { ModelSelectorComponent } from './model-selector.component';
import { AutopilotPopoverComponent } from './autopilot-popover.component';

/**
 * ChatInputComponent - Enhanced message input with bottom bar controls
 *
 * Complexity Level: 2 (Input with model selector and autopilot toggle)
 * Patterns: Signal-based state, Composition
 *
 * Features:
 * - DaisyUI textarea with send button
 * - Elegant model selector dropdown with title + description
 * - Autopilot toggle switch
 * - Shift+Enter for newlines, Enter to send
 * - Clear input after send
 * - Disable during streaming
 * - Auto-resize textarea
 *
 * SOLID Principles:
 * - Single Responsibility: Message input and bottom bar controls
 * - Dependency Inversion: Injects ChatStore abstraction
 */
@Component({
  selector: 'ptah-chat-input',
  imports: [
    LucideAngularModule,
    ModelSelectorComponent,
    AutopilotPopoverComponent,
  ],
  template: `
    <div class="flex flex-col gap-2 p-4 bg-base-100">
      <!-- Input Row with Textarea and Send Button -->
      <div class="flex items-end gap-2">
        <!-- Textarea with gold border when autopilot is enabled -->
        <textarea
          #inputElement
          class="textarea textarea-bordered flex-1 min-h-[2.5rem] max-h-[10rem] resize-none transition-colors"
          [class.border-warning]="autopilotState.enabled()"
          [class.border-2]="autopilotState.enabled()"
          placeholder="Ask a question or describe a task..."
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
          <lucide-angular [img]="SendIcon" class="w-5 h-5" />
          }
        </button>
      </div>

      <!-- Bottom Controls Row -->
      <div class="flex items-center justify-between text-sm">
        <!-- Left: Action Icons with Autopilot Badge -->
        <div class="flex items-center gap-2 text-base-content/60">
          <button
            class="btn btn-ghost btn-xs btn-circle"
            title="Add screenshot"
            type="button"
          >
            📷
          </button>

          <!-- Autopilot Mode Badge - shown when enabled -->
          @if (autopilotState.enabled()) {
          <div class="badge badge-warning badge-sm gap-1">
            <lucide-angular [img]="ZapIcon" class="w-3 h-3" />
            <span>{{ autopilotState.statusText() }}</span>
          </div>
          }
        </div>

        <!-- Right: Model Selector and Autopilot Popover -->
        <div class="flex items-center gap-2">
          <!-- Model Selector Component -->
          <ptah-model-selector />

          <!-- Autopilot Popover Component -->
          <ptah-autopilot-popover />
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  readonly chatStore = inject(ChatStore);
  readonly autopilotState = inject(AutopilotStateService);

  // Lucide icons
  readonly SendIcon = Send;
  readonly ZapIcon = Zap;

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
