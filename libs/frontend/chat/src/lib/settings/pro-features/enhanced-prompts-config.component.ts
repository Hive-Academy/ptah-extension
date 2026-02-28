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
import { MarkdownBlockComponent } from '../../components/atoms/markdown-block.component';

/**
 * EnhancedPromptsConfigComponent - System prompt mode toggle, preset selection,
 * preview, regenerate/download.
 *
 * Extracted from SettingsComponent to reduce its complexity.
 * Self-contained: injects its own dependencies (ClaudeRpcService).
 */
@Component({
  selector: 'ptah-enhanced-prompts-config',
  standalone: true,
  imports: [LucideAngularModule, MarkdownBlockComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-primary/30 rounded-md bg-primary/5">
      <div class="p-3">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-1.5">
            <lucide-angular [img]="SparklesIcon" class="w-4 h-4 text-primary" />
            <h2 class="text-xs font-medium uppercase tracking-wide">
              System Prompt Mode
            </h2>
          </div>
          <!-- Toggle switch -->
          <input
            type="checkbox"
            class="toggle toggle-primary toggle-xs"
            [checked]="enhancedPromptsEnabled()"
            (change)="toggleEnhancedPrompts($any($event.target).checked)"
            [disabled]="!hasGeneratedPrompt() && !enhancedPromptsEnabled()"
            aria-label="Toggle Enhanced System Prompt"
          />
        </div>

        <!-- Mode description -->
        @if (enhancedPromptsEnabled()) {
        <div class="flex items-center gap-1 mb-2">
          <span class="badge badge-primary badge-xs gap-1">
            <lucide-angular [img]="SparklesIcon" class="w-2 h-2" />
            Ptah Enhanced
          </span>
          <span class="text-xs text-base-content/60"
            >Active for all sessions</span
          >
        </div>
        } @else {
        <div class="flex items-center gap-1 mb-2">
          <span class="badge badge-ghost badge-xs">Default</span>
          <span class="text-xs text-base-content/60"
            >Standard system prompt</span
          >
        </div>
        }

        <!-- Preset selection (only show for premium with enhanced prompts) -->
        @if (hasGeneratedPrompt() && enhancedPromptsEnabled()) {
        <div class="mb-2 p-2 border border-base-300 rounded bg-base-200/30">
          <div class="text-xs font-medium mb-1.5">
            Default for new sessions:
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="systemPromptPreset"
                value="enhanced"
                [checked]="systemPromptPreset() === 'enhanced'"
                (change)="setSystemPromptPreset('enhanced')"
                class="radio radio-xs radio-primary"
              />
              <span>Enhanced (Project-specific)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="radio"
                name="systemPromptPreset"
                value="claude_code"
                [checked]="systemPromptPreset() === 'claude_code'"
                (change)="setSystemPromptPreset('claude_code')"
                class="radio radio-xs"
              />
              <span>Default (Minimal)</span>
            </label>
          </div>
          <div class="text-[10px] text-base-content/50 mt-1.5">
            Both presets include MCP documentation for premium users.
          </div>
        </div>
        }

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
          <div class="flex items-center gap-1 text-xs text-base-content/60">
            <lucide-angular [img]="ClockIcon" class="w-3 h-3" />
            <span>Generated: {{ enhancedPromptsGeneratedAt() }}</span>
          </div>
          }

          <!-- Detected stack -->
          @if (detectedStackSummary()) {
          <div
            class="text-xs text-base-content/60 truncate"
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
        <p class="text-xs text-base-content/50 mb-2">
          Run the Setup Wizard to generate an AI-enhanced system prompt tailored
          to your project.
        </p>
        }
      </div>
    </div>
  `,
})
export class EnhancedPromptsConfigComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Lucide icons
  readonly SparklesIcon = Sparkles;
  readonly ClockIcon = Clock;
  readonly ArrowLeftIcon = ArrowLeft;
  readonly ExternalLinkIcon = ExternalLink;

  // State signals
  readonly enhancedPromptsStatus =
    signal<EnhancedPromptsGetStatusResponse | null>(null);
  readonly enhancedPromptsLoading = signal(false);
  readonly enhancedPromptsError = signal<string | null>(null);
  readonly isRegenerating = signal(false);
  readonly promptPreviewContent = signal<string | null>(null);
  readonly promptPreviewExpanded = signal(false);
  readonly isDownloading = signal(false);
  readonly systemPromptPreset = signal<'claude_code' | 'enhanced'>('enhanced');

  // Computed signals
  readonly enhancedPromptsEnabled = computed(
    () => this.enhancedPromptsStatus()?.enabled ?? false
  );

  readonly hasGeneratedPrompt = computed(
    () => this.enhancedPromptsStatus()?.hasGeneratedPrompt ?? false
  );

  readonly enhancedPromptsGeneratedAt = computed(() => {
    const ts = this.enhancedPromptsStatus()?.generatedAt;
    if (!ts) return null;
    return new Date(ts).toLocaleString();
  });

  readonly enhancedPromptsCacheValid = computed(
    () => this.enhancedPromptsStatus()?.cacheValid ?? false
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

  async toggleEnhancedPrompts(enabled: boolean): Promise<void> {
    this.enhancedPromptsError.set(null);
    const result = await this.rpcService.call('enhancedPrompts:setEnabled', {
      workspacePath: '.',
      enabled,
    });
    if (result.isSuccess()) {
      await this.loadEnhancedPromptsStatus();
    } else {
      this.enhancedPromptsError.set(result.error ?? 'Failed to toggle');
    }
  }

  setSystemPromptPreset(preset: 'claude_code' | 'enhanced'): void {
    this.systemPromptPreset.set(preset);
  }

  async regenerateEnhancedPrompt(): Promise<void> {
    this.isRegenerating.set(true);
    this.enhancedPromptsError.set(null);
    try {
      const result = await this.rpcService.call(
        'enhancedPrompts:regenerate',
        { workspacePath: '.', force: true },
        { timeout: 120000 }
      );
      if (result.isSuccess()) {
        this.promptPreviewContent.set(null);
        this.promptPreviewExpanded.set(false);
        await this.loadEnhancedPromptsStatus();
      } else {
        this.enhancedPromptsError.set(result.error ?? 'Regeneration failed');
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
        }
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
