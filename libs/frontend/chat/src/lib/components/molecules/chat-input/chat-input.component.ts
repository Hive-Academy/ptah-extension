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
import {
  LucideAngularModule,
  Send,
  Zap,
  Square,
  Clock,
  X,
  ImageIcon,
  Paperclip,
  ImagePlus,
} from 'lucide-angular';
import {
  InlineImageAttachment,
  type EffortLevel,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '../../../services/tab-manager.service';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
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
} from '../../../services/file-picker.service';
import {
  UnifiedSuggestionsDropdownComponent,
  type SuggestionItem,
} from '../../file-suggestions/unified-suggestions-dropdown.component';
import { FileTagComponent } from '../../file-suggestions/file-tag.component';
import {
  AtTriggerDirective,
  type AtTriggerEvent,
} from '../../../directives/at-trigger.directive';
import {
  SlashTriggerDirective,
  type SlashTriggerEvent,
} from '../../../directives/slash-trigger.directive';
import { AgentSelectorComponent } from './agent-selector.component';
import { EffortSelectorComponent } from './effort-selector.component';

/** Pasted image data for UI display */
interface PastedImage {
  id: string;
  data: string; // base64 (no prefix)
  mediaType: string;
  dataUrl: string; // for thumbnail display
  name: string;
}

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
    EffortSelectorComponent,
  ],
  template: `
    <div
      class="flex flex-col gap-2 p-4 bg-base-100 relative"
      (dragover)="handleDragOver($event)"
      (dragleave)="handleDragLeave($event)"
      (drop)="handleDrop($event)"
    >
      <!-- Compaction overlay on input area -->
      @if (resolvedIsCompacting()) {
        <div
          class="absolute inset-0 z-10 flex items-center justify-center bg-base-100/60 backdrop-blur-[1px] rounded-lg"
        >
          <div class="flex items-center gap-2 text-warning text-sm font-medium">
            <span class="loading loading-spinner loading-sm"></span>
            <span>Optimizing context...</span>
          </div>
        </div>
      }
      <!-- Drop zone overlay -->
      @if (isDraggingOver()) {
        <div
          class="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none"
        >
          <div class="flex items-center gap-2 text-primary text-sm font-medium">
            <lucide-angular [img]="ImageIconRef" class="w-5 h-5" />
            <span>Drop image here</span>
          </div>
        </div>
      }
      <!-- File Tags + Image Thumbnails Row (above textarea) -->
      @if (selectedFiles().length > 0 || pastedImages().length > 0) {
        <div class="flex flex-wrap gap-2">
          @for (file of selectedFiles(); track file.path) {
            <ptah-file-tag [file]="file" (removeFile)="removeFile(file.path)" />
          }
          @for (img of pastedImages(); track img.id) {
            <div class="relative group">
              <div
                class="w-16 h-16 rounded-lg border border-base-300 bg-cover bg-center"
                [style.background-image]="'url(' + img.dataUrl + ')'"
                [attr.aria-label]="img.name"
                role="img"
              ></div>
              <button
                class="absolute -top-1.5 -right-1.5 btn btn-circle btn-xs btn-error opacity-0 group-hover:opacity-100 transition-opacity"
                (click)="removePastedImage(img.id)"
                type="button"
              >
                <lucide-angular [img]="XIcon" class="w-3 h-3" />
              </button>
              <div
                class="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-lg px-1 py-0.5"
              >
                <span class="text-[9px] text-white truncate block">{{
                  img.name
                }}</span>
              </div>
            </div>
          }
        </div>
      }

      <!-- Input Row with Textarea and Send Button -->
      <div class="flex items-end gap-2">
        <!-- Textarea + Suggestions Dropdown -->
        <div class="relative flex-1">
          <!-- Attachment buttons overlaid at top-right of textarea -->
          <div class="absolute top-1.5 right-2 z-10 flex items-center gap-0.5">
            <button
              class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content/80"
              (click)="handleAttachFiles()"
              title="Attach files"
              type="button"
            >
              <lucide-angular [img]="PaperclipIcon" class="w-3.5 h-3.5" />
            </button>
            <button
              class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-base-content/80"
              (click)="handleAttachImages()"
              title="Attach images"
              type="button"
            >
              <lucide-angular [img]="ImagePlusIcon" class="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            #inputElement
            class="textarea textarea-bordered flex-1 min-h-[2.5rem] max-h-[10rem] resize-none transition-colors w-full pr-16"
            [class.border-info]="
              autopilotState.agentPlanMode() ||
              autopilotState.permissionLevel() === 'plan'
            "
            [class.border-warning]="
              !autopilotState.agentPlanMode() &&
              autopilotState.permissionLevel() !== 'plan' &&
              autopilotState.enabled()
            "
            [class.border-2]="
              autopilotState.enabled() || autopilotState.agentPlanMode()
            "
            placeholder="Ask a question or describe a task..."
            [value]="currentMessage()"
            (input)="handleInput($event)"
            (keydown)="handleKeyDown($event)"
            (paste)="handlePaste($event)"
            rows="2"
            role="combobox"
            [attr.aria-expanded]="showSuggestions()"
            [attr.aria-controls]="getListboxId()"
            [attr.aria-activedescendant]="getActiveDescendantId()"
            aria-autocomplete="list"
            ptahAtTrigger
            (atActivated)="handleAtActivated($event)"
            (atTriggered)="handleAtTriggered($event)"
            (atClosed)="handleAtClosed()"
            (atQueryChanged)="handleQueryChanged($event)"
            ptahSlashTrigger
            (slashActivated)="handleSlashActivated($event)"
            (slashTriggered)="handleSlashTriggered()"
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
              [errorMessage]="filePickerError()"
              (suggestionSelected)="handleSuggestionSelected($event)"
              (closed)="closeSuggestions()"
            />
          }
        </div>

        <!-- Button Stack: Stop (streaming only) + Send -->
        <div class="flex flex-col gap-1 pb-1">
          <!-- Stop Button (above send during streaming) -->
          <!-- TASK_2025_096 FIX: Use isActiveTabStreaming() which uses same signal as tab spinner -->
          @if (isActiveTabStreaming()) {
            <button
              class="btn btn-error btn-sm btn-square"
              (click)="handleStop()"
              title="Stop generating"
              type="button"
            >
              <lucide-angular [img]="SquareIcon" class="w-4 h-4" />
            </button>
          }
          <!-- Send Button (always functional - queues message during streaming) -->
          <button
            class="btn btn-primary btn-sm btn-square"
            [disabled]="!canSend()"
            (click)="handleSend()"
            type="button"
          >
            <lucide-angular [img]="SendIcon" class="w-4 h-4" />
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
      <div class="flex items-center justify-between gap-1.5 min-w-0">
        <!-- Left: Auth Method Badge + Model Selector -->
        <div
          class="flex items-center gap-0.5 text-base-content/60 flex-shrink-0"
        >
          <!-- Auth Method Badge (TASK_2025_129 Batch 3) -->
          @if (authMethodLabel()) {
            <div
              class="badge badge-ghost badge-xs gap-1 opacity-70"
              [title]="'Authenticated via ' + authMethodLabel()"
            >
              <span class="text-[10px]">{{ authMethodLabel() }}</span>
            </div>
          }

          <!-- Model Selector Component -->
          <ptah-model-selector />
        </div>

        <!-- Right: Agent Selector, Effort Selector and Autopilot Popover -->
        <div class="flex items-center gap-0.5 min-w-0">
          <!-- Agent Selector - dedicated button for built-in sub-agents -->
          <ptah-agent-selector (agentSelected)="handleAgentSelected($event)" />

          <!-- Effort Selector Component (TASK_2025_184) -->
          <ptah-effort-selector (effortChanged)="onEffortChange($event)" />

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
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
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
    const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    return tabId ? this.tabManager.isTabStreaming(tabId) : false;
  });

  /**
   * Per-tab compaction state. In canvas mode, scoped to this tile's tab.
   * Prevents compaction overlay from showing on ALL tiles.
   */
  readonly resolvedIsCompacting = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      const tabId = ctx();
      if (!tabId) return false;
      return (
        this.tabManager.tabs().find((t) => t.id === tabId)?.isCompacting ??
        false
      );
    }
    return this.chatStore.isCompacting();
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
    'suggestionsDropdown',
  );

  // Lucide icons
  readonly SendIcon = Send;
  readonly ZapIcon = Zap;
  readonly SquareIcon = Square;
  readonly ClockIcon = Clock;
  readonly XIcon = X;
  readonly ImageIconRef = ImageIcon;
  readonly PaperclipIcon = Paperclip;
  readonly ImagePlusIcon = ImagePlus;

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
  private readonly _pastedImages = signal<PastedImage[]>([]);
  private readonly _isDraggingOver = signal(false);
  private readonly _isLoadingSuggestions = signal(false);
  private readonly _isPickingFiles = signal(false);
  private readonly _isPickingImages = signal(false);

  // Public signals
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly suggestionMode = this._suggestionMode.asReadonly();
  readonly selectedFiles = this._selectedFiles.asReadonly();
  readonly pastedImages = this._pastedImages.asReadonly();
  readonly isDraggingOver = this._isDraggingOver.asReadonly();
  readonly isLoadingSuggestions = this._isLoadingSuggestions.asReadonly();

  // Computed
  readonly canSend = computed(
    () =>
      this.currentMessage().trim().length > 0 ||
      this._pastedImages().length > 0 ||
      this._selectedFiles().length > 0,
  );

  /** Expose fetch error only when in @ mode (not stale from previous mode) */
  readonly filePickerError = computed(() =>
    this._suggestionMode() === 'at-trigger'
      ? this.filePicker.fetchError()
      : null,
  );

  /**
   * Initialize auth method label fetch on component init (TASK_2025_129 Batch 3)
   */
  ngOnInit(): void {
    this.fetchAuthMethodLabel();
  }

  // Check if there's queued content waiting to be sent (session-context-aware)
  readonly hasQueuedContent = computed(() => {
    const ctx = this._sessionContext;
    if (ctx) {
      // Canvas tile: read from this tile's specific tab
      const tabId = ctx();
      if (!tabId) return false;
      const tab = this.tabManager.tabs().find((t) => t.id === tabId);
      return !!tab?.queuedContent?.trim();
    }
    // Single mode: read from active tab
    const queued = this.tabManager.activeTabQueuedContent();
    return !!queued?.trim();
  });

  /**
   * Computed signal for filtered suggestions.
   * Hybrid approach: merges local fuzzy results + server-side remote results.
   * Local results appear immediately; remote results merge in when RPC completes.
   */
  readonly filteredSuggestions = computed(() => {
    const mode = this._suggestionMode();
    const query = this._currentQuery().toLowerCase().trim();

    if (mode === 'at-trigger') {
      // Local fuzzy search (immediate, from cached workspace files)
      const localResults = this.filePicker.searchFiles(query);

      // Remote server-side search results (arrives async via signal)
      const remoteResults = this.filePicker.remoteResults();

      // Merge: local first, then remote results not already in local set
      const seenPaths = new Set(localResults.map((f) => f.path));
      const merged = [...localResults];
      for (const remote of remoteResults) {
        if (!seenPaths.has(remote.path)) {
          merged.push(remote);
          seenPaths.add(remote.path);
        }
      }

      return merged.slice(0, 40).map((f) => {
        const isFolder = f.type === 'directory';
        return {
          type: 'file' as const,
          icon: isFolder ? '📁' : '📄',
          description: f.directory,
          isFolder,
          path: f.path,
          name: f.name,
          directory: f.directory,
          extension: f.extension,
          size: f.size,
          lastModified: f.lastModified,
          isImage: f.isImage,
          isText: f.isText,
        } as SuggestionItem;
      });
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
            (c.description && c.description.toLowerCase().includes(query))),
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

  /**
   * Handle clipboard paste - extract images from clipboard
   */
  handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Extract base64 data (remove "data:image/png;base64," prefix)
          const base64 = dataUrl.split(',')[1];
          const mediaType = item.type;

          const pastedImage: PastedImage = {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            data: base64,
            mediaType,
            dataUrl,
            name: `pasted-image.${mediaType.split('/')[1] || 'png'}`,
          };

          this._pastedImages.update((imgs) => [...imgs, pastedImage]);
        };
        reader.onerror = () => {
          console.warn('[ChatInput] Failed to read image file');
        };
        reader.readAsDataURL(file);
      }
    }
  }

  /**
   * Remove a pasted image by ID
   */
  removePastedImage(id: string): void {
    this._pastedImages.update((imgs) => imgs.filter((img) => img.id !== id));
  }

  /**
   * Open native file picker to attach workspace files.
   * Uses RPC to bypass webview sandbox limitation.
   */
  async handleAttachFiles(): Promise<void> {
    if (this._isPickingFiles()) return;
    this._isPickingFiles.set(true);
    try {
      const result = await this.rpcService.call('file:pick', {
        multiple: true,
      });
      if (!result.success || !result.data?.files?.length) return;

      for (const file of result.data.files) {
        // Skip if already attached
        if (this._selectedFiles().some((f) => f.path === file.path)) continue;

        const name =
          file.path.replace(/\\/g, '/').split('/').pop() || file.path;
        const isLarge = file.size > 1024 * 1024; // > 1MB
        const isText = this.filePicker.isFileSupported(file.path);

        const chatFile: ChatFile = {
          path: file.path,
          name,
          size: file.size,
          type: isText ? 'text' : 'binary',
          isLarge,
          tokenEstimate: isText ? Math.ceil(file.size / 4) : 0,
        };

        this._selectedFiles.update((files) => [...files, chatFile]);
      }
    } catch (error) {
      console.error('[ChatInput] Failed to pick files:', error);
    } finally {
      this._isPickingFiles.set(false);
    }
  }

  /**
   * Open native file picker to attach images.
   * Uses RPC to bypass webview sandbox limitation - reads images as base64.
   */
  async handleAttachImages(): Promise<void> {
    if (this._isPickingImages()) return;
    this._isPickingImages.set(true);
    try {
      const result = await this.rpcService.call('file:pick-images', {
        multiple: true,
      });
      if (!result.success || !result.data?.images?.length) return;

      for (const img of result.data.images) {
        const pastedImage: PastedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: img.data,
          mediaType: img.mediaType,
          dataUrl: `data:${img.mediaType};base64,${img.data}`,
          name: img.name,
        };

        this._pastedImages.update((imgs) => [...imgs, pastedImage]);
      }
    } catch (error) {
      console.error('[ChatInput] Failed to pick images:', error);
    } finally {
      this._isPickingImages.set(false);
    }
  }

  /**
   * Handle dragover - show drop zone for image files
   */
  handleDragOver(event: DragEvent): void {
    const hasImages = Array.from(event.dataTransfer?.types ?? []).includes(
      'Files',
    );
    if (hasImages) {
      event.preventDefault();
      event.stopPropagation();
      this._isDraggingOver.set(true);
    }
  }

  /**
   * Handle dragleave - hide drop zone
   */
  handleDragLeave(event: DragEvent): void {
    // Only hide when leaving the container (not when entering a child element)
    const relatedTarget = event.relatedTarget as Node | null;
    const container = event.currentTarget as HTMLElement;
    if (!relatedTarget || !container.contains(relatedTarget)) {
      this._isDraggingOver.set(false);
    }
  }

  /**
   * Handle drop - extract images from dropped files
   */
  handleDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this._isDraggingOver.set(false);

    const files = event.dataTransfer?.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];

        const droppedImage: PastedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: base64,
          mediaType: file.type,
          dataUrl,
          name: file.name,
        };

        this._pastedImages.update((imgs) => [...imgs, droppedImage]);
      };
      reader.onerror = () => {
        console.warn('[ChatInput] Failed to read image file');
      };
      reader.readAsDataURL(file);
    }
  }

  // ============ DIRECTIVE EVENT HANDLERS ============

  /**
   * Handle @ trigger activation (IMMEDIATE - no debounce)
   * Opens dropdown instantly when @ is first detected.
   */
  handleAtActivated(event: AtTriggerEvent): void {
    this._suggestionMode.set('at-trigger');
    this._triggerPosition.set(event.triggerPosition);
    this._currentQuery.set(event.query);
    this._showSuggestions.set(true);
    this.fetchAtSuggestions();
  }

  /**
   * Handle debounced @ trigger from AtTriggerDirective
   * Only updates trigger position (may shift if user edits before @).
   * Does NOT overwrite _currentQuery — handleQueryChanged already has the latest value.
   */
  handleAtTriggered(event: AtTriggerEvent): void {
    this._triggerPosition.set(event.triggerPosition);
  }

  /**
   * Handle @ trigger closed from AtTriggerDirective
   */
  handleAtClosed(): void {
    if (this._suggestionMode() === 'at-trigger') {
      this._showSuggestions.set(false);
      this._suggestionMode.set(null);
      this.filePicker.clearRemoteResults();
    }
  }

  /**
   * Handle / trigger activation (IMMEDIATE - no debounce)
   * Opens dropdown instantly when / is first detected.
   */
  handleSlashActivated(event: SlashTriggerEvent): void {
    this._suggestionMode.set('slash-trigger');
    this._triggerPosition.set(0); // Slash always starts at position 0
    this._currentQuery.set(event.query);
    this._showSuggestions.set(true);
    this.fetchCommandSuggestions();
  }

  /**
   * Handle debounced / trigger from SlashTriggerDirective
   * Does NOT overwrite _currentQuery — handleQueryChanged already has the latest value.
   */
  handleSlashTriggered(): void {
    // Debounced trigger - no query update needed
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
   * Handle immediate query changes for responsive filtering.
   * Also triggers debounced server-side search for @ file queries.
   */
  handleQueryChanged(query: string): void {
    this._currentQuery.set(query);

    // Trigger server-side search for @ file queries (debounced inside service)
    if (this._suggestionMode() === 'at-trigger') {
      this.filePicker.searchFilesRemote(query);
    }
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
        error,
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
        error,
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
   * TASK_2025_184: Handle effort level change from EffortSelectorComponent.
   * The EffortSelectorComponent now persists directly via EffortStateService,
   * so this handler is kept for any additional side-effects if needed.
   */
  onEffortChange(_effort: EffortLevel | undefined): void {
    // No-op: EffortSelectorComponent saves per-tab or globally.
    // MessageSenderService resolves effective effort at send time.
  }

  /**
   * Handle agent selection from AgentSelectorComponent
   * Appends agent-{name} to input (agent convention)
   */
  handleAgentSelected(agentName: string): void {
    const currentValue = this._currentMessage();
    // Format: agent-{name} (not @{name}) per agent convention
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
      files.filter((f) => f.path !== filePath),
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
    this.filePicker.clearRemoteResults();
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
          event.key,
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
    const images = this._pastedImages();
    if (!content && images.length === 0) return;

    // Slash commands passed through as-is — SDK handles namespace resolution natively
    const normalizedContent = content;

    try {
      // FIX #8: Use ChatStore's sendOrQueueMessage method (routing logic moved to store)
      const filePaths = this._selectedFiles().map((f) => f.path);
      const inlineImages: InlineImageAttachment[] = images.map((img) => ({
        data: img.data,
        mediaType: img.mediaType,
      }));
      await this.chatStore.sendOrQueueMessage(
        normalizedContent || 'What is in this image?',
        {
          files: filePaths.length > 0 ? filePaths : undefined,
          images: inlineImages.length > 0 ? inlineImages : undefined,
          tabId: this._sessionContext?.() ?? undefined,
        },
      );

      // Clear input, files, and images
      this._currentMessage.set('');
      this._selectedFiles.set([]);
      this._pastedImages.set([]);

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
   * TASK_2025_185: Uses abortWithConfirmation() to warn user about running sub-agents
   */
  async handleStop(): Promise<void> {
    try {
      const aborted = await this.chatStore.abortWithConfirmation();
      console.log('[ChatInputComponent] Stop requested, aborted:', aborted);
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
            (p) => p.id === anthropicProviderId,
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
        error,
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
  }

  constructor() {
    // Listen for queue-to-input restoration signal
    // Validate tab ID to ensure content goes to correct tab
    effect(
      () => {
        const restoreData = this.chatStore.queueRestoreContent();
        if (restoreData) {
          // Verify tab ID matches active tab before restoring
          const activeTabId = this.tabManager.activeTabId();
          if (activeTabId && activeTabId === restoreData.tabId) {
            this.restoreContentToInput(restoreData.content);
          }
          // Clear signal after processing to prevent re-firing on activeTab() changes
          this.chatStore.clearQueueRestoreSignal();
        }
      },
      { allowSignalWrites: true },
    );

    // Session change monitoring - clear command cache on session change
    // Uses activeTabId() fine-grained selector so this effect only re-runs
    // when the active tab actually changes, not on every streaming tick.
    effect(
      () => {
        const currentTabId = this.tabManager.activeTabId();

        // Only clear cache when tab ID actually changes
        if (currentTabId !== this._lastSessionId) {
          if (this._lastSessionId !== null && currentTabId !== null) {
            // Clear command autocomplete cache on session switch
            this.commandDiscovery.clearCache();
          }
          this._lastSessionId = currentTabId;
        }
      },
      { allowSignalWrites: true },
    );
  }
}
