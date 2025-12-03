import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Send, Zap } from 'lucide-angular';
import { ChatStore } from '../../services/chat.store';
import {
  AutopilotStateService,
  AgentDiscoveryFacade,
  CommandDiscoveryFacade,
} from '@ptah-extension/core';
import { ModelSelectorComponent } from './model-selector.component';
import { AutopilotPopoverComponent } from './autopilot-popover.component';
import {
  FilePickerService,
  type FileSuggestion,
  type ChatFile,
} from '../../services/file-picker.service';
import {
  UnifiedSuggestionsDropdownComponent,
  type SuggestionItem,
} from '../file-suggestions/unified-suggestions-dropdown.component';
import { FileTagComponent } from '../file-suggestions/file-tag.component';

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
    UnifiedSuggestionsDropdownComponent,
    FileTagComponent,
  ],
  template: `
    <div class="flex flex-col gap-2 p-4 bg-base-100">
      <!-- File Tags Row (above textarea) -->
      @if (selectedFiles().length > 0) {
      <div class="flex flex-wrap gap-2">
        @for (file of selectedFiles(); track file.path) {
        <ptah-file-tag [file]="file" (removeFile)="removeFile(file.path)" />
        }
      </div>
      }

      <!-- Input Row with Textarea and Send Button -->
      <div class="flex items-end gap-2">
        <!-- Textarea + Suggestions Dropdown -->
        <div class="relative flex-1">
          <textarea
            #inputElement
            class="textarea textarea-bordered flex-1 min-h-[2.5rem] max-h-[10rem] resize-none transition-colors w-full"
            [class.border-warning]="autopilotState.enabled()"
            [class.border-2]="autopilotState.enabled()"
            placeholder="Ask a question or describe a task..."
            [value]="currentMessage()"
            (input)="handleInput($event)"
            (keydown)="handleKeyDown($event)"
            rows="1"
          ></textarea>

          <!-- Unified Suggestions Dropdown -->
          @if (showSuggestions()) {
          <ptah-unified-suggestions-dropdown
            [suggestions]="filteredSuggestions()"
            [isLoading]="isLoadingSuggestions()"
            [positionTop]="dropdownPosition().top"
            [positionLeft]="dropdownPosition().left"
            (suggestionSelected)="handleSuggestionSelected($event)"
            (closed)="closeSuggestions()"
          />
          }
        </div>

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

  // NEW: Autocomplete service injections
  readonly filePicker = inject(FilePickerService);
  readonly agentDiscovery = inject(AgentDiscoveryFacade);
  readonly commandDiscovery = inject(CommandDiscoveryFacade);

  // Lucide icons
  readonly SendIcon = Send;
  readonly ZapIcon = Zap;

  // Local state
  private readonly _currentMessage = signal('');

  // NEW: Autocomplete state signals
  private readonly _showSuggestions = signal(false);
  private readonly _suggestionMode = signal<
    'at-trigger' | 'slash-trigger' | null
  >(null);
  private readonly _activeCategory = signal<'all' | 'files' | 'agents'>('all');
  private readonly _currentQuery = signal('');
  private readonly _selectedFiles = signal<ChatFile[]>([]);
  private readonly _isLoadingSuggestions = signal(false);

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly showSuggestions = this._showSuggestions.asReadonly();
  readonly suggestionMode = this._suggestionMode.asReadonly();
  readonly activeCategory = this._activeCategory.asReadonly();
  readonly selectedFiles = this._selectedFiles.asReadonly();
  readonly isLoadingSuggestions = this._isLoadingSuggestions.asReadonly();

  // Computed
  readonly canSend = computed(() => this.currentMessage().trim().length > 0);

  // NEW: Computed signals for autocomplete
  readonly filteredSuggestions = computed(() => {
    const mode = this._suggestionMode();
    const query = this._currentQuery();
    const category = this._activeCategory();

    if (mode === 'at-trigger') {
      // @ trigger: Files + Agents
      const files = this.filePicker.searchFiles(query).map((f) => {
        // Destructure to exclude original 'type' property (which is "file" | "directory")
        const { type: _originalType, ...rest } = f;
        return {
          type: 'file' as const,
          icon: '📄',
          description: f.directory,
          ...rest,
        };
      });

      const agents = this.agentDiscovery.searchAgents(query).map((a) => ({
        type: 'agent' as const,
        ...a,
      }));

      // Category filtering
      if (category === 'files') return files;
      if (category === 'agents') return agents;
      return [...files, ...agents]; // 'all' category
    }

    if (mode === 'slash-trigger') {
      // / trigger: Commands only
      return this.commandDiscovery.searchCommands(query).map((c) => ({
        type: 'command' as const,
        ...c,
      }));
    }

    return [];
  });

  readonly dropdownPosition = computed(() => {
    // Calculate dropdown position relative to textarea
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (!textarea) return { top: 0, left: 0 };

    const rect = textarea.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
    };
  });

  /**
   * Handle input change
   */
  handleInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const value = target.value;
    const cursorPos = target.selectionStart;

    this._currentMessage.set(value);

    // Auto-resize textarea
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;

    // Trigger detection
    this.detectTriggers(value, cursorPos);
  }

  /**
   * Detect @ or / triggers and extract query
   */
  private detectTriggers(value: string, cursorPos: number): void {
    // Extract text up to cursor
    const textBeforeCursor = value.substring(0, cursorPos);

    // / trigger detection (must be at start of input)
    if (textBeforeCursor.startsWith('/')) {
      const query = textBeforeCursor.substring(1);
      this._suggestionMode.set('slash-trigger');
      this._currentQuery.set(query);
      this.fetchCommandSuggestions();
      this._showSuggestions.set(true);
      return;
    }

    // @ trigger detection (find last @ before cursor)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      // Check if @ is at start or preceded by whitespace
      if (lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1])) {
        const query = textBeforeCursor.substring(lastAtIndex + 1);
        // Only show if query doesn't contain whitespace (e.g., "@file name" → close dropdown)
        if (!/\s/.test(query)) {
          this._suggestionMode.set('at-trigger');
          this._currentQuery.set(query);
          this.fetchAtSuggestions();
          this._showSuggestions.set(true);
          return;
        }
      }
    }

    // No active trigger
    this._showSuggestions.set(false);
    this._suggestionMode.set(null);
  }

  /**
   * Fetch suggestions for @ trigger (files + agents)
   */
  private async fetchAtSuggestions(): Promise<void> {
    this._isLoadingSuggestions.set(true);
    try {
      await Promise.all([
        this.filePicker.ensureFilesLoaded(),
        this.agentDiscovery.fetchAgents(),
      ]);
    } catch (error) {
      console.error(
        '[ChatInputComponent] Failed to fetch @ suggestions:',
        error
      );
    } finally {
      this._isLoadingSuggestions.set(false);
    }
  }

  /**
   * Fetch suggestions for / trigger (commands)
   */
  private async fetchCommandSuggestions(): Promise<void> {
    this._isLoadingSuggestions.set(true);
    try {
      await this.commandDiscovery.fetchCommands();
    } catch (error) {
      console.error(
        '[ChatInputComponent] Failed to fetch / suggestions:',
        error
      );
    } finally {
      this._isLoadingSuggestions.set(false);
    }
  }

  /**
   * Handle suggestion selection (file tag vs text insertion)
   */
  handleSuggestionSelected(suggestion: SuggestionItem): void {
    if (suggestion.type === 'file') {
      // Add file tag (don't insert text)
      this.addFileTag(suggestion);
    } else if (suggestion.type === 'agent') {
      // Insert @agent-name text at cursor
      this.insertAtCursor(`@${suggestion.name} `);
    } else if (suggestion.type === 'command') {
      // Replace entire input with /command-name
      this._currentMessage.set(`/${suggestion.name} `);
    }

    this.closeSuggestions();
  }

  /**
   * Add file tag above textarea
   */
  private addFileTag(file: FileSuggestion): void {
    const chatFile: ChatFile = {
      path: file.path,
      name: file.name,
      size: file.size || 0,
      type: file.isText ? 'text' : 'binary',
      isLarge: (file.size || 0) > 100_000,
      tokenEstimate: Math.ceil((file.size || 0) / 4),
    };

    this._selectedFiles.update((files) => [...files, chatFile]);
  }

  /**
   * Remove file tag
   */
  removeFile(filePath: string): void {
    this._selectedFiles.update((files) =>
      files.filter((f) => f.path !== filePath)
    );
  }

  /**
   * Insert text at cursor position
   */
  private insertAtCursor(text: string): void {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = this._currentMessage();
    const newValue =
      currentValue.substring(0, start) + text + currentValue.substring(end);

    this._currentMessage.set(newValue);
    textarea.value = newValue;

    // Move cursor after inserted text
    const newCursorPos = start + text.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
  }

  /**
   * Close suggestions dropdown
   */
  closeSuggestions(): void {
    this._showSuggestions.set(false);
    this._suggestionMode.set(null);
  }

  /**
   * Set active category (for tab switching)
   */
  setActiveCategory(category: 'all' | 'files' | 'agents'): void {
    this._activeCategory.set(category);
  }

  /**
   * Handle keyboard shortcuts
   * - Enter: Send message
   * - Shift+Enter: New line
   * - Escape: Close suggestions dropdown
   */
  handleKeyDown(event: KeyboardEvent): void {
    // Escape closes suggestions dropdown
    if (event.key === 'Escape' && this.showSuggestions()) {
      event.preventDefault();
      this.closeSuggestions();
      return;
    }

    // Enter sends message (if dropdown not shown)
    if (event.key === 'Enter' && !event.shiftKey && !this.showSuggestions()) {
      event.preventDefault();
      this.handleSend();
    }
  }

  /**
   * Send message - SMART ROUTING: queue if streaming, send if not
   */
  async handleSend(): Promise<void> {
    const content = this.currentMessage().trim();
    if (!content) return;

    try {
      // ========== SMART ROUTING BASED ON STREAMING STATE ==========
      if (this.chatStore.isStreaming()) {
        // Queue the message instead of sending
        this.chatStore.queueOrAppendMessage(content);
        console.log('[ChatInputComponent] Message queued during streaming');
      } else {
        // Normal send flow
        // Get file paths from selected files
        const filePaths = this._selectedFiles().map((f) => f.path);

        // Send message with files
        await this.chatStore.sendMessage(content, filePaths);
        console.log('[ChatInputComponent] Message sent normally');
      }
      // ========== END SMART ROUTING ==========

      // Clear input and files
      this._currentMessage.set('');
      this._selectedFiles.set([]);

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
   * Restore content to input textarea (called by effect when signal changes)
   * @param content - Content to restore to input
   */
  restoreContentToInput(content: string): void {
    this._currentMessage.set(content);

    // Focus and resize textarea
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }

    console.log('[ChatInputComponent] Content restored to input', {
      length: content.length,
    });
  }

  constructor() {
    // Listen for queue-to-input restoration signal
    effect(() => {
      const content = this.chatStore.queueRestoreContent();
      if (content) {
        this.restoreContentToInput(content);
        // Clear signal after restoration
        this.chatStore.clearQueueRestoreSignal();
      }
    });
  }
}
