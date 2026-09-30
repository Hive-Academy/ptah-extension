import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, effect, inject, input, output,
  signal, untracked,
} from '@angular/core';
import { X, LucideAngularModule } from 'lucide-angular';
import { ProvidersSettingsStateService, type ProvidersEditContext } from '@ptah-extension/core';
import {
  NativePopoverComponent, PROVIDER_MODELS_LOADER, ProviderModelSearchFieldComponent, type ProviderModelSearchOption,
} from '@ptah-extension/ui';
import type { EffortLevel, ProviderModelInfo, SettingScope } from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { runDrawerWrite, type DrawerWriteOutcome } from './connection-drawer/drawer-write';
import { injectAppScopeName, saveTargetLabels } from './app-scope-label';

export type MainAgentFocus = 'main-agent' | 'main-model' | 'main-effort';

/** Route statuses a connection can be made the main agent from (`providers-settings-state.service.ts:72`). */
const ACTIVATABLE: ReadonlySet<string> = new Set(['connected', 'reachable', 'unknown', 'skipped']);
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODALITY: Readonly<Record<string, string>> = {
  apiKey: 'API key', cli: 'CLI login', oauth: 'OAuth', 'local-native': 'Local server', 'local-proxy': 'Local server', custom: 'Custom endpoint',
};
/** Model select value that swaps the select for an inline model-ID field (#35). */
const MANUAL = '__manual__';
const SELECT = 'select select-bordered select-sm min-h-8 w-full border-base-content-muted bg-base-100 text-xs text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

interface ModelCatalogue {
  readonly status: 'loading' | 'ready' | 'error';
  readonly models: readonly ProviderModelInfo[];
}

/**
 * Main Agent popover (plan :596-609, design-spec §2.1, prototype `#popoverMainAgent`), opened from the
 * routing map's Main Agent node or a `main-*` deep link. It is the one place the main agent is changed (the card's
 * "Use for main agent" was removed at Gate V 28, as in the prototype). Compact, like the
 * prototype: header, Provider connection, Model selection, Reasoning effort, Save to.
 * - **Provider** (D6): choosing another connection shows an inline confirm ("… ends running chat
 *   sessions."); "Use for main agent" calls `activateConnection` to the "Save to" scope, with no Undo and its
 *   own outcome only (`runDrawerWrite`, D15). "Save provider to {scope}…" re-saves the current provider there
 *   through the same confirm (the capability of the old override link, RUX-5).
 * - **Model** (the compact searchable `ProviderModelSearchFieldComponent` over the driver's catalogue, loaded
 *   through the page's `PROVIDER_MODELS_LOADER`, with the tool-use marker; "Enter a model ID…" always last, for an
 *   unlisted one; Batch 28b) and **Effort** (segmented group) save
 *   on selection through `SettingsSaveFeedbackService` with Undo (D2); every `write`/`undo` is
 *   `state.saveSettings` (Batch 17 constraint).
 * The edit context is taken on open; a write the host blocks because the workspace changed refreshes it, so
 * the popover stays open with fresh values and the next choice is made against them.
 */
@Component({
  selector: 'ptah-main-agent-reassign-popover',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, ProviderModelSearchFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Angular owns (and removes) this listener with the component.
  host: { '(window:resize)': 'open() && fitToViewport()' },
  template: `
    <ptah-native-popover [isOpen]="open()" placement="bottom-start" [hasBackdrop]="true" backdropClass="transparent"
      (closed)="closed.emit()" (opened)="focusRequested()">
      <!-- Zero-size anchor: the host sits at the Main Agent node's bottom-left edge. -->
      <span trigger class="block h-0 w-0" aria-hidden="true"></span>
      <!-- Height capped at the space below its top edge (fitToViewport); only the body scrolls, so the popover is fully
           visible in every state, the provider-change confirm included (Gate V 28). -->
      <div content role="dialog" aria-labelledby="main-agent-popover-title" class="flex w-[19rem] max-w-[calc(100vw-2rem)] flex-col p-3 text-xs"
        [style.max-height.px]="maxHeight()" data-testid="main-agent-popover">
        <div class="mb-2.5 flex shrink-0 items-center justify-between gap-2 border-b border-base-300 pb-1.5">
          <h2 id="main-agent-popover-title" class="text-xs font-bold text-base-content">Reassign main agent</h2>
          <div class="flex items-center gap-1">
            <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 px-1.5 font-medium text-base-content underline ' + focusRing"
              [disabled]="state.route().status === 'loading'" (click)="state.checkConnection()" data-testid="main-agent-check">
              {{ state.route().status === 'loading' ? 'Checking…' : 'Check connection' }}
            </button>
            <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="closed.emit()">
              <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="-mx-1 min-h-0 space-y-2.5 overflow-y-auto px-1" data-testid="main-agent-popover-body">
        <div class="space-y-1">
          <label for="main-agent-provider" class="block text-[11px] font-semibold text-base-content-muted">Provider connection</label>
          <select id="main-agent-provider" [class]="select" data-focus="main-agent" [disabled]="busy()"
            (change)="providerChoice.set(value($event))" data-testid="main-agent-provider">
            @if (!driverId()) { <option value="" [selected]="!providerId()">Choose a provider…</option> }
            @for (option of providers(); track option.id) {
              <option [value]="option.id" [selected]="option.id === providerId()">{{ option.label }}</option>
            }
          </select>
          @if (rescopeOffer(); as scope) {
            <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing" [disabled]="busy()"
              (click)="rescope.set(true)" data-testid="main-agent-provider-rescope">Save provider to {{ scope }}…</button>
          }
          @if (pendingProvider(); as pending) {
            <div role="group" aria-label="Confirm main provider change" class="space-y-1.5 rounded border border-base-300 bg-base-200 p-2"
              data-testid="main-agent-provider-confirm">
              <p class="text-base-content" data-testid="main-agent-provider-copy">{{ pending.copy }}</p>
              <p class="text-base-content-muted">{{ pending.scope ? 'Saved to: ' + pending.scope + '.' : 'Where to save is not loaded yet.' }}</p>
              @if (pending.uncheckable) {
                <p class="text-base-content-muted" data-testid="activation-unchecked-note">Ptah cannot check this connection before use. If new requests fail, check that {{ pending.name }} is running and reachable.</p>
              }
              <div class="flex flex-wrap gap-1.5">
                <button type="button" [class]="'btn btn-primary btn-xs min-h-6 ' + focusRing" [disabled]="busy() || !pending.writable" (click)="activate()">Use for main agent</button>
                <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 text-base-content ' + focusRing" [disabled]="busy()" (click)="resetProvider()">Cancel provider change</button>
              </div>
            </div>
          }
          @if (providerOutcome(); as outcome) {
            <p [attr.role]="outcome.alert ? 'alert' : 'status'" class="text-base-content" data-testid="main-agent-provider-outcome">{{ outcome.text }}</p>
          }
        </div>

        <div class="space-y-1" data-focus="main-model" tabindex="-1">
          <label for="main-agent-model" class="block text-[11px] font-semibold text-base-content-muted">Model selection</label>
          @if (manual()) {
            <div class="flex items-center gap-1.5">
              <input id="main-agent-model" type="text" [class]="'input input-bordered input-sm min-h-8 min-w-0 flex-1 font-mono text-xs ' + focusRing"
                placeholder="Model ID, e.g. vendor/model-name" [value]="manualDraft()" (input)="manualDraft.set(value($event))"
                aria-label="Main agent model ID" data-testid="main-agent-model-manual" />
              <button type="button" [class]="'btn btn-outline btn-xs min-h-8 text-base-content ' + focusRing" [disabled]="busy() || !targetReady() || !manualDraft().trim()"
                (click)="applyManual()">Use</button>
              <button type="button" [class]="'btn btn-ghost btn-xs min-h-8 text-base-content ' + focusRing" (click)="closeManual()">Cancel</button>
            </div>
          } @else {
            <!-- Batch 28b: the compact searchable model control (ui barrel), filtering the popover's own options. Its list
                 is position:fixed (Floating UI), so the body's scroll box never clips it; Esc closes the list first. -->
            <ptah-provider-model-search-field data-testid="main-agent-model" inputId="main-agent-model" ariaLabel="Main agent model"
              [options]="searchOptions()" [selectedId]="currentModel()" [includeDefault]="!currentModel()"
              [defaultLabel]="catalogue().status === 'loading' ? 'Loading models…' : defaultModelLabel()" [pinnedOption]="manualOption"
              [disabled]="busy() || !targetReady() || !driverId() || catalogue().status === 'loading'" (modelSelected)="onModel($event)" />
          }
          @if (catalogue().status === 'error') {
            <p role="alert" class="flex items-center gap-1.5 text-base-content" data-testid="main-agent-model-error">
              Could not load the model list.
              <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing" (click)="loadModels()">Retry</button>
            </p>
          }
        </div>

        <div class="space-y-1">
          <span id="main-agent-effort-label" class="block text-[11px] font-semibold text-base-content-muted">Reasoning effort</span>
          <div class="join w-full" role="group" aria-labelledby="main-agent-effort-label" data-focus="main-effort" tabindex="-1"
            data-testid="main-agent-effort">
            @for (level of efforts; track level.value) {
              <button type="button" [class]="effortClass(level.value)" [attr.aria-pressed]="currentEffort() === level.value"
                [disabled]="busy() || !targetReady()" (click)="saveEffort(level.value)" [attr.data-effort]="level.value || 'default'">{{ level.label }}</button>
            }
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 border-t border-base-300 pt-2">
          <label for="main-agent-save-to" class="shrink-0 text-base-content-muted">Save to:</label>
          <select id="main-agent-save-to" [class]="select + ' w-auto max-w-[11rem]'" [disabled]="busy() || !targetReady()"
            (change)="targetChoice.set(asScope(value($event)))" data-testid="main-agent-save-to">
            @for (scope of targets(); track scope) {
              <option [value]="scope" [selected]="scope === target()">{{ scopeLabel(scope) }}</option>
            }
          </select>
        </div>
        <!-- M1 (Providers 21-28 review): no Save-to target, no write. Model, effort and Save-to wait for the sources. -->
        @if (state.mainSources().status === 'error') {
          <p role="alert" class="flex flex-wrap items-center gap-1.5 text-base-content" data-testid="main-agent-sources-error">
            Where the model and effort are saved could not be loaded. Nothing was changed.
            <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing"
              (click)="state.refreshMainSources()">Retry model and effort sources</button>
          </p>
        } @else if (!targetReady()) {
          <p role="status" class="text-base-content-muted" data-testid="main-agent-sources-loading">Loading where the model and effort are saved…</p>
        }
        </div>
      </div>
    </ptah-native-popover>
  `,
})
export class MainAgentReassignPopoverComponent {
  protected readonly CloseIcon = X;
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly loader = inject(PROVIDER_MODELS_LOADER);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** "Save to" labels; the App target is the running host's own layer ("VS Code" or "Desktop app"). */
  private readonly scopeLabels = saveTargetLabels(injectAppScopeName());
  protected readonly select = SELECT;
  protected readonly focusRing = FOCUS;
  /** #35: always the last row of the model list, never filtered out; choosing it swaps in the model-ID field. */
  protected readonly manualOption: ProviderModelSearchOption = { id: MANUAL, name: 'Enter a model ID…', supportsToolUse: null };
  protected readonly efforts: readonly { value: EffortLevel | ''; label: string }[] = [
    { value: '', label: 'default' }, ...EFFORT_LEVELS.map((value) => ({ value, label: value })),
  ];

  readonly open = input(false);
  /** Deep-linked control to focus once open. */
  readonly initialFocus = input<MainAgentFocus | null>(null);
  readonly closed = output<void>();

  protected readonly providerChoice = signal<string | null>(null);
  /** The user asked to re-save the CURRENT provider to the "Save to" scope. */
  protected readonly rescope = signal(false);
  protected readonly targetChoice = signal<SettingScope | null>(null);
  protected readonly manual = signal(false);
  protected readonly manualDraft = signal('');
  protected readonly catalogue = signal<ModelCatalogue>({ status: 'loading', models: [] });
  private readonly outcome = signal<DrawerWriteOutcome | null>(null);
  /** The popover's height cap in px (`fitToViewport`); `null` until it is positioned. */
  protected readonly maxHeight = signal<number | null>(null);
  private context: ProvidersEditContext | null = null;
  private session = 0;
  private catalogueRequest = 0;

  protected readonly driverId = computed(() => {
    const route = this.state.route().data;
    return route && route.route !== 'unresolved' ? route.driverProviderId ?? '' : '';
  });
  /** Activatable connections, plus the current driver, labelled "{name} · {modality}". */
  protected readonly providers = computed(() => {
    const statuses = new Map((this.state.route().data?.providers ?? []).map((provider) => [provider.id, provider.status]));
    return (this.state.connections().data ?? [])
      .filter((entry) => entry.id === this.driverId() || (entry.configured && ACTIVATABLE.has(statuses.get(entry.id) ?? '')))
      .map((entry) => ({ id: entry.id, label: `${entry.name} · ${MODALITY[entry.authMode] ?? entry.authMode}`, name: entry.name,
        uncheckable: statuses.get(entry.id) === 'unknown' || statuses.get(entry.id) === 'skipped' }));
  });
  protected readonly providerId = computed(() => this.providerChoice() ?? this.driverId());
  private readonly providerTargets = computed(() => this.state.writeScopes('authMethod'));
  /** The current authentication source scope. */
  private readonly providerSource = computed(() => this.state.scopeEntry('authMethod')?.scope ?? null);

  /** "Save to": the targets the model and effort keys both allow (`writeScopes`), default = the model's source. */
  protected readonly targets = computed(() => {
    const sources = this.state.mainSources().data;
    if (this.state.mainSources().status !== 'ready' || !sources?.model || !sources.effort) return [] as readonly SettingScope[];
    const effort = this.state.writeScopes(sources.effort.key);
    return this.state.writeScopes(sources.model.key).filter((target) => effort.includes(target));
  });
  /**
   * The chosen "Save to" scope, else the model's source, else the first offered target. `null` while no target is
   * offered (sources loading or failed): never a scope `writeScopes` did not offer (M1, Providers 21-28 review).
   */
  protected readonly target = computed<SettingScope | null>(() => {
    const chosen = this.targetChoice(), targets = this.targets();
    if (chosen && targets.includes(chosen)) return chosen;
    const source = this.state.mainSources().data?.model?.scope;
    return source && targets.includes(source) ? source : targets[0] ?? null;
  });
  /** Model, effort and Save-to accept input only once a target is offered. */
  protected readonly targetReady = computed(() => this.target() !== null);
  /** Offered when the "Save to" scope is not where the current provider is stored, and the provider may go there. */
  protected readonly rescopeOffer = computed(() => {
    const target = this.target();
    return target && this.driverId() && !this.providerChoice() && !this.rescope() && this.providerSource() !== target
      && this.providerTargets().includes(target) ? this.scopeLabels[target] : null;
  });
  protected readonly pendingProvider = computed(() => {
    const id = this.providerId();
    const changing = !!id && id !== this.driverId();
    if (!changing && !(this.rescope() && id)) return null;
    const option = this.providers().find((entry) => entry.id === id);
    const name = option?.name ?? id, target = this.target();
    return {
      id, name, uncheckable: option?.uncheckable ?? false, scope: target ? this.scopeLabels[target] : null,
      writable: target !== null && this.providerTargets().includes(target),
      copy: changing ? `New main-agent requests use ${name}. Changing the provider ends running chat sessions.`
        : `New main-agent requests keep using ${name}. Saving the provider ends running chat sessions.`,
    };
  });
  protected readonly providerOutcome = computed(() => {
    const outcome = this.outcome();
    if (!outcome || outcome.status === 'idle') return null;
    if (outcome.status === 'saving') return { text: 'Saving…', alert: false };
    if (outcome.status === 'saved') return { text: 'Main agent provider saved.', alert: false };
    return { text: `${outcome.status === 'unconfirmed' ? 'Save not confirmed.' : 'Not saved.'} ${outcome.message ?? ''}`.trim(), alert: true };
  });

  protected readonly currentModel = computed(() => this.state.model().data?.model ?? '');
  protected readonly defaultModelLabel = computed(() =>
    this.state.route().data?.resolvedModel.kind === 'unresolved' ? 'Default (chosen by Claude)' : 'Provider default');
  /** Catalogue models with the tool-use marker; a stored model the catalogue lacks stays listed. */
  protected readonly modelOptions = computed(() => {
    const models = this.catalogue().models.map((model) => ({
      id: model.id, label: `${model.name || model.id} [Tool: ${model.supportsToolUse ? 'Yes' : 'No'}]`,
    }));
    const current = this.currentModel();
    return current && !models.some((model) => model.id === current)
      ? [{ id: current, label: `${current} · not in current catalog` }, ...models] : models;
  });
  /**
   * `modelOptions` as the compact field's options. The "[Tool: Yes|No]" marker is part of every label, so the field's
   * own "Tool use" badge is left off (`supportsToolUse: null`) rather than shown twice.
   */
  protected readonly searchOptions = computed<readonly ProviderModelSearchOption[]>(() =>
    this.modelOptions().map((option) => ({ id: option.id, name: option.label, supportsToolUse: null })));
  protected readonly currentEffort = computed<EffortLevel | ''>(() => (this.state.effort().data?.effort as EffortLevel | undefined) ?? '');
  /** Triggers wait while any save runs (D3). */
  protected readonly busy = computed(() => this.feedback.saving() || this.outcome()?.status === 'saving');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.session += 1;
        this.context = this.state.reviewContext();
        this.providerChoice.set(null);
        this.rescope.set(false);
        this.targetChoice.set(null);
        this.manual.set(false);
        this.outcome.set(null);
      });
    });
    // The driver's catalogue, while open; a newer request supersedes an older one.
    effect(() => {
      if (this.open() && this.driverId()) untracked(() => this.loadModels());
    });
    // Re-fit after every state that changes the popover's height (Gate V 28: the confirm ran off screen).
    afterRenderEffect(() => {
      if (!this.open()) return;
      this.pendingProvider(); this.providerOutcome(); this.manual(); this.catalogue(); this.targetReady();
      untracked(() => this.fitToViewport());
    });
  }

  protected value(event: Event): string { return (event.target as HTMLSelectElement).value; }
  protected asScope(value: string): SettingScope | null { return value === 'global' || value === 'app' || value === 'workspace' ? value : null; }
  protected scopeLabel(scope: SettingScope): string { return this.scopeLabels[scope]; }
  protected effortClass(value: EffortLevel | ''): string {
    const selected = this.currentEffort() === value;
    return `btn join-item btn-xs min-h-7 flex-1 px-1 text-[11px] ${selected ? 'btn-primary' : 'btn-outline border-base-content-muted text-base-content'} ${FOCUS}`;
  }

  async loadModels(): Promise<void> {
    const request = ++this.catalogueRequest, provider = this.driverId();
    this.catalogue.set({ status: 'loading', models: [] });
    try {
      const result = await this.loader.listModels(provider);
      if (request !== this.catalogueRequest) return;
      this.catalogue.set({ status: result.error ? 'error' : 'ready', models: result.models ?? [] });
    } catch {
      if (request === this.catalogueRequest) this.catalogue.set({ status: 'error', models: [] });
    }
  }

  /**
   * Drops the pending change. Its confirm (holding the focused button) leaves the DOM, so focus goes to the
   * provider select: it stays inside the popover, where Esc still closes it.
   */
  protected resetProvider(): void {
    this.providerChoice.set(null);
    this.rescope.set(false);
    this.element.nativeElement.querySelector<HTMLSelectElement>('#main-agent-provider')?.focus();
  }

  /** D6: a confirmed provider change to the "Save to" scope; no Undo. */
  protected async activate(): Promise<void> {
    const pending = this.pendingProvider(), target = this.target(), session = this.session;
    if (!pending || !pending.writable || !target) return;
    await runDrawerWrite(this.contextSource(), (context) => this.state.activateConnection(pending.id, target, context), (outcome) => {
      if (session !== this.session) return;
      this.outcome.set(outcome);
      if (outcome.status === 'saved') this.resetProvider();
    });
    this.refreshContextIfBlocked();
  }

  protected onModel(value: string): void {
    if (value === MANUAL) {
      this.manualDraft.set('');
      this.manual.set(true);
      // The select leaves the DOM; focus the field once it has rendered, so focus (and Esc) stay in the popover.
      afterNextRender(() => this.element.nativeElement.querySelector<HTMLInputElement>('input#main-agent-model')?.focus(),
        { injector: this.injector });
      return;
    }
    void this.saveModel(value);
  }

  protected async applyManual(): Promise<void> {
    const model = this.manualDraft().trim();
    if (!model) return;
    await this.saveModel(model);
    if (this.state.commit().status === 'saved') this.closeManual();
  }

  /** Back to the model search; the ID field leaves the DOM, so focus goes to the search once it has rendered. */
  protected closeManual(): void {
    this.manual.set(false);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLInputElement>('input#main-agent-model')?.focus(),
      { injector: this.injector });
  }

  protected async saveModel(model: string): Promise<void> {
    const previous = this.currentModel(), applyTo = this.target(), context = this.context;
    if (!model || model === previous || !context || !applyTo) return;
    await this.feedback.save({
      label: 'main agent model', scope: applyTo,
      write: () => this.state.saveSettings({ model: { model, applyTo } }, context),
      undo: previous ? () => this.state.saveSettings({ model: { model: previous, applyTo } }, context) : null,
    });
    this.refreshContextIfBlocked();
  }

  protected async saveEffort(effort: EffortLevel | ''): Promise<void> {
    const previous = this.currentEffort(), applyTo = this.target(), context = this.context;
    if (effort === previous || !context || !applyTo) return;
    await this.feedback.save({
      label: 'reasoning effort', scope: applyTo,
      write: () => this.state.saveSettings({ effort: { effort: effort || undefined, applyTo } }, context),
      undo: () => this.state.saveSettings({ effort: { effort: previous || undefined, applyTo } }, context),
    });
    this.refreshContextIfBlocked();
  }

  /** Focuses the deep-linked control once the panel is positioned (the panel takes focus first). */
  protected focusRequested(): void {
    this.fitToViewport();
    const target = this.initialFocus();
    if (target) this.element.nativeElement.querySelector<HTMLElement>(`[data-focus="${target}"]`)?.focus();
  }

  /**
   * Caps the popover at the space between its top edge and the viewport bottom (8 px margin, 10rem minimum), so a
   * state that adds rows (the provider-change confirm, an outcome, the manual model field) scrolls its body instead
   * of running off screen. Runs once the panel is positioned, after each such state change, and on window resize.
   */
  protected fitToViewport(): void {
    const panel = this.element.nativeElement.querySelector<HTMLElement>('[data-testid="main-agent-popover"]');
    const view = this.element.nativeElement.ownerDocument.defaultView;
    if (!panel || !view) return;
    this.maxHeight.set(Math.max(160, Math.floor(view.innerHeight - panel.getBoundingClientRect().top - 8)));
  }

  /** The runner reads `commit()` and the context this popover reviewed against (taken on open). */
  private contextSource() {
    return { reviewContext: () => this.context, commit: this.state.commit };
  }

  /** A write the host refused because the workspace changed: take the new context for the next choice. */
  private refreshContextIfBlocked(): void {
    if (this.state.commit().status === 'blocked') this.context = this.state.reviewContext();
  }
}
