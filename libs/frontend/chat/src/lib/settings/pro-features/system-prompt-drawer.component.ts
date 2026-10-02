import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  AlertCircle,
  Clock,
  Download,
  LucideAngularModule,
  RotateCw,
  Sparkles,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { NativeDrawerComponent } from '@ptah-extension/ui';

const PROMPT_STATUS_LOAD_FAILED = 'Could not load the system prompt status.';
const PROMPT_REGENERATE_FAILED = 'Could not regenerate the system prompt.';
const PROMPT_DOWNLOAD_FAILED = 'Could not download the system prompt.';
const PROMPT_PREVIEW_LOAD_FAILED = 'Could not load the prompt preview.';

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
 * - A18: Empty-state guidance when no prompt has been generated yet
 *
 * P6 drawer pattern: single body, no tabs. Header with Sparkles icon; footer with Regenerate (outline),
 * Download (ghost) and Close (ghost). Parent owns visibility; {@link NativeDrawerComponent} handles
 * backdrop, Escape, and focus restoration.
 */
@Component({
  selector: 'ptah-system-prompt-drawer',
  standalone: true,
  imports: [
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
            <span>{{ err }}</span>
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
              <div class="flex items-center justify-between text-[10px] text-base-content-muted">
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
        } @else {
          <!-- Empty state guidance (A18) -->
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
              type="button"
              class="btn btn-outline btn-xs gap-1 text-base-content"
              [disabled]="isRegenerating() || isDownloading() || !hasGeneratedPrompt()"
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
              [disabled]="isRegenerating() || isDownloading() || !hasGeneratedPrompt()"
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
export class SystemPromptDrawerComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

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

  readonly isRegenerating = signal(false);
  readonly confirmingRegenerate = signal(false);
  readonly isDownloading = signal(false);

  readonly promptPreviewContent = signal<string | null>(null);
  readonly promptPreviewExpanded = signal(false);
  readonly isLoadingContent = signal(false);

  readonly hasGeneratedPrompt = computed(
    () => this.status()?.hasGeneratedPrompt ?? false,
  );

  readonly generatedAt = computed(() => {
    const ts = this.status()?.generatedAt;
    if (!ts) return null;
    return new Date(ts).toLocaleString();
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
    if (!this.hasGeneratedPrompt()) return 'No prompt generated yet';
    return 'Project-tailored system prompt for AI sessions';
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.error.set(null);
          this.confirmingRegenerate.set(false);
          void this.loadStatus();
        });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.isOpen()) {
      await this.loadStatus();
    }
  }

  async loadStatus(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:getStatus', {
        workspacePath: '.',
      });
      if (result.isSuccess()) {
        this.status.set(result.data);
      } else {
        this.error.set(PROMPT_STATUS_LOAD_FAILED);
      }
    } catch {
      this.error.set(PROMPT_STATUS_LOAD_FAILED);
    } finally {
      this.isLoading.set(false);
    }
  }

  requestRegenerate(): void {
    this.confirmingRegenerate.set(true);
  }

  cancelRegenerate(): void {
    this.confirmingRegenerate.set(false);
  }

  /**
   * Regenerates the enhanced prompt (A15, S-confirm).
   * Host reports a failed generation as `{success:false, error}` inside a successful RPC.
   * On failure, surfaces the fixed error sentence in drawer alert and does not re-read status (F1).
   */
  async confirmRegenerate(): Promise<void> {
    this.confirmingRegenerate.set(false);
    this.isRegenerating.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 },
      );
      if (!result.isSuccess() || !result.data.success) {
        this.error.set(PROMPT_REGENERATE_FAILED);
      } else {
        this.promptPreviewContent.set(null);
        this.promptPreviewExpanded.set(false);
        await this.loadStatus();
        this.changed.emit();
      }
    } catch {
      this.error.set(PROMPT_REGENERATE_FAILED);
    } finally {
      this.isRegenerating.set(false);
    }
  }

  /**
   * Downloads the enhanced prompt as a markdown file (A16).
   * D15: A `{success:false}` or failed RPC surfaces an alert, never silent.
   * F2: User cancellation in the host save dialog (`DOWNLOAD_CANCELLED_BY_USER`) surfaces no alert.
   */
  async downloadEnhancedPrompt(): Promise<void> {
    if (this.isDownloading()) return;
    this.isDownloading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:download', {
        workspacePath: '.',
      });
      if (!result.isSuccess()) {
        this.error.set(PROMPT_DOWNLOAD_FAILED);
      } else if (!result.data.success) {
        if (result.data.error === DOWNLOAD_CANCELLED_BY_USER) {
          return;
        }
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
          { workspacePath: '.' },
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
