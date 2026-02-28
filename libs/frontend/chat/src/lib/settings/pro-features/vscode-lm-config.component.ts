/**
 * VscodeLmConfigComponent - VS Code Language Model provider card
 *
 * Shows VS Code LM model selection dropdown in Tab 2 (Pro Features),
 * replacing the hardcoded informational text that was in the MCP Port section.
 *
 * Extracted from LlmProvidersConfigComponent to colocate with Pro Features tab.
 *
 * Complexity Level: 1 (Simple card with dropdown + service delegation)
 */

import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
  output,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Check, Star, Cpu } from 'lucide-angular';
import { LlmProviderStateService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-vscode-lm-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (vscodeLmProvider(); as provider) {
    <div class="card bg-base-200 shadow-sm mt-3">
      <div class="card-body p-4">
        <!-- Provider header row -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <lucide-angular [img]="CpuIcon" class="w-4 h-4 text-primary" />
            <span class="font-medium text-sm">{{ provider.displayName }}</span>
            @if (provider.provider === llmState.defaultProvider()) {
            <span
              class="badge badge-primary badge-sm gap-1"
              aria-label="Default provider"
            >
              <lucide-angular [img]="StarIcon" class="w-3 h-3" />
              Default
            </span>
            }
          </div>
          <span
            class="badge badge-success badge-sm gap-1"
            aria-label="Provider configured"
          >
            <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
            Configured
          </span>
        </div>

        <!-- Model selection dropdown -->
        <div class="flex items-center gap-2 mt-1 min-w-0">
          <label
            class="text-xs text-base-content/60 shrink-0"
            for="vscode-lm-model"
            >Model:</label
          >
          @if (vsCodeModels().length > 0) {
          <select
            id="vscode-lm-model"
            class="select select-bordered select-xs flex-1 min-w-0 max-w-[260px] text-xs truncate"
            [value]="provider.defaultModel"
            (change)="onVsCodeModelSelect($any($event.target).value)"
            [disabled]="savingModel()"
            aria-label="VS Code LM model"
          >
            @for (model of vsCodeModels(); track model.id) {
            <option
              [value]="model.id"
              [selected]="model.id === provider.defaultModel"
            >
              {{ model.displayName }}
            </option>
            }
          </select>
          @if (savingModel()) {
          <span class="loading loading-spinner loading-xs"></span>
          } } @else if (llmState.loadingModels().has('vscode-lm')) {
          <span class="text-xs text-base-content/50 flex items-center gap-1">
            <span class="loading loading-spinner loading-xs"></span>
            Loading models...
          </span>
          } @else {
          <span class="text-xs text-base-content/50">No models available</span>
          }
        </div>

        <!-- Capabilities -->
        @if (provider.capabilities.length > 0) {
        <div class="flex flex-wrap gap-1 mt-2">
          @for (cap of provider.capabilities; track cap) {
          <span class="badge badge-outline badge-xs flex items-center gap-0.5">
            {{ formatCapability(cap) }}
          </span>
          }
        </div>
        }

        <!-- Info note -->
        <div class="text-xs text-base-content/50 mt-2">
          Uses models from VS Code's Language Model API. No API key required.
        </div>

        <!-- Set as Default button -->
        @if (provider.provider !== llmState.defaultProvider()) {
        <button
          type="button"
          class="btn btn-xs btn-outline mt-2 self-start"
          (click)="onSetDefault()"
          aria-label="Set VS Code LM as default provider"
        >
          Set as Default
        </button>
        }
      </div>
    </div>
    }
  `,
})
export class VscodeLmConfigComponent implements OnInit {
  readonly llmState = inject(LlmProviderStateService);

  /** Emitted when the VS Code LM model selection changes (so parent can refresh agent detection) */
  readonly modelChanged = output<void>();

  // Lucide icons
  readonly CheckIcon = Check;
  readonly StarIcon = Star;
  readonly CpuIcon = Cpu;

  /** Local saving state */
  readonly savingModel = signal(false);

  /** Find the vscode-lm provider from the provider list */
  readonly vscodeLmProvider = computed(() =>
    this.llmState.providers().find((p) => p.provider === 'vscode-lm')
  );

  /** Available VS Code LM models */
  readonly vsCodeModels = this.llmState.vsCodeModels;

  async ngOnInit(): Promise<void> {
    await this.llmState.loadProviderStatus();
    await this.llmState.loadVsCodeModels();
  }

  async onVsCodeModelSelect(modelId: string): Promise<void> {
    if (!modelId || this.savingModel()) {
      return;
    }

    this.savingModel.set(true);

    try {
      await this.llmState.setDefaultModel('vscode-lm', modelId);
      this.modelChanged.emit();
    } finally {
      this.savingModel.set(false);
    }
  }

  async onSetDefault(): Promise<void> {
    await this.llmState.setDefaultProvider('vscode-lm');
  }

  formatCapability(cap: string): string {
    return cap
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
