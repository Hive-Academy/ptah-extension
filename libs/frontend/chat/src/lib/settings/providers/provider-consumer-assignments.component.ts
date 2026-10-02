import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal,
  viewChild,
} from '@angular/core';
import { AlertTriangle, ArrowRight, ChevronDown, Clock, LucideAngularModule, X } from 'lucide-angular';
import {
  NativePopoverComponent, ProviderModelPickerComponent, type ProviderIdentityOption, type ProviderModelSelection,
} from '@ptah-extension/ui';
import { ProvidersSettingsStateService, type ProvidersEditContext, type ProvidersSettingsPatch } from '@ptah-extension/core';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import { SettingScopeRowComponent, type SettingScopeDisplay } from './setting-scope-row.component';
import {
  buildConsumerRows, consumerPatch, formatProviderDisplayName, providerReadiness,
  type BackgroundConsumerId, type BackgroundConsumerRow,
} from './provider-consumer-rows';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const ACTION = `btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[11px] font-medium text-base-content underline underline-offset-2 ${FOCUS}`;
/** Reassignment cell: an own provider shows as a value with a chevron, "Follows main agent →" as a link-styled chip. */
const CELL = `inline-flex max-w-[15rem] items-center gap-1 whitespace-nowrap rounded px-1 text-left text-xs text-base-content hover:bg-base-200 hover:underline ${FOCUS}`;
/** Background roles are settings for every Ptah app (`supportedTargets: ['global']`). */
const SAVE_SCOPE = 'global';
const TIMEOUT_NOT_SAVED = 'Could not save the enhancement time limit. The limit shown is the saved one.';
/** The save never ran: another change was still saving (Gate V 36 re-check N-2). */
const TIMEOUT_REFUSED = 'The enhancement time limit was not saved because another change was still saving. The limit shown is the saved one.';

/**
 * Background model roles (design-spec §1.2 item 4, plan :765-774, prototype `orchestration.html` section 3): the six
 * background-consumer rows in fixed order, as a `table-xs` inside the Orchestration tab's roles `<details>`.
 * - The Provider & model cell opens the row's reassignment popover (the shared provider/model picker). A choice saves
 *   at once through `SettingsSaveFeedbackService` with Undo (D2); a provider that is not ready is not saved and the
 *   popover says why, with its "Set up" link (fixed sentences only). A role without its own provider shows the
 *   "Follows main agent →" chip, which opens the same popover.
 * - `initialEditingConsumerId` (a role deep link) opens that row's popover. Esc, the backdrop and Close return focus
 *   to the row's cell, also while a save runs: the cell is then `aria-disabled`, never natively disabled (Gate V 36,
 *   M-2), so it can take focus back.
 * - Scope badges sit inline after the cell, only for a role with a non-inherited value (D16; no Scope column, V36-6).
 * - The Enhancement time limit sits under Judging & enhancement; it is rendered only from the backend's
 *   `enhanceTimeoutMs` (never invented bounds). It saves with Undo through the same feedback path; a write that did
 *   not save puts the input back on the saved limit and says so (D15, Gate V 36 S-1).
 * Row derivation is pure, in `provider-consumer-rows.ts`.
 */
@Component({
  selector: 'ptah-provider-consumer-assignments',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, ProviderModelPickerComponent, SettingScopeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-2" data-testid="provider-consumer-assignments">
      <header class="space-y-0.5">
        <h2 class="text-xs font-semibold text-base-content" data-testid="assignments-heading">Background models</h2>
        <p class="text-xs text-base-content-muted" data-testid="assignments-copy">
          These assignments run background work. They do not select the main agent.
        </p>
      </header>

      <div class="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
        <!-- table-xs density (design-spec §1.2), as the CLI matrix above. -->
        <table class="table table-xs w-full [&_td]:px-1.5 [&_th]:px-1.5" aria-labelledby="background-roles-table-label" data-testid="consumer-table">
          <caption id="background-roles-table-label" class="sr-only">Background model roles</caption>
          <thead>
            <tr class="text-[11px] uppercase tracking-wide text-base-content-muted">
              <th scope="col">Role</th><th scope="col">Provider &amp; model</th><th scope="col">Tier</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr [attr.data-testid]="'consumer-row-' + row.id" class="align-top">
                <th scope="row" class="min-w-[8rem] font-normal">
                  <span class="text-xs font-bold text-base-content" [attr.data-testid]="'consumer-name-' + row.id">{{ row.name }}</span>
                  @if (row.helperCopy) {
                    <p class="mt-0.5 max-w-[16rem] text-xs leading-snug text-base-content-muted" [attr.data-testid]="'consumer-helper-' + row.id">{{ row.helperCopy }}</p>
                  }
                </th>
                @if (!row.loaded) {
                  <!-- Not loaded: no effective value renders, only the section's state and its own Retry. -->
                  <td colspan="2" [attr.data-testid]="'consumer-notloaded-' + row.id">
                    <span class="text-xs text-base-content" [attr.data-testid]="'consumer-notloaded-copy-' + row.id">
                      {{ row.sectionStatus === 'loading' ? 'Loading…' : 'Could not load this section. Retry.' }}
                    </span>
                    @if (row.sectionStatus !== 'loading') {
                      <button type="button" [class]="action" [attr.aria-label]="'Retry loading ' + row.name" [disabled]="busy()"
                        (click)="retrySection(row.retryKey)" [attr.data-testid]="'consumer-retry-' + row.id">Retry</button>
                    }
                  </td>
                } @else {
                  <td>
                    <div class="flex flex-wrap items-center gap-1">
                    <ptah-native-popover [isOpen]="activeEditId() === row.id" placement="bottom-start" [hasBackdrop]="true"
                      backdropClass="transparent" (closed)="cancelEdit()">
                      <!-- One line in both hosts: the label truncates (full text in the title and the accessible name),
                           the icon stays right after it, and the row never grows (Batch 35 revise, R1). -->
                      <button trigger type="button" [class]="cell + (row.followsMain ? ' font-medium' : ' font-mono')" [attr.aria-disabled]="busy() ? 'true' : null"
                        [attr.aria-label]="row.name + ': ' + row.resolvedSummary + '. Reassign'" [attr.aria-expanded]="activeEditId() === row.id"
                        [title]="row.resolvedSummary" aria-haspopup="dialog" (click)="toggleEdit(row.id)" [attr.data-testid]="'consumer-edit-' + row.id">
                        <span class="min-w-0 truncate" [attr.data-testid]="'consumer-summary-' + row.id">{{ row.cellLabel }}</span>
                        <lucide-angular [img]="row.followsMain ? ArrowIcon : ChevronIcon"
                          [class]="'h-3 w-3 shrink-0 ' + (row.followsMain ? 'text-primary' : 'text-base-content-muted')" aria-hidden="true" />
                      </button>
                      @if (activeEditId() === row.id) {
                        <!-- The picker's own header (the role name) is the visible title; Close sits in its empty right corner. -->
                        <div content role="dialog" [attr.aria-label]="'Reassign ' + row.name"
                          class="relative w-[27rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-2 text-left text-xs"
                          [attr.data-testid]="'consumer-editor-' + row.id">
                          <button type="button" [class]="'btn btn-ghost btn-xs btn-square absolute right-3 top-3 z-10 min-h-6 ' + focusRing" aria-label="Close"
                            (click)="cancelEdit()" [attr.data-testid]="'consumer-close-' + row.id">
                            <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <ptah-provider-model-picker [label]="row.name" [provider]="currentDraft().provider" [model]="currentDraft().model"
                            [defaultTier]="row.defaultTier" [requiresToolUse]="row.requiresToolUse" [extraProviders]="extraProviders()"
                            [disabled]="busy() || disabled()" (selectionChange)="onDraftChange(row.id, $event)" [attr.data-testid]="'picker-' + row.id" />
                          @if (draftProviderReadiness(); as readiness) {
                            <div class="flex flex-wrap items-center gap-1.5 rounded border border-base-300 bg-base-200 p-2"
                              [attr.role]="readiness.blocking ? 'alert' : 'status'" [attr.data-testid]="'readiness-alert-' + row.id">
                              <lucide-angular [img]="AlertTriangleIcon" class="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                              <span class="min-w-0 flex-1 text-base-content" [attr.data-testid]="'readiness-message-' + row.id">
                                {{ readiness.message }}{{ readiness.blocking ? ' Not saved.' : '' }}
                              </span>
                              @if (readiness.setupProviderId !== null) {
                                <button type="button" [class]="action" [attr.aria-label]="'Set up ' + readiness.providerDisplayName"
                                  (click)="onSetupProvider(readiness.setupProviderId)" [attr.data-testid]="'readiness-setup-' + row.id">Set up {{ readiness.providerDisplayName }}</button>
                              }
                            </div>
                          }
                          <p class="px-1 text-xs text-base-content-muted">Each choice saves at once, with Undo. No provider follows the main agent.</p>
                        </div>
                      }
                    </ptah-native-popover>
                    @if (row.scopeShown) {
                      <ptah-setting-scope-row [fieldName]="row.providerFieldName" [scope]="row.providerScope" [hasOverride]="row.providerOverride"
                        [supportedTargets]="['global']" [disabled]="disabled()" [attr.data-testid]="'scope-row-provider-' + row.id" />
                      <ptah-setting-scope-row [fieldName]="row.modelFieldName" [scope]="row.modelScope" [hasOverride]="row.modelOverride"
                        [supportedTargets]="['global']" [disabled]="disabled()" [attr.data-testid]="'scope-row-model-' + row.id" />
                    }
                    @if (row.sectionStatus === 'error') {
                      <!-- Loaded earlier; the latest refresh failed, so the values may be stale. -->
                      <span class="text-xs text-base-content" [attr.data-testid]="'consumer-reload-' + row.id">
                        <span [attr.data-testid]="'consumer-reload-copy-' + row.id">Could not load this section. Retry.</span>
                        <button type="button" [class]="action" [attr.aria-label]="'Retry loading ' + row.name" [disabled]="busy()"
                          (click)="retrySection(row.retryKey)" [attr.data-testid]="'consumer-retry-' + row.id">Retry</button>
                      </span>
                    }
                    </div>
                  </td>
                  <td class="whitespace-nowrap">
                    <span [class]="'badge badge-outline badge-xs whitespace-nowrap font-mono text-base-content ' + (row.model ? 'border-base-300 bg-base-300' : 'border-info/30 bg-info/10')"
                      [attr.data-testid]="'consumer-tier-' + row.id">{{ row.tierLabel }}</span>
                  </td>
                }
              </tr>
              @if (row.id === 'judging-enhancement' && timeoutMeta()) {
                <tr data-testid="enhancement-timeout-section">
                  <td colspan="3" class="bg-base-200/40">
                    <div class="space-y-1.5">
                      @if (timeoutNotice(); as notice) {
                        <div class="flex flex-wrap items-center gap-1.5 rounded border border-base-300 bg-base-100 p-1.5" role="alert" data-testid="timeout-notice-alert">
                          <lucide-angular [img]="ClockIcon" class="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                          <span class="text-xs text-base-content" data-testid="timeout-notice-text">Enhancement stopped after {{ notice.seconds }} seconds. No changes were saved.</span>
                          <button type="button" [class]="action" (click)="retryEnhancementRequested.emit()" data-testid="timeout-retry-button">Retry</button>
                          <button type="button" [class]="action" (click)="editTimeout()" data-testid="timeout-change-limit-button">Change time limit</button>
                        </div>
                      }
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span class="text-xs font-semibold text-base-content">Enhancement time limit</span>
                        <span class="text-xs text-base-content-muted">Maximum time allowed for one enhancement attempt.</span>
                        <span class="badge badge-outline badge-xs whitespace-nowrap border-warning/30 bg-warning/10 font-mono text-base-content"
                          data-testid="timeout-effective-display">Time limit: {{ timeoutEffectiveSec() }} seconds</span>
                        @if (!isEditingTimeout()) {
                          <button type="button" [class]="action" [disabled]="busy() || disabled()" aria-label="Edit Enhancement time limit"
                            (click)="editTimeout()" data-testid="timeout-edit-button">Edit limit</button>
                        }
                        <ptah-setting-scope-row [fieldName]="'Enhancement time limit'" [scope]="timeoutScope()" [hasOverride]="timeoutOverride()" [supportedTargets]="['global']"
                          [disabled]="disabled()" data-testid="scope-row-timeout" />
                      </div>
                      @if (isEditingTimeout()) {
                        <div class="space-y-1" data-testid="timeout-editor">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <label for="enhance-timeout-input" class="sr-only">Enhancement time limit in seconds</label>
                            <input #timeoutInput id="enhance-timeout-input" type="number"
                              [class]="'input input-bordered input-xs h-7 w-24 border-base-content-muted bg-base-100 text-base-content ' + focusRing"
                              [min]="timeoutMinSec()" [max]="timeoutMaxSec()" [value]="timeoutDraftSec()" [disabled]="busy() || disabled()"
                              (input)="onTimeoutInput($event)" data-testid="timeout-input" />
                            <span class="text-xs text-base-content">seconds</span>
                            <button type="button" [class]="'btn btn-primary btn-xs h-7 min-h-7 px-2 ' + focusRing" [disabled]="isTimeoutSaveDisabled()"
                              aria-label="Save Enhancement time limit" (click)="saveTimeout()" data-testid="timeout-save-button">Save limit</button>
                            <button type="button" [class]="action" [disabled]="busy() || disabled()" aria-label="Cancel editing Enhancement time limit"
                              (click)="cancelTimeoutEdit()" data-testid="timeout-cancel-button">Cancel</button>
                          </div>
                          <p class="text-xs text-base-content-muted" data-testid="timeout-range-helper">
                            Allowed: {{ timeoutMinSec() }}–{{ timeoutMaxSec() }} seconds (default {{ timeoutDefaultSec() }} seconds). Maximum time allowed for one enhancement attempt.
                          </p>
                          @if (timeoutValidationError(); as err) {
                            <p class="text-xs text-base-content" role="alert" data-testid="timeout-validation-error">{{ err }}</p>
                          }
                          @if (timeoutSaveError(); as message) {
                            <p class="text-xs text-base-content" role="alert" data-testid="timeout-save-error">{{ message }}</p>
                          }
                        </div>
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class ProviderConsumerAssignmentsComponent {
  protected readonly state = inject(ProvidersSettingsStateService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ClockIcon = Clock;
  protected readonly ChevronIcon = ChevronDown;
  protected readonly ArrowIcon = ArrowRight;
  protected readonly CloseIcon = X;
  protected readonly focusRing = FOCUS;
  protected readonly action = ACTION;
  protected readonly cell = CELL;

  readonly timeoutNotice = input<{ seconds: number } | null>(null);
  readonly disabled = input<boolean>(false);
  readonly initialEditingConsumerId = input<BackgroundConsumerId | null>(null);

  readonly setupProviderRequested = output<string>();
  /** The `initialEditingConsumerId` deep link was applied: that row's popover is open. */
  readonly deepLinkOpened = output<BackgroundConsumerId>();
  readonly retryEnhancementRequested = output<void>();
  readonly assignmentSaved = output<{ id: BackgroundConsumerId; provider: string; model: string }>();
  readonly timeoutSaved = output<number>();

  /** The row whose reassignment popover is open. */
  protected readonly activeEditId = signal<BackgroundConsumerId | null>(null);
  /** The picker's current choice; it equals the saved value except while a choice is not ready to save. */
  protected readonly currentDraft = signal<{ provider: string; model: string }>({ provider: '', model: '' });
  protected readonly isEditingTimeout = signal<boolean>(false);
  /** Draft seed only; editTimeout() seeds it from the backend value. */
  protected readonly timeoutDraftSec = signal<number>(0);
  /** Set only by this editor's own save when its write did not save (a fixed sentence, never host text). */
  protected readonly timeoutSaveError = signal<string | null>(null);

  private readonly timeoutInputRef = viewChild<ElementRef<HTMLInputElement>>('timeoutInput');
  private appliedDeepLinkId: BackgroundConsumerId | null = null;
  /** The edit context, taken when the popover opens (as the other Settings popovers). */
  private context: ProvidersEditContext | null = null;

  constructor() {
    // Deep link stays reactive: a later input change still opens the popover.
    // Each new value applies once, so a user cancel is not fought.
    effect(() => {
      const deepLinkId = this.initialEditingConsumerId();
      // Cleared (the visit that applied it ended): the same role may be deep-linked again later.
      if (!deepLinkId) { this.appliedDeepLinkId = null; return; }
      if (deepLinkId !== this.appliedDeepLinkId) {
        // Waits for the row's data and for a running save to end (no popover opens while a save runs).
        if (!this.rows().find((row) => row.id === deepLinkId)?.loaded || this.busy()) return;
        this.appliedDeepLinkId = deepLinkId;
        // Opens it (a toggle would close a popover the user already opened on this row).
        if (this.activeEditId() !== deepLinkId) this.toggleEdit(deepLinkId);
        this.deepLinkOpened.emit(deepLinkId);
      }
    });
  }

  /** Save triggers wait while any save runs (D3). */
  protected readonly busy = this.feedback.saving;

  protected readonly extraProviders = computed<readonly ProviderIdentityOption[]>(() =>
    (this.state.route().data?.providers ?? []).map((p) => ({ id: p.id, name: formatProviderDisplayName(p.id) })));

  /**
   * Bounds and effective value come only from the backend payload
   * (Decision 8: the backend owns the bound; the UI never invents the range).
   * Null while the judging read has not landed — no number renders then.
   */
  protected readonly timeoutMeta = computed(() => this.state.judging().data?.enhanceTimeoutMs ?? null);
  protected readonly timeoutMinSec = computed<number>(() => Math.round((this.timeoutMeta()?.min ?? 0) / 1000));
  protected readonly timeoutMaxSec = computed<number>(() => Math.round((this.timeoutMeta()?.max ?? 0) / 1000));
  protected readonly timeoutDefaultSec = computed<number>(() => Math.round((this.timeoutMeta()?.default ?? 0) / 1000));
  protected readonly timeoutEffectiveSec = computed<number>(() => Math.round((this.timeoutMeta()?.value ?? 0) / 1000));
  protected readonly timeoutScope = computed<SettingScopeDisplay>(() =>
    this.state.scopeEntry('skillSynthesis.enhanceTimeoutMs')?.scope ?? 'mixed');
  protected readonly timeoutOverride = computed<boolean>(() =>
    this.state.scopeEntry('skillSynthesis.enhanceTimeoutMs')?.hasOverride === true);
  protected readonly timeoutValidationError = computed<string | null>(() => {
    if (!this.timeoutMeta()) return null;
    const sec = this.timeoutDraftSec(), min = this.timeoutMinSec(), max = this.timeoutMaxSec();
    return isNaN(sec) || sec < min || sec > max ? `Must be between ${min} and ${max} seconds.` : null;
  });
  protected readonly isTimeoutSaveDisabled = computed<boolean>(() => !this.timeoutMeta() || this.busy() || this.disabled()
    || this.timeoutValidationError() !== null || this.timeoutDraftSec() === this.timeoutEffectiveSec());

  protected readonly rows = computed<readonly BackgroundConsumerRow[]>(() => buildConsumerRows(
    { memory: this.state.memory(), lanes: this.state.lanes(), judging: this.state.judging() },
    this.state.route().data,
    (key) => this.state.scopeEntry(key),
  ));

  /** `blocking: false` is an advisory note: the choice still saves. */
  protected readonly draftProviderReadiness = computed(() => this.activeEditId()
    ? providerReadiness(this.currentDraft().provider, this.state.route().data?.providers ?? [], !!this.state.activeProviderId())
    : null);

  protected toggleEdit(id: BackgroundConsumerId): void {
    if (this.activeEditId() === id) {
      this.cancelEdit();
      return;
    }
    const row = this.rows().find((r) => r.id === id);
    // While a save runs the cell is only aria-disabled (so it can keep and take focus): the click is refused here (D3).
    if (!row || !row.loaded || this.busy()) return;
    this.context = this.state.reviewContext();
    this.currentDraft.set({ provider: row.provider, model: row.model });
    this.activeEditId.set(id);
  }

  /** Closes the popover; focus goes back to the row's cell (also when a deep link opened it). */
  protected cancelEdit(): void {
    const id = this.activeEditId();
    this.activeEditId.set(null);
    this.currentDraft.set({ provider: '', model: '' });
    if (!id) return;
    afterNextRender(() => this.element.nativeElement.querySelector<HTMLElement>(`[data-testid="consumer-edit-${id}"]`)?.focus(),
      { injector: this.injector });
  }

  /** A picker choice saves at once unless its provider is not ready (then the popover says why and nothing is written). */
  protected onDraftChange(id: BackgroundConsumerId, selection: ProviderModelSelection): void {
    this.currentDraft.set({ provider: selection.provider, model: selection.model });
    if (this.draftProviderReadiness()?.blocking) return;
    void this.saveDraft(id);
  }

  protected onSetupProvider(providerId: string): void {
    this.setupProviderRequested.emit(providerId);
  }

  /**
   * Saves the draft with Undo (D2). `assignmentSaved` is emitted from each write's own result, never from an earlier
   * save's `commit()` (Batch 17). A write that did not save puts the picker back on the read-back value (D15); the
   * toast names what failed.
   */
  protected async saveDraft(id: BackgroundConsumerId): Promise<void> {
    const row = this.rows().find((r) => r.id === id);
    const draft = this.currentDraft(), context = this.context;
    if (!row || !context || this.busy() || this.disabled()) return;
    if (draft.provider === row.provider && draft.model === row.model) return;
    // This save's own result decides the revert, never `commit()` (an earlier save may have left it `saved`).
    const result = await this.feedback.save({
      label: `${row.name} assignment`, scope: SAVE_SCOPE,
      write: () => this.writeAssignment(id, draft.provider, draft.model, context),
      undo: () => this.writeAssignment(id, row.provider, row.model, context),
    });
    if (this.activeEditId() !== id || result === 'saved') return;
    if (result === 'failed' && this.state.commit().status === 'blocked') this.context = this.state.reviewContext();
    const current = this.rows().find((r) => r.id === id);
    if (current) this.currentDraft.set({ provider: current.provider, model: current.model });
  }

  private async writeAssignment(id: BackgroundConsumerId, provider: string, model: string, context: ProvidersEditContext): Promise<boolean> {
    const accepted = await this.state.saveSettings(consumerPatch(id, provider, model), context);
    if (accepted && this.state.commit().status === 'saved') this.assignmentSaved.emit({ id, provider, model });
    return accepted;
  }

  /** Re-reads only the section whose row requested the retry. */
  protected async retrySection(retryKey: BackgroundConsumerRow['retryKey']): Promise<void> {
    if (retryKey === 'memory') await this.state.refreshMemory();
    else if (retryKey === 'lanes') await this.state.refreshLanes();
    else await this.state.refreshJudging();
  }

  protected editTimeout(): void {
    if (!this.timeoutMeta()) return;
    this.timeoutSaveError.set(null);
    this.timeoutDraftSec.set(this.timeoutEffectiveSec());
    this.isEditingTimeout.set(true);
    afterNextRender(() => this.timeoutInputRef()?.nativeElement.focus(), { injector: this.injector });
  }

  protected cancelTimeoutEdit(): void {
    this.isEditingTimeout.set(false);
    this.timeoutSaveError.set(null);
    this.timeoutDraftSec.set(this.timeoutEffectiveSec());
  }

  protected onTimeoutInput(event: Event): void {
    this.timeoutSaveError.set(null);
    this.timeoutDraftSec.set((event.target as HTMLInputElement).valueAsNumber);
  }

  /**
   * Saves the limit with Undo through `SettingsSaveFeedbackService` (D2; the toast names a failure). "Saved" comes from
   * this write's own result (accepted and its commit `saved`), never from an earlier commit (D15). A write that was
   * refused, failed or threw keeps the editor open on the saved limit with a fixed sentence (Gate V 36, S-1).
   */
  protected async saveTimeout(): Promise<void> {
    if (this.isTimeoutSaveDisabled()) return;
    const sec = this.timeoutDraftSec(), previousSec = this.timeoutEffectiveSec();
    const context: ProvidersEditContext = this.state.reviewContext() ?? { scopeKey: '', activePath: null };
    this.timeoutSaveError.set(null);
    const result = await this.feedback.save({
      label: 'enhancement time limit', scope: SAVE_SCOPE,
      write: () => this.writeTimeout(sec, context),
      undo: () => this.writeTimeout(previousSec, context),
    });
    if (result === 'saved') {
      this.isEditingTimeout.set(false);
      return;
    }
    if (!this.isEditingTimeout()) return;
    const savedSec = this.timeoutEffectiveSec();
    this.timeoutDraftSec.set(savedSec);
    // The binding may not change (the same value as before the edit), so the input is reset directly.
    const input = this.timeoutInputRef()?.nativeElement;
    if (input) input.value = String(savedSec);
    this.timeoutSaveError.set(result === 'refused' ? TIMEOUT_REFUSED : TIMEOUT_NOT_SAVED);
  }

  /** One limit write; `timeoutSaved` (the host re-reads judging) follows only this write's own confirmed save. */
  private async writeTimeout(sec: number, context: ProvidersEditContext): Promise<boolean> {
    const patch: ProvidersSettingsPatch = { judging: { enhanceTimeoutMs: Math.round(sec * 1000) } };
    const accepted = await this.state.saveSettings(patch, context);
    if (accepted && this.state.commit().status === 'saved') this.timeoutSaved.emit(sec);
    return accepted;
  }
}
