import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, AlertTriangle, Clock } from 'lucide-angular';
import {
  NativeCardComponent,
  ProviderModelPickerComponent,
  type ProviderIdentityOption,
  type ProviderModelSelection,
} from '@ptah-extension/ui';
import {
  getAnthropicProvider,
  type ProviderModelTier,
  type SkillLaneIdDto,
} from '@ptah-extension/shared';
import {
  ProvidersSettingsStateService,
  type ProvidersEditContext,
  type ProvidersSettingsPatch,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import {
  SettingScopeRowComponent,
  type SettingScopeDisplay,
} from './setting-scope-row.component';

/** The six canonical background-consumer rows in fixed order. */
export type BackgroundConsumerId =
  | 'memory-curator'
  | 'archaeologist'
  | 'synthesis'
  | 'judge'
  | 'replay'
  | 'judging-enhancement';

/**
 * Translates stored model value to the picker sentinel.
 * model-resolver.ts:171 recognizes 'inherit' as the workspace default.
 * ProviderModelPickerComponent emits '' for that same sentinel.
 */
export function toPickerModel(model: string | undefined | null): string {
  return !model || model === 'inherit' ? '' : model;
}

/**
 * Translates picker selection to the backend stored model value.
 * ProviderModelPickerComponent emits '' for inherit.
 * resolveJudgeModel requires the literal 'inherit'.
 */
export function toBackendJudgeModel(model: string | undefined | null): string {
  return !model || model.trim() === '' ? 'inherit' : model.trim();
}

/** Human-readable provider name, falling back gracefully for custom/unregistered IDs. */
export function formatProviderDisplayName(id: string): string {
  const meta = getAnthropicProvider(id);
  if (meta?.name) return meta.name;
  if (id.toLowerCase() === 'openai') return 'OpenAI';
  return id;
}

/** One background-consumer row descriptor for view rendering. */
export interface BackgroundConsumerRow {
  readonly id: BackgroundConsumerId;
  readonly name: string;
  readonly helperCopy: string | null;
  readonly defaultTier: ProviderModelTier;
  readonly requiresToolUse: boolean;
  readonly provider: string;
  readonly model: string;
  readonly resolvedSummary: string;
  readonly providerFieldName: string;
  readonly modelFieldName: string;
  readonly providerScope: SettingScopeDisplay | null;
  readonly modelScope: SettingScopeDisplay | null;
  /** Status of the section this row reads from, as the state service reports it. */
  readonly sectionStatus: 'unloaded' | 'loading' | 'ready' | 'error';
  /**
   * True only when the backend returned data. `null` data means the section
   * has not loaded — an empty collection is a successful empty read. The row
   * renders a not-loaded state with its own retry until this is true.
   */
  readonly loaded: boolean;
  /** Which state-service section a retry re-reads. */
  readonly retryKey: 'memory' | 'lanes' | 'judging';
}

const JUDGING_HELPER_COPY =
  'Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.';

function makeRow(
  id: BackgroundConsumerId,
  name: string,
  helperCopy: string | null,
  tier: ProviderModelTier,
  toolUse: boolean,
  provider: string,
  model: string,
  providerKey: string,
  modelKey: string,
  state: ProvidersSettingsStateService,
  summary: string,
  section: ProvidersSettingsSection<unknown>,
  retryKey: BackgroundConsumerRow['retryKey'],
): BackgroundConsumerRow {
  return {
    id,
    name,
    helperCopy,
    defaultTier: tier,
    requiresToolUse: toolUse,
    provider,
    model,
    resolvedSummary: summary,
    providerFieldName: `${name} provider`,
    modelFieldName: `${name} model`,
    // Provenance not known renders as Mixed sources (Decision 6); never a
    // guessed 'global' source badge.
    providerScope: state.scopeEntry(providerKey)?.scope ?? 'mixed',
    modelScope: state.scopeEntry(modelKey)?.scope ?? 'mixed',
    sectionStatus: section.status,
    loaded: section.data !== null,
    retryKey,
  };
}

/**
 * Background consumer model assignments component.
 *
 * Governs the six background-consumer rows in fixed order:
 * 1. Memory curator, 2. Archaeologist lane, 3. Synthesis lane,
 * 4. Judge lane, 5. Replay lane, 6. Judging & enhancement.
 * Plus Enhancement time limit beneath Judging & enhancement.
 */
@Component({
  selector: 'ptah-provider-consumer-assignments',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativeCardComponent,
    ProviderModelPickerComponent,
    SettingScopeRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-4" data-testid="provider-consumer-assignments">
      <header class="space-y-1">
        <h2 class="text-sm font-semibold text-base-content" data-testid="assignments-heading">
          Background models
        </h2>
        <p class="text-xs text-base-content-muted" data-testid="assignments-copy">
          These assignments run background work. They do not select the main agent.
        </p>
      </header>

      <div class="space-y-3">
        @for (row of rows(); track row.id) {
          <ptah-native-card
            [density]="'compact'"
            [tone]="'neutral'"
            [spine]="false"
            [clickable]="false"
            [attr.data-testid]="'consumer-row-' + row.id"
          >
            <div class="flex flex-col gap-3">
              <!-- Header line: Consumer name, summary, and Edit button -->
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div class="min-w-0 space-y-1">
                  <h3 class="text-sm font-semibold text-base-content" [attr.data-testid]="'consumer-name-' + row.id">
                    {{ row.name }}
                  </h3>
                  @if (row.helperCopy) {
                    <p class="text-xs text-base-content-muted" [attr.data-testid]="'consumer-helper-' + row.id">
                      {{ row.helperCopy }}
                    </p>
                  }
                  @if (row.loaded) {
                    <p class="text-xs text-base-content break-all" [attr.data-testid]="'consumer-summary-' + row.id">
                      {{ row.resolvedSummary }}
                    </p>
                  }
                </div>

                <div class="shrink-0 flex items-center gap-2">
                  @if (row.loaded && activeEditId() === row.id) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [disabled]="isCommitting() || disabled()"
                      [attr.aria-label]="'Cancel editing ' + row.name"
                      (click)="cancelEdit()"
                      [attr.data-testid]="'consumer-cancel-' + row.id"
                    >Cancel</button>
                  } @else if (row.loaded) {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [disabled]="isCommitting() || disabled()"
                      [attr.aria-label]="'Edit ' + row.name"
                      (click)="toggleEdit(row.id)"
                      [attr.data-testid]="'consumer-edit-' + row.id"
                    >Edit</button>
                  }
                </div>
              </div>

              <!-- Not-loaded state: the section has no data yet. No effective values render. -->
              @if (!row.loaded) {
                <div
                  class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-base-100 p-2 text-xs"
                  [attr.data-testid]="'consumer-notloaded-' + row.id"
                >
                  <span class="text-base-content" [attr.data-testid]="'consumer-notloaded-copy-' + row.id">
                    @if (row.sectionStatus === 'loading') {
                      Loading…
                    } @else {
                      Could not load this section. Retry.
                    }
                  </span>
                  @if (row.sectionStatus !== 'loading') {
                    <button
                      type="button"
                      class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [attr.aria-label]="'Retry loading ' + row.name"
                      [disabled]="isCommitting() || disabled()"
                      (click)="retrySection(row.retryKey)"
                      [attr.data-testid]="'consumer-retry-' + row.id"
                    >Retry</button>
                  }
                </div>
              } @else if (row.sectionStatus === 'error') {
                <!-- Loaded earlier; the latest refresh failed, so the values may be stale. -->
                <div
                  class="flex flex-wrap items-center justify-between gap-2 rounded-md bg-base-100 p-2 text-xs"
                  [attr.data-testid]="'consumer-reload-' + row.id"
                >
                  <span class="text-base-content" [attr.data-testid]="'consumer-reload-copy-' + row.id">
                    Could not load this section. Retry.
                  </span>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                    [attr.aria-label]="'Retry loading ' + row.name"
                    [disabled]="isCommitting() || disabled()"
                    (click)="retrySection(row.retryKey)"
                    [attr.data-testid]="'consumer-retry-' + row.id"
                  >Retry</button>
                </div>
              }

              <!-- Scope Provenance strips for Provider and Model -->
              @if (row.loaded) {
                <div class="flex flex-col gap-1 rounded-md bg-base-100 p-2">
                <ptah-setting-scope-row
                  [fieldName]="row.providerFieldName"
                  [scope]="row.providerScope"
                  [supportedTargets]="['global']"
                  [disabled]="disabled()"
                  [attr.data-testid]="'scope-row-provider-' + row.id"
                />
                <ptah-setting-scope-row
                  [fieldName]="row.modelFieldName"
                  [scope]="row.modelScope"
                  [supportedTargets]="['global']"
                  [disabled]="disabled()"
                  [attr.data-testid]="'scope-row-model-' + row.id"
                />
                </div>
              }

              <!-- Inline editor expanded for this row -->
              @if (activeEditId() === row.id) {
                <div class="border-t border-base-300 pt-3 space-y-3" [attr.data-testid]="'consumer-editor-' + row.id">
                  <ptah-provider-model-picker
                    [label]="row.name"
                    [provider]="currentDraft().provider"
                    [model]="currentDraft().model"
                    [defaultTier]="row.defaultTier"
                    [requiresToolUse]="row.requiresToolUse"
                    [extraProviders]="extraProviders()"
                    [disabled]="isCommitting() || disabled()"
                    (selectionChange)="onDraftChange($event)"
                    [attr.data-testid]="'picker-' + row.id"
                  />

                  <!-- Unavailable provider warning & deep link -->
                  @if (draftProviderReadiness(); as readiness) {
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-base-content-muted bg-base-100 p-2 text-xs"
                      role="alert"
                      [attr.data-testid]="'readiness-alert-' + row.id"
                    >
                      <div class="flex items-center gap-2">
                        <lucide-angular [img]="AlertTriangleIcon" class="h-4 w-4 shrink-0 text-base-content" aria-hidden="true" />
                        <span class="text-base-content" [attr.data-testid]="'readiness-message-' + row.id">
                          {{ readiness.message }}
                        </span>
                      </div>

                      @if (readiness.setupProviderId; as providerId) {
                        <button
                          type="button"
                          class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [attr.aria-label]="'Set up ' + readiness.providerDisplayName"
                          (click)="onSetupProvider(providerId)"
                          [attr.data-testid]="'readiness-setup-' + row.id"
                        >Set up {{ readiness.providerDisplayName }}</button>
                      }
                    </div>
                  }

                  <!-- Save action area -->
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [disabled]="isSaveDisabled(row.id)"
                      [attr.aria-label]="'Save ' + row.name"
                      (click)="saveDraft(row.id)"
                      [attr.data-testid]="'save-button-' + row.id"
                    >Save</button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                      [disabled]="isCommitting() || disabled()"
                      [attr.aria-label]="'Cancel editing ' + row.name"
                      (click)="cancelEdit()"
                      [attr.data-testid]="'cancel-button-' + row.id"
                    >Cancel</button>

                    @if (isSaveDisabled(row.id) && draftProviderReadiness(); as readiness) {
                      <span class="text-xs text-base-content-muted" [attr.data-testid]="'save-disabled-reason-' + row.id">
                        {{ readiness.message }}
                      </span>
                    }
                  </div>
                </div>
              }

              <!-- Enhancement time limit placed directly beneath Judging & enhancement.
                   Rendered only from backend enhanceTimeoutMs; never with invented bounds. -->
              @if (row.id === 'judging-enhancement' && timeoutMeta(); as meta) {
                <div class="border-t border-base-300 pt-3 space-y-3" data-testid="enhancement-timeout-section">
                  @if (timeoutNotice(); as notice) {
                    <div
                      class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-base-content-muted bg-base-100 p-2 text-xs"
                      role="alert"
                      data-testid="timeout-notice-alert"
                    >
                      <div class="flex items-center gap-2">
                        <lucide-angular [img]="ClockIcon" class="h-4 w-4 shrink-0 text-base-content" aria-hidden="true" />
                        <span class="text-base-content" data-testid="timeout-notice-text">
                          Enhancement stopped after {{ notice.seconds }} seconds. No changes were saved.
                        </span>
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          (click)="retryEnhancementRequested.emit()"
                          data-testid="timeout-retry-button"
                        >Retry</button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          (click)="editTimeout()"
                          data-testid="timeout-change-limit-button"
                        >Change time limit</button>
                      </div>
                    </div>
                  }

                  <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div class="space-y-1">
                      <h4 class="text-sm font-semibold text-base-content">Enhancement time limit</h4>
                      <p class="text-xs text-base-content-muted">Maximum time allowed for one enhancement attempt.</p>
                      <p class="text-xs text-base-content font-medium" data-testid="timeout-effective-display">
                        Time limit: {{ timeoutEffectiveSec() }} seconds
                      </p>
                    </div>

                    <div class="shrink-0">
                      @if (!isEditingTimeout()) {
                        <button
                          type="button"
                          class="btn btn-outline btn-sm min-h-9 border-base-content-muted bg-base-100 text-base-content hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [disabled]="isCommitting() || disabled()"
                          aria-label="Edit Enhancement time limit"
                          (click)="editTimeout()"
                          data-testid="timeout-edit-button"
                        >Edit limit</button>
                      }
                    </div>
                  </div>

                  @if (isEditingTimeout()) {
                    <div class="space-y-2 rounded-md bg-base-100 p-3" data-testid="timeout-editor">
                      <div class="flex flex-wrap items-center gap-2">
                        <label for="enhance-timeout-input" class="sr-only">Enhancement time limit in seconds</label>
                        <input
                          #timeoutInput
                          id="enhance-timeout-input"
                          type="number"
                          class="input input-bordered input-sm min-h-9 w-28 bg-base-100 text-base-content border-base-content-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [min]="timeoutMinSec()"
                          [max]="timeoutMaxSec()"
                          [value]="timeoutDraftSec()"
                          [disabled]="isCommitting() || disabled()"
                          (input)="onTimeoutInput($event)"
                          data-testid="timeout-input"
                        />
                        <span class="text-sm text-base-content">seconds</span>

                        <button
                          type="button"
                          class="btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [disabled]="isTimeoutSaveDisabled()"
                          aria-label="Save Enhancement time limit"
                          (click)="saveTimeout()"
                          data-testid="timeout-save-button"
                        >Save limit</button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-sm min-h-9 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                          [disabled]="isCommitting() || disabled()"
                          aria-label="Cancel editing Enhancement time limit"
                          (click)="cancelTimeoutEdit()"
                          data-testid="timeout-cancel-button"
                        >Cancel</button>
                      </div>

                      <p class="text-xs text-base-content-muted" data-testid="timeout-range-helper">
                        Allowed: {{ timeoutMinSec() }}–{{ timeoutMaxSec() }} seconds (default {{ timeoutDefaultSec() }} seconds). Maximum time allowed for one enhancement attempt.
                      </p>

                      @if (timeoutValidationError(); as err) {
                        <p class="text-xs text-error" role="alert" data-testid="timeout-validation-error">{{ err }}</p>
                      }
                    </div>
                  }

                  <div class="rounded-md bg-base-100 p-2">
                    <ptah-setting-scope-row
                      [fieldName]="'Enhancement time limit'"
                      [scope]="timeoutScope()"
                      [supportedTargets]="['global']"
                      [disabled]="disabled()"
                      data-testid="scope-row-timeout"
                    />
                  </div>
                </div>
              }
            </div>
          </ptah-native-card>
        }
      </div>
    </section>
  `,
})
export class ProviderConsumerAssignmentsComponent {
  protected readonly state = inject(ProvidersSettingsStateService);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ClockIcon = Clock;

  readonly timeoutNotice = input<{ seconds: number } | null>(null);
  readonly disabled = input<boolean>(false);
  readonly initialEditingConsumerId = input<BackgroundConsumerId | null>(null);

  readonly setupProviderRequested = output<string>();
  readonly retryEnhancementRequested = output<void>();
  readonly assignmentSaved = output<{ id: BackgroundConsumerId; provider: string; model: string }>();
  readonly timeoutSaved = output<number>();

  protected readonly activeEditId = signal<BackgroundConsumerId | null>(null);
  protected readonly currentDraft = signal<{ provider: string; model: string }>({ provider: '', model: '' });
  protected readonly isEditingTimeout = signal<boolean>(false);
  /** Draft seed only; editTimeout() seeds it from the backend value. */
  protected readonly timeoutDraftSec = signal<number>(0);

  private readonly timeoutInputRef = viewChild<ElementRef<HTMLInputElement>>('timeoutInput');

  constructor() {
    // Deep link stays reactive: a later input change still opens the editor.
    // Each new value applies once, so a user cancel is not fought.
    effect(() => {
      const deepLinkId = this.initialEditingConsumerId();
      if (deepLinkId && deepLinkId !== this.appliedDeepLinkId) {
        this.appliedDeepLinkId = deepLinkId;
        this.toggleEdit(deepLinkId);
      }
    });
  }

  private appliedDeepLinkId: BackgroundConsumerId | null = null;

  protected readonly isCommitting = computed<boolean>(() => this.state.commit().status === 'saving');

  protected readonly extraProviders = computed<readonly ProviderIdentityOption[]>(() => {
    const providers = this.state.route().data?.providers ?? [];
    return providers.map((p) => ({ id: p.id, name: formatProviderDisplayName(p.id) }));
  });

  /**
   * Bounds and effective value come only from the backend payload
   * (Decision 8: the backend owns the bound; the UI never invents the range).
   * Null while the judging read has not landed — no number renders then.
   */
  protected readonly timeoutMeta = computed<{
    value: number;
    default: number;
    min: number;
    max: number;
  } | null>(() => {
    return this.state.judging().data?.enhanceTimeoutMs ?? null;
  });

  protected readonly timeoutMinSec = computed<number>(() => Math.round((this.timeoutMeta()?.min ?? 0) / 1000));
  protected readonly timeoutMaxSec = computed<number>(() => Math.round((this.timeoutMeta()?.max ?? 0) / 1000));
  protected readonly timeoutDefaultSec = computed<number>(() => Math.round((this.timeoutMeta()?.default ?? 0) / 1000));
  protected readonly timeoutEffectiveSec = computed<number>(() => Math.round((this.timeoutMeta()?.value ?? 0) / 1000));

  protected readonly timeoutScope = computed<SettingScopeDisplay>(() => {
    return this.state.scopeEntry('skillSynthesis.enhanceTimeoutMs')?.scope ?? 'mixed';
  });

  protected readonly timeoutValidationError = computed<string | null>(() => {
    if (!this.timeoutMeta()) return null;
    const sec = this.timeoutDraftSec();
    const min = this.timeoutMinSec();
    const max = this.timeoutMaxSec();
    return isNaN(sec) || sec < min || sec > max ? `Must be between ${min} and ${max} seconds.` : null;
  });

  protected readonly isTimeoutSaveDisabled = computed<boolean>(() => {
    return (
      !this.timeoutMeta() ||
      this.isCommitting() ||
      this.disabled() ||
      this.timeoutValidationError() !== null ||
      this.timeoutDraftSec() === this.timeoutEffectiveSec()
    );
  });

  protected readonly rows = computed<readonly BackgroundConsumerRow[]>(() => {
    const mem = this.state.memory();
    const lanes = this.state.lanes();
    const judging = this.state.judging();

    const memProv = mem.data?.curatorProvider ?? '';
    const memModel = mem.data?.curatorModel ?? '';
    const r1 = makeRow(
      'memory-curator', 'Memory curator', null, 'haiku', false,
      memProv, memModel, 'memory.curatorProvider', 'memory.curatorModel',
      this.state, this.formatResolvedSummary(memProv, memModel, 'haiku'),
      mem, 'memory',
    );

    const arch = lanes.data?.archaeologist;
    const archProv = arch?.provider ?? '';
    const archModel = arch?.model ?? '';
    const archTier = arch?.defaultTier ?? 'haiku';
    const r2 = makeRow(
      'archaeologist', 'Archaeologist lane', null, archTier, arch?.toolUse === 'required',
      archProv, archModel, 'skillSynthesis.archaeologist.provider', 'skillSynthesis.archaeologist.model',
      this.state, this.formatResolvedSummary(archProv, archModel, archTier),
      lanes, 'lanes',
    );

    const syn = lanes.data?.synthesis;
    const synProv = syn?.provider ?? '';
    const synModel = syn?.model ?? '';
    const synTier = syn?.defaultTier ?? 'haiku';
    const r3 = makeRow(
      'synthesis', 'Synthesis lane', null, synTier, syn?.toolUse === 'required',
      synProv, synModel, 'skillSynthesis.synthesis.provider', 'skillSynthesis.synthesis.model',
      this.state, this.formatResolvedSummary(synProv, synModel, synTier),
      lanes, 'lanes',
    );

    const jg = lanes.data?.judge;
    const jgProv = jg?.provider ?? '';
    const jgModel = jg?.model ?? '';
    const jgTier = jg?.defaultTier ?? 'haiku';
    const r4 = makeRow(
      'judge', 'Judge lane', null, jgTier, jg?.toolUse === 'required',
      jgProv, jgModel, 'skillSynthesis.judge.provider', 'skillSynthesis.judge.model',
      this.state, this.formatResolvedSummary(jgProv, jgModel, jgTier),
      lanes, 'lanes',
    );

    const rep = lanes.data?.replay;
    const repProv = rep?.provider ?? '';
    const repModel = rep?.model ?? '';
    const repTier = rep?.defaultTier ?? 'haiku';
    const r5 = makeRow(
      'replay', 'Replay lane', null, repTier, rep?.toolUse === 'required',
      repProv, repModel, 'skillSynthesis.replay.provider', 'skillSynthesis.replay.model',
      this.state, this.formatResolvedSummary(repProv, repModel, repTier),
      lanes, 'lanes',
    );

    const jdProv = judging.data?.judgeProvider ?? '';
    const jdModel = toPickerModel(judging.data?.judgeModel);
    const r6 = makeRow(
      'judging-enhancement', 'Judging & enhancement', JUDGING_HELPER_COPY, 'haiku', false,
      jdProv, jdModel, 'skillSynthesis.judgeProvider', 'skillSynthesis.judgeModel',
      this.state, this.formatResolvedSummary(jdProv, jdModel, 'haiku'),
      judging, 'judging',
    );

    return [r1, r2, r3, r4, r5, r6];
  });

  protected readonly draftProviderReadiness = computed<{
    message: string;
    setupProviderId: string | null;
    providerDisplayName: string;
  } | null>(() => {
    const activeId = this.activeEditId();
    if (!activeId) return null;

    const draft = this.currentDraft();
    const providers = this.state.route().data?.providers ?? [];

    if (!draft.provider) {
      if (!this.state.activeProviderId()) {
        return {
          message: 'Choose a provider to start the main agent.',
          setupProviderId: '',
          providerDisplayName: 'main provider',
        };
      }
      return null;
    }

    const providerId = draft.provider;
    const displayName = formatProviderDisplayName(providerId);
    const entry = providers.find((p) => p.id === providerId);

    if (entry && (entry.status === 'connected' || entry.status === 'reachable')) {
      return null;
    }

    const status = entry?.status ?? 'not-configured';
    let message: string;
    switch (status) {
      case 'needs-key':
        message = `Add an API key to connect ${displayName}.`;
        break;
      case 'unauthenticated':
        message = 'Your credential is missing or expired; authenticate again.';
        break;
      case 'unreachable':
        message = `Could not reach ${displayName}; check the connection and retry.`;
        break;
      case 'not-installed':
        message = `Install ${displayName} to use this connection.`;
        break;
      case 'not-configured':
      case 'missing':
      case 'unknown':
      case 'skipped':
      default:
        message = `Set up ${displayName} when you are ready.`;
        break;
    }

    return { message, setupProviderId: providerId, providerDisplayName: displayName };
  });

  protected toggleEdit(id: BackgroundConsumerId): void {
    if (this.activeEditId() === id) {
      this.cancelEdit();
      return;
    }
    const row = this.rows().find((r) => r.id === id);
    if (!row || !row.loaded) return;

    this.currentDraft.set({ provider: row.provider, model: row.model });
    this.activeEditId.set(id);
  }

  protected cancelEdit(): void {
    this.activeEditId.set(null);
    this.currentDraft.set({ provider: '', model: '' });
  }

  protected onDraftChange(selection: ProviderModelSelection): void {
    this.currentDraft.set({ provider: selection.provider, model: selection.model });
  }

  protected onSetupProvider(providerId: string): void {
    this.setupProviderRequested.emit(providerId);
  }

  protected isSaveDisabled(id: BackgroundConsumerId): boolean {
    if (this.isCommitting() || this.disabled() || this.draftProviderReadiness() !== null) return true;
    const row = this.rows().find((r) => r.id === id);
    if (!row) return true;
    const draft = this.currentDraft();
    return draft.provider === row.provider && draft.model === row.model;
  }

  protected async saveDraft(id: BackgroundConsumerId): Promise<void> {
    if (this.isSaveDisabled(id)) return;

    const draft = this.currentDraft();
    const context: ProvidersEditContext = this.state.reviewContext() ?? { scopeKey: '', activePath: null };

    let patch: ProvidersSettingsPatch;
    if (id === 'memory-curator') {
      patch = { memory: { curatorProvider: draft.provider, curatorModel: draft.model } };
    } else if (id === 'judging-enhancement') {
      patch = { judging: { judgeProvider: draft.provider, judgeModel: toBackendJudgeModel(draft.model) } };
    } else {
      const laneId = id as SkillLaneIdDto;
      patch = { lanes: { [laneId]: { provider: draft.provider, model: draft.model } } };
    }

    await this.state.saveSettings(patch, context);

    if (this.state.commit().status === 'saved') {
      this.assignmentSaved.emit({ id, provider: draft.provider, model: draft.model });
      this.activeEditId.set(null);
    }
  }

  /** Re-reads only the section whose row requested the retry. */
  protected async retrySection(retryKey: BackgroundConsumerRow['retryKey']): Promise<void> {
    if (retryKey === 'memory') await this.state.refreshMemory();
    else if (retryKey === 'lanes') await this.state.refreshLanes();
    else await this.state.refreshJudging();
  }

  protected editTimeout(): void {
    if (!this.timeoutMeta()) return;
    this.timeoutDraftSec.set(this.timeoutEffectiveSec());
    this.isEditingTimeout.set(true);
    setTimeout(() => this.timeoutInputRef()?.nativeElement.focus(), 0);
  }

  protected cancelTimeoutEdit(): void {
    this.isEditingTimeout.set(false);
    this.timeoutDraftSec.set(this.timeoutEffectiveSec());
  }

  protected onTimeoutInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.timeoutDraftSec.set(target.valueAsNumber);
  }

  protected async saveTimeout(): Promise<void> {
    if (this.isTimeoutSaveDisabled()) return;

    const sec = this.timeoutDraftSec();
    const context: ProvidersEditContext = this.state.reviewContext() ?? { scopeKey: '', activePath: null };
    const patch: ProvidersSettingsPatch = { judging: { enhanceTimeoutMs: sec * 1000 } };

    await this.state.saveSettings(patch, context);

    if (this.state.commit().status === 'saved') {
      this.timeoutSaved.emit(sec);
      this.isEditingTimeout.set(false);
    }
  }

  private formatResolvedSummary(provider: string, model: string, defaultTier: ProviderModelTier): string {
    const route = this.state.route().data;
    if (!provider) {
      let routeStr = 'Active provider';
      if (route?.driverProviderId) {
        const driverName = formatProviderDisplayName(route.driverProviderId);
        const modality = route.resolvedAuthModality ? ` · ${route.resolvedAuthModality}` : '';
        routeStr = `${driverName}${modality}`;
      }
      const modelStr = model || `Default (${defaultTier} tier)`;
      return `Follows main agent → ${routeStr} → ${modelStr}`;
    }

    const providerName = formatProviderDisplayName(provider);
    const modelStr = model || `Default (${defaultTier} tier)`;
    return `${providerName} · ${modelStr}`;
  }
}
