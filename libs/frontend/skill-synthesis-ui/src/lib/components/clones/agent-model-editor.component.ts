/**
 * Per-agent model control on the desktop Agents tab (TASK_2026_609, plan C6).
 *
 * {@link AgentModelsStore} (`agent-models.store.ts`) loads the two settings
 * layers once per Agents-tab entry, Refresh and workspace switch;
 * {@link AgentModelEditorComponent} is the inline section on each agent card
 * that shows and edits them.
 *
 * Per provider row: the effective value and where it comes from, the server's
 * label for it, and an Edit action. An empty non-Claude row says what the
 * subagent inherits (the lane default from `agent:getConfig`, or the CLI
 * default). `agent:listCliModels` only feeds the input's suggestions; every
 * label comes from the server's classification or from the shared
 * {@link classifyAgentModelValue} over the server's lists.
 *
 * Save: reconcile guard (shown only when hand-edited files exist) →
 * `skillSynthesis:setAgentModel` with the loaded `workspaceRoot` →
 * `HarnessHealthStore.reconcile()`. Nothing is written before the guard
 * agrees.
 *
 * ### Guard failure vs Cancel
 *
 * The guard's own per-call outcome decides: `unverified` keeps the typed
 * value and offers Retry ({@link GUARD_FAILED_COPY}); `cancelled` closes the
 * form silently. Nothing is inferred from `HarnessHealthStore` afterwards, so
 * a `harness:healthChanged` push while the guard is open changes neither.
 *
 * ### Stale steps stop
 *
 * Each save captures an {@link AgentModelsTicket} (workspace identity) and an
 * editor operation number. After every `await` it stops, writing nothing and
 * reconciling nothing, when the editor was destroyed, the workspace changed,
 * or a newer operation started. A workspace change also drops any open draft.
 * The store discards load replies older than its last load or adopted save,
 * and save results for another workspace.
 *
 * ### After the save
 *
 * The follow-up reconcile is reported on the row, with Sync as the retry,
 * when it failed, returned per-file `writeFailed` entries, or did not run
 * because another pass was already active (`HarnessHealthStore.reconcile`
 * returns at once then, and that pass may have read the settings before this
 * save).
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import {
  AGENT_MODEL_PROVIDERS,
  classifyAgentModelValue,
  resolveAgentModel,
  type AgentModelClass,
  type AgentModelProvider,
  type AgentModelSettingsScope,
  type AgentModelSettingsValue,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { AgentModelsStore, type AgentModelsTicket } from './agent-models.store';
import {
  describeWriteFailures,
  reconcileWriteFailures,
} from './agent-sync-chips';
import {
  RECONCILE_WHOLE_WORKSPACE_NOTICE,
  type ReconcileGuardComponent,
} from './reconcile-guard';

const PROVIDER_LABEL: Readonly<Record<AgentModelProvider, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  opencode: 'OpenCode',
};

/** AC7: stated before saving whenever the machine scope is chosen. */
export const MACHINE_SCOPE_COPY =
  'Applies to every workspace without its own value.';
export const GUARD_FAILED_COPY =
  'Could not check for hand-edited files; nothing was saved.';
const NO_FOLDER_COPY = 'Open a workspace folder to set per-agent models.';
const WORKSPACE_CHANGED_COPY =
  'The workspace changed, so nothing was saved. Models were reloaded.';
/** The save landed but its reconcile was skipped: a pass was already active. */
export const SYNC_SKIPPED_COPY =
  'Saved; provider copies not updated: a sync was already running.';

/** Label and badge tone for a stored value's server classification. */
const CLASS_BADGE: Readonly<
  Record<Exclude<AgentModelClass, 'empty'>, { label: string; tone: string }>
> = {
  listed: { label: 'listed', tone: 'badge-success' },
  unlisted: { label: 'not in provider list', tone: 'badge-warning' },
  unverifiable: { label: 'list unavailable', tone: 'badge-ghost' },
  malformed: { label: 'not written: invalid id', tone: 'badge-error' },
};

const SOURCE_LABEL = {
  workspace: { own: 'workspace override', wildcard: 'workspace default' },
  machine: { own: 'machine default', wildcard: 'machine default, all agents' },
} as const;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ModelRow {
  readonly provider: AgentModelProvider;
  readonly label: string;
  readonly value: string | null;
  /** Where `value` comes from, or what an empty row inherits. */
  readonly source: string;
  readonly badge: { readonly label: string; readonly tone: string } | null;
  readonly unsupported: boolean;
}

type EditPhase =
  'editing' | 'confirm-unlisted' | 'saving' | 'guard-failed' | 'save-failed';

interface EditState {
  readonly provider: AgentModelProvider;
  readonly scope: AgentModelSettingsScope;
  readonly phase: EditPhase;
  /** Server text for `confirm-unlisted` / `save-failed`. */
  readonly message: string | null;
  /** The last save attempt carried `confirmUnlisted: true` (Retry repeats it). */
  readonly confirmed: boolean;
}

interface RowNotice {
  readonly provider: AgentModelProvider;
  readonly kind: 'info' | 'sync-failed';
  readonly text: string;
}

let nextEditorId = 0;

@Component({
  selector: 'ptah-agent-model-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="space-y-1 rounded-lg bg-base-300/30 px-2 py-1.5 text-[11px]"
      data-card-ignore
      [attr.aria-label]="'Model per provider for ' + slug()"
      data-testid="agent-model-editor"
    >
      @if (store.snapshot(); as snap) {
        @if (snap.workspaceRoot === null) {
          <p
            class="text-base-content-muted"
            data-testid="agent-model-no-folder"
          >
            {{ noFolderCopy }}
          </p>
        } @else {
          <ul class="space-y-1">
            @for (row of rows(); track row.provider) {
              <li
                [attr.data-provider]="row.provider"
                data-testid="agent-model-row"
              >
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="w-16 shrink-0 font-medium">{{ row.label }}</span>
                  @if (row.value !== null) {
                    <code class="break-all" data-testid="agent-model-value">{{
                      row.value
                    }}</code>
                  }
                  <span
                    class="text-base-content-muted"
                    data-testid="agent-model-source"
                    >{{ row.source }}</span
                  >
                  @if (row.badge; as badge) {
                    <span
                      class="badge badge-xs"
                      [class]="badge.tone"
                      data-testid="agent-model-class"
                      >{{ badge.label }}</span
                    >
                  }
                  @if (edit()?.provider !== row.provider) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs ml-auto"
                      data-testid="agent-model-edit-btn"
                      [disabled]="
                        locked() || row.unsupported || edit() !== null
                      "
                      [title]="
                        row.unsupported
                          ? 'Not supported for ' + row.label + ' agent copies.'
                          : 'Set the ' + row.label + ' model for this agent.'
                      "
                      [attr.aria-label]="
                        'Edit ' + row.label + ' model for ' + slug()
                      "
                      (click)="startEdit(row.provider)"
                    >
                      Edit
                    </button>
                  }
                </div>

                @if (row.unsupported) {
                  <p
                    class="text-base-content-muted"
                    data-testid="agent-model-unsupported"
                  >
                    Not supported for {{ row.label }} agent copies.
                  </p>
                }

                @if (notice(); as n) {
                  @if (n.provider === row.provider) {
                    <p
                      class="flex flex-wrap items-center gap-1.5"
                      [class.text-warning]="n.kind === 'sync-failed'"
                      role="status"
                      data-testid="agent-model-notice"
                    >
                      <span>{{ n.text }}</span>
                      @if (n.kind === 'sync-failed') {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          data-testid="agent-model-sync-btn"
                          [disabled]="locked() || harness.busy()"
                          (click)="syncAgain()"
                        >
                          Sync
                        </button>
                      }
                    </p>
                  }
                }

                @if (edit(); as e) {
                  @if (e.provider === row.provider) {
                    <div
                      class="mt-1 space-y-1.5"
                      data-testid="agent-model-form"
                    >
                      <fieldset class="flex flex-wrap items-center gap-3">
                        <legend class="sr-only">Save the value in</legend>
                        <label class="inline-flex items-center gap-1">
                          <input
                            type="radio"
                            class="radio radio-xs"
                            [name]="fieldId + '-scope'"
                            value="workspace"
                            data-testid="agent-model-scope-workspace"
                            [checked]="e.scope === 'workspace'"
                            [disabled]="busyEditing()"
                            (change)="setScope('workspace')"
                          />
                          This workspace
                        </label>
                        <label class="inline-flex items-center gap-1">
                          <input
                            type="radio"
                            class="radio radio-xs"
                            [name]="fieldId + '-scope'"
                            value="machine"
                            data-testid="agent-model-scope-machine"
                            [checked]="e.scope === 'machine'"
                            [disabled]="busyEditing()"
                            (change)="setScope('machine')"
                          />
                          Machine default
                        </label>
                      </fieldset>
                      @if (e.scope === 'machine') {
                        <p data-testid="agent-model-machine-copy">
                          {{ machineScopeCopy }}
                        </p>
                      }

                      <div class="flex flex-wrap items-center gap-1">
                        <label class="sr-only" [for]="fieldId + '-input'"
                          >{{ row.label }} model for {{ slug() }}</label
                        >
                        <input
                          #modelInput
                          type="text"
                          class="input input-xs input-bordered min-w-0 flex-1 font-mono"
                          [id]="fieldId + '-input'"
                          [attr.list]="fieldId + '-list'"
                          [placeholder]="placeholder(row.provider)"
                          autocomplete="off"
                          spellcheck="false"
                          data-testid="agent-model-input"
                          [value]="draft()"
                          [disabled]="busyEditing()"
                          (input)="onDraft($event)"
                          (keydown.enter)="onSave()"
                          (keydown.escape)="cancelEdit()"
                        />
                        <datalist [id]="fieldId + '-list'">
                          @for (id of suggestionsFor(row.provider); track id) {
                            <option [value]="id"></option>
                          }
                        </datalist>
                        <button
                          type="button"
                          class="btn btn-primary btn-xs"
                          data-testid="agent-model-save-btn"
                          [disabled]="!canSave()"
                          (click)="onSave()"
                        >
                          {{ e.phase === 'saving' ? 'Saving…' : 'Save' }}
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs"
                          data-testid="agent-model-cancel-btn"
                          [disabled]="e.phase === 'saving'"
                          (click)="cancelEdit()"
                        >
                          Cancel
                        </button>
                      </div>

                      <p
                        class="text-base-content-muted"
                        [class.text-error]="draftClass() === 'malformed'"
                        data-testid="agent-model-draft-class"
                      >
                        {{ draftHint() }}
                      </p>
                      <p class="text-base-content-muted">
                        {{ wholeWorkspaceNotice }}
                      </p>

                      @switch (e.phase) {
                        @case ('confirm-unlisted') {
                          <div
                            class="space-y-1 rounded bg-warning/10 p-1.5"
                            role="alert"
                            data-testid="agent-model-confirm-unlisted"
                          >
                            <p>
                              {{ e.message ?? unlistedQuestion(row.label) }}
                            </p>
                            <div class="flex gap-1">
                              <button
                                type="button"
                                class="btn btn-warning btn-xs"
                                data-testid="agent-model-confirm-unlisted-btn"
                                (click)="confirmUnlisted()"
                              >
                                Save anyway
                              </button>
                              <button
                                type="button"
                                class="btn btn-ghost btn-xs"
                                data-testid="agent-model-confirm-unlisted-back"
                                (click)="backToEditing()"
                              >
                                Back
                              </button>
                            </div>
                          </div>
                        }
                        @case ('guard-failed') {
                          <p
                            class="flex flex-wrap items-center gap-1.5 text-warning"
                            role="alert"
                            data-testid="agent-model-guard-failed"
                          >
                            <span>{{ guardFailedCopy }}</span>
                            <button
                              type="button"
                              class="btn btn-ghost btn-xs"
                              data-testid="agent-model-retry-btn"
                              [disabled]="locked()"
                              (click)="retry()"
                            >
                              Retry
                            </button>
                          </p>
                        }
                        @case ('save-failed') {
                          <p
                            class="break-words text-error"
                            role="alert"
                            data-testid="agent-model-save-failed"
                          >
                            Not saved: {{ e.message }}
                          </p>
                        }
                      }
                    </div>
                  }
                }
              </li>
            }
          </ul>
        }
      } @else if (store.error(); as loadError) {
        <p
          class="flex flex-wrap items-center gap-1.5"
          data-testid="agent-model-load-error"
        >
          <span class="text-error">Models unavailable: {{ loadError }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            [disabled]="store.loading()"
            (click)="reload()"
          >
            Reload
          </button>
        </p>
      } @else {
        <p class="text-base-content-muted" data-testid="agent-model-loading">
          Loading models…
        </p>
      }
    </section>
  `,
})
export class AgentModelEditorComponent {
  protected readonly store = inject(AgentModelsStore);
  protected readonly harness = inject(HarnessHealthStore);
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  public readonly slug = input.required<string>();
  /** The view's one reconcile guard; every save confirms through it. */
  public readonly guard = input.required<ReconcileGuardComponent>();
  /** Another action on this card is in flight. */
  public readonly locked = input<boolean>(false);

  protected readonly fieldId = `ptah-agent-model-${++nextEditorId}`;
  protected readonly machineScopeCopy = MACHINE_SCOPE_COPY;
  protected readonly guardFailedCopy = GUARD_FAILED_COPY;
  protected readonly noFolderCopy = NO_FOLDER_COPY;
  protected readonly wholeWorkspaceNotice = RECONCILE_WHOLE_WORKSPACE_NOTICE;

  protected readonly edit = signal<EditState | null>(null);
  protected readonly draft = signal('');
  protected readonly notice = signal<RowNotice | null>(null);

  private readonly modelInput =
    viewChild<ElementRef<HTMLInputElement>>('modelInput');

  /**
   * Bumped by every save/sync chain and every workspace switch; a chain whose
   * number is no longer current stops at its next step.
   */
  private op = 0;

  public constructor() {
    // A draft belongs to the workspace it was typed in: a switch drops it and
    // stops any pending save or sync chain.
    let lastEpoch: number | undefined;
    effect(() => {
      const epoch = this.store.workspaceEpoch();
      const changed = lastEpoch !== undefined && epoch !== lastEpoch;
      lastEpoch = epoch;
      if (!changed) return;
      untracked(() => {
        this.op++;
        this.edit.set(null);
        this.draft.set('');
        this.notice.set(null);
      });
    });
  }

  protected readonly rows = computed<ModelRow[]>(() => {
    const snap = this.store.snapshot();
    if (snap === null) return [];
    const slug = this.slug();
    const lanes = this.store.laneDefaults();
    const unsupported = new Set(snap.unsupportedProviders);
    return AGENT_MODEL_PROVIDERS.map((provider) => {
      const label = PROVIDER_LABEL[provider];
      const resolved = resolveAgentModel(snap, slug, provider);
      if (resolved === undefined) {
        return {
          provider,
          label,
          value: null,
          source: emptySource(provider, lanes),
          badge: null,
          unsupported: unsupported.has(provider),
        };
      }
      const key = resolved.wildcard ? '*' : slug;
      const cls =
        snap.classification[resolved.scope][key]?.[provider] ??
        classifyAgentModelValue(
          provider,
          resolved.value,
          snap.lists?.[provider] ?? null,
        );
      return {
        provider,
        label,
        value: resolved.value,
        source:
          SOURCE_LABEL[resolved.scope][resolved.wildcard ? 'wildcard' : 'own'],
        badge: cls === 'empty' ? null : CLASS_BADGE[cls],
        unsupported: unsupported.has(provider),
      };
    });
  });

  /** The typed value's class, from the shared classifier over the server lists. */
  protected readonly draftClass = computed<AgentModelClass | null>(() => {
    const e = this.edit();
    if (e === null) return null;
    const lists = this.store.snapshot()?.lists ?? null;
    return classifyAgentModelValue(
      e.provider,
      this.draft(),
      lists?.[e.provider] ?? null,
    );
  });

  protected readonly draftHint = computed<string>(() => {
    const e = this.edit();
    if (e === null) return '';
    const label = PROVIDER_LABEL[e.provider];
    switch (this.draftClass()) {
      case 'empty':
        return e.scope === 'machine'
          ? "Saving an empty value clears this agent's machine default."
          : "Saving an empty value clears this agent's workspace override.";
      case 'malformed':
        return e.provider === 'claude'
          ? 'Use opus, sonnet, haiku or inherit.'
          : e.provider === 'opencode'
            ? 'Use the provider/model form, without spaces.'
            : `Not a valid ${label} model id (no spaces or line breaks).`;
      case 'listed':
        return `In ${label}'s model list.`;
      case 'unlisted':
        return `Not in ${label}'s model list; you will be asked to confirm.`;
      case 'unverifiable':
        return `${label}'s model list is unavailable, so this value cannot be checked.`;
      default:
        return '';
    }
  });

  protected readonly busyEditing = computed<boolean>(() => {
    const phase = this.edit()?.phase;
    return phase === 'saving' || phase === 'confirm-unlisted';
  });

  protected readonly canSave = computed<boolean>(() => {
    const e = this.edit();
    if (e === null || this.locked()) return false;
    if (e.phase === 'saving' || e.phase === 'confirm-unlisted') return false;
    return this.draftClass() !== 'malformed';
  });

  protected suggestionsFor(provider: AgentModelProvider): readonly string[] {
    return this.store.suggestions()[provider] ?? [];
  }

  protected placeholder(provider: AgentModelProvider): string {
    if (provider === 'claude') return 'opus, sonnet, haiku or inherit';
    if (provider === 'opencode') return 'provider/model';
    return 'model id';
  }

  protected unlistedQuestion(label: string): string {
    return `"${this.draft().trim()}" is not in ${label}'s model list. Save it anyway?`;
  }

  protected startEdit(provider: AgentModelProvider): void {
    const snap = this.store.snapshot();
    if (snap === null) return;
    const scope: AgentModelSettingsScope =
      ownValue(snap.workspace, this.slug(), provider) === undefined &&
      ownValue(snap.machine, this.slug(), provider) !== undefined
        ? 'machine'
        : 'workspace';
    this.notice.set(null);
    this.edit.set({
      provider,
      scope,
      phase: 'editing',
      message: null,
      confirmed: false,
    });
    this.draft.set(ownValue(snap[scope], this.slug(), provider) ?? '');
    afterNextRender(() => this.modelInput()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected setScope(scope: AgentModelSettingsScope): void {
    const e = this.edit();
    const snap = this.store.snapshot();
    if (e === null || snap === null) return;
    this.edit.set({ ...e, scope, phase: 'editing', message: null });
    this.draft.set(ownValue(snap[scope], this.slug(), e.provider) ?? '');
  }

  protected onDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
    const e = this.edit();
    if (e !== null && e.phase !== 'editing') {
      this.edit.set({
        ...e,
        phase: 'editing',
        message: null,
        confirmed: false,
      });
    }
  }

  /** Cancel: nothing is saved and nothing is said; the typed value is dropped. */
  protected cancelEdit(): void {
    if (this.edit()?.phase === 'saving') return;
    this.edit.set(null);
    this.draft.set('');
  }

  protected backToEditing(): void {
    const e = this.edit();
    if (e !== null) this.edit.set({ ...e, phase: 'editing', message: null });
  }

  protected async onSave(): Promise<void> {
    if (!this.canSave()) return;
    if (this.draftClass() === 'unlisted') {
      this.patch({ phase: 'confirm-unlisted', message: null });
      return;
    }
    await this.save(false);
  }

  protected async confirmUnlisted(): Promise<void> {
    await this.save(true);
  }

  /** Re-runs the guard and, when it agrees, the same save. */
  protected async retry(): Promise<void> {
    await this.save(this.edit()?.confirmed ?? false);
  }

  protected async reload(): Promise<void> {
    await this.store.load();
  }

  /** "Saved; provider copies not updated" → Sync again through the guard. */
  protected async syncAgain(): Promise<void> {
    const n = this.notice();
    if (n === null) return;
    const op = ++this.op;
    const ticket = this.store.ticket();
    const outcome = await this.guard().check({ confirmLabel: 'Sync' });
    if (!this.live(op, ticket) || outcome !== 'approved') return;
    await this.reconcileAndReport(op, ticket, n.provider);
  }

  private async save(confirmUnlisted: boolean): Promise<void> {
    const e = this.edit();
    if (e === null) return;
    const ticket = this.store.ticket();
    const workspaceRoot = ticket.workspaceRoot;
    if (workspaceRoot === null) {
      this.patch({ phase: 'save-failed', message: NO_FOLDER_COPY });
      return;
    }
    const op = ++this.op;
    this.patch({ phase: 'saving', message: null, confirmed: confirmUnlisted });

    const verdict = await this.guard().check({
      onlyWhenEdits: true,
      confirmLabel: 'Save model',
    });
    if (!this.live(op, ticket)) return;
    if (verdict === 'unverified') {
      this.patch({ phase: 'guard-failed' });
      return;
    }
    if (verdict === 'cancelled') {
      this.edit.set(null);
      this.draft.set('');
      return;
    }

    const value = this.draft().trim();
    let outcome: Awaited<ReturnType<SkillSynthesisRpcService['setAgentModel']>>;
    try {
      outcome = await this.rpc.setAgentModel({
        workspaceRoot,
        slug: this.slug(),
        provider: e.provider,
        scope: e.scope,
        value: value === '' ? null : value,
        ...(confirmUnlisted ? { confirmUnlisted: true } : {}),
      });
    } catch (err: unknown) {
      if (this.live(op, ticket)) {
        this.patch({ phase: 'save-failed', message: messageOf(err) });
      }
      return;
    }
    if (!this.live(op, ticket)) return;

    if (!outcome.ok) {
      if (outcome.code === 'MODEL_NOT_AVAILABLE') {
        this.patch({ phase: 'confirm-unlisted', message: outcome.message });
      } else if (outcome.code === 'UNAUTHORIZED_WORKSPACE') {
        this.edit.set(null);
        this.draft.set('');
        this.notice.set({
          provider: e.provider,
          kind: 'info',
          text: WORKSPACE_CHANGED_COPY,
        });
        await this.store.load();
      } else {
        this.patch({ phase: 'save-failed', message: outcome.message });
      }
      return;
    }

    const adopted = this.store.applySaved(
      ticket,
      e.scope,
      this.slug(),
      e.provider,
      outcome.result,
    );
    if (!adopted) return;
    this.edit.set(null);
    this.draft.set('');
    await this.reconcileAndReport(op, ticket, e.provider);
  }

  /** Whether the chain numbered `op` may take its next step. */
  private live(op: number, ticket: AgentModelsTicket): boolean {
    return (
      op === this.op &&
      !this.destroyRef.destroyed &&
      this.store.isCurrent(ticket)
    );
  }

  /** Reconcile after a save or Sync, and say on the row what it achieved. */
  private async reconcileAndReport(
    op: number,
    ticket: AgentModelsTicket,
    provider: AgentModelProvider,
  ): Promise<void> {
    // `HarnessHealthStore.reconcile` returns at once while another pass is
    // active (it checks this same flag synchronously on entry), and that pass
    // may have read the settings before this save.
    if (this.harness.reconciling()) {
      this.notice.set({
        provider,
        kind: 'sync-failed',
        text: SYNC_SKIPPED_COPY,
      });
      return;
    }
    await this.harness.reconcile();
    if (!this.live(op, ticket)) return;
    this.notice.set(this.reconcileNotice(provider));
  }

  /**
   * A transport/handler error, or a returned report with `writeFailed`
   * entries, is a failure with Sync as the retry; only a clean report clears
   * the notice.
   */
  private reconcileNotice(provider: AgentModelProvider): RowNotice | null {
    const error = this.harness.error();
    if (error !== null) {
      return {
        provider,
        kind: 'sync-failed',
        text: `Saved; provider copies not updated: ${error}`,
      };
    }
    const failures = reconcileWriteFailures(this.harness.health());
    if (failures.length === 0) return null;
    return {
      provider,
      kind: 'sync-failed',
      text: `Saved; provider copies not fully updated: ${describeWriteFailures(failures)}`,
    };
  }

  private patch(changes: Partial<EditState>): void {
    const e = this.edit();
    if (e !== null) this.edit.set({ ...e, ...changes });
  }
}

/** The agent's own (non-wildcard) value in one layer. */
function ownValue(
  layer: AgentModelSettingsValue | null,
  slug: string,
  provider: AgentModelProvider,
): string | undefined {
  const resolved = resolveAgentModel({ workspace: layer }, slug, provider);
  return resolved !== undefined && !resolved.wildcard
    ? resolved.value
    : undefined;
}

/** What an empty row inherits. */
function emptySource(
  provider: AgentModelProvider,
  lanes: Partial<Record<AgentModelProvider, string>> | null,
): string {
  if (provider === 'claude') return 'template';
  if (lanes === null) return 'inherits: lane default';
  const lane = lanes[provider]?.trim() ?? '';
  return lane === ''
    ? 'inherits: CLI default'
    : `inherits: ${lane} (lane default)`;
}
