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
  Clock,
  Download,
  LucideAngularModule,
  RotateCw,
  Sparkles,
} from 'lucide-angular';
import { ClaudeRpcService, WorkspaceScopeService, WALL_CLOCK_COARSE_MS, injectWallClock } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

const PROMPT_STATUS_LOAD_FAILED = 'Could not load the system prompt status.';
const PROMPT_REGENERATE_FAILED = 'Could not regenerate the system prompt.';
const PROMPT_DOWNLOAD_FAILED = 'Could not download the system prompt.';
const PROMPT_PREVIEW_LOAD_FAILED = 'Could not load the prompt preview.';
const PROMPT_DOWNLOAD_SAVED = 'Saved to the chosen file.';

const REGENERATE_TIMEOUT_MS = 120_000;

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

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
 * - A15: Regenerate prompt (S-confirm: inline confirm first; inline progress up to 120 s; failure in the page toast)
 * - A16: Download prompt as markdown file (D15: {success:false} or failed RPC shows an alert toast, never silent)
 * - A17: View/Hide prompt preview rendered through {@link MarkdownBlockComponent} (safe DOMPurify chokepoint)
 * - A18: Empty-state guidance when no prompt has been generated yet — only after a successful status read
 *
 * The host reports a running regeneration in status. The drawer refreshes that status while open.
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

        @if (regenerationStartedAt() !== null) {
          <div
            role="status"
            class="flex items-center gap-1.5 rounded border border-base-300 p-2 text-xs text-base-content"
            data-testid="regenerate-may-be-running"
          >
            <lucide-angular [img]="ClockIcon" class="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
            <span class="flex-1">
              Regeneration may still be running ({{ regenerationElapsedSeconds() === null ? '—' : regenerationElapsedSeconds() + ' s elapsed' }}).
              Regenerate stays off until the host finishes.
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
              [ptahBusyDisabled]="isRegenerating() || isDownloading() || !hasGeneratedPrompt() || regenerationStartedAt() !== null"
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
  /** Regenerate and download outcomes show as the Settings page toast; load failures stay inline with Retry. */
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly regenerateCancel = viewChild<ElementRef<HTMLButtonElement>>('regenerateCancel');
  private readonly regenerateButton = viewChild<ElementRef<HTMLButtonElement>>('regenerateButton');

  readonly SparklesIcon = Sparkles;
  readonly ClockIcon = Clock;
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

  readonly regenerationStartedAt = computed(() => parseIso(this.status()?.regenerationStartedAt));
  private readonly now = injectWallClock('second', () => this.isOpen() && this.regenerationStartedAt() !== null);
  private readonly coarseNow = injectWallClock('coarse', () => this.isOpen() && this.regenerationStartedAt() !== null);
  readonly regenerationElapsedSeconds = computed(() => {
    const startedAt = this.regenerationStartedAt();
    return startedAt === null ? null : Math.max(0, Math.floor((this.now() - startedAt) / 1000));
  });
  private lastReconciliationTick: number | null = null;

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
          this.confirmingRegenerate.set(false);
          void this.loadStatus();
        });
      }
    });
    // P8: the opened regenerate confirm takes focus on Cancel, so Esc reaches it.
    effect(() => this.regenerateCancel()?.nativeElement.focus());
    effect(() => {
      if (!this.isOpen() || this.regenerationStartedAt() === null) {
        this.lastReconciliationTick = null;
        return;
      }
      const tick = this.coarseNow();
      if (this.lastReconciliationTick !== null && tick - this.lastReconciliationTick >= WALL_CLOCK_COARSE_MS) {
        untracked(() => void this.checkRegenerate(true));
        this.lastReconciliationTick = tick;
      } else if (this.lastReconciliationTick === null) {
        this.lastReconciliationTick = tick;
      }
    });
  }

  /** Reads the status; an RPC failure, a throw or a host-reported `error` all show the fixed load error. */
  async loadStatus(background = false): Promise<boolean> {
    if (!background) this.isLoading.set(true);
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
      if (!background) this.isLoading.set(false);
    }
    this.statusLoadFailed.set(true);
    this.error.set(PROMPT_STATUS_LOAD_FAILED);
    return false;
  }

  requestRegenerate(): void {
    if (this.regenerationStartedAt() !== null) return;
    this.confirmingRegenerate.set(true);
  }

  /** Cancel and Esc close the confirm and return focus to Regenerate; Esc stops here, so the drawer stays open. */
  cancelRegenerate(event?: Event): void {
    event?.stopPropagation();
    this.confirmingRegenerate.set(false);
    afterNextRender(() => this.regenerateButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Re-read host status after the RPC settles, including failures and timeouts. */
  async confirmRegenerate(): Promise<void> {
    if (this.regenerationStartedAt() !== null) return;
    this.confirmingRegenerate.set(false);
    this.isRegenerating.set(true);
    this.error.set(null);
    const generatedBefore = this.status()?.generatedAt ?? null;
    try {
      await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: this.workspacePath(), force: true },
        { timeout: REGENERATE_TIMEOUT_MS },
      );
    } catch {
      // Host status is still authoritative after a transport failure.
    } finally {
      this.isRegenerating.set(false);
    }
    if (await this.loadStatus()) this.resolveRegeneration(generatedBefore);
  }

  /** Reconcile a host-reported run on demand or on the shared coarse tick. */
  async checkRegenerate(background = false): Promise<void> {
    if (this.regenerationStartedAt() === null) return;
    const generatedBefore = this.status()?.generatedAt ?? null;
    if (!(await this.loadStatus(background))) return;
    this.resolveRegeneration(generatedBefore);
  }

  private resolveRegeneration(generatedBefore: string | null): void {
    if (this.regenerationStartedAt() !== null) return;
    const current = this.status()?.generatedAt ?? null;
    if (current !== null && current !== generatedBefore) {
      this.promptPreviewContent.set(null);
      this.promptPreviewExpanded.set(false);
      this.changed.emit();
    } else {
      this.feedback.announce(PROMPT_REGENERATE_FAILED, 'alert');
    }
  }

  /**
   * Downloads the enhanced prompt as a markdown file (A16).
   * D15: A `{success:false}` or failed RPC surfaces an alert, never silent; only the host's own success shows
   * the saved toast (Minor 15).
   * F2: User cancellation in the host save dialog (`DOWNLOAD_CANCELLED_BY_USER`) surfaces no alert.
   */
  async downloadEnhancedPrompt(): Promise<void> {
    if (this.isDownloading()) return;
    this.isDownloading.set(true);
    try {
      const result = await this.rpcService.call('enhancedPrompts:download', {
        workspacePath: this.workspacePath(),
      });
      if (!result.isSuccess()) {
        this.feedback.announce(PROMPT_DOWNLOAD_FAILED, 'alert');
      } else if (result.data.success) {
        this.feedback.announce(PROMPT_DOWNLOAD_SAVED, 'status');
      } else if (result.data.error !== DOWNLOAD_CANCELLED_BY_USER) {
        this.feedback.announce(PROMPT_DOWNLOAD_FAILED, 'alert');
      }
    } catch {
      this.feedback.announce(PROMPT_DOWNLOAD_FAILED, 'alert');
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
