/**
 * ProviderModelPickerComponent — a domain-free provider + model selector.
 *
 * Two `<select>`s: one over the registry in `ANTHROPIC_PROVIDERS`, one over
 * whatever the injected {@link PROVIDER_MODELS_LOADER} returns for the chosen
 * provider. Both carry an explicit "inherit" sentinel (`''`) so a consumer can
 * express "whatever the host's active provider is" without inventing a magic
 * id.
 *
 * WHY IT LIVES IN `libs/frontend/ui`. It was extracted from the Electron-only
 * Memory tab because the Skills tab needs four instances of it and ships to
 * the VS Code webview as well. Forking would have stranded VS Code users on a
 * divergent copy. The price of living here is the boundary rule described on
 * {@link PROVIDER_MODELS_LOADER}: no `type:core` import, hence the injected
 * loader.
 *
 * PROVIDER-AGNOSTIC BY CONSTRUCTION. There is no provider id anywhere in this
 * file. The provider list comes from the registry, the default-model label
 * comes from the chosen entry's own `defaultTiers`, and the tool-use warning
 * comes from `ProviderModelInfo.supportsToolUse`. Adding a provider to the
 * registry is the whole integration.
 *
 * @example
 * ```html
 * <ptah-provider-model-picker
 *   label="Archaeologist lane"
 *   [provider]="lane().provider"
 *   [model]="lane().model"
 *   [defaultTier]="lane().defaultTier"
 *   [requiresToolUse]="lane().toolUse === 'required'"
 *   (selectionChange)="patchLane($event)"
 * />
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ANTHROPIC_PROVIDERS,
  getAnthropicProvider,
  type ProviderModelInfo,
  type ProviderModelTier,
} from '@ptah-extension/shared';

import { PROVIDER_MODELS_LOADER } from './provider-models-loader.port';

/** Emitted by {@link ProviderModelPickerComponent.selectionChange}. */
export interface ProviderModelSelection {
  /** Registry provider id, or `''` meaning "inherit the active provider". */
  readonly provider: string;
  /** Model id, or `''` meaning "use the provider's default tier". */
  readonly model: string;
}

interface ProviderOption {
  readonly id: string;
  readonly name: string;
}

const INHERIT_PROVIDER_LABEL = 'Active provider (default)';

/**
 * Characters of prompt budget suggested per token of context window.
 *
 * Half the window is left for the model's own reply and the surrounding
 * harness, and English/code averages roughly four characters per token —
 * so `contextLength / 2 * 4`. Deliberately a suggestion rendered as a hint,
 * never an enforced cap: the picker does not own the consumer's limit.
 */
const SUGGESTED_CHARS_PER_CONTEXT_TOKEN = 2;

/**
 * Label for the "no model pinned" sentinel.
 *
 * The backend sends a bare tier alias in this case, so the label must name a
 * tier, never a model id. An earlier version read `Default (<some claude id>)`
 * for every provider, which told a user on a third-party provider that their
 * work ran on a Claude model (TASK_2026_159).
 *
 * The concrete model is named only where this component can actually know it:
 * a chosen provider whose registry entry declares `defaultTiers[tier]`. With
 * no provider chosen, resolution happens server-side against whichever
 * provider the host settled on, and this component has no business guessing
 * which one that is.
 */
function buildDefaultModelLabel(
  providerId: string,
  tier: ProviderModelTier,
): string {
  if (!providerId) return `Default (active provider's ${tier} tier)`;
  const provider = getAnthropicProvider(providerId);
  const pinned = provider?.defaultTiers?.[tier];
  if (pinned) return `Default (${pinned})`;
  return `Default (${provider?.name ?? providerId} ${tier} tier)`;
}

@Component({
  selector: 'ptah-provider-model-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-md border border-base-300 bg-base-100">
      <header
        class="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content"
        data-testid="provider-model-picker-label"
      >
        {{ label() }}
      </header>

      <div class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-base-content-muted"
            >Provider</span
          >
          <select
            class="select select-bordered select-sm"
            data-testid="provider-model-picker-provider"
            [value]="provider()"
            [attr.aria-label]="providerAriaLabel()"
            (change)="onProviderChange($event)"
          >
            <option value="">{{ inheritProviderLabel }}</option>
            @for (opt of providerOptions; track opt.id) {
              <option [value]="opt.id">{{ opt.name }}</option>
            }
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-base-content-muted">Model</span>
          <select
            class="select select-bordered select-sm"
            data-testid="provider-model-picker-model"
            [value]="model()"
            [disabled]="modelsLoading()"
            [attr.aria-label]="modelAriaLabel()"
            (change)="onModelChange($event)"
          >
            <option value="">{{ defaultModelLabel() }}</option>
            @for (m of models(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </label>
      </div>

      @if (toolUseWarning()) {
        <p
          class="px-3 pb-2 text-xs text-warning"
          role="alert"
          data-testid="provider-model-picker-tooluse-warning"
        >
          {{ toolUseWarning() }}
        </p>
      }

      @if (contextHint(); as hint) {
        <p
          class="px-3 pb-2 text-xs text-base-content-muted"
          data-testid="provider-model-picker-context-hint"
        >
          {{ hint }}
        </p>
      }

      @if (modelsError(); as err) {
        <p
          class="px-3 pb-2 text-xs text-error"
          role="alert"
          data-testid="provider-model-picker-error"
        >
          {{ err }}
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProviderModelPickerComponent {
  private readonly loader = inject(PROVIDER_MODELS_LOADER);

  /** Registry provider id, or `''` to inherit the host's active provider. */
  readonly provider = input<string>('');

  /** Model id, or `''` to use the provider's default tier. */
  readonly model = input<string>('');

  /** Section heading. Also seeds the two `aria-label`s. */
  readonly label = input<string>('Model');

  /**
   * Tier the backend falls back to when no model is pinned. Only affects the
   * sentinel option's label — the component never sends a tier anywhere.
   */
  readonly defaultTier = input<ProviderModelTier>('haiku');

  /**
   * Set when the consumer's workload cannot run without tool use (a lane
   * declaring `toolUse: 'required'`). Turns the tool-use mismatch into a
   * visible warning instead of a run that loops to timeout (risk R6).
   */
  readonly requiresToolUse = input<boolean>(false);

  /** Fires on every user edit of either select, with both current values. */
  readonly selectionChange = output<ProviderModelSelection>();

  protected readonly inheritProviderLabel = INHERIT_PROVIDER_LABEL;

  protected readonly providerOptions: readonly ProviderOption[] =
    ANTHROPIC_PROVIDERS.map((p) => ({ id: p.id, name: p.name }));

  private readonly _provider = signal<string>('');
  private readonly _model = signal<string>('');
  private readonly _models = signal<readonly ProviderModelInfo[]>([]);
  private readonly _modelsLoading = signal<boolean>(false);
  private readonly _modelsError = signal<string | null>(null);

  protected readonly models = this._models.asReadonly();
  protected readonly modelsLoading = this._modelsLoading.asReadonly();
  protected readonly modelsError = this._modelsError.asReadonly();

  protected readonly defaultModelLabel = computed(() =>
    buildDefaultModelLabel(this._provider(), this.defaultTier()),
  );

  protected readonly providerAriaLabel = computed(
    () => `${this.label()} provider`,
  );
  protected readonly modelAriaLabel = computed(() => `${this.label()} model`);

  /** The loaded entry for the pinned model, when the catalogue knows it. */
  private readonly selectedModel = computed<ProviderModelInfo | null>(() => {
    const id = this._model();
    if (!id) return null;
    return this._models().find((m) => m.id === id) ?? null;
  });

  /**
   * Non-null when a tool-use-requiring consumer has pinned a model the
   * provider reports as tool-use incapable. Silent otherwise — including when
   * the catalogue has not loaded the model, since absence is not evidence.
   */
  protected readonly toolUseWarning = computed<string | null>(() => {
    if (!this.requiresToolUse()) return null;
    const selected = this.selectedModel();
    if (!selected || selected.supportsToolUse) return null;
    return `${selected.name} does not report tool-use support. This selection needs a tool-capable model.`;
  });

  /** Suggested prompt budget derived from the pinned model's context window. */
  protected readonly contextHint = computed<string | null>(() => {
    const selected = this.selectedModel();
    const contextLength = selected?.contextLength ?? 0;
    if (contextLength <= 0) return null;
    const suggested = contextLength * SUGGESTED_CHARS_PER_CONTEXT_TOKEN;
    return `Context window ${contextLength.toLocaleString('en-US')} tokens — suggested max input ~${suggested.toLocaleString('en-US')} characters.`;
  });

  /**
   * Monotonic counter that makes model loads last-write-wins. Switching
   * provider twice quickly must not let the first (slower) response overwrite
   * the second one's catalogue.
   */
  private loadGeneration = 0;

  constructor() {
    effect(() => {
      const providerId = this.provider();
      this._provider.set(providerId);
      this._model.set(this.model());
      void this.loadModels(providerId);
    });
  }

  protected onProviderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this._provider.set(value);
    // A model id from the previous provider is meaningless here.
    this._model.set('');
    void this.loadModels(value);
    this.emit();
  }

  protected onModelChange(event: Event): void {
    this._model.set((event.target as HTMLSelectElement).value);
    this.emit();
  }

  private emit(): void {
    this.selectionChange.emit({
      provider: this._provider(),
      model: this._model(),
    });
  }

  private async loadModels(providerId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this._modelsLoading.set(true);
    this._modelsError.set(null);
    try {
      // `''` is this component's "inherit" sentinel, not a provider id; the
      // loader's own contract spells that case `undefined`.
      const result = await this.loader.listModels(providerId || undefined);
      if (generation !== this.loadGeneration) return;
      this._models.set(result.models);
      if (result.error) this._modelsError.set(result.error);
    } catch (error: unknown) {
      if (generation !== this.loadGeneration) return;
      this._models.set([]);
      this._modelsError.set(
        error instanceof Error ? error.message : 'Failed to load models',
      );
    } finally {
      if (generation === this.loadGeneration) this._modelsLoading.set(false);
    }
  }
}
