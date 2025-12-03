import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
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
import {
  AtTriggerDirective,
  type AtTriggerEvent,
} from '../../directives/at-trigger.directive';
import {
  SlashTriggerDirective,
  type SlashTriggerEvent,
} from '../../directives/slash-trigger.directive';

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
    AtTriggerDirective,
    SlashTriggerDirective,
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
            ptahAtTrigger
            (atTriggered)="handleAtTriggered($event)"
            (atClosed)="handleAtClosed()"
            ptahSlashTrigger
            (slashTriggered)="handleSlashTriggered($event)"
            (slashClosed)="handleSlashClosed()"
          ></textarea>

          <!-- Unified Suggestions Dropdown -->
          @if (showSuggestions()) {
          <ptah-unified-suggestions-dropdown
            [suggestions]="filteredSuggestions()"
            [isLoading]="isLoadingSuggestions()"
            [positionTop]="dropdownPosition().top"
            [positionLeft]="dropdownPosition().left"
            [showTabs]="suggestionMode() === 'at-trigger'"
            [activeCategory]="activeCategory()"
            (suggestionSelected)="handleSuggestionSelected($event)"
            (categoryChanged)="setActiveCategory($event)"
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

  // Signal-based viewChild reference for textarea (Angular 20+ pattern)
  private readonly textareaRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('inputElement');

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
    // Calculate dropdown position relative to textarea using signal-based viewChild
    const textareaEl = this.textareaRef()?.nativeElement;
    if (!textareaEl) return { top: 0, left: 0 };

    const rect = textareaEl.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
    };
  });

  /**
   * Handle input change (auto-resize only, trigger detection delegated to directives)
   */
  handleInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const value = target.value;

    this._currentMessage.set(value);

    // Auto-resize textarea
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
  }

  // ============ DIRECTIVE EVENT HANDLERS ============

  /**
   * Handle @ trigger from AtTriggerDirective (debounced)
   */
  handleAtTriggered(event: AtTriggerEvent): void {
    this._suggestionMode.set('at-trigger');
    this._currentQuery.set(event.query);
    this._showSuggestions.set(true);
    this.fetchAtSuggestions();
  }

  /**
   * Handle @ trigger closed from AtTriggerDirective
   */
  handleAtClosed(): void {
    if (this._suggestionMode() === 'at-trigger') {
      this._showSuggestions.set(false);
      this._suggestionMode.set(null);
    }
  }

  /**
   * Handle / trigger from SlashTriggerDirective (debounced)
   */
  handleSlashTriggered(event: SlashTriggerEvent): void {
    this._suggestionMode.set('slash-trigger');
    this._currentQuery.set(event.query);
    this._showSuggestions.set(true);
    this.fetchCommandSuggestions();
  }

  /**
   * Handle / trigger closed from SlashTriggerDirective
   */
  handleSlashClosed(): void {
    if (this._suggestionMode() === 'slash-trigger') {
      this._showSuggestions.set(false);
      this._suggestionMode.set(null);
    }
  }

  // ============ END DIRECTIVE EVENT HANDLERS ============

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
   * Add file tag above textarea (prevents duplicates)
   */
  private addFileTag(file: FileSuggestion): void {
    // Check for duplicate file path
    const existingPaths = this._selectedFiles().map((f) => f.path);
    if (existingPaths.includes(file.path)) {
      console.log('[ChatInputComponent] File already selected:', file.path);
      return;
    }

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
   * Insert text at cursor position using signal-based viewChild
   */
  private insertAtCursor(text: string): void {
    const textarea = this.textareaRef()?.nativeElement;
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
   * Send message
   * FIX #8: Delegate smart routing to ChatStore (SRP violation fixed)
   */
  async handleSend(): Promise<void> {
    const content = this.currentMessage().trim();
    if (!content) return;

    try {
      // FIX #8: Use ChatStore's sendOrQueueMessage method (routing logic moved to store)
      const filePaths = this._selectedFiles().map((f) => f.path);
      await this.chatStore.sendOrQueueMessage(content, filePaths);

      // Clear input and files
      this._currentMessage.set('');
      this._selectedFiles.set([]);

      // Reset textarea height using signal-based viewChild
      const textarea = this.textareaRef()?.nativeElement;
      if (textarea) {
        textarea.style.height = 'auto';
      }
    } catch (error) {
      console.error('[ChatInputComponent] Failed to send message:', error);
    }
  }

  /**
   * Restore content to input textarea (called by effect when signal changes)
   * FIX #2: Check if input is empty before restoring to prevent overwriting user input
   * @param content - Content to restore to input
   */
  restoreContentToInput(content: string): void {
    // FIX #2: Only restore if current message is empty (prevent overwriting user typing)
    if (this._currentMessage().trim()) {
      console.log(
        '[ChatInputComponent] Skipping restoration - input not empty',
        {
          currentLength: this._currentMessage().length,
          queueLength: content.length,
        }
      );
      return;
    }

    this._currentMessage.set(content);

    // Focus and resize textarea using signal-based viewChild
    const textarea = this.textareaRef()?.nativeElement;
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
    // FIX #3: Validate tab ID to ensure content goes to correct tab
    effect(() => {
      const restoreData = this.chatStore.queueRestoreContent();
      if (restoreData) {
        // FIX #3: Verify tab ID matches active tab
        const activeTab = this.chatStore.activeTab();
        if (activeTab && activeTab.id === restoreData.tabId) {
          this.restoreContentToInput(restoreData.content);
          console.log('[ChatInputComponent] Queue restored to correct tab', {
            tabId: restoreData.tabId,
          });
        } else {
          console.log(
            '[ChatInputComponent] Skipping restoration - tab mismatch',
            {
              restoreTabId: restoreData.tabId,
              activeTabId: activeTab?.id,
            }
          );
        }
        // Clear signal after restoration (or rejection)
        this.chatStore.clearQueueRestoreSignal();
      }
    });
  }
}
