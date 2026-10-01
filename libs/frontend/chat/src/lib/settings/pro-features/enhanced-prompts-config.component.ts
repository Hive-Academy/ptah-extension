import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  OnInit,
} from '@angular/core';
import {
  LucideAngularModule,
  Sparkles,
  Clock,
  ArrowLeft,
  ExternalLink,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { EnhancedPromptsGetStatusResponse } from '@ptah-extension/shared';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';

/**
 * EnhancedPromptsConfigComponent - generated system prompt details: generated-at,
 * detected stack, preview, regenerate/download. The on/off mode lives in the
 * Agent behaviour card; these details move to the D-SP drawer in Batch 42.
 *
 * Extracted from SettingsComponent to reduce its complexity.
 * Self-contained: injects its own dependencies (ClaudeRpcService).
 */
@Component({
  selector: 'ptah-enhanced-prompts-config',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'mt-4 block' },
  template: `
    <div class="border border-secondary/30 rounded-md bg-secondary/5">
      <div class="p-3">
        <!-- The mode toggle and its status moved to the Agent behaviour card (Batch 41, A10/A11);
             the "Default for new sessions" presets were removed (PR-1: they wrote nothing). -->
        <div class="flex items-center gap-1.5 mb-2">
          <lucide-angular
            [img]="SparklesIcon"
            class="w-4 h-4 text-secondary"
          />
          <h2 class="text-xs font-medium uppercase tracking-wide">
            System Prompt
          </h2>
        </div>

        <!-- Error display -->
        @if (enhancedPromptsError()) {
          <div class="text-xs text-error mb-2">
            {{ enhancedPromptsError() }}
          </div>
        }

        <!-- Enhanced prompts details (when prompt exists) -->
        @if (hasGeneratedPrompt()) {
          <div class="space-y-1.5 mb-2">
            <!-- Generated timestamp -->
            @if (enhancedPromptsGeneratedAt()) {
              <div
                class="flex items-center gap-1 text-xs text-base-content-muted"
              >
                <lucide-angular [img]="ClockIcon" class="w-3 h-3" />
                <span>Generated: {{ enhancedPromptsGeneratedAt() }}</span>
              </div>
            }

            <!-- Detected stack -->
            @if (detectedStackSummary()) {
              <div
                class="text-xs text-base-content-muted truncate"
                [title]="detectedStackSummary()!"
              >
                Stack: {{ detectedStackSummary() }}
              </div>
            }
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2">
            <button
              class="btn btn-outline btn-xs gap-1 flex-1"
              (click)="regenerateEnhancedPrompt()"
              [disabled]="isRegenerating()"
              aria-label="Regenerate Enhanced Prompt"
            >
              @if (isRegenerating()) {
                <span class="loading loading-spinner loading-xs"></span>
                <span>Generating...</span>
              } @else {
                <lucide-angular
                  [img]="ArrowLeftIcon"
                  class="w-3 h-3 rotate-[135deg]"
                />
                <span>Regenerate</span>
              }
            </button>
            <button
              class="btn btn-ghost btn-xs gap-1"
              (click)="downloadEnhancedPrompt()"
              [disabled]="isDownloading()"
              aria-label="Download Enhanced Prompt"
            >
              <lucide-angular [img]="ExternalLinkIcon" class="w-3 h-3" />
              <span>Download</span>
            </button>
          </div>

          <!-- Expandable preview -->
          <div class="mt-2">
            <button
              class="btn btn-ghost btn-xs gap-1 w-full justify-start"
              (click)="togglePromptPreview()"
              aria-label="Toggle Prompt Preview"
            >
              <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
              <span
                >{{ promptPreviewExpanded() ? 'Hide' : 'View' }} Generated
                Prompt</span
              >
            </button>
            @if (promptPreviewExpanded() && promptPreviewContent()) {
              <div
                class="mt-1.5 max-h-96 overflow-y-auto border border-base-300 rounded p-3 bg-base-200/50"
              >
                <ptah-markdown-block [content]="promptPreviewContent()!" />
              </div>
            }
          </div>
        } @else {
          <!-- No prompt generated yet -->
          <p class="text-xs text-base-content-muted mb-2">
            Run the Setup Wizard to generate an AI-enhanced system prompt
            tailored to your project.
          </p>
        }
      </div>
    </div>
  `,
})
export class EnhancedPromptsConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);
  readonly SparklesIcon = Sparkles;
  readonly ClockIcon = Clock;
  readonly ArrowLeftIcon = ArrowLeft;
  readonly ExternalLinkIcon = ExternalLink;
  readonly enhancedPromptsStatus =
    signal<EnhancedPromptsGetStatusResponse | null>(null);
  readonly enhancedPromptsLoading = signal(false);
  readonly enhancedPromptsError = signal<string | null>(null);
  readonly isRegenerating = signal(false);
  readonly promptPreviewContent = signal<string | null>(null);
  readonly promptPreviewExpanded = signal(false);
  readonly isDownloading = signal(false);
  readonly hasGeneratedPrompt = computed(
    () => this.enhancedPromptsStatus()?.hasGeneratedPrompt ?? false,
  );

  readonly enhancedPromptsGeneratedAt = computed(() => {
    const ts = this.enhancedPromptsStatus()?.generatedAt;
    if (!ts) return null;
    return new Date(ts).toLocaleString();
  });

  readonly enhancedPromptsCacheValid = computed(
    () => this.enhancedPromptsStatus()?.cacheValid ?? false,
  );

  readonly detectedStackSummary = computed(() => {
    const stack = this.enhancedPromptsStatus()?.detectedStack;
    if (!stack) return null;
    const parts: string[] = [];
    if (stack.frameworks.length > 0) parts.push(stack.frameworks.join(', '));
    if (stack.languages.length > 0) parts.push(stack.languages.join(', '));
    if (stack.projectType) parts.push(stack.projectType);
    return parts.join(' | ');
  });

  async ngOnInit(): Promise<void> {
    await this.loadEnhancedPromptsStatus();
  }

  async loadEnhancedPromptsStatus(): Promise<void> {
    this.enhancedPromptsLoading.set(true);
    this.enhancedPromptsError.set(null);
    try {
      const result = await this.rpcService.call('enhancedPrompts:getStatus', {
        workspacePath: '.',
      });
      if (result.isSuccess()) {
        this.enhancedPromptsStatus.set(result.data);
      } else {
        this.enhancedPromptsError.set(result.error ?? 'Failed to load status');
      }
    } catch {
      this.enhancedPromptsError.set('Failed to load enhanced prompts status');
    } finally {
      this.enhancedPromptsLoading.set(false);
    }
  }

  async regenerateEnhancedPrompt(): Promise<void> {
    this.isRegenerating.set(true);
    this.enhancedPromptsError.set(null);
    try {
      const result = await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 },
      );
      if (!result.isSuccess()) {
        this.enhancedPromptsError.set(result.error ?? 'Regeneration failed');
      } else if (!result.data.success) {
        // The host reports a failed generation as `{success:false}` inside a successful RPC.
        this.enhancedPromptsError.set(result.data.error ?? 'Regeneration failed');
      } else {
        this.promptPreviewContent.set(null);
        this.promptPreviewExpanded.set(false);
        await this.loadEnhancedPromptsStatus();
      }
    } finally {
      this.isRegenerating.set(false);
    }
  }

  async togglePromptPreview(): Promise<void> {
    if (this.promptPreviewExpanded()) {
      this.promptPreviewExpanded.set(false);
      return;
    }
    if (!this.promptPreviewContent()) {
      const result = await this.rpcService.call(
        'enhancedPrompts:getPromptContent',
        {
          workspacePath: '.',
        },
      );
      if (result.isSuccess() && result.data.content) {
        this.promptPreviewContent.set(result.data.content);
      }
    }
    this.promptPreviewExpanded.set(true);
  }

  async downloadEnhancedPrompt(): Promise<void> {
    this.isDownloading.set(true);
    try {
      await this.rpcService.call('enhancedPrompts:download', {
        workspacePath: '.',
      });
    } finally {
      this.isDownloading.set(false);
    }
  }
}
