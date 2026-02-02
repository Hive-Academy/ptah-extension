import {
  Component,
  inject,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
  viewChild,
  ElementRef,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Send, Zap, Square, Clock } from 'lucide-angular';
import { ChatStore } from '../../services/chat.store';
import { TabManagerService } from '../../services/tab-manager.service';
import {
  AutopilotStateService,
  CommandDiscoveryFacade,
  ClaudeRpcService,
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
import { AgentSelectorComponent } from './agent-selector.component';

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
 * MIGRATION NOTE (TASK_2025_092 Batch 4):
 * - Removed CdkOverlayOrigin - now using native ElementRef for overlay positioning
 * - UnifiedSuggestionsDropdownComponent uses Floating UI instead of CDK Overlay
 * - Overlay origin now passed as { elementRef } object instead of CdkOverlayOrigin
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
    AgentSelectorComponent,
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
            rows="2"
            role="combobox"
            [attr.aria-expanded]="showSuggestions()"
            [attr.aria-controls]="getListboxId()"
            [attr.aria-activedescendant]="getActiveDescendantId()"
            aria-autocomplete="list"
            ptahAtTrigger
            (atTriggered)="handleAtTriggered($event)"
            (atClosed)="handleAtClosed()"
            (atQueryChanged)="handleQueryChanged($event)"
            ptahSlashTrigger
            (slashTriggered)="handleSlashTriggered($event)"
            (slashClosed)="handleSlashClosed()"
            (slashQueryChanged)="handleQueryChanged($event)"
          ></textarea>

          <!-- File/Folder Suggestions Dropdown - positioned above textarea -->
          @if (showSuggestions() && textareaOrigin()) {
          <ptah-unified-suggestions-dropdown
            #suggestionsDropdown
            [overlayOrigin]="textareaOrigin()!"
            [suggestions]="filteredSuggestions()"
            [isLoading]="isLoadingSuggestions()"
            (suggestionSelected)="handleSuggestionSelected($event)"
            (closed)="closeSuggestions()"
          />
          }
        </div>

        <!-- Button Stack: Stop (streaming only) + Send -->
        <div class="flex flex-col gap-1">
          <!-- Stop Button (above send during streaming) -->
          <!-- TASK_2025_096 FIX: Use isActiveTabStreaming() which uses same signal as tab spinner -->
          @if (isActiveTabStreaming()) {
          <button
            class="btn btn-error btn-sm"
            (click)="handleStop()"
            title="Stop generating"
            type="button"
          >
            <lucide-angular [img]="SquareIcon" class="w-4 h-4" />
          </button>
          }
          <!-- Send Button (always functional - queues message during streaming) -->
          <button
            class="btn btn-primary"
            [disabled]="!canSend()"
            (click)="handleSend()"
            type="button"
          >
            <lucide-angular [img]="SendIcon" class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Queued Message Indicator -->
      @if (hasQueuedContent()) {
      <div
        class="flex items-center gap-2 px-2 py-1 bg-warning/10 rounded-lg text-warning text-xs"
      >
        <lucide-angular [img]="ClockIcon" class="w-3 h-3" />
        <span>Message queued - will send when response completes</span>
      </div>
      }

      <!-- Bottom Controls Row -->
      <div class="flex items-center justify-between gap-2 text-sm min-w-0">
        <!-- Left: Action Icons with Autopilot Badge -->
        <div class="flex items-center gap-2 text-base-content/60 flex-shrink-0">
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

          <!-- Auth Method Badge (TASK_2025_129 Batch 3) -->
          @if (authMethodLabel()) {
          <div
            class="badge badge-ghost badge-sm gap-1 opacity-70"
            [title]="'Authenticated via ' + authMethodLabel()"
          >
            <span>{{ authMethodLabel() }}</span>
          </div>
          }
        </div>

        <!-- Right: Agent Selector, Model Selector and Autopilot Popover -->
        <div class="flex items-center gap-1 min-w-0">
          <!-- Agent Selector - dedicated button for agents -->
          <ptah-agent-selector (agentSelected)="handleAgentSelected($event)" />

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
export class ChatInputComponent implements OnInit {
  readonly chatStore = inject(ChatStore);
  readonly tabManager = inject(TabManagerService);
  readonly autopilotState = inject(AutopilotStateService);
  private readonly rpcService = inject(ClaudeRpcService);

  // Autocomplete service injections
  readonly filePicker = inject(FilePickerService);
  readonly commandDiscovery = inject(CommandDiscoveryFacade);

  // Auth method badge (TASK_2025_129 Batch 3)
  readonly authMethodLabel = signal<string | null>(null);

  /**
   * TASK_2025_096 FIX: Use the same streaming indicator as tab spinner.
   * Previously, stop button used `chatStore.isStreaming()` which checks `tab.status`,
   * while tab spinner used `tabManager.isTabStreaming()` which uses `_streamingTabIds`.
   * These two signals could diverge, causing stop button to not appear even when
   * tab shows streaming spinner. Now both use the visual streaming indicator.
   */
  readonly isActiveTabStreaming = computed(() => {
    const activeTab = this.chatStore.activeTab();
    return activeTab ? this.tabManager.isTabStreaming(activeTab.id) : false;
  });

  // Signal-based viewChild references (Angular 20+ pattern)
  private readonly textareaRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('inputElement');

  /**
   * Textarea origin for Floating UI positioning.
   * Returns an object with elementRef to match the expected interface.
   * Replaces CdkOverlayOrigin which was removed in the native migration.
   */
  readonly textareaOrigin = computed(() => {
    const ref = this.textareaRef();
    return ref ? { elementRef: ref } : null;
  });

  private readonly dropdownRef = viewChild<UnifiedSuggestionsDropdownComponent>(
    'suggestionsDropdown'
  );

  // Lucide icons
  readonly SendIcon = Send;
  readonly ZapIcon = Zap;
  readonly SquareIcon = Square;
  readonly ClockIcon = Clock;

  // Session tracking for proper change detection (avoid clearing cache on every stream event)
  private _lastSessionId: string | null = null;

  // Local state
  private readonly _currentMessage = signal('');

  // Suggestion dropdown state (for @file and /command triggers)
  private readonly _showSuggestions = signal(false);
  readonly showSuggestions = this._showSuggestions.asReadonly();

  private readonly _suggestionMode = signal<
    'at-trigger' | 'slash-trigger' | null
  >(null);
  private readonly _triggerPosition = signal(0); // Position where trigger (@, /) starts
  private readonly _currentQuery = signal(''); // Current search query after trigger
  private readonly _selectedFiles = signal<ChatFile[]>([]);
  private readonly _isLoadingSuggestions = signal(false);

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly suggestionMode = this._suggestionMode.asReadonly();
  readonly selectedFiles = this._selectedFiles.asReadonly();
  readonly isLoadingSuggestions = this._isLoadingSuggestions.asReadonly();

  // Computed
  readonly canSend = computed(() => this.currentMessage().trim().length > 0);

  /**
   * Initialize auth method label fetch on component init (TASK_2025_129 Batch 3)
   */
  ngOnInit(): void {
    this.fetchAuthMethodLabel();
  }

  // Check if there's queued content waiting to be sent
  readonly hasQueuedContent = computed(() => {
    const tab = this.chatStore.activeTab();
    return !!tab?.queuedContent?.trim();
  });

  /**
   * Computed signal for filtered suggestions
   * Replaces the logic previously held inside the dropdown
   */
  readonly filteredSuggestions = computed(() => {
    const mode = this._suggestionMode();
    const query = this._currentQuery().toLowerCase().trim();

    if (mode === 'at-trigger') {
      const allFiles = this.filePicker.workspaceFiles().map((f) => {
        const { type: originalType, ...rest } = f;
        const isFolder = originalType === 'directory';
        return {
          type: 'file' as const,
          icon: isFolder ? '📁' : '📄',
          description: f.directory,
          isFolder,
          ...rest,
        } as SuggestionItem;
      });

      if (!query) return allFiles;
      return allFiles.filter(
        (f) =>
          f.type === 'file' &&
          (f.name.toLowerCase().includes(query) ||
            f.path.toLowerCase().includes(query))
      );
    }

    if (mode === 'slash-trigger') {
      const allCommands = this.commandDiscovery.searchCommands('').map((c) => ({
        type: 'command' as const,
        ...c,
      })) as SuggestionItem[];

      if (!query) return allCommands;
      return allCommands.filter(
        (c) =>
          c.type === 'command' &&
          (c.name.toLowerCase().includes(query) ||
            (c.description && c.description.toLowerCase().includes(query)))
      );
    }

    return [];
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
   * Handle @ trigger from AtTriggerDirective
   * Opens dropdown with ALL files (dropdown handles filtering)
   */
  handleAtTriggered(event: AtTriggerEvent): void {
    this._suggestionMode.set('at-trigger');
    this._triggerPosition.set(event.triggerPosition);
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
   * Handle / trigger from SlashTriggerDirective
   * Opens dropdown with ALL commands (dropdown handles filtering)
   */
  handleSlashTriggered(event: SlashTriggerEvent): void {
    this._suggestionMode.set('slash-trigger');
    this._triggerPosition.set(0); // Slash always starts at position 0
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

  /**
   * Handle immediate query changes for responsive filtering
   */
  handleQueryChanged(query: string): void {
    this._currentQuery.set(query);
  }

  // ============ END DIRECTIVE EVENT HANDLERS ============

  /**
   * Fetch suggestions for @ trigger (files + folders only)
   */
  private async fetchAtSuggestions(): Promise<void> {
    this._isLoadingSuggestions.set(true);
    try {
      await this.filePicker.ensureFilesLoaded();
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
      // Add file tag (don't insert text) and remove @ trigger from input
      this.addFileTag(suggestion);
      this.removeTriggerText();
    } else if (suggestion.type === 'command') {
      // Replace /query with /command-name
      this.replaceTrigger(`/${suggestion.name} `);
    }

    this.closeSuggestions();
  }

  /**
   * Handle agent selection from AgentSelectorComponent
   * Appends agent-{name} to input (Claude Code CLI convention)
   */
  handleAgentSelected(agentName: string): void {
    const currentValue = this._currentMessage();
    // Format: agent-{name} (not @{name}) per Claude Code CLI convention
    const newValue =
      currentValue +
      (currentValue.endsWith(' ') || currentValue === '' ? '' : ' ') +
      `agent-${agentName} `;
    this._currentMessage.set(newValue);

    // Focus textarea and update value
    const textarea = this.textareaRef()?.nativeElement;
    if (textarea) {
      textarea.value = newValue;
      textarea.focus();
      textarea.setSelectionRange(newValue.length, newValue.length);
    }
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
   * Replace trigger text with selected suggestion
   * Used for /command autocomplete
   */
  private replaceTrigger(replacement: string): void {
    const textarea = this.textareaRef()?.nativeElement;
    if (!textarea) return;

    const currentValue = this._currentMessage();
    const triggerStart = this._triggerPosition();
    const cursorPos = textarea.selectionStart;

    // Replace text from trigger start to current cursor position
    const newValue =
      currentValue.substring(0, triggerStart) +
      replacement +
      currentValue.substring(cursorPos);

    this._currentMessage.set(newValue);
    textarea.value = newValue;

    // Move cursor after replacement text
    const newCursorPos = triggerStart + replacement.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
  }

  /**
   * Remove trigger text from input (for file selection where we add tag instead)
   */
  private removeTriggerText(): void {
    const textarea = this.textareaRef()?.nativeElement;
    if (!textarea) return;

    const currentValue = this._currentMessage();
    const triggerStart = this._triggerPosition();
    const cursorPos = textarea.selectionStart;

    // Remove text from trigger start to current cursor position
    const newValue =
      currentValue.substring(0, triggerStart) +
      currentValue.substring(cursorPos);

    this._currentMessage.set(newValue);
    textarea.value = newValue;

    // Move cursor to trigger position
    textarea.setSelectionRange(triggerStart, triggerStart);
  }

  /**
   * Close suggestions dropdown
   */
  closeSuggestions(): void {
    this._showSuggestions.set(false);
    this._suggestionMode.set(null);
    this._currentQuery.set('');
  }

  /**
   * Get listbox ID for aria-controls attribute
   * Returns the ID of the dropdown's listbox element, or null if closed.
   *
   * ACCESSIBILITY: aria-controls tells assistive technology which element
   * the combobox controls (the popup listbox).
   */
  getListboxId(): string | null {
    if (!this.showSuggestions()) {
      return null;
    }
    return this.dropdownRef()?.listboxId ?? null;
  }

  /**
   * Get active descendant ID for aria-activedescendant attribute
   * Returns the ID of the currently highlighted option in the dropdown,
   * or null if dropdown is closed or no option is active.
   *
   * ACCESSIBILITY: Screen readers use aria-activedescendant to announce
   * the currently focused option without moving DOM focus from the textarea.
   */
  getActiveDescendantId(): string | null {
    if (!this.showSuggestions()) {
      return null;
    }
    return this.dropdownRef()?.getActiveDescendantId() ?? null;
  }

  /**
   * Handle keyboard shortcuts
   * - When dropdown is closed: Enter sends message, Shift+Enter for new line
   *
   * KEYBOARD NAVIGATION PATTERN (NEW: Batch 13):
   * - Dropdown has its own filter input that receives focus when open
   * - User types in filter input (NOT textarea)
   * - Dropdown handles all keyboard navigation internally
   * - No need to forward events from textarea to dropdown
   *
   * IMPORTANT: Textarea only handles Enter to send messages when dropdown is CLOSED.
   * When dropdown is open, focus is on filter input, so textarea doesn't receive events.
   */
  handleKeyDown(event: KeyboardEvent): void {
    const dropdown = this.dropdownRef();

    // If dropdown is open, handle navigation and selection
    if (this.showSuggestions() && dropdown) {
      if (
        ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'].includes(
          event.key
        )
      ) {
        // Forward event to dropdown component
        const handled = dropdown.onKeyDown(event);
        if (handled) {
          event.preventDefault();
          return;
        }
      }
    }

    // Default: Handle Enter to send message
    if (!this.showSuggestions() && event.key === 'Enter' && !event.shiftKey) {
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
   * Stop streaming (abort current response)
   * Calls ChatStore.abortCurrentMessage() which invokes SDK's interrupt()
   */
  async handleStop(): Promise<void> {
    try {
      await this.chatStore.abortCurrentMessage();
      console.log('[ChatInputComponent] Stopped streaming');
    } catch (error) {
      console.error('[ChatInputComponent] Failed to stop streaming:', error);
    }
  }

  /**
   * Fetch auth method label from backend for badge display (TASK_2025_129 Batch 3)
   */
  private async fetchAuthMethodLabel(): Promise<void> {
    try {
      const result = await this.rpcService.call('auth:getAuthStatus', {});
      if (result.isSuccess() && result.data) {
        const { authMethod, anthropicProviderId, availableProviders } =
          result.data;

        let label: string;
        if (authMethod === 'openrouter') {
          const provider = availableProviders?.find(
            (p) => p.id === anthropicProviderId
          );
          label = provider?.name ?? 'Provider';
        } else if (authMethod === 'oauth') {
          label = 'OAuth';
        } else if (authMethod === 'apiKey') {
          label = 'API Key';
        } else {
          label = 'Auto';
        }

        this.authMethodLabel.set(label);
      }
    } catch (error) {
      console.error(
        '[ChatInputComponent] Failed to fetch auth method label:',
        error
      );
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

    // Session change monitoring - clear command cache on session change
    // FIX: Track session ID (primitive) to avoid clearing cache on every stream event
    // Previously, watching activeTab() cleared cache 220+ times per streaming session
    // because updateTab() causes activeTab() to return a new object reference
    effect(
      () => {
        const activeTab = this.chatStore.activeTab();
        const currentSessionId = activeTab?.id ?? null;

        // Only clear cache when session ID actually changes
        if (currentSessionId !== this._lastSessionId) {
          if (this._lastSessionId !== null && currentSessionId !== null) {
            // Clear command autocomplete cache on session switch
            this.commandDiscovery.clearCache();
            console.log('[ChatInputComponent] Session changed, cache cleared', {
              from: this._lastSessionId,
              to: currentSessionId,
            });
          }
          this._lastSessionId = currentSessionId;
        }
      },
      { allowSignalWrites: true }
    );
  }
}
