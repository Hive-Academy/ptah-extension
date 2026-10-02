/**
 * VscodeLmConfigComponent - VS Code Language Model provider card
 *
 * Card on the Advanced tab (pattern map rows A33-A37, P2/P4/P10).
 * Shows VS Code LM model selection dropdown and default provider control with D15 save feedback.
 *
 * Saves route through {@link SettingsSaveFeedbackService.saveGeneric}:
 * - Model change (A34): S-sel with Undo; failure reverts model selection and suppresses modelChanged (D15).
 * - Set as default (A36): S-sel with Undo restoring previous default provider.
 * - Host error text is never surfaced to visible text or toasts (D15).
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
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';

export const COULD_NOT_SAVE_LM_MODEL = 'Could not save the VS Code language model.';
export const COULD_NOT_SET_DEFAULT_PROVIDER = 'Could not set the default provider.';

@Component({
  selector: 'ptah-vscode-lm-config',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @if (vscodeLmProvider(); as provider) {
      <section class="card bg-base-200 border border-base-300 p-3" aria-labelledby="vscode-lm-heading">
        <!-- Provider header row -->
        <div class="flex items-center justify-between gap-3 mb-2">
          <div class="flex flex-wrap items-center gap-2">
            <lucide-angular [img]="CpuIcon" class="w-4 h-4 text-secondary shrink-0" aria-hidden="true" />
            <h2 id="vscode-lm-heading" class="text-xs font-bold uppercase tracking-wider text-base-content">
              {{ provider.displayName }}
            </h2>
            @if (provider.provider === llmState.defaultProvider()) {
              <span
                class="badge badge-outline badge-xs gap-1 text-base-content"
                aria-label="Default provider"
              >
                <lucide-angular [img]="StarIcon" class="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
                Default
              </span>
            }
            <span
              class="badge badge-outline badge-xs gap-1 text-base-content"
              aria-label="Provider configured"
            >
              <lucide-angular [img]="CheckIcon" class="w-3 h-3 text-success shrink-0" aria-hidden="true" />
              Configured
            </span>
          </div>

          <!-- Set as Default button (A36) -->
          @if (provider.provider !== llmState.defaultProvider()) {
            <button
              type="button"
              class="btn btn-outline btn-xs text-base-content"
              (click)="onSetDefault()"
              [disabled]="saving()"
              aria-label="Set VS Code LM as default provider"
              data-testid="vscode-lm-set-default"
            >
              Set as Default
            </button>
          }
        </div>

        <!-- Model selection dropdown (A34) -->
        <div class="flex items-center gap-2 mt-1 min-w-0">
          <label
            class="text-xs font-medium text-base-content shrink-0"
            for="vscode-lm-model"
          >
            Model:
          </label>
          @if (vsCodeModels().length > 0) {
            <select
              id="vscode-lm-model"
              class="select select-bordered select-xs flex-1 min-w-0 max-w-[260px] text-xs truncate text-base-content"
              [value]="currentModelId()"
              (change)="onVsCodeModelSelectEvent($event)"
              [disabled]="saving() || savingModel()"
              aria-label="VS Code LM model"
              data-testid="vscode-lm-model-select"
            >
              @for (model of vsCodeModels(); track model.id) {
                <option
                  [value]="model.id"
                  [selected]="model.id === currentModelId()"
                >
                  {{ model.displayName }}
                </option>
              }
            </select>
            @if (savingModel()) {
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            }
          } @else if (llmState.loadingModels().has('vscode-lm')) {
            <span
              class="text-xs text-base-content-muted flex items-center gap-1"
            >
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              Loading models...
            </span>
          } @else {
            <span class="text-xs text-base-content-muted">
              No models available
            </span>
          }
        </div>

        <!-- Capabilities (A35) -->
        @if (provider.capabilities.length > 0) {
          <div class="flex flex-wrap gap-1 mt-2">
            @for (cap of provider.capabilities; track cap) {
              <span
                class="badge badge-outline badge-xs text-base-content"
              >
                {{ formatCapability(cap) }}
              </span>
            }
          </div>
        }

        <!-- Info note (A35) -->
        <p class="text-xs text-base-content-muted mt-2">
          Uses models from VS Code's Language Model API. No API key required.
        </p>
      </section>
    }
  `,
})
export class VscodeLmConfigComponent implements OnInit {
  readonly llmState = inject(LlmProviderStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);

  /** Emitted when the VS Code LM model selection changes (so parent can refresh agent detection, A37) */
  readonly modelChanged = output<void>();

  readonly CheckIcon = Check;
  readonly StarIcon = Star;
  readonly CpuIcon = Cpu;

  /** Save triggers are disabled while any settings write is in flight (D3). */
  readonly saving = this.feedback.saving;

  /** Local saving state */
  readonly savingModel = signal(false);

  /** Local selected model override to ensure revert on failure (D15) */
  readonly selectedModel = signal<string | null>(null);

  /** Find the vscode-lm provider from the provider list */
  readonly vscodeLmProvider = computed(() =>
    this.llmState.providers().find((p) => p.provider === 'vscode-lm'),
  );

  /** Currently active model id (selectedModel override or provider.defaultModel) */
  readonly currentModelId = computed(() =>
    this.selectedModel() ?? this.vscodeLmProvider()?.defaultModel ?? '',
  );

  /** Available VS Code LM models */
  readonly vsCodeModels = this.llmState.vsCodeModels;

  async ngOnInit(): Promise<void> {
    await this.llmState.loadProviderStatus();
    await this.llmState.loadVsCodeModels();
  }

  onVsCodeModelSelectEvent(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    void this.onVsCodeModelSelect(value);
  }

  async onVsCodeModelSelect(modelId: string): Promise<void> {
    if (!modelId || this.savingModel() || this.saving()) {
      return;
    }

    const previousModel = this.currentModelId();
    if (modelId === previousModel) {
      return;
    }

    this.selectedModel.set(modelId);
    this.savingModel.set(true);

    try {
      await this.feedback.saveGeneric({
        label: 'VS Code language model',
        write: async () => {
          try {
            const success = await this.llmState.setDefaultModel('vscode-lm', modelId);
            if (success) {
              this.modelChanged.emit();
              return { ok: true };
            }
            this.selectedModel.set(previousModel);
            return { ok: false, message: COULD_NOT_SAVE_LM_MODEL };
          } catch {
            this.selectedModel.set(previousModel);
            return { ok: false, message: COULD_NOT_SAVE_LM_MODEL };
          }
        },
        undo: async () => {
          try {
            const success = await this.llmState.setDefaultModel('vscode-lm', previousModel);
            if (success) {
              this.selectedModel.set(previousModel);
              this.modelChanged.emit();
              return { ok: true };
            }
            return { ok: false, message: COULD_NOT_SAVE_LM_MODEL };
          } catch {
            return { ok: false, message: COULD_NOT_SAVE_LM_MODEL };
          }
        },
      });
    } finally {
      this.savingModel.set(false);
    }
  }

  async onSetDefault(): Promise<void> {
    if (this.saving()) {
      return;
    }

    const previousDefault = this.llmState.defaultProvider();

    await this.feedback.saveGeneric({
      label: 'default provider',
      write: async () => {
        try {
          const success = await this.llmState.setDefaultProvider('vscode-lm');
          if (success) {
            return { ok: true };
          }
          return { ok: false, message: COULD_NOT_SET_DEFAULT_PROVIDER };
        } catch {
          return { ok: false, message: COULD_NOT_SET_DEFAULT_PROVIDER };
        }
      },
      undo: previousDefault
        ? async () => {
            try {
              const success = await this.llmState.setDefaultProvider(previousDefault);
              if (success) {
                return { ok: true };
              }
              return { ok: false, message: COULD_NOT_SET_DEFAULT_PROVIDER };
            } catch {
              return { ok: false, message: COULD_NOT_SET_DEFAULT_PROVIDER };
            }
          }
        : null,
    });
  }

  formatCapability(cap: string): string {
    return cap
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
