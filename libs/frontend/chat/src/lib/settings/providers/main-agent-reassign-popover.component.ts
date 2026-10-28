import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, effect, inject, input, output,
  signal, untracked,
} from '@angular/core';
import { X, LucideAngularModule } from 'lucide-angular';
import {
  ClaudeAmbientStatusService, ProviderAccountsStateService, ProvidersSettingsStateService, VSCodeService, type ProviderAccountActionOutcome,
  type ProviderAccountChoice, type ProvidersEditContext,
} from '@ptah-extension/core';
import {
  DEFAULT_OVERLAY_OFFSET, NativePopoverComponent, PROVIDER_MODELS_LOADER, ProviderModelSearchFieldComponent, type ProviderModelSearchOption,
} from '@ptah-extension/ui';
import type { EffortLevel, ProviderModelInfo, SettingScope } from '@ptah-extension/shared';
import { SAVE_REFUSED_MESSAGE, SettingsSaveFeedbackService, type SettingsSaveResult } from '../feedback/settings-save-feedback.service';
import { commitToast } from '../feedback/settings-commit-toast';
import { DRAWER_WRITE_NO_CONTEXT, runDrawerWrite, type DrawerWriteOutcome } from './connection-drawer/drawer-write';
import { injectAppScopeName, saveTargetLabels } from './app-scope-label';
import { capPopoverHeight } from './popover-height-cap';
import { SettingsBusyDisabledDirective } from '../feedback/busy-disabled.directive';
import { connectionKind } from './connection-drawer/connection-kind';
import {
  ACCOUNT_COPY, accountChoiceOf, accountSelectorModel, selectionFeedback, type AccountSelectorValue,
} from './accounts/account-presentation';

export type MainAgentFocus = 'main-agent' | 'main-model' | 'main-effort';

/** Route statuses a connection can be made the main agent from (`providers-settings-state.service.ts:72`). */
const ACTIVATABLE: ReadonlySet<string> = new Set(['connected', 'reachable', 'unknown', 'skipped']);
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODALITY: Readonly<Record<string, string>> = {
  apiKey: 'API key', cli: 'CLI login', oauth: 'OAuth', 'local-native': 'Local server', 'local-proxy': 'Local server', custom: 'Custom endpoint',
};
/** Model select value that swaps the select for an inline model-ID field (#35). */
const MANUAL = '__manual__';
const PROVIDER_SAVED = 'Main agent provider saved.';
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
 * The account write Save will make, taken synchronously when Save is clicked (P6-A12): the choice and the revisions it
 * was made against, so a push during the provider write cannot become the write's expected revision.
 */
interface AccountIntent {
  readonly value: AccountSelectorValue;
  readonly choice: ProviderAccountChoice;
  readonly selectionRevision: number;
  readonly profileRevision: number | null;
}

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
    <ptah-native-popover [isOpen]="open()" placement="bottom-start" [hasBackdrop]="true" [keepInViewport]="true" backdropClass="transparent"
      (closed)="cancel()" (opened)="focusRequested()">
      <!-- Zero-size anchor: the host sits at the Main Agent node's bottom-left edge. -->
      <span trigger class="block h-0 w-0" aria-hidden="true"></span>
      <!-- Height capped at the larger free side of its trigger (fitToViewport); only the body scrolls, so the header and the
           Save / Cancel footer stay visible in every state, the provider-change confirm included (Gate V 28). In a
           window too short for that chrome the body keeps 4rem and the whole panel scrolls instead. Header,
           body and footer share one horizontal padding (px-3), so every row starts on the same left edge. -->
      <div content role="dialog" aria-labelledby="main-agent-popover-title" class="flex w-[19rem] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto text-xs"
        [style.max-height.px]="maxHeight()" data-testid="main-agent-popover">
        <!-- min-w-0 throughout so the header shrinks at narrow widths (245 px): the title and the Check label truncate,
             and Close (flex-none) always stays in view. -->
        <div class="flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-base-300 px-3 py-2">
          <h2 id="main-agent-popover-title" class="min-w-0 flex-1 truncate text-xs font-bold text-base-content" title="Reassign main agent">Reassign main agent</h2>
          <div class="-mr-1 flex min-w-0 items-center gap-1">
            <button type="button" [class]="'btn btn-ghost btn-xs min-h-6 min-w-0 flex-nowrap px-1.5 font-medium text-base-content underline ' + focusRing"
              [ptahBusyDisabled]="state.route().status === 'loading'" (click)="state.checkConnection()" data-testid="main-agent-check">
              <span class="truncate">{{ state.route().status === 'loading' ? 'Checking…' : 'Check connection' }}</span>
            </button>
            <button type="button" [class]="'btn btn-ghost btn-xs btn-square min-h-6 flex-none ' + focusRing" aria-label="Close" (click)="cancel()">
              <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="grid min-h-16 grid-cols-1 gap-3 overflow-y-auto px-3 py-3" data-testid="main-agent-popover-body">
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
          </div>

          <!-- Account (P6 MP): the Claude CLI's main-chat account, drafted like the rest and written by Save after the
               provider. Absent outside Electron, before the first list read, and for any other provider. Busy keeps it
               focusable (value changes blocked), so it can take focus back after a refused write (P6-A3). -->
          @if (accountField(); as account) {
            <div class="grid gap-1" data-testid="main-agent-account-field">
              @if (account.stored.kind === 'signed-out') {
                <div class="flex items-center justify-between gap-2">
                  <label for="main-agent-account" [class]="label">Account</label>
                  <button type="button" [class]="'btn btn-link btn-xs h-auto min-h-6 px-0 text-[11px] text-base-content ' + focusRing"
                    [attr.aria-label]="copy.signInSavedAccount" (click)="accountSignInRequested.emit()"
                    data-testid="main-agent-account-sign-in">Sign in</button>
                </div>
              } @else {
                <label for="main-agent-account" [class]="label">Account</label>
              }
              <select id="main-agent-account" [class]="select" [ptahBusyDisabled]="busy()" [title]="accountText()"
                [attr.aria-invalid]="accountRemoved() ? 'true' : null" [attr.aria-describedby]="accountRemoved() ? 'main-agent-account-removed' : null"
                (change)="onAccount($event)" data-testid="main-agent-account">
                @for (option of account.options; track option.value) {
                  <option [value]="option.value" [disabled]="option.disabled" [selected]="option.value === accountValue()">{{ option.label }}</option>
                }
              </select>
              @if (accountRemoved()) {
                <span id="main-agent-account-removed" class="sr-only" data-testid="main-agent-account-removed">{{ copy.removedAccount }}</span>
              }
            </div>
          }

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
  /** The stored main account is signed out: "Sign in" asks the page to open the Claude drawer on Accounts (P6-A10). */
  readonly accountSignInRequested = output<void>();

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
  // Account (P6 MP). Electron only, like the Providers page (D34): elsewhere the services are never injected.
  private readonly accountsAvailable = inject(VSCodeService).isElectron;
  private readonly accounts = this.accountsAvailable ? inject(ProviderAccountsStateService) : null;
  private readonly ambient = this.accountsAvailable ? inject(ClaudeAmbientStatusService) : null;
  protected readonly copy = ACCOUNT_COPY;
  /** The drafted account; `null` = follow the stored value (pushes included). */
  protected readonly accountDraft = signal<AccountSelectorValue | null>(null);
  /**
   * P6-A13: a confirmed account refusal (failed, unavailable or the P6-A12 conflict) locks Save, even with model or
   * effort drafted, until the user picks another enabled account or reopens the popover. Never set by `unconfirmed`.
   */
  protected readonly accountRefused = signal(false);
  /** The stored key the current draft was made against, and whether "Account changed elsewhere" was said for it. */
  private draftBase: string | null = null;
  private elsewhereAnnounced = false;
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
  /** The draft provider is the Claude CLI connection (the same predicate as the card badge). */
  private readonly claudeCliDraft = computed(() => {
    const entry = (this.state.connections().data ?? []).find((connection) => connection.id === this.providerId());
    return !!entry && connectionKind(entry) === 'claude-cli';
  });
  /** The main-scope selector model; `null` outside Electron and before the first account list read. */
  private readonly accountModel = computed(() =>
    this.accounts && this.ambient ? accountSelectorModel(this.accounts.state('claude')(), this.ambient.view(), 'main') : null);
  /** The Account field, when shown: Claude CLI drafted and the model visible (P6-1). */
  protected readonly accountField = computed(() => {
    if (!this.claudeCliDraft()) return null;
    const model = this.accountModel();
    return model?.visible ? model : null;
  });
  /** The value the select shows: an enabled draft, else the stored value. A disabled or `stored` value is never kept. */
  protected readonly accountValue = computed<AccountSelectorValue | null>(() => {
    const model = this.accountModel(), draft = this.accountDraft();
    if (!model) return null;
    return draft !== null && this.enabledOption(draft) ? draft : model.value;
  });
  protected readonly accountText = computed(() => {
    const value = this.accountValue();
    return this.accountField()?.options.find((option) => option.value === value)?.label ?? '';
  });
  /** M4b: the stored account is gone; the select says so and nothing is reassigned (B-1). */
  protected readonly accountRemoved = computed(() => this.accountField()?.stored.kind === 'removed' && this.accountValue() === 'stored');
  /** Identity of the stored main selection, for "Account changed elsewhere" (a sign-in state change is not a change). */
  private readonly storedKey = computed(() => {
    const stored = this.accountModel()?.stored;
    return !stored ? null : stored.kind === 'ambient' ? 'ambient' : `named:${stored.profileId}`;
  });
  protected readonly accountChanged = computed(() => {
    const draft = this.accountDraft();
    return this.accountField() !== null && draft !== null && draft !== this.accountModel()?.value && this.enabledOption(draft)
      && accountChoiceOf(draft) !== null;
  });
  /**
   * Save has something to write, somewhere it may go; `busy` is applied separately (focus stays on the button). A refused
   * account write locks it first (P6-A13). An account-only draft needs no "Save to" target.
   */
  protected readonly saveReady = computed(() => {
    if (this.accountRefused()) return false;
    const pending = this.pendingProvider();
    const dirty = pending !== null || this.modelChanged() || this.effortChanged();
    if (dirty) return this.targetReady() && !this.awaitingConfirm() && (pending?.writable ?? true);
    return this.accountChanged() && !this.awaitingConfirm();
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.session += 1;
        this.context = this.state.reviewContext();
        this.discardDraft();
        this.accountRefused.set(false);
        this.manual.set(false);
        this.outcome.set(null);
        // One list read and one cached ambient read per open (no forced probe).
        void this.accounts?.open('claude');
        void this.ambient?.read(false);
      });
    });
    // Contract 3: a stored account pushed while a draft is held keeps the draft and is said once per draft. Not while a
    // Save runs: its own outcome (or the P6-A12 refusal) speaks for that write.
    effect(() => {
      const key = this.storedKey(), draft = this.accountDraft();
      if (this.saving()) return;
      untracked(() => {
        if (draft === null || key === null || this.elsewhereAnnounced || key === this.draftBase) return;
        this.elsewhereAnnounced = true;
        this.feedback.announce(ACCOUNT_COPY.accountChangedElsewhere, 'status');
      });
    });
    // DOM re-assert (B-1): the select's value is always the shown value, never a disabled or `stored` pick.
    afterRenderEffect(() => {
      const value = this.accountValue();
      if (!this.accountField() || value === null) return;
      untracked(() => this.reassertAccount(value));
    });
    // The draft provider's catalogue, while open; a newer request supersedes an older one.
    effect(() => {
      if (this.open() && this.providerId()) untracked(() => this.loadModels());
    });
    // Re-fit after every state that changes the popover's height (Gate V 28: the confirm ran off screen).
    afterRenderEffect(() => {
      if (!this.open()) return;
      this.pendingProvider(); this.providerConfirmed(); this.manual(); this.catalogue(); this.targetReady();
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

  /** A new enabled account joins the draft (and lifts the P6-A13 lock); a disabled or `stored` pick is undone. */
  protected onAccount(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as AccountSelectorValue;
    const model = this.accountModel();
    if (!model || this.busy() || !this.enabledOption(value) || accountChoiceOf(value) === null) {
      const shown = this.accountValue();
      if (shown !== null) this.reassertAccount(shown);
      return;
    }
    if (value === model.value) {
      this.accountDraft.set(null);
      return;
    }
    this.accountDraft.set(value);
    this.draftBase = this.storedKey();
    this.elsewhereAnnounced = false;
    this.accountRefused.set(false);
  }

  protected onEffort(effort: EffortLevel | ''): void {
    if (this.busy() || !this.targetReady()) return;
    this.effortDraft.set(effort);
  }

  /**
   * Writes the draft: a confirmed provider change first (`activateConnection`, its own outcome, no Undo, D6/D15), then
   * the Claude CLI account (`setSelection`, P6-A2), then the model and effort together (`saveSettings`, with Undo). A step
   * that does not save stops the rest and keeps the popover open with the remaining draft; a fully saved draft closes it.
   * The account intent is taken before the first await and re-checked after the provider write (P6-A12).
   */
  protected async save(): Promise<void> {
    const target = this.target(), pending = this.pendingProvider(), session = this.session;
    const writesSettings = pending !== null || this.modelChanged() || this.effortChanged();
    if (!this.saveReady() || this.busy() || (writesSettings && !target)) return;
    const intent = this.captureAccountIntent();
    const saveButton = this.saveButton();
    const followUp = intent !== null || (target !== null && (this.modelChanged() || this.effortChanged()));
    this.saving.set(true);
    try {
      if (pending && target) {
        await runDrawerWrite(this.contextSource(), (context) => this.state.activateConnection(pending.id, target, context), (outcome) => {
          if (session === this.session) this.outcome.set(outcome);
          // The toast outlives the popover. A saved provider is said by the write that follows it, when one does.
          const said = commitToast(outcome, PROVIDER_SAVED);
          if (said && (said.tone === 'alert' || !followUp)) this.feedback.announce(said.message, said.tone);
        });
        this.refreshContextIfBlocked();
        if (session !== this.session || this.outcome()?.status !== 'saved') return;
        this.providerChoice.set(null);
        this.rescope.set(false);
        this.providerConfirmed.set(false);
      }
      let accountSaved: string | null = null;
      const accounts = this.accounts;
      if (intent && accounts) {
        // A closed or reopened popover drops the intent: nothing more is written.
        const providerSaved = pending !== null;
        if (session !== this.session || !this.open()) {
          if (providerSaved) this.feedback.announce(PROVIDER_SAVED, 'status');
          return;
        }
        // No await between the check and the call: the service's call-time snapshot read is the checked one.
        const outcome: ProviderAccountActionOutcome = !providerSaved || this.intentHolds(intent)
          ? await accounts.setSelection('claude', 'main', intent.choice)
          : { status: 'unavailable' };
        const feedback = selectionFeedback(outcome, 'main', { providerSaved });
        const live = session === this.session && this.open();
        if (outcome.status !== 'saved') {
          // D60: a null feedback shows no toast. The toast outlives the popover, so it announces even when closed.
          if (feedback) this.feedback.announce(feedback.message, feedback.tone);
          if (!live) return;
          this.accountDraft.set(null);
          if (outcome.status === 'unconfirmed') return;
          // Confirmed refusal: P6-A13 lock; P6-A3 focus only when focus is still on Save (the B-2 waiting target).
          const focusWasOnSave = !!saveButton && saveButton.ownerDocument.activeElement === saveButton;
          this.accountRefused.set(true);
          if (focusWasOnSave) {
            afterNextRender(() => this.element.nativeElement.querySelector<HTMLSelectElement>('#main-agent-account')?.focus(),
              { injector: this.injector });
          }
          return;
        }
        if (live) this.accountDraft.set(null);
        if (!live || !(this.modelChanged() || this.effortChanged())) {
          if (feedback) this.feedback.announce(providerSaved ? `${PROVIDER_SAVED} ${feedback.message}` : feedback.message, feedback.tone);
          else if (providerSaved) this.feedback.announce(PROVIDER_SAVED, 'status');
          if (!live) return;
        } else {
          accountSaved = feedback?.message ?? null;
        }
      }
      if (target && (this.modelChanged() || this.effortChanged())) {
        const result = await this.saveModelAndEffort(target, accountSaved, pending !== null);
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
   * Caps the popover at the larger free side of the popover's trigger (less the overlay offset, the panel's own
   * padding and an 8 px margin), so a state that adds rows (the provider-change confirm, an outcome,
   * the manual model field) scrolls its body instead of running off screen. The cap is measured from the trigger,
   * not from the panel: Floating UI flips a panel taller than the space below it above the trigger, where a cap taken
   * from the panel's own (flipped) top edge never bound it and it ran off the top of the viewport. Capped to one
   * side, the panel fits there, so the flip settles on it. In a window too short for the header and footer the
   * panel scrolls whole; `capPopoverHeight` keeps a usable floor, so the cap is never zero or NaN, and clamps it so
   * the whole panel fits inside the viewport's 8 px edges, where `keepInViewport` shifts it. Runs once the panel
   * is positioned, after each such state change, and on window resize.
   */
  protected fitToViewport(): void {
    const host = this.element.nativeElement;
    const trigger = host.querySelector<HTMLElement>('.popover-trigger');
    const panel = host.querySelector<HTMLElement>('[data-testid="main-agent-popover"]');
    const view = host.ownerDocument.defaultView;
    if (!trigger || !panel || !view) return;
    const { top, bottom } = trigger.getBoundingClientRect();
    const frame = panel.closest<HTMLElement>('.popover-panel');
    const chrome = frame ? frame.offsetHeight - panel.offsetHeight : 0;
    const reserve = DEFAULT_OVERLAY_OFFSET + chrome + 8;
    this.maxHeight.set(capPopoverHeight(Math.max(view.innerHeight - bottom, top) - reserve, view.innerHeight - chrome - 16));
  }

  /** The drafted model and effort in one write; Undo writes the stored values back (none when no model was stored). */
  private async saveModelAndEffort(applyTo: SettingScope, accountSaved: string | null, providerSaved: boolean): Promise<SettingsSaveResult | null> {
    const context = this.context;
    const model = this.modelChanged() ? this.selectedModel() : null;
    const effort = this.effortChanged() ? this.selectedEffort() : null;
    const previousModel = this.currentModel(), previousEffort = this.currentEffort();
    const label = model !== null && effort !== null ? 'main agent model and reasoning effort' : model !== null ? 'main agent model' : 'reasoning effort';
    if (!context) {
      if (providerSaved) this.announceProviderSavedWith(`Could not save ${label}. ${DRAWER_WRITE_NO_CONTEXT}`);
      return null;
    }
    const result = await this.feedback.save({
      label, scope: applyTo,
      // P6-A2: a saved account rides on this toast, so its Undo (model and effort only) survives.
      // A provider saved just before rides on it too (its own inline outcome moved to the toast).
      ...(accountSaved || providerSaved ? {
        successMessage: [providerSaved ? PROVIDER_SAVED : '', `Saved ${label} to ${this.scopeLabels[applyTo]}.`, accountSaved ? `${accountSaved}.` : '']
          .filter(Boolean).join(' '),
      } : {}),
      write: () => this.state.saveSettings(this.patch(model, effort, applyTo), context),
      undo: model !== null && !previousModel ? null
        : () => this.state.saveSettings(this.patch(model !== null ? previousModel : null, effort !== null ? previousEffort : null, applyTo), context),
    });
    this.refreshContextIfBlocked();
    if (providerSaved && result === 'failed') this.announceProviderSavedWith(this.feedback.toast()?.message ?? `Could not save ${label}.`);
    else if (providerSaved && result === 'refused') this.announceProviderSavedWith(`Could not save ${label}. ${SAVE_REFUSED_MESSAGE}`);
    return result;
  }

  /**
   * The model/effort step did not save, but the provider write of the same Save did (its toast was held back for this
   * one): one alert names both, so the failure never hides that the provider changed.
   */
  private announceProviderSavedWith(failure: string): void {
    this.feedback.announce(`${PROVIDER_SAVED} ${failure}`, 'alert');
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
    this.accountDraft.set(null);
    this.draftBase = null;
    this.elsewhereAnnounced = false;
  }

  private enabledOption(value: AccountSelectorValue): boolean {
    return this.accountModel()?.options.some((option) => option.value === value && !option.disabled) ?? false;
  }

  private reassertAccount(value: AccountSelectorValue): void {
    const select = this.element.nativeElement.querySelector<HTMLSelectElement>('#main-agent-account');
    if (select && select.value !== value) select.value = value;
  }

  private saveButton(): HTMLButtonElement | null {
    return this.element.nativeElement.querySelector<HTMLButtonElement>('[data-testid="main-agent-save"]');
  }

  /** P6-A12: the account write and the revisions it is made against, taken at the Save click. */
  private captureAccountIntent(): AccountIntent | null {
    const value = this.accountDraft();
    if (!this.accounts || value === null || !this.accountChanged()) return null;
    const choice = accountChoiceOf(value), snapshot = this.accounts.state('claude')().snapshot;
    if (!choice || !snapshot) return null;
    const profile = choice.kind === 'named' ? snapshot.accounts.find((account) => account.profileId === choice.profileId) : null;
    if (choice.kind === 'named' && !profile) return null;
    return { value, choice, selectionRevision: snapshot.selections.main.revision, profileRevision: profile?.revision ?? null };
  }

  /** After the provider write: unchanged scope and profile revisions, and still an enabled option (P6-A12). */
  private intentHolds(intent: AccountIntent): boolean {
    const snapshot = this.accounts?.state('claude')().snapshot;
    if (!snapshot || snapshot.selections.main.revision !== intent.selectionRevision) return false;
    if (intent.choice.kind === 'named') {
      const profileId = intent.choice.profileId;
      const profile = snapshot.accounts.find((account) => account.profileId === profileId);
      if (!profile || profile.revision !== intent.profileRevision) return false;
    }
    return this.enabledOption(intent.value);
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
