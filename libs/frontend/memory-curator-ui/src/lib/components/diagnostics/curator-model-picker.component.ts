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
} from '@ptah-extension/shared';

import { MemoryDiagnosticsRpcService } from '../../services/memory-diagnostics-rpc.service';

export interface CuratorModelChange {
  readonly curatorProvider: string;
  readonly curatorModel: string;
}

interface ProviderOption {
  readonly id: string;
  readonly name: string;
}

const ACTIVE_PROVIDER_LABEL = 'Active provider (default)';

/**
 * Label for the "no model pinned" sentinel.
 *
 * The backend sends the bare `haiku` tier alias in this case, so the label has
 * to name a tier, never a model id. It previously read
 * `Default (claude-haiku-4-5-20251001)` for every provider, which told a user
 * on Ollama Cloud that their curator ran on Claude (TASK_2026_159).
 *
 * We name the concrete model only where the picker can actually know it: a
 * chosen curator provider whose registry entry declares `defaultTiers.haiku`.
 * With no curator provider chosen the resolution happens server-side against
 * whichever provider the chat agent settled on, and this component has no
 * business guessing which one that is.
 */
function buildDefaultModelLabel(providerId: string): string {
  if (!providerId) return "Default (active provider's haiku tier)";
  const provider = getAnthropicProvider(providerId);
  const haiku = provider?.defaultTiers?.haiku;
  if (haiku) return `Default (${haiku})`;
  return `Default (${provider?.name ?? providerId} haiku tier)`;
}

@Component({
  selector: 'ptah-curator-model-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-md border border-base-300 bg-base-100">
      <header
        class="border-b border-base-300 px-3 py-2 text-sm font-semibold text-base-content"
      >
        Curator model
      </header>
      <div class="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-base-content-muted"
            >Provider</span
          >
          <select
            class="select select-bordered select-sm"
            data-testid="curator-provider-select"
            [value]="provider()"
            (change)="onProviderChange($event)"
            aria-label="Curator provider"
          >
            <option value="">{{ activeProviderLabel }}</option>
            @for (opt of providerOptions; track opt.id) {
              <option [value]="opt.id">{{ opt.name }}</option>
            }
          </select>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-base-content-muted">Model</span>
          <select
            class="select select-bordered select-sm"
            data-testid="curator-model-select"
            [value]="model()"
            [disabled]="modelsLoading()"
            (change)="onModelChange($event)"
            aria-label="Curator model"
          >
            <option value="">{{ defaultModelLabel() }}</option>
            @for (m of models(); track m.id) {
              <option [value]="m.id">{{ m.name }}</option>
            }
          </select>
        </label>
      </div>

      @if (modelsError(); as err) {
        <div
          class="px-3 pb-2 text-xs text-warning"
          data-testid="curator-model-error"
        >
          {{ err }}
        </div>
      }

      <p
        class="border-t border-base-300 px-3 py-2 text-xs text-base-content-muted"
        data-testid="curator-phase1-note"
      >
        {{ phase1Note }}
      </p>
    </section>
  `,
})
export class CuratorModelPickerComponent {
  private readonly rpc = inject(MemoryDiagnosticsRpcService);

  public readonly curatorProvider = input<string>('');
  public readonly curatorModel = input<string>('');

  public readonly curatorChange = output<CuratorModelChange>();

  protected readonly activeProviderLabel = ACTIVE_PROVIDER_LABEL;
  protected readonly defaultModelLabel = computed(() =>
    buildDefaultModelLabel(this._provider()),
  );
  protected readonly phase1Note =
    'model rides the active provider (full provider routing coming soon)';

  protected readonly providerOptions: readonly ProviderOption[] =
    ANTHROPIC_PROVIDERS.map((p) => ({ id: p.id, name: p.name }));

  private readonly _provider = signal<string>('');
  private readonly _model = signal<string>('');
  private readonly _models = signal<readonly ProviderModelInfo[]>([]);
  private readonly _modelsLoading = signal<boolean>(false);
  private readonly _modelsError = signal<string | null>(null);

  protected readonly provider = this._provider.asReadonly();
  protected readonly model = this._model.asReadonly();
  protected readonly models = this._models.asReadonly();
  protected readonly modelsLoading = this._modelsLoading.asReadonly();
  protected readonly modelsError = this._modelsError.asReadonly();

  private loadGeneration = 0;

  public constructor() {
    effect(() => {
      const providerId = this.curatorProvider();
      this._provider.set(providerId);
      this._model.set(this.curatorModel());
      void this.loadModels(providerId);
    });
  }

  protected onProviderChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this._provider.set(value);
    this._model.set('');
    void this.loadModels(value);
    this.emit();
  }

  protected onModelChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this._model.set(value);
    this.emit();
  }

  private emit(): void {
    this.curatorChange.emit({
      curatorProvider: this._provider(),
      curatorModel: this._model(),
    });
  }

  private async loadModels(providerId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    this._modelsLoading.set(true);
    this._modelsError.set(null);
    try {
      const result = await this.rpc.listModels(providerId || undefined);
      if (generation !== this.loadGeneration) return;
      this._models.set(result.models);
      if (result.error) {
        this._modelsError.set(result.error);
      }
    } catch (error: unknown) {
      if (generation !== this.loadGeneration) return;
      this._models.set([]);
      this._modelsError.set(
        error instanceof Error ? error.message : 'Failed to load models',
      );
    } finally {
      if (generation === this.loadGeneration) {
        this._modelsLoading.set(false);
      }
    }
  }
}
