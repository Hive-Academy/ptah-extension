import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked,
} from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { ProvidersSettingsStateService, type ProvidersEditContext } from '@ptah-extension/core';
import {
  NativeModalComponent, PROVIDER_MODELS_LOADER, ProviderModelSearchFieldComponent, type ProviderModelSearchOption,
} from '@ptah-extension/ui';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingsToastComponent } from '../feedback/settings-toast.component';

/** The instance whose tiers the modal edits. */
export interface CliTierMappingTarget {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly providerName: string;
}

type Tier = 'sonnet' | 'opus' | 'haiku';
type TierMappings = Partial<Record<Tier, string>>;
const TIERS: readonly { readonly tier: Tier; readonly label: string }[] = [
  { tier: 'sonnet', label: 'Sonnet' }, { tier: 'opus', label: 'Opus' }, { tier: 'haiku', label: 'Haiku' },
];
/** The list's last row: swaps the search for a model-ID field (an id the catalogue does not list). */
const MANUAL = '__manual__';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const SAVE_SCOPE = 'global';

interface Catalogue {
  readonly status: 'loading' | 'ready' | 'error';
  readonly models: readonly ProviderModelInfo[];
}

/**
 * A Ptah CLI instance's own tier mapping (#53, D5; plan :759-764, prototype `#modalTierMapping`), on the shared
 * `NativeModalComponent`. Compact like the prototype: one row per tier.
 * - Each row is the compact searchable model field (ids in mono, the current one checked) over the instance provider's
 *   catalogue (`PROVIDER_MODELS_LOADER`, loaded once per open), with "Enter a model ID…" for an unlisted id.
 * - Its default row and its line under the field name what the tier inherits without its own model: the provider-level
 *   `cliAgent` tier (`provider:getModelTiers {scope:'cliAgent'}`), else the provider default — the D5 order
 *   (instance > provider `cliAgent` > defaults, `ptah-cli-registry.ts` `resolveEffectiveTiers`).
 * - Each pick saves at once through `state.setCliInstanceTiers` with the **full** object (`ptahCli:update` replaces
 *   it); choosing the inherited row, or "Use inherited", sends the object without that tier. Undo sends the previous
 *   full object.
 * Every `write`/`undo` is that one state call (Batch 17 constraint), reported by `SettingsSaveFeedbackService`; the
 * footer's toast copy is the one heard while the page is inert (plan :542-544).
 */
@Component({
  selector: 'ptah-cli-tier-mapping-modal',
  standalone: true,
  imports: [LucideAngularModule, NativeModalComponent, ProviderModelSearchFieldComponent, SettingsToastComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal [isOpen]="open()" ariaLabelledby="cli-tier-mapping-title" size="md" (closed)="closed.emit()">
      <div modal-header class="-mx-6 -mt-6 mb-4 flex items-center justify-between gap-2 border-b border-base-300 bg-base-200 px-5 py-3"
        data-testid="cli-tier-mapping-modal">
        <h2 id="cli-tier-mapping-title" class="text-sm font-bold text-base-content">{{ target()?.name ?? 'Instance' }} Tier Model Mapping</h2>
        <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="closed.emit()">
          <lucide-angular [img]="CloseIcon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      @if (target(); as instance) {
        <div class="space-y-3 text-xs">
          <p class="text-base-content-muted">
            Models for this Ptah CLI instance only, from {{ instance.providerName }}. A tier without its own model uses the
            provider's CLI-agent tier, else the provider default. Each choice saves at once.
          </p>
          @if (catalogue().status === 'error') {
            <p role="alert" class="flex flex-wrap items-center gap-1.5 text-base-content" data-testid="cli-tier-models-error">
              Could not load {{ instance.providerName }}'s model list. You can still enter a model ID.
              <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing" (click)="loadModels()">Retry</button>
            </p>
          }
          @if (mappings() === null) {
            <p role="status" class="text-base-content-muted" data-testid="cli-tier-mapping-loading">Loading this instance's tier mapping…</p>
          } @else {
            <ul class="space-y-3">
              @for (row of tiers; track row.tier) {
                <li class="space-y-1" [attr.data-tier]="row.tier">
                  <div class="flex items-center justify-between gap-2">
                    <label [for]="'cli-tier-' + row.tier" class="font-bold text-base-content">{{ row.label }} tier</label>
                    @if (own(row.tier)) {
                      <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing"
                        [disabled]="busy()" (click)="useInherited(row.tier)" [attr.data-testid]="'cli-tier-inherit-' + row.tier">Use inherited</button>
                    }
                  </div>
                  @if (manualTier() === row.tier) {
                    <div class="flex items-center gap-1.5">
                      <input [id]="'cli-tier-' + row.tier" type="text" [class]="'input input-bordered input-sm min-w-0 flex-1 font-mono text-xs ' + focusRing"
                        placeholder="Model ID, e.g. vendor/model-name" [value]="manualDraft()" (input)="manualDraft.set(value($event))"
                        [attr.aria-label]="row.label + ' tier model ID'" [attr.data-testid]="'cli-tier-manual-' + row.tier" />
                      <button type="button" [class]="'btn btn-outline btn-xs min-h-8 border-base-content-muted text-base-content ' + focusRing"
                        [disabled]="busy() || !manualDraft().trim()" (click)="applyManual(row.tier)" [attr.data-testid]="'cli-tier-manual-apply-' + row.tier">Use</button>
                      <button type="button" [class]="'btn btn-ghost btn-xs min-h-8 text-base-content ' + focusRing" (click)="closeManual(row.tier)">Cancel</button>
                    </div>
                  } @else {
                    <ptah-provider-model-search-field [inputId]="'cli-tier-' + row.tier" [ariaLabel]="row.label + ' tier model'"
                      [options]="options(row.tier)" [selectedId]="own(row.tier) ?? ''" [includeDefault]="true"
                      [defaultLabel]="'Inherited: ' + inheritedLabel(row.tier)" [placeholder]="'Inherited: ' + inheritedLabel(row.tier)"
                      [pinnedOption]="manualOption" [compact]="true" [disabled]="busy() || catalogue().status === 'loading'"
                      (modelSelected)="onPick(row.tier, $event)" [attr.data-testid]="'cli-tier-picker-' + row.tier" />
                  }
                  <p class="text-[11px] text-base-content-muted" [attr.data-testid]="'cli-tier-source-' + row.tier">
                    @if (own(row.tier); as model) {
                      This instance: <span class="font-mono text-base-content">{{ model }}</span>. Inherited otherwise: {{ inheritedLabel(row.tier) }}.
                    } @else {
                      Inherited: {{ inheritedLabel(row.tier) }}.
                    }
                  </p>
                </li>
              }
            </ul>
          }
        </div>
      }

      <div modal-footer class="-mx-6 -mb-6 mt-5 flex items-center justify-end gap-2 border-t border-base-300 bg-base-200 px-5 py-3">
        <button type="button" [class]="'btn btn-primary btn-sm ' + focusRing" (click)="closed.emit()" data-testid="cli-tier-mapping-done">Done</button>
        <!-- Only while open: a closed modal must not keep a second toast (and Undo) in the page. -->
        @if (open()) {
          <ptah-settings-toast />
        }
      </div>
    </ptah-native-modal>
  `,
})
export class CliTierMappingModalComponent {
  protected readonly CloseIcon = X;
  protected readonly focusRing = FOCUS;
  protected readonly tiers = TIERS;
  protected readonly manualOption: ProviderModelSearchOption = { id: MANUAL, name: 'Enter a model ID…', supportsToolUse: null };
  private readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly loader = inject(PROVIDER_MODELS_LOADER);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly open = input(false);
  readonly target = input<CliTierMappingTarget | null>(null);
  readonly closed = output<void>();

  private context: ProvidersEditContext | null = null;
  private catalogueRequest = 0;
  protected readonly busy = this.feedback.saving;
  protected readonly catalogue = signal<Catalogue>({ status: 'loading', models: [] });
  /** The tier whose search is swapped for a model-ID field, if any. */
  protected readonly manualTier = signal<Tier | null>(null);
  protected readonly manualDraft = signal('');

  /** The instance's own mapping as last read (`cliModels`); `null` while it is not loaded. */
  protected readonly mappings = computed<TierMappings | null>(() => {
    const id = this.target()?.id;
    const saved = id ? this.state.cliModels().data?.[id] : undefined;
    if (!saved) return null;
    const mappings: TierMappings = {};
    for (const { tier } of TIERS) {
      const model = saved.tierMappings?.[tier]?.trim();
      if (model) mappings[tier] = model;
    }
    return mappings;
  });
  /** The catalogue as compact-field options; ids lead, display names follow. */
  private readonly catalogueOptions = computed<readonly ProviderModelSearchOption[]>(() =>
    this.catalogue().models.map((model) => ({ id: model.id, name: model.name || model.id, supportsToolUse: null })));

  constructor() {
    effect(() => {
      const target = this.target();
      if (!this.open() || !target) return;
      untracked(() => {
        this.context = this.state.reviewContext();
        this.manualTier.set(null);
        void this.state.refreshTiers({ providerId: target.providerId, scope: 'cliAgent' });
        void this.loadModels();
      });
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected own(tier: Tier): string | null {
    return this.mappings()?.[tier] ?? null;
  }

  /** The catalogue, with this tier's own id kept listed when the catalogue lacks it (opening never changes it). */
  protected options(tier: Tier): readonly ProviderModelSearchOption[] {
    const options = this.catalogueOptions(), own = this.own(tier);
    return !own || options.some((option) => option.id === own)
      ? options : [{ id: own, name: 'saved, not in the current list', supportsToolUse: null }, ...options];
  }

  protected inheritedLabel(tier: Tier): string {
    const section = this.state.tiers();
    if (section.status !== 'ready') return section.status === 'error' ? 'not loaded' : 'loading…';
    return section.data?.[tier] ?? 'provider default';
  }

  async loadModels(): Promise<void> {
    const providerId = this.target()?.providerId;
    if (!providerId) return;
    const request = ++this.catalogueRequest;
    this.catalogue.set({ status: 'loading', models: [] });
    try {
      const result = await this.loader.listModels(providerId);
      if (request !== this.catalogueRequest) return;
      this.catalogue.set({ status: result.error ? 'error' : 'ready', models: result.models ?? [] });
    } catch {
      if (request === this.catalogueRequest) this.catalogue.set({ status: 'error', models: [] });
    }
  }

  protected onPick(tier: Tier, model: string): Promise<void> {
    if (model === MANUAL) {
      this.manualDraft.set('');
      this.manualTier.set(tier);
      this.focusAfterRender(`[data-testid="cli-tier-manual-${tier}"]`);
      return Promise.resolve();
    }
    return this.saveTier(tier, model.trim());
  }

  protected async applyManual(tier: Tier): Promise<void> {
    const model = this.manualDraft().trim();
    if (!model) return;
    await this.saveTier(tier, model);
    if (this.state.commit().status === 'saved') this.closeManual(tier);
  }

  protected closeManual(tier: Tier): void {
    this.manualTier.set(null);
    this.focusAfterRender(`#cli-tier-${tier}`);
  }

  protected useInherited(tier: Tier): Promise<void> {
    return this.saveTier(tier, '');
  }

  /** One tier changes; the full object is sent (a blank tier is left out and inherits). */
  private async saveTier(tier: Tier, model: string): Promise<void> {
    const target = this.target(), previous = this.mappings();
    const context = this.context ?? this.state.reviewContext();
    if (!target || !previous || !context || (previous[tier] ?? '') === model) return;
    const next: TierMappings = { ...previous };
    if (model) next[tier] = model;
    else delete next[tier];
    const label = TIERS.find((row) => row.tier === tier)?.label ?? tier;
    await this.feedback.save({
      label: `${target.name} ${label} tier`, scope: SAVE_SCOPE,
      write: () => this.state.setCliInstanceTiers(target.id, next, context),
      undo: () => this.state.setCliInstanceTiers(target.id, previous, context),
    });
    if (this.state.commit().status === 'blocked') this.context = this.state.reviewContext();
  }

  /** The swapped-in control takes focus once rendered, so focus (and Esc) stay in the dialog. */
  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), { injector: this.injector });
  }
}
