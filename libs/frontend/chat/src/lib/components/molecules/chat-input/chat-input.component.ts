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
  X,
  ImageIcon,
  Paperclip,
  ImagePlus,
  File as FileIcon,
  Folder as FolderIcon,
  Mic,
  Share2,
  Unlink,
  MessageSquare,
} from 'lucide-angular';
import {
  InlineImageAttachment,
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
  type EffortLevel,
  type GatewayBindingDto,
  type GatewayPlatformId,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import {
  AutopilotStateService,
  CommandDiscoveryFacade,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import { VoiceInputService } from '../../../services/voice-input.service';
import { ModelSelectorComponent } from './model-selector.component';
import { AutopilotPopoverComponent } from '@ptah-extension/chat-ui';
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
import { AgentSelectorComponent } from '@ptah-extension/chat-ui';
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
 * MIGRATION NOTE:
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
  providers: [VoiceInputService],
  template: `
    <div
      class="flex flex-col gap-2 p-4 bg-base-100 relative"
      (dragover)="handleDragOver($event)"
      (dragleave)="handleDragLeave($event)"
      (drop)="handleDrop($event)"
    >
      <!-- Read-only banner: session attached to a messaging binding -->
      @if (attachedReadOnly()) {
        <div
          class="flex items-center gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
        >
          <lucide-angular
            [img]="MessageSquareIcon"
            class="w-4 h-4 text-info flex-shrink-0"
          />
          <span class="flex-1 text-base-content/80">
            This session is attached to {{ attachedPlatformLabel() }}. Resolve
            back to Ptah to continue here.
          </span>
          <button
            class="btn btn-info btn-xs gap-1"
            [disabled]="detaching()"
            (click)="detachBinding()"
            type="button"
            data-testid="chat-resolve-back-btn"
          >
            @if (detaching()) {
              <span class="loading loading-spinner loading-xs"></span>
            } @else {
              <lucide-angular [img]="UnlinkIcon" class="w-3.5 h-3.5" />
            }
            <span>Resolve back to webview</span>
          </button>
        </div>
      }
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

      <!-- Image attachment validation error (auto-clears after 4s) -->
      @if (imageAttachmentError()) {
        <div
          class="flex items-center gap-1.5 text-xs text-error px-2"
          role="alert"
          aria-live="polite"
        >
          <span>{{ imageAttachmentError() }}</span>
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
            @if (isElectron) {
              @if (isRecording()) {
                <span class="text-[10px] text-error tabular-nums px-0.5">{{
                  voiceElapsedLabel()
                }}</span>
              }
              <button
                [class]="
                  'btn btn-ghost btn-xs btn-square ' +
                  (isRecording()
                    ? 'text-error animate-pulse'
                    : 'text-base-content/50 hover:text-base-content/80')
                "
                [disabled]="isTranscribing()"
                (click)="handleVoiceButton()"
                [title]="
                  isRecording()
                    ? 'Stop recording'
                    : isTranscribing()
                      ? 'Transcribing...'
                      : 'Record voice'
                "
                type="button"
                data-testid="chat-voice-btn"
              >
                @if (isTranscribing()) {
                  <span class="loading loading-spinner loading-xs"></span>
                } @else if (isRecording()) {
                  <lucide-angular [img]="SquareIcon" class="w-3.5 h-3.5" />
                } @else {
                  <lucide-angular [img]="MicIcon" class="w-3.5 h-3.5" />
                }
              </button>
            }
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
            [placeholder]="
              attachedReadOnly()
                ? 'Session is attached to messaging — read-only'
                : 'Ask a question or describe a task...'
            "
            [value]="currentMessage()"
            [readonly]="attachedReadOnly()"
            [class.opacity-60]="attachedReadOnly()"
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
          <!-- Use isActiveTabStreaming() which uses same signal as tab spinner -->
          @if (isActiveTabStreaming()) {
            <button
              class="btn btn-error btn-sm btn-square"
              (click)="handleStop()"
              title="Stop generating"
              type="button"
              data-testid="chat-stop-btn"
            >
              <lucide-angular [img]="SquareIcon" class="w-4 h-4" />
            </button>
          }
          <!-- Send Button (always functional - queues message during streaming) -->
          <button
            class="btn btn-primary btn-sm btn-square"
            [disabled]="!canSend() || attachedReadOnly()"
            (click)="handleSend()"
            type="button"
            data-testid="chat-send-btn"
          >
            <lucide-angular [img]="SendIcon" class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Bottom Controls Row -->
      <div class="flex items-center justify-between gap-1.5 min-w-0">
        <!-- Left: Auth Method Badge + Model Selector -->
        <div
          class="flex items-center gap-0.5 text-base-content/60 flex-shrink-0"
        >
          <!-- Auth Method Badge -->
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

        <!-- Right: Send-to-messaging, Agent Selector, Effort Selector, Autopilot -->
        <div class="flex items-center gap-0.5 min-w-0">
          <!-- Send to messaging (Electron only; needs a real session) -->
          @if (canSendToMessaging()) {
            <div class="relative">
              <button
                class="btn btn-ghost btn-xs gap-1 text-base-content/60 hover:text-base-content/90"
                (click)="
                  showBindingPicker()
                    ? closeBindingPicker()
                    : openBindingPicker()
                "
                type="button"
                title="Send this session to a messaging app"
                data-testid="chat-send-to-messaging-btn"
              >
                <lucide-angular
                  [img]="SendToMessagingIcon"
                  class="w-3.5 h-3.5"
                />
                <span class="text-[11px]">Send to messaging</span>
              </button>

              @if (showBindingPicker()) {
                <div
                  class="absolute bottom-full right-0 mb-1 z-20 w-64 rounded-lg border border-base-300 bg-base-100 shadow-lg p-1"
                  role="listbox"
                  aria-label="Approved messaging bindings"
                >
                  @if (bindingsLoading()) {
                    <div
                      class="flex items-center gap-2 px-3 py-3 text-sm text-base-content/60"
                    >
                      <span class="loading loading-spinner loading-xs"></span>
                      <span>Loading bindings…</span>
                    </div>
                  } @else if (approvedBindings().length === 0) {
                    <div class="px-3 py-3 text-sm text-base-content/60">
                      No approved bindings. Approve one in the Gateway tab
                      first.
                    </div>
                  } @else {
                    @for (binding of approvedBindings(); track binding.id) {
                      <button
                        class="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-base-200 disabled:opacity-50 flex items-center gap-2"
                        [disabled]="attaching()"
                        (click)="attachToBinding(binding)"
                        type="button"
                        role="option"
                        [attr.aria-selected]="false"
                      >
                        <lucide-angular
                          [img]="MessageSquareIcon"
                          class="w-3.5 h-3.5 flex-shrink-0 text-base-content/50"
                        />
                        <span class="truncate">{{
                          bindingLabel(binding)
                        }}</span>
                      </button>
                    }
                  }
                </div>
              }
            </div>
          }

          <!-- Agent Selector - dedicated button for built-in sub-agents -->
          <ptah-agent-selector (agentSelected)="handleAgentSelected($event)" />

          <!-- Effort Selector Component -->
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
  private readonly vscodeService = inject(VSCodeService);
  readonly voiceInput = inject(VoiceInputService);
  readonly filePicker = inject(FilePickerService);

  readonly isElectron = this.vscodeService.isElectron;
  readonly isRecording = this.voiceInput.isRecording;
  readonly isTranscribing = this.voiceInput.isTranscribing;
  readonly voiceElapsedLabel = computed(() => {
    const total = this.voiceInput.elapsedSeconds();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  });
  readonly commandDiscovery = inject(CommandDiscoveryFacade);
  readonly authMethodLabel = signal<string | null>(null);

  /**
   * Use the same streaming indicator as tab spinner.
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
   * Per-`SessionStatus` direct-send enablement matrix.
   *
   * - `fresh` — enabled
   * - `draft` — enabled
   * - `loaded` — enabled
   * - `awaiting-background` — enabled
   * - `streaming` — disabled
   * - `resuming` — disabled
   * - `switching` — disabled
   */
  readonly inputEnabled = computed<boolean>(() => {
    const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    if (!tabId) return true;
    const tab = this.tabManager.tabs().find((t) => t.id === tabId);
    if (!tab) return true;
    switch (tab.status) {
      case 'fresh':
      case 'draft':
      case 'loaded':
      case 'awaiting-background':
        return true;
      case 'streaming':
      case 'resuming':
      case 'switching':
        return false;
    }
  });

  /**
   * The active tab resolved the same way `inputEnabled` resolves it
   * (SESSION_CONTEXT tile scope first, else the global active tab). Single
   * source of truth for both the read-only gate and the "Send to messaging"
   * trigger so they always agree on which tab they act on.
   */
  private readonly resolvedTab = computed(() => {
    const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    if (!tabId) return null;
    return this.tabManager.tabs().find((t) => t.id === tabId) ?? null;
  });

  /**
   * The messaging binding this tab's session is attached to, or null. When
   * non-null the composer is READ-ONLY (the session is being driven from
   * Telegram / Discord / Slack) and the "Resolve back to webview" banner shows.
   */
  readonly attachedBinding = computed(
    () => this.resolvedTab()?.attachedBinding ?? null,
  );

  /** True when this tab's session is attached to a messaging binding. */
  readonly attachedReadOnly = computed(() => this.attachedBinding() != null);

  /** Human-readable platform label for the read-only banner. */
  readonly attachedPlatformLabel = computed(() => {
    const platform = this.attachedBinding()?.platform;
    return platform ? this.platformLabel(platform) : '';
  });

  /** In-flight guard for the detach ("Resolve back to webview") action. */
  private readonly _detaching = signal(false);
  readonly detaching = this._detaching.asReadonly();

  // ----- "Send to messaging" trigger / picker state -----

  /** Whether the binding picker popover is open. */
  private readonly _showBindingPicker = signal(false);
  readonly showBindingPicker = this._showBindingPicker.asReadonly();

  /** Approved bindings loaded for the picker. */
  private readonly _approvedBindings = signal<GatewayBindingDto[]>([]);
  readonly approvedBindings = this._approvedBindings.asReadonly();

  /** Whether the approved-binding list is loading. */
  private readonly _bindingsLoading = signal(false);
  readonly bindingsLoading = this._bindingsLoading.asReadonly();

  /** In-flight guard for the attach action. */
  private readonly _attaching = signal(false);
  readonly attaching = this._attaching.asReadonly();

  /**
   * Whether the "Send to messaging" trigger is available: an Electron-only
   * affordance that requires a real SDK session and an un-attached tab.
   */
  readonly canSendToMessaging = computed(() => {
    if (!this.isElectron) return false;
    if (this.attachedReadOnly()) return false;
    return !!this.resolvedTab()?.claudeSessionId;
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
  readonly SendIcon = Send;
  readonly ZapIcon = Zap;
  readonly SquareIcon = Square;
  readonly XIcon = X;
  readonly ImageIconRef = ImageIcon;
  readonly PaperclipIcon = Paperclip;
  readonly ImagePlusIcon = ImagePlus;
  readonly MicIcon = Mic;
  readonly SendToMessagingIcon = Share2;
  readonly UnlinkIcon = Unlink;
  readonly MessageSquareIcon = MessageSquare;
  private _lastSessionId: string | null = null;
  private readonly _currentMessage = signal('');
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
  private readonly _imageAttachmentError = signal<string | null>(null);
  readonly imageAttachmentError = this._imageAttachmentError.asReadonly();
  private _imageAttachmentErrorTimeout: ReturnType<typeof setTimeout> | null =
    null;
  readonly currentMessage = this._currentMessage.asReadonly();
  readonly suggestionMode = this._suggestionMode.asReadonly();
  readonly selectedFiles = this._selectedFiles.asReadonly();
  readonly pastedImages = this._pastedImages.asReadonly();
  readonly isDraggingOver = this._isDraggingOver.asReadonly();
  readonly isLoadingSuggestions = this._isLoadingSuggestions.asReadonly();
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
   * Initialize auth method label fetch on component init.
   */
  ngOnInit(): void {
    this.fetchAuthMethodLabel();
  }

  /**
   * Computed signal for filtered suggestions.
   * Hybrid approach: merges local fuzzy results + server-side remote results.
   * Local results appear immediately; remote results merge in when RPC completes.
   */
  readonly filteredSuggestions = computed(() => {
    const mode = this._suggestionMode();
    const query = this._currentQuery().toLowerCase().trim();

    if (mode === 'at-trigger') {
      const localResults = this.filePicker.searchFiles(query);
      const remoteResults = this.filePicker.remoteResults();
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
          icon: isFolder ? FolderIcon : f.isImage ? ImageIcon : FileIcon,
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
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, 160)}px`;
  }

  /**
   * Show a transient, user-visible error near the input area.
   * Mirrors the signal+timeout pattern used in editor.service.ts showError().
   * Auto-clears after 4 seconds.
   */
  private showImageAttachmentError(message: string): void {
    if (this._imageAttachmentErrorTimeout) {
      clearTimeout(this._imageAttachmentErrorTimeout);
    }
    this._imageAttachmentError.set(message);
    this._imageAttachmentErrorTimeout = setTimeout(() => {
      this._imageAttachmentError.set(null);
      this._imageAttachmentErrorTimeout = null;
    }, 4000);
  }

  /**
   * Handle clipboard paste - extract images from clipboard.
   *
   * Layer 2 defense-in-depth validation: magic-byte sniffing via
   * resolveImageMediaType() + 5MB size cap. Unsupported/oversized images
   * are rejected at the UI boundary before hitting the API.
   */
  handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          this.showImageAttachmentError('Image too large â€” 5MB max');
          continue;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const decodedSize = Math.floor(base64.length * 0.75);
          if (decodedSize > MAX_IMAGE_SIZE_BYTES) {
            this.showImageAttachmentError('Image too large â€” 5MB max');
            return;
          }
          const mediaType = resolveImageMediaType(item.type, base64);
          if (!mediaType) {
            this.showImageAttachmentError(
              'Unsupported image format â€” use PNG, JPEG, GIF, or WebP',
            );
            return;
          }

          const pastedImage: PastedImage = {
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            data: base64,
            mediaType,
            dataUrl,
            name: `pasted-image.${mediaType.split('/')[1]}`,
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
        const mediaType = resolveImageMediaType(img.mediaType, img.data);
        if (!mediaType) {
          console.warn(
            '[ChatInput] Picker returned image that failed client-side validation:',
            img.name,
            img.mediaType,
          );
          continue;
        }

        const pastedImage: PastedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: img.data,
          mediaType,
          dataUrl: `data:${mediaType};base64,${img.data}`,
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

  async handleVoiceButton(): Promise<void> {
    if (this.isTranscribing()) return;

    if (this.isRecording()) {
      const result = await this.voiceInput.stopRecording();
      if (!result) return;
      if (result.ok && result.transcript) {
        this.insertTranscript(result.transcript);
      } else if (!result.ok && result.error) {
        this.showImageAttachmentError(result.error);
      }
      return;
    }

    await this.voiceInput.startRecording();
    const error = this.voiceInput.error();
    if (error) {
      this.showImageAttachmentError(error);
    }
  }

  private insertTranscript(transcript: string): void {
    const text = transcript.trim();
    if (!text) return;

    const textarea = this.textareaRef()?.nativeElement;
    const currentValue = this._currentMessage();

    if (!textarea) {
      const needsSpace =
        currentValue.length > 0 && !currentValue.endsWith(' ') ? ' ' : '';
      this._currentMessage.set(currentValue + needsSpace + text);
      return;
    }

    const cursorStart = textarea.selectionStart ?? currentValue.length;
    const cursorEnd = textarea.selectionEnd ?? currentValue.length;
    const before = currentValue.substring(0, cursorStart);
    const after = currentValue.substring(cursorEnd);
    const atEndAfterText =
      cursorStart === currentValue.length && before.length > 0;
    const leadingSpace = atEndAfterText && !before.endsWith(' ') ? ' ' : '';
    const insertion = leadingSpace + text;
    const newValue = before + insertion + after;

    this._currentMessage.set(newValue);
    textarea.value = newValue;
    const newCursorPos = cursorStart + insertion.length;
    textarea.focus();
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
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
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        this.showImageAttachmentError('Image too large â€” 5MB max');
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        const mediaType = resolveImageMediaType(file.type, base64);
        if (!mediaType) {
          this.showImageAttachmentError(
            'Unsupported image format â€” use PNG, JPEG, GIF, or WebP',
          );
          return;
        }

        const droppedImage: PastedImage = {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: base64,
          mediaType,
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
   * Does NOT overwrite _currentQuery â€” handleQueryChanged already has the latest value.
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
   * Does NOT overwrite _currentQuery â€” handleQueryChanged already has the latest value.
   */
  handleSlashTriggered(): void {
    console.log('ChatInputComponent.handleSlashTriggered called');
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
    if (this._suggestionMode() === 'at-trigger') {
      this.filePicker.searchFilesRemote(query);
    }
  }

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
      this.addFileTag(suggestion);
      this.removeTriggerText();
    } else if (suggestion.type === 'command') {
      this.replaceTrigger(`/${suggestion.name} `);
    }

    this.closeSuggestions();
  }

  /**
   * Handle effort level change from EffortSelectorComponent.
   * The EffortSelectorComponent now persists directly via EffortStateService,
   * so this handler is kept for any additional side-effects if needed.
   */
  onEffortChange(_effort: EffortLevel | undefined): void {
    console.log('ChatInputComponent.onEffortChange called');
  }

  /**
   * Handle agent selection from AgentSelectorComponent
   * Appends agent-{name} to input (agent convention)
   */
  handleAgentSelected(agentName: string): void {
    const currentValue = this._currentMessage();
    const newValue =
      currentValue +
      (currentValue.endsWith(' ') || currentValue === '' ? '' : ' ') +
      `agent-${agentName} `;
    this._currentMessage.set(newValue);
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
    const newValue =
      currentValue.substring(0, triggerStart) +
      replacement +
      currentValue.substring(cursorPos);

    this._currentMessage.set(newValue);
    textarea.value = newValue;
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
    const newValue =
      currentValue.substring(0, triggerStart) +
      currentValue.substring(cursorPos);

    this._currentMessage.set(newValue);
    textarea.value = newValue;
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
    if (this.showSuggestions() && dropdown) {
      if (
        ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape'].includes(
          event.key,
        )
      ) {
        const handled = dropdown.onKeyDown(event);
        if (handled) {
          event.preventDefault();
          return;
        }
      }
    }
    if (!this.showSuggestions() && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Read-only while attached to a messaging binding — Enter must not send.
      if (this.attachedReadOnly()) return;
      this.handleSend();
    }
  }

  /**
   * Send message
   * FIX #8: Delegate smart routing to ChatStore (SRP violation fixed)
   */
  async handleSend(): Promise<void> {
    // Composer is read-only while the session is attached to a messaging
    // binding — block sends; the user must "Resolve back to webview" first.
    if (this.attachedReadOnly()) return;
    const content = this.currentMessage().trim();
    const images = this._pastedImages();
    if (!content && images.length === 0) return;
    const normalizedContent = content;

    try {
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
      this._currentMessage.set('');
      this._selectedFiles.set([]);
      this._pastedImages.set([]);
      const textarea = this.textareaRef()?.nativeElement;
      if (textarea) {
        textarea.style.height = 'auto';
      }
    } catch (error) {
      console.error('[ChatInputComponent] Failed to send message:', error);
    }
  }

  /**
   * Stop streaming (abort current response).
   * Uses abortWithConfirmation() to warn user about running sub-agents.
   */
  async handleStop(): Promise<void> {
    try {
      const aborted = await this.chatStore.abortWithConfirmation();
      console.log('[ChatInputComponent] Stop requested, aborted:', aborted);
    } catch (error) {
      console.error('[ChatInputComponent] Failed to stop streaming:', error);
    }
  }

  // ==========================================================================
  // MESSAGING ATTACHMENT — "Send to messaging" + "Resolve back to webview"
  // ==========================================================================

  /** Map a platform id to a display label for banners/picker. */
  private platformLabel(platform: GatewayPlatformId): string {
    switch (platform) {
      case 'telegram':
        return 'Telegram';
      case 'discord':
        return 'Discord';
      case 'slack':
        return 'Slack';
    }
  }

  /** Display label for a binding row in the picker. */
  bindingLabel(binding: GatewayBindingDto): string {
    const platform = this.platformLabel(binding.platform);
    const name = binding.displayName?.trim();
    return name ? `${platform} · ${name}` : platform;
  }

  /**
   * Resolve the workspace root for THIS tab's session (not just the active
   * workspace). The tab's session is registered to a workspace in the
   * partition reverse index — look it up by the tab's SDK session id.
   */
  private resolveTabWorkspaceRoot(sessionId: string): string | null {
    const lookup =
      this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId);
    return lookup?.workspacePath ?? this.tabManager.activeWorkspacePath ?? null;
  }

  /**
   * Open the binding picker: fetch the approved bindings via
   * `gateway:listBindings({ status: 'approved' })`. Disabled unless the tab has
   * a real SDK session and is not already attached (see `canSendToMessaging`).
   */
  async openBindingPicker(): Promise<void> {
    if (!this.canSendToMessaging()) return;
    this._showBindingPicker.set(true);
    this._bindingsLoading.set(true);
    try {
      const result = await this.rpcService.call('gateway:listBindings', {
        status: 'approved',
      });
      if (result.isSuccess() && result.data) {
        this._approvedBindings.set(result.data.bindings ?? []);
      } else {
        this._approvedBindings.set([]);
        this.showImageAttachmentError(
          result.error || 'Failed to load messaging bindings',
        );
      }
    } catch (error) {
      console.error('[ChatInputComponent] listBindings failed:', error);
      this._approvedBindings.set([]);
      this.showImageAttachmentError('Failed to load messaging bindings');
    } finally {
      this._bindingsLoading.set(false);
    }
  }

  /** Close the binding picker popover. */
  closeBindingPicker(): void {
    this._showBindingPicker.set(false);
  }

  /**
   * Attach this tab's session to the chosen binding via
   * `gateway:attachSession`. Surfaces the typed error results
   * (`binding-not-approved`, `session-not-resumable`, `binding-not-found`) as a
   * short transient message. On success the backend pushes
   * `gateway:sessionAttached`, which flips the tab to read-only.
   */
  async attachToBinding(binding: GatewayBindingDto): Promise<void> {
    if (this._attaching()) return;
    const tab = this.resolvedTab();
    const sessionUuid = tab?.claudeSessionId;
    if (!tab || !sessionUuid) {
      this.showImageAttachmentError('No session to attach yet');
      return;
    }
    const workspaceRoot = this.resolveTabWorkspaceRoot(sessionUuid);
    if (!workspaceRoot) {
      this.showImageAttachmentError('Could not resolve this tab’s workspace');
      return;
    }

    this._attaching.set(true);
    try {
      const result = await this.rpcService.call('gateway:attachSession', {
        bindingId: binding.id,
        sessionUuid,
        workspaceRoot,
        externalConversationId: 'default',
      });
      if (result.isSuccess() && result.data?.ok) {
        // Success — backend push (`gateway:sessionAttached`) sets read-only.
        this.closeBindingPicker();
      } else {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.showImageAttachmentError(this.attachErrorLabel(reason));
      }
    } catch (error) {
      console.error('[ChatInputComponent] attachSession failed:', error);
      this.showImageAttachmentError('Failed to attach session to messaging');
    } finally {
      this._attaching.set(false);
    }
  }

  /** Map a typed attach error to a short user-facing message. */
  private attachErrorLabel(reason: string | undefined): string {
    switch (reason) {
      case 'binding-not-approved':
        return 'That messaging binding is not approved yet';
      case 'session-not-resumable':
        return 'This session can’t be resumed for messaging';
      case 'binding-not-found':
        return 'Messaging binding no longer exists';
      default:
        return reason || 'Failed to attach session to messaging';
    }
  }

  /**
   * "Resolve back to webview" — detach the binding via
   * `gateway:detachSession`. The backend clears the link and pushes
   * `gateway:sessionDetached`, which re-enables this composer.
   */
  async detachBinding(): Promise<void> {
    if (this._detaching()) return;
    const bindingId = this.attachedBinding()?.bindingId;
    if (!bindingId) return;

    this._detaching.set(true);
    try {
      const result = await this.rpcService.call('gateway:detachSession', {
        bindingId,
      });
      if (!(result.isSuccess() && result.data?.ok)) {
        const reason =
          result.isSuccess() && result.data && result.data.ok === false
            ? result.data.error
            : result.error;
        this.showImageAttachmentError(
          reason === 'binding-not-found'
            ? 'Messaging binding no longer exists'
            : reason || 'Failed to resolve session back to webview',
        );
      }
      // On success the `gateway:sessionDetached` push clears `attachedBinding`.
    } catch (error) {
      console.error('[ChatInputComponent] detachSession failed:', error);
      this.showImageAttachmentError(
        'Failed to resolve session back to webview',
      );
    } finally {
      this._detaching.set(false);
    }
  }

  /**
   * Fetch auth method label from backend for badge display.
   */
  private async fetchAuthMethodLabel(): Promise<void> {
    try {
      const result = await this.rpcService.call('auth:getAuthStatus', {});
      if (result.isSuccess() && result.data) {
        const { authMethod, anthropicProviderId, availableProviders } =
          result.data;

        let label: string;
        if (authMethod === 'thirdParty') {
          const provider = availableProviders?.find(
            (p) => p.id === anthropicProviderId,
          );
          label = provider?.name ?? 'Provider';
        } else if (authMethod === 'apiKey') {
          label = 'API Key';
        } else if (authMethod === 'claudeCli') {
          label = 'Claude CLI';
        } else {
          label = 'API Key';
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
    if (this._currentMessage().trim()) {
      return;
    }

    this._currentMessage.set(content);
    const textarea = this.textareaRef()?.nativeElement;
    if (textarea) {
      textarea.focus();
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    }
  }

  constructor() {
    effect(() => {
      const restoreData = this.chatStore.queueRestoreContent();
      if (restoreData) {
        const activeTabId = this.tabManager.activeTabId();
        if (activeTabId && activeTabId === restoreData.tabId) {
          this.restoreContentToInput(restoreData.content);
        }
        this.chatStore.clearQueueRestoreSignal();
      }
    });
    effect(() => {
      const currentTabId = this.tabManager.activeTabId();
      if (currentTabId !== this._lastSessionId) {
        if (this._lastSessionId !== null && currentTabId !== null) {
          this.commandDiscovery.clearCache();
        }
        this._lastSessionId = currentTabId;
      }
    });
  }
}
