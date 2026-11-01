import {
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  afterNextRender,
  Injector,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  viewChild,
  ElementRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import {
  LucideAngularModule,
  ArrowUp,
  GitBranch,
  Zap,
  Square,
  X,
  ImageIcon,
  Paperclip,
  ImagePlus,
  File as FileIcon,
  Folder as FolderIcon,
  Mic,
  Plus,
} from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  InlineImageAttachment,
  MAX_IMAGE_SIZE_BYTES,
  resolveImageMediaType,
  type EffortLevel,
} from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { isTabBusyGenerating } from '../../../services/chat-store/message-dispatch.service';
import {
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  SESSION_CONTEXT,
  SESSION_START_GUARD,
  SESSION_STOP_HANDLER,
} from '../../../tokens/session-context.token';
import { ComposerCompactStore } from '../../../services/composer-compact.store';
import { ComposerActivityDirective } from '../../../directives/composer-activity.directive';
import { ComposerTypeToExpandDirective } from './composer-type-to-expand.directive';
import {
  ComposerDraftStore,
  type ComposerDraft,
  type ComposerDraftImage,
} from '../../../services/composer-draft.store';
import {
  AuthStateService,
  AutopilotStateService,
  CommandDiscoveryFacade,
  ClaudeRpcService,
  AppStateManager,
  VSCodeService,
} from '@ptah-extension/core';
import { VoiceInputService } from '../../../services/voice-input.service';
import {
  SessionGitStatsStore,
  sessionBranch,
  sessionWorkingRoot,
} from '../../../services/session-git-stats/session-git-stats.store';
import { ModelSelectorComponent } from './model-selector.component';
import {
  AutopilotPopoverComponent,
  ComposerCompactBarComponent,
  COMPOSER_CARD_BORDER_CLASS,
  COMPOSER_CARD_CLASS,
  PROMPT_CATALOGUE,
} from '@ptah-extension/chat-ui';
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
import { EffortSelectorComponent } from './effort-selector.component';
import { McpStatusChipComponent } from '../mcp-status-chip.component';
import { PeerSessionSendComponent } from '../peer-session-send';
import {
  COMPOSER_TRIGGER_CACHE_ENABLED,
  MAX_CACHED_TRIGGER_QUERIES,
  TRIGGER_PROJECTION_DEBOUNCE_MS,
} from '../../../services/composer-trigger-scheduler';

/** Pasted image data for UI display */
interface PastedImage extends ComposerDraftImage {
  id: string;
  data: string; // base64 (no prefix)
  mediaType: string;
  dataUrl: string; // for thumbnail display
  name: string;
}

type FileSuggestionItem = Extract<SuggestionItem, { type: 'file' }>;
type CommandSuggestionItem = Extract<SuggestionItem, { type: 'command' }>;

/** Per-instance suffix for the textarea id (several composers can mount). */
let nextComposerId = 0;

/** Last path segment of a working root (`/a/b/` and `C:\a\b` -> `b`). */
function folderName(root: string): string {
  const parts = root.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? root;
}

/**
 * ChatInputComponent - Enhanced message input with bottom bar controls
 *
 * Complexity Level: 2 (Input with model selector and autopilot toggle)
 * Patterns: Signal-based state, Composition
 *
 * Layout ("card + status line", design-spec §6):
 * - One `<form aria-label="Message composer">` card holds the workspace /
 *   branch hint strip, attachments, a borderless textarea and a toolbar
 *   (`+` attach menu, approval chip | model + effort, voice, stop, round
 *   send). The card's 1px border carries the plan-mode / autopilot tint.
 * - A quiet status line under the card holds MCP, peer send and the auth
 *   method label.
 *
 * Features:
 * - Shift+Enter for newlines, Enter to send
 * - Clear input after send
 * - Disable during streaming
 * - Auto-resize textarea via CSS `field-sizing: content` (no JS height writes)
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
    EffortSelectorComponent,
    McpStatusChipComponent,
    PeerSessionSendComponent,
    NativePopoverComponent,
    ComposerActivityDirective,
    ComposerCompactBarComponent,
    ComposerTypeToExpandDirective,
  ],
  providers: [VoiceInputService, ComposerCompactStore],
  template: `
    <div
      class="ptah-composer relative flex flex-col px-3 pt-2 pb-2 bg-surface-0"
      data-testid="chat-composer"
      [ptahComposerTypeToExpand]="isCompact()"
      (typeToExpand)="expandComposer()"
      (pasteToExpand)="pasteIntoCompact($event)"
      (dragover)="handleDragOver($event)"
      (dragleave)="handleDragLeave($event)"
      (drop)="handleDrop($event)"
    >
      <!-- Image attachment validation error (auto-clears after 4s) -->
      @if (commandCenterHeld()) {
        <div role="status" class="text-xs text-base-content-muted px-2 pb-1.5">
          Command Center voice owns this session. Regular chat sends are held.
          <button type="button" class="link" (click)="openCommandCenter()">
            Open Command Center
          </button>
        </div>
      }
      @if (imageAttachmentError()) {
        <div
          class="flex items-center gap-1.5 text-xs text-error px-2 pb-1.5"
          role="alert"
          aria-live="polite"
        >
          <span>{{ imageAttachmentError() }}</span>
        </div>
      }

      <!-- Two-state streaming composer. Both states share one grid cell and
           fold by animating grid-template-rows 0fr <-> 1fr, so no height is
           measured in script. The folded state is inert (no tab stops, hidden
           from assistive tech). ComposerCompactStore owns the rules. -->
      <div
        class="ptah-composer-stage"
        [attr.data-compact]="isCompact() ? '' : null"
        data-testid="chat-composer-stage"
      >
      <div class="ptah-composer-fold ptah-composer-fold--full">
      <div
        class="ptah-composer-fold-clip"
        [class.is-unclipped]="compactStore.unclipped()"
        [id]="composerFullId"
        [attr.inert]="isCompact() ? '' : null"
        ptahComposerActivity
        data-testid="chat-composer-full"
      >
      <!-- Composer card (design-spec §6): workspace / branch hints, attachments,
           textarea, toolbar. A form landmark; sending stays on the Send click
           and Enter handlers, so a native submit is always prevented. The
           border carries the mode tint (plan = info, autopilot = primary). -->
      <form
        [class]="cardClasses()"
        data-glass-surface="tile"
        aria-label="Message composer"
        data-testid="chat-composer-form"
        (submit)="$event.preventDefault()"
      >
        <!-- Compaction overlay on the card -->
        @if (resolvedIsCompacting()) {
          <div
            class="absolute inset-0 z-10 flex items-center justify-center bg-base-100/60 backdrop-blur-[1px] rounded-xl"
          >
            <div
              class="flex items-center gap-2 text-base-content-muted text-sm font-medium"
            >
              <span class="loading loading-spinner loading-sm"></span>
              <span>Optimizing context...</span>
            </div>
          </div>
        }
        <!-- Drop zone overlay -->
        @if (isDraggingOver()) {
          <div
            class="absolute inset-0 z-10 flex items-center justify-center bg-primary/10 border border-dashed border-primary rounded-xl pointer-events-none"
          >
            <div
              class="flex items-center gap-2 text-primary text-sm font-medium"
            >
              <lucide-angular [img]="ImageIconRef" class="w-5 h-5" />
              <span>Drop image here</span>
            </div>
          </div>
        }

        <!-- Top strip: workspace and branch hints. Non-interactive (no tab
             stops, design D8); absent when neither is known. -->
        @if (workspaceName() || branchName()) {
          <div
            class="ptah-fold-fade h-[38px] flex items-center gap-3.5 px-3 min-w-0 border-b border-surface-border text-xs text-base-content-muted"
            data-testid="composer-top-strip"
          >
            @if (workspaceName(); as name) {
              <span
                class="inline-flex items-center gap-1.5 min-w-0 flex-shrink"
                [title]="workspaceRoot() ?? name"
                data-testid="composer-workspace-hint"
              >
                <lucide-angular
                  [img]="FolderHintIcon"
                  class="w-3.5 h-3.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <span class="ptah-composer-workspace-label truncate">{{
                  name
                }}</span>
              </span>
            }
            @if (branchName(); as branch) {
              <span
                class="inline-flex items-center gap-1.5 min-w-0 flex-shrink"
                [title]="'Branch ' + branch"
                data-testid="composer-branch-hint"
              >
                <lucide-angular
                  [img]="GitBranchIcon"
                  class="w-3.5 h-3.5 flex-shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate font-mono text-[11.5px]">{{
                  branch
                }}</span>
              </span>
            }
          </div>
        }

        <!-- File Tags + Image Thumbnails Row (above textarea) -->
        @if (selectedFiles().length > 0 || pastedImages().length > 0) {
          <div class="ptah-fold-fade flex flex-wrap gap-2 px-3 pt-3">
            @for (file of selectedFiles(); track file.path) {
              <ptah-file-tag
                [file]="file"
                (removeFile)="removeFile(file.path)"
              />
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
                  class="absolute -top-1.5 -right-1.5 btn btn-circle btn-xs btn-error opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  (click)="removePastedImage(img.id)"
                  type="button"
                  [attr.aria-label]="'Remove ' + img.name"
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

        <!-- Textarea + Suggestions Dropdown -->
        <div class="relative">
          <label class="sr-only" [attr.for]="inputId"
            >Message the orchestrator</label
          >
          <!-- Auto-resize is pure CSS (field-sizing: content), so typing never
               forces a document layout. The min-height is the 60 px resting
               field (design-spec §2.2, which field-sizing ignores); it grows
               to 8 lines, then scrolls. -->
          <textarea
            #inputElement
            [id]="inputId"
            style="field-sizing: content"
            class="ptah-fold-fade block w-full min-h-[60px] max-h-[calc(8lh+1rem)] overflow-y-auto resize-none bg-transparent border-0 px-3.5 pt-3 pb-1 text-[13px] leading-[1.6] text-base-content placeholder:text-base-content-muted outline-none focus:outline-none focus:ring-0"
            [placeholder]="
              commandCenterHeld()
                ? 'Command Center voice owns this session — sends held'
                : attachedReadOnly()
                  ? 'Session is attached to messaging — read-only'
                  : 'Ask the orchestrator to plan, build or review...'
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

          <!-- File/Folder Suggestions Dropdown - positioned above textarea.
               Rendered only once the fold has settled: while the card still
               moves, its clip box carries a translate, which makes it the
               containing block of this position:fixed panel. Floating UI
               would then write box-relative left/top that land near the
               window's top-left once the translate returns to none. -->
          @if (showSuggestions() && textareaOrigin() && compactStore.unclipped()) {
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

        <!-- In-card toolbar (design-spec §6.3 order): + -> approval chip ->
             spacer -> model / effort group -> mic -> stop / send -->
        <div class="ptah-composer-toolbar flex items-center gap-1 px-2 pr-2.5 pb-2 min-w-0">
          <div class="ptah-composer-toolbar-start flex items-center gap-1 min-w-0 flex-1">
            <ptah-native-popover
              [isOpen]="attachMenuOpen()"
              [placement]="'top-start'"
              [hasBackdrop]="true"
              [backdropClass]="'transparent'"
              (closed)="closeAttachMenu()"
            >
              <button
                trigger
                class="inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-md text-base-content-muted hover:text-base-content hover:bg-surface-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                [class.bg-surface-2]="attachMenuOpen()"
                [class.text-base-content]="attachMenuOpen()"
                (click)="toggleAttachMenu()"
                type="button"
                title="Attach"
                aria-label="Attach files or add context"
                aria-haspopup="menu"
                [attr.aria-expanded]="attachMenuOpen()"
                data-testid="chat-attach-btn"
              >
                <lucide-angular
                  [img]="PlusIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
              </button>

              <div content data-glass-surface="overlay" data-composer-overlay class="w-44 p-1 flex flex-col" role="menu">
                <button
                  class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none transition-colors"
                  (click)="selectAttachFiles()"
                  type="button"
                  role="menuitem"
                >
                  <lucide-angular
                    [img]="PaperclipIcon"
                    class="w-3.5 h-3.5 text-base-content-muted"
                  />
                  <span>Attach files</span>
                </button>
                <button
                  class="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-left hover:bg-base-300 focus-visible:bg-base-300 focus-visible:outline-none transition-colors"
                  (click)="selectAttachImages()"
                  type="button"
                  role="menuitem"
                >
                  <lucide-angular
                    [img]="ImagePlusIcon"
                    class="w-3.5 h-3.5 text-base-content-muted"
                  />
                  <span>Attach images</span>
                </button>
              </div>
            </ptah-native-popover>

            <!-- Approval chip (moved from the status line; data unchanged:
                 AutopilotStateService.stateFor(sessionId)) -->
            <ptah-autopilot-popover
              class="min-w-0"
              [sessionId]="tabSessionId()"
            />
          </div>

          <!-- Right: model / effort, voice, stop, send -->
          <div class="ptah-composer-toolbar-end flex items-center gap-1 min-w-0 flex-shrink">
            <!-- Both existing controls kept (Decision A2-5); below 640 px the
                 effort label hides and its icon trigger stays. -->
            <div
              role="group"
              aria-label="Model and effort"
              class="inline-flex items-center h-7 min-w-0 rounded-md text-xs text-base-content-muted"
            >
              <ptah-model-selector class="min-w-0" />
              <span class="px-0.5" aria-hidden="true">·</span>
              <ptah-effort-selector
                class="min-w-0 flex-shrink-0"
                (effortChanged)="onEffortChange($event)"
              />
            </div>

            @if (isElectron) {
              @if (isRecording()) {
                <span class="text-xs text-error tabular-nums px-0.5">{{
                  voiceElapsedLabel()
                }}</span>
              }
              <button
                [class]="
                  'inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))] disabled:opacity-50 ' +
                  (isRecording()
                    ? 'text-error bg-error/10 animate-pulse'
                    : 'text-base-content-muted hover:text-base-content hover:bg-surface-2')
                "
                [disabled]="isTranscribing()"
                (click)="handleVoiceButton()"
                [title]="
                  isRecording()
                    ? 'Stop recording'
                    : isTranscribing()
                      ? 'Transcribing...'
                      : 'Dictate'
                "
                [attr.aria-label]="
                  isRecording()
                    ? 'Stop recording'
                    : isTranscribing()
                      ? 'Transcribing...'
                      : 'Dictate'
                "
                type="button"
                data-testid="chat-voice-btn"
              >
                @if (isTranscribing()) {
                  <span
                    class="loading loading-spinner loading-xs"
                    aria-hidden="true"
                  ></span>
                } @else if (isRecording()) {
                  <lucide-angular
                    [img]="SquareIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                } @else {
                  <lucide-angular
                    [img]="MicIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                }
              </button>
            }

            <!-- Stop Button (streaming only), same 28 px circle as Send.
                 Gated on the same busy predicate the dispatcher queues on, so
                 a queued send always has a Stop to drain it. Exactly one Stop
                 exists at a time: while folded it lives on the compact bar,
                 because this card is then inert and clipped to zero height,
                 so a Stop left here keeps a layout box nothing can click. -->
            @if (isActiveTabStreaming() && !isCompact()) {
              <button
                class="inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-error/15 text-error hover:bg-error/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                (click)="handleStop()"
                title="Stop generating"
                aria-label="Stop generating"
                type="button"
                data-testid="chat-stop-btn"
              >
                <lucide-angular
                  [img]="SquareIcon"
                  class="w-3.5 h-3.5"
                  aria-hidden="true"
                />
              </button>
            }

            <!-- Send Button (always functional - queues message during
                 streaming). Neutral inverse circle, design D1. -->
            <button
              class="inline-flex items-center justify-center h-7 w-7 flex-shrink-0 rounded-full bg-base-content text-base-100 transition-transform enabled:hover:scale-105 enabled:active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [disabled]="
                !canSend() || attachedReadOnly() || commandCenterHeld()
              "
              (click)="handleSend()"
              type="button"
              title="Send message"
              aria-label="Send message"
              data-testid="chat-send-btn"
            >
              <lucide-angular
                [img]="ArrowUpIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </form>

      <!-- Status line under the card: MCP, peer send, auth (unchanged) -->
      <div
        class="ptah-composer-status-line chat-composer-column flex items-center gap-2 px-1 mt-1.5 min-w-0 w-full mx-auto"
        data-glass-surface="plate"
      >
        <div class="flex items-center gap-0.5 min-w-0">
          <!-- MCP status (host is display: contents; renders nothing when the
               session reports no servers) -->
          <ptah-mcp-status-chip
            [sessionId]="tabSessionId()"
            [tabId]="mcpTabId()"
          />

          <!-- Peer session send affordance (TASK_2026_402 §11) -->
          <ptah-peer-session-send />
        </div>

        @if (authMethodLabel()) {
          <span
            class="ml-auto min-w-0 truncate text-xs text-base-content-muted"
            [title]="'Authenticated via ' + authMethodLabel()"
            >{{ authMethodLabel() }}</span
          >
        }
      </div>
      </div>
      </div>

      <!-- Compact bar: shown only while the tab streams and the composer is
           idle; any expand request moves focus into the textarea. -->
      <div class="ptah-composer-fold ptah-composer-fold--bar">
        <div
          class="ptah-composer-fold-clip"
          [attr.inert]="isCompact() ? null : ''"
        >
          <ptah-composer-compact-bar
            [statusLabel]="compactStatusLabel()"
            [modelLabel]="compactModelLabel()"
            [controlsId]="composerFullId"
            [showStop]="isActiveTabStreaming() && isCompact()"
            [collapsed]="!isCompact()"
            (expandRequested)="expandComposer()"
            (stopRequested)="stopFromCompact()"
          />
        </div>
      </div>
      </div>

      <!-- Announces the fold politely; empty until the first change. -->
      <div
        class="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="chat-composer-fold-announcer"
      >
        {{ compactAnnouncement() }}
      </div>
    </div>
  `,
  // Narrow-width container queries and the streaming fold live in the sheet.
  styleUrl: './chat-input.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent implements OnInit, OnDestroy {
  readonly chatStore = inject(ChatStore);
  readonly tabManager = inject(TabManagerService);
  private readonly commandCenterSendLock = inject(CommandCenterSendLockService);
  private readonly appState = inject(AppStateManager);
  private readonly draftStore = inject(ComposerDraftStore);
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });
  private readonly sessionStartGuard = inject(SESSION_START_GUARD, {
    optional: true,
  });
  private readonly sessionStopHandler = inject(SESSION_STOP_HANDLER, {
    optional: true,
  });
  readonly autopilotState = inject(AutopilotStateService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly gitStore = inject(SessionGitStatsStore);
  readonly voiceInput = inject(VoiceInputService);
  readonly filePicker = inject(FilePickerService);
  private readonly composerTriggerCacheEnabled = inject(
    COMPOSER_TRIGGER_CACHE_ENABLED,
  );

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
  private readonly authState = inject(AuthStateService);

  /**
   * Auth badge label, read straight off `AuthStateService`.
   *
   * This component used to issue the auth-status RPC itself in `ngOnInit` and
   * derive the label locally — a third independent boot caller of a 2-5s
   * handler, re-fired on every workspace switch because the input re-inits
   * (TASK_2026_342). The label rule now has one owner.
   */
  readonly authMethodLabel = this.authState.authMethodLabel;

  /**
   * Stop-button visibility. Reads `isTabBusyGenerating` — the SAME predicate
   * `MessageDispatchService` uses to decide send-vs-queue.
   *
   * This used to read `tabManager.isTabStreaming()` (the `_streamingTabIds`
   * spinner set) alone, which is only one of that predicate's three sources.
   * Whenever the other two said busy and the spinner set did not, every send
   * was queued while Stop stayed hidden — and Stop is the only drain for a
   * queue outside a root turn-end, so the tab was a dead end until reload
   * (TASK_2026_382 review B5). Widening the busy predicate without widening the
   * recovery affordance that reads the same state is what made that reachable;
   * the two now cannot disagree by construction.
   */
  readonly isActiveTabStreaming = computed(() => {
    const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    if (!tabId) return false;
    // Resolved across workspaces, like the dispatcher: a canvas tile or a tab
    // parked in a background workspace is absent from `tabs()`.
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab ?? null;
    return isTabBusyGenerating({
      status: tab?.status,
      streamingState: tab?.streamingState,
      isStreamingTab: this.tabManager.isTabStreaming(tabId),
    });
  });

  /**
   * Per-`SessionStatus` direct-send enablement matrix.
   *
   * - `fresh` — enabled
   * - `draft` — enabled
   * - `loaded` — enabled
   * - `awaiting-background` — enabled
   * - `sleeping` — enabled (agent idle until its next scheduled wakeup)
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
      case 'sleeping':
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
   * Working root of this composer's session for the top-strip workspace
   * hint: the same `sessionWorkingRoot` call the session details use
   * (worktree, else the tab's workspace partition, else the webview root).
   * With no tab yet, the webview root, where a new session starts.
   */
  protected readonly workspaceRoot = computed<string | null>(() => {
    const fallback = this.vscodeService.config().workspaceRoot || undefined;
    const tab = this.resolvedTab();
    if (!tab) return fallback ?? null;
    return sessionWorkingRoot(
      tab,
      this.tabManager.findTabByIdAcrossWorkspaces(tab.id)?.workspacePath ??
        null,
      fallback,
    );
  });

  protected readonly workspaceName = computed(() => {
    const root = this.workspaceRoot();
    return root ? folderName(root) : null;
  });

  /**
   * Branch hint: the agent-origin branch, else the last known branch of the
   * working root. Reads the git state only; the composer never starts git
   * tracking, so the hint shows once another surface (the inspector) tracks
   * the root.
   */
  protected readonly branchName = computed(() =>
    sessionBranch(
      this.resolvedTab(),
      this.gitStore.stateFor(this.workspaceRoot()),
    ),
  );

  /** Ties the visually hidden label to the textarea. */
  protected readonly inputId = `ptah-composer-input-${nextComposerId++}`;

  /** The full composer region; the compact bar's `aria-controls` target. */
  protected readonly composerFullId = `${this.inputId}-full`;

  /**
   * Tab and session ids of the tab this composer belongs to, resolved exactly
   * as `ChatViewComponent` resolves them: a canvas tile scopes to its own tab
   * via SESSION_CONTEXT, the main panel falls back to the global active tab.
   * The MCP status chip gets both ids because the backend pushes MCP status
   * under the tabId until the SDK reports the session UUID. The autopilot
   * popover gets the session id so a toggle re-gates THIS tab's session, not
   * the backend's most recently active one.
   */
  protected readonly mcpTabId = computed(
    () => this._sessionContext?.() ?? this.tabManager.activeTabId(),
  );

  protected readonly tabSessionId = computed(() =>
    this._sessionContext
      ? (this.resolvedTab()?.claudeSessionId ?? null)
      : this.chatStore.currentSessionId(),
  );

  /**
   * The messaging binding this tab's session is attached to, or null. When
   * non-null the composer is READ-ONLY (the session is being driven from
   * Telegram / Discord / Slack). The "attached" indicator and the "Resolve
   * back to webview" detach action now live in the tile header
   * (`SendToMessagingComponent`); this composer only gates input on the state.
   */
  private readonly attachedBinding = computed(
    () => this.resolvedTab()?.attachedBinding ?? null,
  );

  /** True when this tab's session is attached to a messaging binding. */
  readonly attachedReadOnly = computed(() => this.attachedBinding() != null);

  public readonly commandCenterHeld = computed(() => {
    this.commandCenterSendLock.state();
    const tab = this.resolvedTab();
    return tab != null && this.commandCenterSendLock.isHeld(tab.id);
  });

  public openCommandCenter(): void {
    this.appState.setCurrentView('command-center');
  }

  /**
   * Per-tab compaction state. In canvas mode, scoped to this tile's tab
   * (a tile whose SESSION_CONTEXT resolves null shows no overlay); otherwise
   * the global active tab. Reads the SAME registry derivation as the
   * chat-view banner, so the overlay and banner always agree.
   */
  readonly resolvedIsCompacting = computed(() =>
    this.chatStore.isCompactingForTab(
      this._sessionContext
        ? this._sessionContext()
        : this.tabManager.activeTabId(),
    ),
  );
  private readonly textareaRef =
    viewChild<ElementRef<HTMLTextAreaElement>>('inputElement');

  // ---- Two-state streaming composer (rules in ComposerCompactStore) ----
  protected readonly compactStore = inject(ComposerCompactStore);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly composerActivity = viewChild(ComposerActivityDirective);
  private readonly modelSelector = viewChild(ModelSelectorComponent);

  /** The composer is folded into its one-row bar. */
  readonly isCompact = this.compactStore.compact;

  protected readonly compactStatusLabel = computed(() =>
    this.resolvedIsCompacting() ? 'Optimizing context…' : 'Ptah is working…',
  );

  /** The model chip reuses the selector's own display rule. */
  protected readonly compactModelLabel = computed(
    () => this.modelSelector()?.effectiveModelDisplay() ?? '',
  );

  /** Polite screen-reader note for each fold change (empty at first). */
  protected readonly compactAnnouncement = signal('');

  /**
   * Open the full composer and put focus in the textarea now, inside the
   * triggering event. The view is checked first so the region is no longer
   * inert; a key press that expanded it then types into the textarea.
   */
  expandComposer(): void {
    this.compactStore.expand();
    this.cdr.detectChanges();
    this.textareaRef()?.nativeElement.focus({ preventScroll: true });
  }

  /**
   * Stop from the bar. The bar turns inert when the stream ends, which drops
   * its focus; the textarea takes it back on that expand.
   */
  protected stopFromCompact(): Promise<void> {
    this.focusTextareaOnExpand = true;
    return this.handleStop();
  }
  private focusTextareaOnExpand = false;

  /** Paste while folded: expand, then take the clipboard text and images. */
  protected pasteIntoCompact(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    this.expandComposer();
    if (text) this._currentMessage.update((current) => current + text);
    this.handlePaste(event);
  }

  /** Wire the store and the polite fold announcement. */
  private setupCompactComposer(): void {
    this.compactStore.connect({
      scope: computed(
        () => this._sessionContext?.() ?? this.tabManager.activeTabId(),
      ),
      streaming: this.isActiveTabStreaming,
      hasContent: computed(
        () =>
          this._currentMessage().length > 0 ||
          this._selectedFiles().length > 0 ||
          this._pastedImages().length > 0,
      ),
      focused: computed(
        () => this.composerActivity()?.focusWithin() ?? false,
      ),
      overlayOpen: computed(
        () =>
          this._showSuggestions() ||
          this._attachMenuOpen() ||
          (this.composerActivity()?.popoverOpen() ?? false),
      ),
      dragging: this._isDraggingOver,
    });

    let announced = false;
    effect(() => {
      const compact = this.isCompact();
      if (!announced && !compact) return;
      announced = true;
      untracked(() => {
        this.compactAnnouncement.set(
          compact
            ? 'Composer minimized while Ptah works. Start typing to expand it.'
            : 'Composer expanded.',
        );
        if (compact || !this.focusTextareaOnExpand) return;
        this.focusTextareaOnExpand = false;
        afterNextRender(
          () => {
            const active = this.document.activeElement;
            if (active && active !== this.document.body) return;
            this.textareaRef()?.nativeElement.focus({ preventScroll: true });
          },
          { injector: this.injector },
        );
      });
    });
  }

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
  readonly ArrowUpIcon = ArrowUp;
  readonly FolderHintIcon = FolderIcon;
  readonly GitBranchIcon = GitBranch;
  readonly ZapIcon = Zap;
  readonly SquareIcon = Square;
  readonly XIcon = X;
  readonly ImageIconRef = ImageIcon;
  readonly PaperclipIcon = Paperclip;
  readonly ImagePlusIcon = ImagePlus;
  readonly MicIcon = Mic;
  readonly PlusIcon = Plus;

  /** Open state of the `+` attach menu in the composer toolbar. */
  private readonly _attachMenuOpen = signal(false);
  readonly attachMenuOpen = this._attachMenuOpen.asReadonly();

  /**
   * Composer card classes (design-spec §6 card line: surface-1, 12 px radius,
   * hairline, inset highlight + elevation). The 1px border doubles as the
   * mode indicator: info while plan mode is active (agent plan mode or the
   * `plan` permission level), primary while autopilot is on, else the
   * neutral hairline that strengthens on focus-within.
   */
  readonly cardClasses = computed(() => {
    const base = `chat-composer-column chat-composer-card ${COMPOSER_CARD_CLASS}`;
    if (
      this.autopilotState.agentPlanMode() ||
      this.autopilotState.permissionLevel() === 'plan'
    ) {
      return `${base} chat-composer-card--plan border-info/50 focus-within:border-info/70`;
    }
    if (this.autopilotState.enabled()) {
      return `${base} border-primary/40 focus-within:border-primary/60`;
    }
    return `${base} ${COMPOSER_CARD_BORDER_CLASS}`;
  });

  private _lastSessionId: string | null = null;
  private readonly _currentMessage = signal('');
  private readonly _showSuggestions = signal(false);
  readonly showSuggestions = this._showSuggestions.asReadonly();

  private readonly _suggestionMode = signal<
    'at-trigger' | 'slash-trigger' | null
  >(null);
  private readonly _triggerPosition = signal(0); // Position where trigger (@, /) starts
  private readonly _currentQuery = signal(''); // Current search query after trigger
  /** Query whose expensive local suggestion projection is ready to render. */
  private readonly _projectedQuery = signal('');
  private readonly _localSuggestions = signal<SuggestionItem[]>([]);
  private readonly _fileSuggestionCache = new Map<string, SuggestionItem[]>();
  private _commandSuggestions: CommandSuggestionItem[] | null = null;
  private _triggerProjectionTimeout: ReturnType<typeof setTimeout> | null =
    null;
  private readonly _selectedFiles = signal<ChatFile[]>([]);
  private readonly _pastedImages = signal<PastedImage[]>([]);
  private draftTabId: string | null = null;
  /** Drafts whose send is still pending, with the tab they were sent from. */
  private readonly sendsInFlight = new Set<{
    tabId: string | null;
    draft: ComposerDraft;
  }>();
  private lastDraft: {
    text: string;
    files: ChatFile[];
    images: PastedImage[];
  } | null = null;
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
   * Ensure auth status has been loaded once so the badge can render.
   * No-op after the first successful load — the guard lives in the service.
   */
  ngOnInit(): void {
    void this.authState.loadAuthStatus();
  }

  ngOnDestroy(): void {
    this.saveDraft();
    this.clearTriggerProjectionTimeout();
    if (this._imageAttachmentErrorTimeout) {
      clearTimeout(this._imageAttachmentErrorTimeout);
    }
  }

  /**
   * Computed signal for filtered suggestions.
   * Hybrid approach: merges local fuzzy results + server-side remote results.
   * Local results appear immediately; remote results merge in when RPC completes.
   */
  readonly filteredSuggestions = computed(() => {
    const mode = this._suggestionMode();
    this._projectedQuery();

    if (mode === 'at-trigger') {
      const localResults = this._localSuggestions().filter(
        (suggestion): suggestion is FileSuggestionItem =>
          suggestion.type === 'file',
      );
      const remoteResults = this.filePicker.remoteResults();
      const seenPaths = new Set(localResults.map((f) => f.path));
      const merged = [...localResults];
      for (const remote of remoteResults) {
        if (!seenPaths.has(remote.path)) {
          merged.push(this.toFileSuggestionItem(remote));
          seenPaths.add(remote.path);
        }
      }

      return merged.slice(0, 40);
    }

    if (mode === 'slash-trigger') {
      return this._localSuggestions();
    }

    return [];
  });

  /**
   * Handle input change (value sync only — the textarea sizes itself via
   * `field-sizing: content`, so no layout reads or height writes happen here;
   * trigger detection is delegated to directives)
   */
  handleInput(event: Event): void {
    this._currentMessage.set((event.target as HTMLTextAreaElement).value);
  }

  /**
   * Show a transient, user-visible error near the input area.
   * Mirrors the signal+timeout pattern used in editor.service.ts showError().
   * Auto-clears after 4 seconds.
   */
  private showComposerError(message: string): void {
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
          this.showComposerError('Image too large — 5MB max');
          continue;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const decodedSize = Math.floor(base64.length * 0.75);
          if (decodedSize > MAX_IMAGE_SIZE_BYTES) {
            this.showComposerError('Image too large — 5MB max');
            return;
          }
          const mediaType = resolveImageMediaType(item.type, base64);
          if (!mediaType) {
            this.showComposerError(
              'Unsupported image format — use PNG, JPEG, GIF, or WebP',
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

  toggleAttachMenu(): void {
    this._attachMenuOpen.update((open) => !open);
  }

  closeAttachMenu(): void {
    this._attachMenuOpen.set(false);
  }

  /** `+` menu → Attach files. Closes the menu, then opens the picker. */
  selectAttachFiles(): void {
    this.closeAttachMenu();
    void this.handleAttachFiles();
  }

  /** `+` menu → Attach images. Closes the menu, then opens the picker. */
  selectAttachImages(): void {
    this.closeAttachMenu();
    void this.handleAttachImages();
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
        this.showComposerError(result.error);
      }
      return;
    }

    await this.voiceInput.startRecording();
    const error = this.voiceInput.error();
    if (error) {
      this.showComposerError(error);
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
      if (this.isCompact()) this.compactStore.expand();
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
        this.showComposerError('Image too large — 5MB max');
        continue;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        const mediaType = resolveImageMediaType(file.type, base64);
        if (!mediaType) {
          this.showComposerError(
            'Unsupported image format — use PNG, JPEG, GIF, or WebP',
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
    this.refreshSuggestions(event.query);
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
      this.clearTriggerProjectionTimeout();
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
    this.refreshSuggestions(event.query);
    this.fetchCommandSuggestions();
  }

  /**
   * Handle debounced / trigger from SlashTriggerDirective
   * Does NOT overwrite _currentQuery — handleQueryChanged already has the latest value.
   */
  handleSlashTriggered(): void {
    // Intentionally empty: handleQueryChanged already holds the latest query.
  }

  /**
   * Handle / trigger closed from SlashTriggerDirective
   */
  handleSlashClosed(): void {
    if (this._suggestionMode() === 'slash-trigger') {
      this._showSuggestions.set(false);
      this._suggestionMode.set(null);
      this.clearTriggerProjectionTimeout();
    }
  }

  /**
   * Handle immediate query changes for responsive filtering.
   * Also triggers debounced server-side search for @ file queries.
   */
  handleQueryChanged(query: string): void {
    this._currentQuery.set(query);
    this.scheduleSuggestionRefresh(query);
  }

  /**
   * Keeps typing on the synchronous draft path. The potentially expensive
   * local search/filter work runs once after a brief quiet period instead of
   * for every trigger keystroke.
   */
  private scheduleSuggestionRefresh(query: string): void {
    this.clearTriggerProjectionTimeout();
    if (!this.composerTriggerCacheEnabled) {
      this.refreshSuggestions(query);
      return;
    }
    this._triggerProjectionTimeout = setTimeout(() => {
      this._triggerProjectionTimeout = null;
      this.refreshSuggestions(query);
    }, TRIGGER_PROJECTION_DEBOUNCE_MS);
  }

  private refreshSuggestions(query: string): void {
    const mode = this._suggestionMode();
    if (!mode) return;

    this._projectedQuery.set(query);
    if (mode === 'at-trigger') {
      const cached = this._fileSuggestionCache.get(query);
      if (cached) {
        this._localSuggestions.set(cached);
      } else {
        const suggestions = this.filePicker
          .searchFiles(query)
          .slice(0, 40)
          .map((file) => this.toFileSuggestionItem(file));
        this.cacheFileSuggestions(query, suggestions);
        this._localSuggestions.set(suggestions);
      }
      this.filePicker.searchFilesRemote(query);
      return;
    }

    const commands: CommandSuggestionItem[] =
      this._commandSuggestions ??
      this.commandDiscovery.searchCommands('').map(
        (command): CommandSuggestionItem => ({
          type: 'command',
          ...command,
        }),
      );
    this._commandSuggestions = commands;
    const matchedCommands = !query
      ? commands
      : commands.filter(
          (command) =>
            command.name.toLowerCase().includes(query.toLowerCase()) ||
            (command.description &&
              command.description
                .toLowerCase()
                .includes(query.toLowerCase())),
        );
    // TASK_2026_721 D7: the prompt catalogue lives behind `/`, appended after
    // the commands so the dropdown renders one command group then prompts.
    this._localSuggestions.set([
      ...matchedCommands,
      ...this.toPromptSuggestionItems(query),
    ]);
  }

  private toFileSuggestionItem(file: FileSuggestion): FileSuggestionItem {
    const isFolder = file.type === 'directory';
    return {
      type: 'file',
      icon: isFolder ? FolderIcon : file.isImage ? ImageIcon : FileIcon,
      description: file.directory,
      path: file.path,
      name: file.name,
      directory: file.directory,
      extension: file.extension,
      size: file.size,
      lastModified: file.lastModified,
      isImage: file.isImage,
      isText: file.isText,
    };
  }

  private cacheFileSuggestions(
    query: string,
    suggestions: SuggestionItem[],
  ): void {
    if (this._fileSuggestionCache.size >= MAX_CACHED_TRIGGER_QUERIES) {
      const oldest = this._fileSuggestionCache.keys().next().value;
      if (oldest !== undefined) this._fileSuggestionCache.delete(oldest);
    }
    this._fileSuggestionCache.set(query, suggestions);
  }

  /**
   * Catalogue prompt suggestions for the `/` dropdown. The typed query
   * filters by label, description, category and text; every entry carries
   * its category label for the "Prompt · <Category>" badge. An empty query
   * lists the whole catalogue.
   */
  private toPromptSuggestionItems(query: string): SuggestionItem[] {
    const needle = query.toLowerCase();
    const prompts: SuggestionItem[] = [];
    for (const category of PROMPT_CATALOGUE) {
      for (const prompt of category.prompts) {
        const matches =
          !needle ||
          prompt.label.toLowerCase().includes(needle) ||
          (prompt.description?.toLowerCase().includes(needle) ?? false) ||
          category.label.toLowerCase().includes(needle) ||
          prompt.text.toLowerCase().includes(needle);
        if (matches) {
          prompts.push({
            type: 'prompt',
            category: category.label,
            ...prompt,
          });
        }
      }
    }
    return prompts;
  }

  private clearTriggerProjectionTimeout(): void {
    if (!this._triggerProjectionTimeout) return;
    clearTimeout(this._triggerProjectionTimeout);
    this._triggerProjectionTimeout = null;
  }

  /**
   * Fetch suggestions for @ trigger (files + folders only)
   */
  private async fetchAtSuggestions(): Promise<void> {
    this._isLoadingSuggestions.set(true);
    try {
      await this.filePicker.ensureFilesLoaded();
      this._fileSuggestionCache.clear();
      this.refreshSuggestions(this._currentQuery());
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
      this._commandSuggestions = null;
      this.refreshSuggestions(this._currentQuery());
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
    } else if (suggestion.type === 'prompt') {
      // A prompt prefills the composer for editing; it does not send.
      this.restoreContentToInput(suggestion.text, { replace: true });
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
    this.clearTriggerProjectionTimeout();
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
      if (this.attachedReadOnly() || this.commandCenterHeld()) return;
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
    if (this.attachedReadOnly() || this.commandCenterHeld()) return;
    const content = this.currentMessage().trim();
    const images = this._pastedImages();
    if (!content && images.length === 0) return;
    const blockReason = this.sessionStartGuard?.();
    if (blockReason) return this.showComposerError(blockReason);
    const normalizedContent = content;
    // Captured before the await: the user may switch tabs while it runs, and
    // the draft effect then shows (and stores) another tab's draft.
    const sendingTabId =
      this._sessionContext?.() ?? this.tabManager.activeTabId();
    const submitted = {
      text: this._currentMessage(),
      files: this._selectedFiles(),
      images,
    };
    // A double click, or Enter then a click, re-submits the unchanged draft
    // while its send is pending. An edited or other-tab draft still sends.
    for (const pending of this.sendsInFlight) {
      if (
        pending.tabId === sendingTabId &&
        this.isSubmittedDraft(submitted, pending.draft)
      ) {
        return;
      }
    }
    const inFlight = { tabId: sendingTabId, draft: submitted };
    this.sendsInFlight.add(inFlight);

    try {
      const filePaths = submitted.files.map((f) => f.path);
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
      // A failed send also clears: the sender keeps the prompt as the user's
      // bubble, so a kept draft would duplicate it on retry.
      // Clear only what still holds the submitted draft: the sending tab's
      // stored draft, and the composer while it shows that tab unchanged.
      if (
        sendingTabId &&
        this.isSubmittedDraft(this.draftStore.get(sendingTabId), submitted)
      ) {
        this.draftStore.clear(sendingTabId);
      }
      if (
        this.draftTabId === sendingTabId &&
        this.isSubmittedDraft(
          {
            text: this._currentMessage(),
            files: this._selectedFiles(),
            images: this._pastedImages(),
          },
          submitted,
        )
      ) {
        this._currentMessage.set('');
        this._selectedFiles.set([]);
        this._pastedImages.set([]);
      }
      // The emptied `[value]` binding plus `field-sizing: content` shrink the
      // textarea back to its resting height — no manual height reset.
    } catch (error) {
      console.error('[ChatInputComponent] Failed to send message:', error);
    } finally {
      this.sendsInFlight.delete(inFlight);
    }
  }

  /**
   * Stop streaming (abort current response).
   * Uses abortWithConfirmation() to warn user about running sub-agents.
   */
  async handleStop(): Promise<void> {
    const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    if (tabId && this.sessionStopHandler?.(tabId) === 'handled') return;
    try {
      const aborted = await this.chatStore.abortWithConfirmation();
      console.log('[ChatInputComponent] Stop requested, aborted:', aborted);
    } catch (error) {
      console.error('[ChatInputComponent] Failed to stop streaming:', error);
    }
  }

  /**
   * Restore content to input textarea (called by effect when signal changes)
   * FIX #2: Check if input is empty before restoring to prevent overwriting user input
   * @param content - Content to restore to input
   * @param options - `replace: true` overwrites a non-empty input. Used for
   *   explicit user selections (a prompt picked from the `/` dropdown, which
   *   replaces the trigger and the input); the queued-restore effect keeps
   *   the default so it never clobbers typed text.
   */
  restoreContentToInput(
    content: string,
    options?: { replace?: boolean },
  ): void {
    if (!options?.replace && this._currentMessage().trim()) {
      return;
    }

    this._currentMessage.set(content);
    // `field-sizing: content` sizes the box to the restored value. A folded
    // composer opens on the new text; focus once it is no longer inert.
    const textarea = this.textareaRef()?.nativeElement;
    if (textarea?.closest('[inert]')) {
      afterNextRender(() => textarea.focus({ preventScroll: true }), {
        injector: this.injector,
      });
    } else {
      textarea?.focus();
    }
  }

  constructor() {
    this.setupCompactComposer();
    this.draftTabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
    if (this.draftTabId) this.restoreDraft(this.draftTabId);
    effect(() => {
      const tabId = this._sessionContext?.() ?? this.tabManager.activeTabId();
      if (tabId !== this.draftTabId) {
        untracked(() => {
          this.saveDraft();
          this.draftTabId = tabId;
          if (tabId) this.restoreDraft(tabId);
          else this.clearLocalDraft();
        });
      }
      this._currentMessage();
      this._selectedFiles();
      this._pastedImages();
      untracked(() => this.saveDraft());
    });
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

  private saveDraft(): void {
    if (!this.draftTabId) return;
    if (!this.tabManager.findTabByIdAcrossWorkspaces(this.draftTabId)) return;
    const text = this._currentMessage();
    const files = this._selectedFiles();
    const images = this._pastedImages();
    if (
      this.lastDraft?.text === text &&
      this.lastDraft.files === files &&
      this.lastDraft.images === images
    )
      return;
    this.lastDraft = { text, files, images };
    if (!text && files.length === 0 && images.length === 0) {
      this.draftStore.clear(this.draftTabId);
      return;
    }
    this.draftStore.save(this.draftTabId, {
      text,
      files,
      images,
    });
  }

  private restoreDraft(tabId: string): void {
    const draft = this.draftStore.get(tabId);
    this._currentMessage.set(draft?.text ?? '');
    this._selectedFiles.set(draft?.files ?? []);
    this._pastedImages.set(draft?.images ?? []);
    this.lastDraft = {
      text: this._currentMessage(),
      files: this._selectedFiles(),
      images: this._pastedImages(),
    };
  }

  /** The same text and the same file and image lists (by reference). */
  private isSubmittedDraft(
    draft: ComposerDraft | undefined,
    submitted: ComposerDraft,
  ): boolean {
    return (
      draft !== undefined &&
      draft.text === submitted.text &&
      draft.files === submitted.files &&
      draft.images === submitted.images
    );
  }

  private clearLocalDraft(): void {
    this._currentMessage.set('');
    this._selectedFiles.set([]);
    this._pastedImages.set([]);
    this.lastDraft = null;
  }
}
