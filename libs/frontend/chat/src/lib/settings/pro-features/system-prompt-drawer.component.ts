import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  AlertCircle,
  Check,
  Clock,
  Download,
  LucideAngularModule,
  RotateCw,
  Sparkles,
} from 'lucide-angular';
import { ClaudeRpcService, WorkspaceScopeService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

const PROMPT_STATUS_LOAD_FAILED = 'Could not load the system prompt status.';
const PROMPT_REGENERATE_FAILED = 'Could not regenerate the system prompt.';
const PROMPT_DOWNLOAD_FAILED = 'Could not download the system prompt.';
const PROMPT_PREVIEW_LOAD_FAILED = 'Could not load the prompt preview.';
const PROMPT_DOWNLOAD_SAVED = 'Saved to the chosen file.';

/** The client's regenerate budget; the host is not told to stop when it runs out. */
const REGENERATE_TIMEOUT_MS = 120_000;
/** A timer may fire a little before the wall clock shows the full budget; a failure this close counts as the timeout. */
const TIMEOUT_CLOCK_TOLERANCE_MS = 1_000;

/**
 * When the user dismisses the file save dialog without picking a path, the backend returns
 * `{ success: false, error: 'Save cancelled by user' }` (`enhanced-prompts-rpc.handlers.ts:631`).
 * A user cancellation is not a failure and surfaces no alert (F2).
 */
const DOWNLOAD_CANCELLED_BY_USER = 'Save cancelled by user';

/**
 * SystemPromptDrawerComponent (Drawer D-SP, pattern map rows A14-A18, P6).
 *
 * Slide-over detail drawer for the enhanced system prompt:
 * - A14: Metadata readout (generated-at timestamp and detected stack summary)
 * - A15: Regenerate prompt (S-confirm: inline confirm first; inline progress up to 120 s; failure alert)
 * - A16: Download prompt as markdown file (D15: {success:false} or failed RPC shows alert, never silent)
 * - A17: View/Hide prompt preview rendered through {@link MarkdownBlockComponent} (safe DOMPurify chokepoint)
 * - A18: Empty-state guidance when no prompt has been generated yet — only after a successful status read
 *
 * A regenerate that runs out the 120 s client timeout may still be running on the host, which has no stop
 * signal; a failure that comes back sooner is shown as the fixed failure sentence. The drawer then re-reads the status and keeps Regenerate off until a
 * newer prompt appears or a later "Check again" is at least another 120 s on, so two runs never overlap.
 *
 * P6 drawer pattern: single body, no tabs. Header with Sparkles icon; footer with Regenerate (outline),
 * Download (ghost) and Close (ghost). Parent owns visibility; {@link NativeDrawerComponent} handles
 * backdrop, Escape, and focus restoration.
 */
@Component({
  selector: 'ptah-system-prompt-drawer',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, 
    LucideAngularModule,
    NativeDrawerComponent,
    MarkdownBlockComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-drawer
      [isOpen]="isOpen()"
      widthClass="w-full max-w-lg"
      ariaLabel="System prompt details"
      (closed)="closed.emit()"
    >
      @if (isOpen()) {
        <div drawer-header class="flex items-center gap-2" data-testid="system-prompt-drawer">
          <lucide-angular [img]="SparklesIcon" class="w-4 h-4 text-secondary" aria-hidden="true" />
          <div>
            <h2 class="text-sm font-semibold text-base-content" data-testid="system-prompt-drawer-title">
              System prompt
            </h2>
            <p class="text-xs text-base-content-muted" data-testid="system-prompt-drawer-subtitle">
              {{ subtitle() }}
            </p>
          </div>
        </div>
      }

      <div class="space-y-4 p-4 text-xs text-base-content">
        @if (error(); as err) {
          <div
            role="alert"
            class="flex items-center gap-1.5 rounded border border-error/40 p-2 text-xs text-base-content"
            data-testid="system-prompt-drawer-error"
          >
            <lucide-angular [img]="AlertCircleIcon" class="w-3.5 h-3.5 text-error shrink-0" aria-hidden="true" />
            <span class="flex-1">{{ err }}</span>
            @if (statusLoadFailed() && !isLoading()) {
              <button
                type="button"
                class="btn btn-ghost btn-xs text-base-content"
                (click)="loadStatus()"
                data-testid="system-prompt-status-retry"
              >
                Retry
              </button>
            }
          </div>
        }

        @if (regenerateStartedAt() !== null) {
          <div
            role="status"
            class="flex items-center gap-1.5 rounded border border-base-300 p-2 text-xs text-base-content"
            data-testid="regenerate-may-be-running"
          >
            <lucide-angular [img]="ClockIcon" class="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
            <span class="flex-1">
              The regeneration did not answer in time and may still be running. Regenerate stays off until
              a newer prompt appears.
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-xs text-base-content"
              [disabled]="isLoading()"
              (click)="checkRegenerate()"
              data-testid="regenerate-check-again"
            >
              Check again
            </button>
          </div>
        }

        @if (downloadNote(); as note) {
          <p role="status" class="flex items-center gap-1.5 text-xs text-base-content" data-testid="system-prompt-download-saved">
            <lucide-angular [img]="CheckIcon" class="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            {{ note }}
          </p>
        }

        @if (isLoading()) {
          <p class="text-xs text-base-content-muted" role="status" data-testid="system-prompt-drawer-loading">
            Loading system prompt status…
          </p>
        } @else if (hasGeneratedPrompt()) {
          <!-- Metadata (A14) -->
          <div class="space-y-2 rounded border border-base-300 p-3 bg-base-200/40">
            @if (generatedAt(); as ts) {
              <div class="flex items-center gap-1.5 text-xs text-base-content-muted" data-testid="system-prompt-generated-at">
                <lucide-angular [img]="ClockIcon" class="w-3.5 h-3.5" aria-hidden="true" />
                <span>Generated: {{ ts }}</span>
              </div>
            }
            @if (detectedStackSummary(); as stack) {
              <div class="text-xs text-base-content-muted truncate" [title]="stack" data-testid="system-prompt-detected-stack">
                <span class="font-semibold text-base-content">Stack:</span> {{ stack }}
              </div>
            }
          </div>

          <!-- Inline confirm for Regenerate (A15, S-confirm, P8) -->
          @if (confirmingRegenerate()) {
            <div
              role="group"
              aria-label="Confirm regenerate system prompt"
              class="rounded border border-base-300 p-3 bg-base-200/60 space-y-2"
              data-testid="regenerate-confirm"
              (keydown.escape)="cancelRegenerate($event)"
            >
              <p class="text-xs text-base-content">
                Regenerate replaces your current project system prompt with fresh guidance tailored to your project. This may take up to 2 minutes.
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-outline btn-xs border-error text-base-content"
                  [disabled]="isRegenerating()"
                  (click)="confirmRegenerate()"
                  data-testid="regenerate-confirm-button"
                >
                  @if (isRegenerating()) {
                    <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                  }
                  <span>Regenerate prompt</span>
                </button>
                <button
                  #regenerateCancel
                  type="button"
                  class="btn btn-ghost btn-xs text-base-content"
                  [disabled]="isRegenerating()"
                  (click)="cancelRegenerate()"
                  data-testid="regenerate-cancel-button"
                >
                  Cancel
                </button>
              </div>
            </div>
          }

          <!-- Generation Progress (Gap G5) -->
          @if (isRegenerating()) {
            <div class="space-y-1" role="status" data-testid="regenerate-progress">
              <div class="flex items-center justify-between text-xs text-base-content-muted">
                <span>Generating fresh guidance…</span>
                <span>Up to 120 s</span>
              </div>
              <progress class="progress progress-primary w-full" aria-label="Prompt generation progress"></progress>
            </div>
          }

          <!-- View / Preview generated prompt (A17) -->
          <div class="space-y-2">
            <button
              type="button"
              class="btn btn-ghost btn-xs gap-1.5 w-full justify-start text-base-content"
              (click)="togglePromptPreview()"
              aria-label="Toggle Prompt Preview"
              data-testid="system-prompt-preview-toggle"
            >
              <lucide-angular [img]="SparklesIcon" class="w-3.5 h-3.5 text-secondary" aria-hidden="true" />
              <span>{{ promptPreviewExpanded() ? 'Hide' : 'View' }} Generated Prompt</span>
            </button>

            @if (promptPreviewExpanded()) {
              @if (isLoadingContent()) {
                <div class="flex items-center gap-1.5 text-xs text-base-content-muted p-2" role="status">
                  <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                  <span>Loading prompt content…</span>
                </div>
              } @else if (promptPreviewContent(); as content) {
                <div
                  class="max-h-96 overflow-y-auto border border-base-300 rounded p-3 bg-base-200/50"
                  data-testid="system-prompt-markdown-preview"
                >
                  <ptah-markdown-block [content]="content" />
                </div>
              }
            }
          </div>
        } @else if (status() !== null && !statusLoadFailed()) {
          <!-- Empty state guidance (A18): only a successful read can say there is no prompt -->
          <div class="py-8 text-center space-y-2" data-testid="system-prompt-empty-state">
            <lucide-angular [img]="SparklesIcon" class="w-8 h-8 text-secondary/40 mx-auto" aria-hidden="true" />
            <p class="text-xs text-base-content-muted max-w-xs mx-auto">
              Run the Setup Wizard to generate an AI-enhanced system prompt tailored to your project.
            </p>
          </div>
        }
      </div>

      @if (isOpen()) {
        <div drawer-footer class="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3">
          <div class="flex items-center gap-2">
            <button
              #regenerateButton
              type="button"
              class="btn btn-outline btn-xs gap-1 text-base-content"
              [ptahBusyDisabled]="isRegenerating() || isDownloading() || !hasGeneratedPrompt() || regenerateStartedAt() !== null"
              (click)="requestRegenerate()"
              aria-label="Regenerate Enhanced Prompt"
              data-testid="system-prompt-regenerate-button"
            >
              @if (isRegenerating()) {
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                <span>Generating…</span>
              } @else {
                <lucide-angular [img]="RotateCwIcon" class="w-3 h-3" aria-hidden="true" />
                <span>Regenerate</span>
              }
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs gap-1 text-base-content"
              [ptahBusyDisabled]="isRegenerating() || isDownloading() || !hasGeneratedPrompt()"
              (click)="downloadEnhancedPrompt()"
              aria-label="Download Enhanced Prompt"
              data-testid="system-prompt-download-button"
            >
              @if (isDownloading()) {
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
                <span>Downloading…</span>
              } @else {
                <lucide-angular [img]="DownloadIcon" class="w-3 h-3" aria-hidden="true" />
                <span>Download</span>
              }
            </button>
          </div>

          <button
            type="button"
            class="btn btn-ghost btn-sm"
            (click)="closed.emit()"
            data-testid="system-prompt-drawer-close"
          >
            Close
          </button>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class SystemPromptDrawerComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly workspaceScope = inject(WorkspaceScopeService);
  /** The real workspace root; `'.'` only where the host tracks none (VS Code). */
  private workspacePath(): string {
    return this.workspaceScope.activeWorkspacePath() ?? '.';
  }
  private readonly injector = inject(Injector);
  private readonly regenerateCancel = viewChild<ElementRef<HTMLButtonElement>>('regenerateCancel');
  private readonly regenerateButton = viewChild<ElementRef<HTMLButtonElement>>('regenerateButton');

  readonly SparklesIcon = Sparkles;
  readonly ClockIcon = Clock;
  readonly CheckIcon = Check;
  readonly RotateCwIcon = RotateCw;
  readonly DownloadIcon = Download;
  readonly AlertCircleIcon = AlertCircle;

  readonly isOpen = input<boolean>(false);
  readonly closed = output<void>();
  readonly changed = output<void>();

  readonly status = signal<EnhancedPromptsGetStatusResponse | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  /** The last status read failed; the alert offers Retry and the empty state is not shown. */
  readonly statusLoadFailed = signal(false);

  readonly isRegenerating = signal(false);
  readonly confirmingRegenerate = signal(false);
  readonly isDownloading = signal(false);
  readonly downloadNote = signal<string | null>(null);

  /**
   * When a regenerate went unanswered, the time it started; `null` otherwise. While set, the host may still be
   * generating, so Regenerate stays disabled.
   */
  readonly regenerateStartedAt = signal<number | null>(null);
  /** `generatedAt` before the unanswered regenerate, to recognise the prompt it produces. */
  private regenerateBaseline: string | null = null;

  readonly promptPreviewContent = signal<string | null>(null);
  readonly promptPreviewExpanded = signal(false);
  readonly isLoadingContent = signal(false);

  readonly hasGeneratedPrompt = computed(
    () => this.status()?.hasGeneratedPrompt ?? false,
  );

  readonly generatedAt = computed(() => {
    const ts = this.status()?.generatedAt;
    if (!ts) return null;
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
  });

  readonly detectedStackSummary = computed(() => {
    const stack = this.status()?.detectedStack;
    if (!stack) return null;
    const parts: string[] = [];
    if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(', '));
    if (stack.languages.length > 0) parts.push(stack.languages.join(', '));
    if (stack.projectType) parts.push(stack.projectType);
    return parts.join(' | ');
  });

  readonly subtitle = computed(() => {
    if (this.isLoading()) return 'Loading system prompt…';
    if (this.statusLoadFailed() && this.status() === null) return 'Status not loaded';
    if (!this.hasGeneratedPrompt()) return 'No prompt generated yet';
    return 'Project-tailored system prompt for AI sessions';
  });

  constructor() {
    // Runs once for a drawer created open, and again on every reopen: the only status load (Minor 13).
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.error.set(null);
          this.downloadNote.set(null);
          this.confirmingRegenerate.set(false);
          void this.loadStatus();
        });
      }
    });
    // P8: the opened regenerate confirm takes focus on Cancel, so Esc reaches it.
    effect(() => this.regenerateCancel()?.nativeElement.focus());
  }

  /** Reads the status; an RPC failure, a throw or a host-reported `error` all show the fixed load error. */
  async loadStatus(): Promise<boolean> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:getStatus', {
        workspacePath: this.workspacePath(),
      });
      if (result.isSuccess() && !result.data.error) {
        this.status.set(result.data);
        this.statusLoadFailed.set(false);
        return true;
      }
    } catch {
      // Falls through to the fixed load error below.
    } finally {
      this.isLoading.set(false);
    }
    this.statusLoadFailed.set(true);
    this.error.set(PROMPT_STATUS_LOAD_FAILED);
    return false;
  }

  requestRegenerate(): void {
    if (this.regenerateStartedAt() !== null) return;
    this.downloadNote.set(null);
    this.confirmingRegenerate.set(true);
  }

  /** Cancel and Esc close the confirm and return focus to Regenerate; Esc stops here, so the drawer stays open. */
  cancelRegenerate(event?: Event): void {
    event?.stopPropagation();
    this.confirmingRegenerate.set(false);
    afterNextRender(() => this.regenerateButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * Regenerates the enhanced prompt (A15, S-confirm).
   * Host reports a failed generation as `{success:false, error}` inside a successful RPC: the host has stopped,
   * so only the fixed sentence is shown and the status is not re-read (F1). A failed call or a throw that comes
   * back well inside the client budget is a definitive failure too: fixed sentence, Regenerate stays enabled
   * (N1). Only a call that ran out the 120 s client timeout may have left the host running: the status is
   * re-read and Regenerate is blocked.
   */
  async confirmRegenerate(): Promise<void> {
    if (this.regenerateStartedAt() !== null) return;
    this.confirmingRegenerate.set(false);
    this.isRegenerating.set(true);
    this.error.set(null);
    const baseline = this.status()?.generatedAt ?? null;
    const startedAt = Date.now();
    try {
      const result = await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: this.workspacePath(), force: true },
        { timeout: REGENERATE_TIMEOUT_MS },
      );
      if (result.isSuccess() && result.data.success) {
        this.promptPreviewContent.set(null);
        this.promptPreviewExpanded.set(false);
        await this.loadStatus();
        this.changed.emit();
        return;
      }
      if (!result.isSuccess() && this.ranOutClientBudget(startedAt)) {
        this.regenerateBaseline = baseline;
        this.regenerateStartedAt.set(startedAt);
        await this.checkRegenerate();
        return;
      }
    } catch {
      // A throw is not the client timeout (that resolves a failed result); shown as the fixed failure below.
    } finally {
      this.isRegenerating.set(false);
    }
    this.error.set(PROMPT_REGENERATE_FAILED);
  }

  /** The RPC client resolves a timeout as a failed result once the budget has elapsed (`claude-rpc.service`). */
  private ranOutClientBudget(startedAt: number): boolean {
    return Date.now() - startedAt >= REGENERATE_TIMEOUT_MS - TIMEOUT_CLOCK_TOLERANCE_MS;
  }

  /**
   * Re-reads the status after an unanswered regenerate. The block lifts when a newer prompt is on disk, or when
   * the check comes at least another full timeout after the regenerate started, by which time the host is done.
   */
  async checkRegenerate(): Promise<void> {
    const startedAt = this.regenerateStartedAt();
    if (startedAt === null) return;
    if (!(await this.loadStatus())) return;
    const current = this.status()?.generatedAt ?? null;
    if (current !== null && current !== this.regenerateBaseline) {
      this.regenerateStartedAt.set(null);
      this.promptPreviewContent.set(null);
      this.promptPreviewExpanded.set(false);
      this.changed.emit();
    } else if (Date.now() - startedAt >= 2 * REGENERATE_TIMEOUT_MS) {
      this.regenerateStartedAt.set(null);
      this.error.set(PROMPT_REGENERATE_FAILED);
    }
  }

  /**
   * Downloads the enhanced prompt as a markdown file (A16).
   * D15: A `{success:false}` or failed RPC surfaces an alert, never silent; only the host's own success shows
   * the saved line (Minor 15).
   * F2: User cancellation in the host save dialog (`DOWNLOAD_CANCELLED_BY_USER`) surfaces no alert.
   */
  async downloadEnhancedPrompt(): Promise<void> {
    if (this.isDownloading()) return;
    this.isDownloading.set(true);
    this.error.set(null);
    this.downloadNote.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:download', {
        workspacePath: this.workspacePath(),
      });
      if (!result.isSuccess()) {
        this.error.set(PROMPT_DOWNLOAD_FAILED);
      } else if (result.data.success) {
        this.downloadNote.set(PROMPT_DOWNLOAD_SAVED);
      } else if (result.data.error !== DOWNLOAD_CANCELLED_BY_USER) {
        this.error.set(PROMPT_DOWNLOAD_FAILED);
      }
    } catch {
      this.error.set(PROMPT_DOWNLOAD_FAILED);
    } finally {
      this.isDownloading.set(false);
    }
  }

  async togglePromptPreview(): Promise<void> {
    if (this.promptPreviewExpanded()) {
      this.promptPreviewExpanded.set(false);
      return;
    }
    if (!this.promptPreviewContent()) {
      this.isLoadingContent.set(true);
      try {
        const result = await this.rpcService.call(
          'enhancedPrompts:getPromptContent',
          { workspacePath: this.workspacePath() },
        );
        if (result.isSuccess() && result.data.content) {
          this.promptPreviewContent.set(result.data.content);
        } else {
          this.error.set(PROMPT_PREVIEW_LOAD_FAILED);
        }
      } catch {
        this.error.set(PROMPT_PREVIEW_LOAD_FAILED);
      } finally {
        this.isLoadingContent.set(false);
      }
    }
    this.promptPreviewExpanded.set(true);
  }
}
