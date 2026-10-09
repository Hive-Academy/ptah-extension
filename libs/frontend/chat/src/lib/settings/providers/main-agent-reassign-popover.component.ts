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
import { SettingsSaveFeedbackService, type SettingsSaveResult } from '../feedback/settings-save-feedback.service';
import { runDrawerWrite, type DrawerWriteOutcome } from './connection-drawer/drawer-write';
import { injectAppScopeName, saveTargetLabels } from './app-scope-label';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';

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
/** The disabled Save keeps a visible shape and a muted, readable label (native `disabled` semantics unchanged). */
const SAVE_DISABLED = 'disabled:border-base-content-muted disabled:bg-base-200 disabled:text-base-content-muted';
/** Every field's label: one style, always above its control. */
const LABEL = 'block text-[11px] font-semibold text-base-content-muted';

interface ModelCatalogue {
  readonly status: 'loading' | 'ready' | 'error';
  readonly models: readonly ProviderModelInfo[];
}

type MainAgentPatch = Parameters<ProvidersSettingsStateService['saveSettings']>[0];

/**
 * Main Agent popover (plan :596-609, design-spec §2.1, prototype `#popoverMainAgent`), opened from the
 * routing map's Main Agent node or a `main-*` deep link. It is the one place the main agent is changed (the card's
 * "Use for main agent" was removed at Gate V 28, as in the prototype). One column, every label above its control:
 * header, Provider connection, Model selection, Reasoning effort, Save to, then a Save / Cancel footer.
 *
 * Explicit save (Batch 4, TASK_PROVIDER_SCOPE): nothing is written until **Save**. Provider, model, effort and
 * "Save to" choices are a local draft taken against the values read on open; **Cancel** (and Esc / ×) discards it.
 * Save is disabled while the draft equals the stored values, while a save runs, and while a provider change waits for
 * its confirm.
 * - **Provider** (D6): choosing another connection shows the inline confirm ("… ends running chat sessions in this
 *   workspace." / "… in every workspace." by "Save to" scope). "Use for main agent" accepts the change into the draft
 *   (changing "Save to" asks again); "Cancel provider change" drops it. "Save provider to {scope}…" re-saves the
 *   current provider there through the same confirm (RUX-5). On Save the provider is written first, through
 *   `activateConnection` and `runDrawerWrite` (its own outcome, no Undo, D15); the model and effort follow only when
 *   it saved.
 * - **Model** (the compact searchable `ProviderModelSearchFieldComponent` over the draft provider's catalogue, loaded
 *   through the page's `PROVIDER_MODELS_LOADER`, with the tool-use marker; "Enter a model ID…" always last, for an
 *   unlisted one) and **Effort** (segmented group) are written by Save in one `state.saveSettings` call through
 *   `SettingsSaveFeedbackService`, with Undo (D2).
 * A fully saved draft closes the popover. A write the host blocks because the workspace changed refreshes the edit
 * context, so the popover stays open with the draft kept and the next Save is made against the new context.
 */
@Component({
  selector: 'ptah-main-agent-reassign-popover',
  standalone: true,
  imports: [SettingsBusyDisabledDirective, LucideAngularModule, NativePopoverComponent, ProviderModelSearchFieldComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Angular owns (and removes) this listener with the component.
  host: { '(window:resize)': 'open() && fitToViewport()' },
  template: `
    <ptah-native-popover [isOpen]="open()" placement="bottom-start" [hasBackdrop]="true" backdropClass="transparent"
      (closed)="cancel()" (opened)="focusRequested()">
      <!-- Zero-size anchor: the host sits at the Main Agent node's bottom-left edge. -->
      <span trigger class="block h-0 w-0" aria-hidden="true"></span>
      <!-- Height capped at the space below its top edge (fitToViewport); only the body scrolls, so the header and the
           Save / Cancel footer stay visible in every state, the provider-change confirm included (Gate V 28). Header,
           body and footer share one horizontal padding (px-3), so every row starts on the same left edge. -->
      <div content role="dialog" aria-labelledby="main-agent-popover-title" class="flex w-[19rem] max-w-[calc(100vw-2rem)] flex-col text-xs"
        [style.max-height.px]="maxHeight()" data-testid="main-agent-popover">
        <div class="flex shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
          <h2 id="main-agent-popover-title" class="text-xs font-bold text-base-content">Reassign main agent</h2>
          <div class="-mr-1 flex items-center gap-1">
            <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 px-1.5 font-medium text-base-content underline ' + focusRing"
              [ptahBusyDisabled]="state.route().status === 'loading'" (click)="state.checkConnection()" data-testid="main-agent-check">
              {{ state.route().status === 'loading' ? 'Checking…' : 'Check connection' }}
            </button>
            <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 ' + focusRing" aria-label="Close" (click)="cancel()">
              <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="grid min-h-0 grid-cols-1 gap-3 overflow-y-auto px-3 py-3" data-testid="main-agent-popover-body">
          <div class="grid gap-1">
            <label for="main-agent-provider" [class]="label">Provider connection</label>
            <select id="main-agent-provider" [class]="select" data-focus="main-agent" [disabled]="busy()"
              (change)="onProvider(value($event))" data-testid="main-agent-provider">
              @if (!driverId()) { <option value="" [selected]="!providerId()">Choose a provider…</option> }
              @for (option of providers(); track option.id) {
                <option [value]="option.id" [selected]="option.id === providerId()">{{ option.label }}</option>
              }
            </select>
            @if (rescopeOffer(); as scope) {
              <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 justify-self-start px-0 text-base-content ' + focusRing"
                [disabled]="busy()" (click)="requestRescope()" data-testid="main-agent-provider-rescope">Save provider to {{ scope }}…</button>
            }
            @if (pendingProvider(); as pending) {
              <div role="group" aria-label="Confirm main provider change" class="space-y-1.5 rounded border border-base-300 bg-base-200 p-2"
                data-testid="main-agent-provider-confirm">
                <p class="text-base-content" data-testid="main-agent-provider-copy">{{ pending.copy }}</p>
                <p class="text-base-content-muted">{{ pending.scope ? 'Saved to: ' + pending.scope + '.' : 'Where to save is not loaded yet.' }}</p>
                @if (pending.uncheckable) {
                  <p class="text-base-content-muted" data-testid="activation-unchecked-note">Ptah cannot check this connection before use. If new requests fail, check that {{ pending.name }} is running and reachable.</p>
                }
                @if (providerConfirmed()) {
                  <p role="status" class="font-semibold text-base-content" data-testid="main-agent-provider-confirmed">Confirmed. Applied when you press Save.</p>
                }
                <div class="flex flex-wrap gap-1.5">
                  @if (!providerConfirmed()) {
                    <button type="button" [class]="'btn btn-primary btn-xs min-h-6 ' + focusRing" [ptahBusyDisabled]="busy() || !pending.writable"
                      (click)="confirmProvider()">Use for main agent</button>
                  }
                  <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 text-base-content ' + focusRing" [disabled]="busy()" (click)="resetProvider()">Cancel provider change</button>
                </div>
              </div>
            }
            @if (providerOutcome(); as outcome) {
              <p [attr.role]="outcome.alert ? 'alert' : 'status'" class="text-base-content" data-testid="main-agent-provider-outcome">{{ outcome.text }}</p>
            }
          </div>

          <div class="grid gap-1" data-focus="main-model" tabindex="-1">
            <label for="main-agent-model" [class]="label">Model selection</label>
            @if (manual()) {
              <div class="flex items-center gap-1.5">
                <input id="main-agent-model" type="text" [class]="'input input-bordered input-sm min-h-8 min-w-0 flex-1 font-mono text-xs ' + focusRing"
                  placeholder="Model ID, e.g. vendor/model-name" [value]="manualDraft()" (input)="manualDraft.set(value($event))"
                  aria-label="Main agent model ID" data-testid="main-agent-model-manual" />
                <button type="button" [class]="'btn btn-outline btn-xs min-h-8 text-base-content ' + focusRing" [ptahBusyDisabled]="busy() || !targetReady() || !manualDraft().trim()"
                  (click)="applyManual()">Use</button>
                <button type="button" [class]="'btn btn-ghost btn-xs min-h-8 text-base-content ' + focusRing" (click)="closeManual()">Cancel</button>
              </div>
            } @else {
              <!-- Batch 28b: the compact searchable model control (ui barrel), filtering the popover's own options. Its list
                   is position:fixed (Floating UI), so the body's scroll box never clips it; Esc closes the list first. -->
              <ptah-provider-model-search-field data-testid="main-agent-model" inputId="main-agent-model" ariaLabel="Main agent model"
                [options]="searchOptions()" [selectedId]="selectedModel()" [includeDefault]="!selectedModel()"
                [defaultLabel]="catalogue().status === 'loading' ? 'Loading models…' : defaultModelLabel()" [pinnedOption]="manualOption"
                [disabled]="busy() || !targetReady() || !providerId() || catalogue().status === 'loading'" (modelSelected)="onModel($event)" />
            }
            @if (catalogue().status === 'error') {
              <p role="alert" class="flex items-center gap-1.5 text-base-content" data-testid="main-agent-model-error">
                Could not load the model list.
                <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-base-content ' + focusRing" (click)="loadModels()">Retry</button>
              </p>
            }
          </div>

          <div class="grid gap-1">
            <span id="main-agent-effort-label" [class]="label">Reasoning effort</span>
            <!-- Six toggle buttons in a 3 x 2 grid with gaps, the full width of the selects: every label stays legible. -->
            <div class="grid w-full grid-cols-3 gap-1.5" role="group" aria-labelledby="main-agent-effort-label" data-focus="main-effort" tabindex="-1"
              data-testid="main-agent-effort">
              @for (level of efforts; track level.value) {
                <button type="button" [class]="effortClass(level.value)" [attr.aria-pressed]="selectedEffort() === level.value"
                  [ptahBusyDisabled]="busy() || !targetReady()" (click)="onEffort(level.value)" [attr.data-effort]="level.value || 'default'">{{ level.label }}</button>
              }
            </div>
          </div>

          <div class="grid gap-1">
            <label for="main-agent-save-to" [class]="label">Save to</label>
            <select id="main-agent-save-to" [class]="select" [disabled]="busy() || !targetReady()"
              (change)="onTarget(asScope(value($event)))" data-testid="main-agent-save-to">
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

        <!-- The model-ID field has its own Use / Cancel; the popover's Save / Cancel return once it closes. -->
        @if (!manual()) {
          <div class="grid shrink-0 gap-1.5 border-t border-base-300 px-3 py-2.5" data-testid="main-agent-footer">
            @if (awaitingConfirm()) {
              <p id="main-agent-save-hint" role="status" class="text-base-content-muted" data-testid="main-agent-save-hint">
                Confirm or cancel the provider change to save.</p>
            }
            <div class="flex items-center justify-end gap-2">
              <button type="button" [class]="'btn btn-ghost btn-sm min-h-8 text-base-content ' + focusRing" (click)="cancel()"
                data-testid="main-agent-cancel">Cancel</button>
              <!-- Natively disabled while nothing can be saved; the disabled: utilities keep its outline and label legible in
                   both themes (daisyUI's own disabled button nearly vanishes on the popover's base-100). -->
              <button type="button" [class]="'btn btn-primary btn-sm min-h-8 ' + saveDisabledLook + ' ' + focusRing" [disabled]="!saveReady()"
                [ptahBusyDisabled]="busy()" [attr.aria-describedby]="awaitingConfirm() ? 'main-agent-save-hint' : null"
                (click)="save()" data-testid="main-agent-save">{{ saving() ? 'Saving…' : 'Save' }}</button>
            </div>
          </div>
        }
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
  protected readonly label = LABEL;
  protected readonly focusRing = FOCUS;
  protected readonly saveDisabledLook = SAVE_DISABLED;
  /** #35: always the last row of the model list, never filtered out; choosing it swaps in the model-ID field. */
  protected readonly manualOption: ProviderModelSearchOption = { id: MANUAL, name: 'Enter a model ID…', supportsToolUse: null };
  protected readonly efforts: readonly { value: EffortLevel | ''; label: string }[] = [
    { value: '', label: 'default' }, ...EFFORT_LEVELS.map((value) => ({ value, label: value })),
  ];

  readonly open = input(false);
  /** Deep-linked control to focus once open. */
  readonly initialFocus = input<MainAgentFocus | null>(null);
  readonly closed = output<void>();

  // The draft: nothing below is written before Save.
  protected readonly providerChoice = signal<string | null>(null);
  /** The user asked to re-save the CURRENT provider to the "Save to" scope. */
  protected readonly rescope = signal(false);
  /** The pending provider change was accepted in its D6 confirm ("Use for main agent"). */
  protected readonly providerConfirmed = signal(false);
  protected readonly targetChoice = signal<SettingScope | null>(null);
  /** The drafted model id; `null` = keep the stored one. */
  protected readonly modelDraft = signal<string | null>(null);
  /** The drafted effort (`''` = default); `null` = keep the stored one. */
  protected readonly effortDraft = signal<EffortLevel | '' | null>(null);

  protected readonly manual = signal(false);
  protected readonly manualDraft = signal('');
  protected readonly catalogue = signal<ModelCatalogue>({ status: 'loading', models: [] });
  private readonly outcome = signal<DrawerWriteOutcome | null>(null);
  /** A Save is running (provider, then model and effort). */
  protected readonly saving = signal(false);
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
   * The chosen "Save to" scope, else this workspace when one is open, else the model's source, else the first
   * offered target. `writeScopes` offers `workspace` only while a workspace is active, so a folder with no
   * override yet does not default to Global. `null` while no target is offered (sources loading or failed):
   * never a scope `writeScopes` did not offer (M1, Providers 21-28 review).
   */
  protected readonly target = computed<SettingScope | null>(() => {
    const chosen = this.targetChoice(), targets = this.targets();
    if (chosen && targets.includes(chosen)) return chosen;
    if (targets.includes('workspace')) return 'workspace';
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
    const ends = target === 'workspace' ? 'ends running chat sessions in this workspace.' : 'ends running chat sessions in every workspace.';
    return {
      id, name, uncheckable: option?.uncheckable ?? false, scope: target ? this.scopeLabels[target] : null,
      writable: target !== null && this.providerTargets().includes(target),
      copy: changing ? `New main-agent requests use ${name}. Changing the provider ${ends}`
        : `New main-agent requests keep using ${name}. Saving the provider ${ends}`,
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
  protected readonly selectedModel = computed(() => this.modelDraft() ?? this.currentModel());
  protected readonly defaultModelLabel = computed(() =>
    this.state.route().data?.resolvedModel.kind === 'unresolved' ? 'Default (chosen by Claude)' : 'Provider default');
  /** Catalogue models with the tool-use marker; a selected model the catalogue lacks stays listed. */
  protected readonly modelOptions = computed(() => {
    const models = this.catalogue().models.map((model) => ({
      id: model.id, label: `${model.name || model.id} [Tool: ${model.supportsToolUse ? 'Yes' : 'No'}]`,
    }));
    const selected = this.selectedModel();
    return selected && !models.some((model) => model.id === selected)
      ? [{ id: selected, label: `${selected} · not in current catalog` }, ...models] : models;
  });
  /**
   * `modelOptions` as the compact field's options. The "[Tool: Yes|No]" marker is part of every label, so the field's
   * own "Tool use" badge is left off (`supportsToolUse: null`) rather than shown twice.
   */
  protected readonly searchOptions = computed<readonly ProviderModelSearchOption[]>(() =>
    this.modelOptions().map((option) => ({ id: option.id, name: option.label, supportsToolUse: null })));
  protected readonly currentEffort = computed<EffortLevel | ''>(() => (this.state.effort().data?.effort as EffortLevel | undefined) ?? '');
  protected readonly selectedEffort = computed<EffortLevel | ''>(() => this.effortDraft() ?? this.currentEffort());

  private readonly modelChanged = computed(() => !!this.selectedModel() && this.selectedModel() !== this.currentModel());
  private readonly effortChanged = computed(() => this.selectedEffort() !== this.currentEffort());
  /** A provider change (or re-save) is drafted but its D6 confirm has not been accepted. */
  protected readonly awaitingConfirm = computed(() => this.pendingProvider() !== null && !this.providerConfirmed());
  /** Triggers wait while any save runs (D3). */
  protected readonly busy = computed(() => this.saving() || this.feedback.saving() || this.outcome()?.status === 'saving');
  /** Save has something to write, somewhere it may go; `busy` is applied separately (focus stays on the button). */
  protected readonly saveReady = computed(() => {
    const pending = this.pendingProvider();
    const dirty = pending !== null || this.modelChanged() || this.effortChanged();
    return dirty && this.targetReady() && !this.awaitingConfirm() && (pending?.writable ?? true);
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.session += 1;
        this.context = this.state.reviewContext();
        this.discardDraft();
        this.manual.set(false);
        this.outcome.set(null);
      });
    });
    // The draft provider's catalogue, while open; a newer request supersedes an older one.
    effect(() => {
      if (this.open() && this.providerId()) untracked(() => this.loadModels());
    });
    // Re-fit after every state that changes the popover's height (Gate V 28: the confirm ran off screen).
    afterRenderEffect(() => {
      if (!this.open()) return;
      this.pendingProvider(); this.providerConfirmed(); this.providerOutcome(); this.manual(); this.catalogue(); this.targetReady();
      untracked(() => this.fitToViewport());
    });
  }

  protected value(event: Event): string { return (event.target as HTMLSelectElement).value; }
  protected asScope(value: string): SettingScope | null { return value === 'global' || value === 'app' || value === 'workspace' ? value : null; }
  protected scopeLabel(scope: SettingScope): string { return this.scopeLabels[scope]; }
  protected effortClass(value: EffortLevel | ''): string {
    const selected = this.selectedEffort() === value;
    return `btn btn-xs min-h-7 w-full px-1 text-[11px] font-medium ${selected ? 'btn-primary' : 'btn-outline border-base-content-muted text-base-content'} ${FOCUS}`;
  }

  async loadModels(): Promise<void> {
    const request = ++this.catalogueRequest, provider = this.providerId();
    this.catalogue.set({ status: 'loading', models: [] });
    try {
      const result = await this.loader.listModels(provider);
      if (request !== this.catalogueRequest) return;
      this.catalogue.set({ status: result.error ? 'error' : 'ready', models: result.models ?? [] });
    } catch {
      if (request === this.catalogueRequest) this.catalogue.set({ status: 'error', models: [] });
    }
  }

  /** Another provider in the draft; a model drafted from the previous provider's catalogue is dropped with it. */
  protected onProvider(id: string): void {
    if (id !== this.providerId()) this.modelDraft.set(null);
    this.providerChoice.set(id || null);
    this.providerConfirmed.set(false);
  }

  protected requestRescope(): void {
    this.rescope.set(true);
    this.providerConfirmed.set(false);
  }

  /** A new "Save to" changes what the D6 copy promises, so an accepted provider change is asked again. */
  protected onTarget(scope: SettingScope | null): void {
    this.targetChoice.set(scope);
    this.providerConfirmed.set(false);
  }

  /** D6 accepted: the provider change joins the draft. Its button leaves the DOM, so focus goes to Save. */
  protected confirmProvider(): void {
    const pending = this.pendingProvider();
    if (!pending || !pending.writable || this.busy()) return;
    this.providerConfirmed.set(true);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLButtonElement>('[data-testid="main-agent-save"]')?.focus(),
      { injector: this.injector });
  }

  /**
   * Drops the pending provider change (and a model drafted for it). Its confirm (holding the focused button) leaves
   * the DOM, so focus goes to the provider select: it stays inside the popover, where Esc still closes it.
   */
  protected resetProvider(): void {
    if (this.providerChoice() !== null && this.providerChoice() !== this.driverId()) this.modelDraft.set(null);
    this.providerChoice.set(null);
    this.rescope.set(false);
    this.providerConfirmed.set(false);
    this.element.nativeElement.querySelector<HTMLSelectElement>('#main-agent-provider')?.focus();
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
    this.modelDraft.set(value || null);
  }

  /** The typed id joins the draft; nothing is written until Save. */
  protected applyManual(): void {
    const model = this.manualDraft().trim();
    if (!model || this.busy()) return;
    this.modelDraft.set(model);
    this.closeManual();
  }

  /** Back to the model search; the ID field leaves the DOM, so focus goes to the search once it has rendered. */
  protected closeManual(): void {
    this.manual.set(false);
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLInputElement>('input#main-agent-model')?.focus(),
      { injector: this.injector });
  }

  protected onEffort(effort: EffortLevel | ''): void {
    if (this.busy() || !this.targetReady()) return;
    this.effortDraft.set(effort);
  }

  /**
   * Writes the draft to "Save to": a confirmed provider change first (`activateConnection`, its own outcome, no Undo,
   * D6/D15), then the model and effort together (`saveSettings`, with Undo). A step that does not save stops the rest
   * and keeps the popover open with the remaining draft; a fully saved draft closes it.
   */
  protected async save(): Promise<void> {
    const target = this.target(), pending = this.pendingProvider(), session = this.session;
    if (!this.saveReady() || this.busy() || !target) return;
    this.saving.set(true);
    try {
      if (pending) {
        await runDrawerWrite(this.contextSource(), (context) => this.state.activateConnection(pending.id, target, context), (outcome) => {
          if (session === this.session) this.outcome.set(outcome);
        });
        this.refreshContextIfBlocked();
        if (session !== this.session || this.outcome()?.status !== 'saved') return;
        this.providerChoice.set(null);
        this.rescope.set(false);
        this.providerConfirmed.set(false);
      }
      if (this.modelChanged() || this.effortChanged()) {
        const result = await this.saveModelAndEffort(target);
        if (session !== this.session || result !== 'saved') return;
        this.modelDraft.set(null);
        this.effortDraft.set(null);
      }
      if (session === this.session) this.closed.emit();
    } finally {
      this.saving.set(false);
    }
  }

  /** Cancel, ×, Esc and the backdrop: the draft is discarded, nothing is written. */
  protected cancel(): void {
    this.discardDraft();
    this.closed.emit();
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

  /** The drafted model and effort in one write; Undo writes the stored values back (none when no model was stored). */
  private async saveModelAndEffort(applyTo: SettingScope): Promise<SettingsSaveResult | null> {
    const context = this.context;
    if (!context) return null;
    const model = this.modelChanged() ? this.selectedModel() : null;
    const effort = this.effortChanged() ? this.selectedEffort() : null;
    const previousModel = this.currentModel(), previousEffort = this.currentEffort();
    const label = model !== null && effort !== null ? 'main agent model and reasoning effort' : model !== null ? 'main agent model' : 'reasoning effort';
    const result = await this.feedback.save({
      label, scope: applyTo,
      write: () => this.state.saveSettings(this.patch(model, effort, applyTo), context),
      undo: model !== null && !previousModel ? null
        : () => this.state.saveSettings(this.patch(model !== null ? previousModel : null, effort !== null ? previousEffort : null, applyTo), context),
    });
    this.refreshContextIfBlocked();
    return result;
  }

  private patch(model: string | null, effort: EffortLevel | '' | null, applyTo: SettingScope): MainAgentPatch {
    return {
      ...(model !== null ? { model: { model, applyTo } } : {}),
      ...(effort !== null ? { effort: { effort: effort || undefined, applyTo } } : {}),
    };
  }

  private discardDraft(): void {
    this.providerChoice.set(null);
    this.rescope.set(false);
    this.providerConfirmed.set(false);
    this.targetChoice.set(null);
    this.modelDraft.set(null);
    this.effortDraft.set(null);
  }

  /** The runner reads `commit()` and the context this popover reviewed against (taken on open). */
  private contextSource() {
    return { reviewContext: () => this.context, commit: this.state.commit };
  }

  /** A write the host refused because the workspace changed: take the new context for the next Save. */
  private refreshContextIfBlocked(): void {
    if (this.state.commit().status === 'blocked') this.context = this.state.reviewContext();
  }
}
