import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Send, ChevronDown } from 'lucide-angular';
import { ChatStore } from '../../services/chat.store';

/**
 * ChatInputComponent - Enhanced message input with bottom bar controls
 *
 * Complexity Level: 2 (Input with model selector and autopilot toggle)
 * Patterns: Signal-based state, Composition
 *
 * Features:
 * - DaisyUI textarea with send button
 * - Model selector dropdown
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
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-2 p-4 bg-base-100">
      <!-- Input Row with Textarea and Send Button -->
      <div class="flex items-end gap-2">
        <!-- Textarea -->
        <textarea
          #inputElement
          class="textarea textarea-bordered flex-1 min-h-[2.5rem] max-h-[10rem] resize-none"
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
        <!-- Left: Action Icons -->
        <div class="flex items-center gap-2 text-base-content/60">
          <button
            class="btn btn-ghost btn-xs btn-circle"
            title="Attach file"
            type="button"
          >
            📎
          </button>
          <button
            class="btn btn-ghost btn-xs btn-circle"
            title="Mention context"
            type="button"
          >
            @
          </button>
          <button
            class="btn btn-ghost btn-xs btn-circle"
            title="Add screenshot"
            type="button"
          >
            📷
          </button>
        </div>

        <!-- Right: Model Selector and Autopilot Toggle -->
        <div class="flex items-center gap-3">
          <!-- Model Selector -->
          <div class="dropdown dropdown-top dropdown-end">
            <button
              tabindex="0"
              class="btn btn-ghost btn-sm gap-1"
              type="button"
            >
              <span class="text-xs">{{ selectedModel() }}</span>
              <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
            </button>
            <ul
              tabindex="0"
              class="dropdown-content menu p-2 shadow bg-base-200 rounded-box w-52 mb-1"
            >
              <li>
                <button
                  type="button"
                  (click)="selectModel('Claude Sonnet 4.0')"
                >
                  Claude Sonnet 4.0
                </button>
              </li>
              <li>
                <button type="button" (click)="selectModel('Claude Opus 4.0')">
                  Claude Opus 4.0
                </button>
              </li>
              <li>
                <button type="button" (click)="selectModel('Claude Haiku 3.5')">
                  Claude Haiku 3.5
                </button>
              </li>
            </ul>
          </div>

          <!-- Autopilot Toggle -->
          <label class="flex items-center gap-2 cursor-pointer">
            <span class="text-xs text-base-content/70">Auto</span>
            <input
              type="checkbox"
              class="toggle toggle-sm toggle-primary"
              [checked]="autopilotEnabled()"
              (change)="toggleAutopilot()"
            />
          </label>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  readonly chatStore = inject(ChatStore);

  // Lucide icons
  readonly SendIcon = Send;
  readonly ChevronDownIcon = ChevronDown;

  // Local state
  private readonly _currentMessage = signal('');
  private readonly _selectedModel = signal('Claude Sonnet 4.0');
  private readonly _autopilotEnabled = signal(false);

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly selectedModel = this._selectedModel.asReadonly();
  readonly autopilotEnabled = this._autopilotEnabled.asReadonly();

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

  /**
   * Select AI model
   */
  selectModel(model: string): void {
    this._selectedModel.set(model);
    // TODO: Integrate with backend model selection when implemented
  }

  /**
   * Toggle autopilot mode
   */
  toggleAutopilot(): void {
    this._autopilotEnabled.update((enabled) => !enabled);
    // TODO: Integrate with backend autopilot feature when implemented
  }
}
