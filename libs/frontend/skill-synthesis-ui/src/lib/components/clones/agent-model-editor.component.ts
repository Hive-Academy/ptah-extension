/**
 * Per-agent model control on the desktop Agents tab (TASK_2026_609, plan C6).
 *
 * {@link AgentModelsStore} loads the two settings layers once per Agents-tab
 * entry, Refresh and workspace switch; {@link AgentModelEditorComponent} is the
 * inline section on each agent card that shows and edits them.
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
 * The guard resolves `false` for both, and `reconcile-guard.ts` stays as it
 * is. The editor tells them apart from the state the guard leaves behind in
 * `HarnessHealthStore`: the guard could not check when the store was busy as
 * it was called, ends with an error or no report, or still holds the report
 * from before the call (no fresh read happened). A Cancel always follows a
 * fresh, successful read, so the store then holds a new report and no error.
 * The failure keeps the typed value and offers Retry; Cancel closes silently.
 */
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injectable,
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
import { VSCodeService } from '@ptah-extension/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import {
  AGENT_MODEL_PROVIDERS,
  classifyAgentModelValue,
  resolveAgentModel,
  type AgentListCliModelsResult,
  type AgentModelClass,
  type AgentModelProvider,
  type AgentModelSettingsScope,
  type AgentModelSettingsValue,
  type AgentOrchestrationConfig,
  type SkillSynthesisGetAgentModelsResult,
  type SkillSynthesisSetAgentModelResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
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

/** Each lane's default model in `agent:getConfig`; `''` = CLI default. */
function laneDefaults(
  config: AgentOrchestrationConfig,
): Partial<Record<AgentModelProvider, string>> {
  return {
    codex: config.codexModel,
    copilot: config.copilotModel,
    cursor: config.cursorModel,
    opencode: config.opencodeModel ?? '',
  };
}

function suggestionIds(
  lists: AgentListCliModelsResult,
): Partial<Record<AgentModelProvider, readonly string[]>> {
  const ids = (entries: readonly { id: string }[] | undefined) =>
    (entries ?? []).map((entry) => entry.id);
  return {
    codex: ids(lists.codex),
    copilot: ids(lists.copilot),
    cursor: ids(lists.cursor),
    opencode: ids(lists.opencode),
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The model settings the Agents tab shows. Provided by the Library view, so it
 * lives and dies with that surface; nothing here polls.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- per-surface, provided by SkillClonesViewComponent (same as CloneBulkRebaseService).
@Injectable()
export class AgentModelsStore {
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly vscode = inject(VSCodeService);

  private readonly _snapshot =
    signal<SkillSynthesisGetAgentModelsResult | null>(null);
  private readonly _suggestions = signal<
    Partial<Record<AgentModelProvider, readonly string[]>>
  >({});
  private readonly _laneDefaults = signal<Partial<
    Record<AgentModelProvider, string>
  > | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  public readonly snapshot = this._snapshot.asReadonly();
  /** Input suggestions per provider (never used to classify). */
  public readonly suggestions = this._suggestions.asReadonly();
  /** `null` while `agent:getConfig` is unread or failed. */
  public readonly laneDefaults = this._laneDefaults.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  /** Set by the first {@link load}; a workspace switch reloads only after it. */
  private requested = false;
  private loadSeq = 0;

  public constructor() {
    // WORKSPACE_CHANGED updates `workspaceRoot` here; Electron does not reload
    // the view, so the models read for the old workspace must be replaced.
    let lastRoot: string | undefined;
    effect(() => {
      const root = this.vscode.config()?.workspaceRoot ?? '';
      const changed = lastRoot !== undefined && root !== lastRoot;
      lastRoot = root;
      if (changed && this.requested) untracked(() => void this.load());
    });
  }

  /** Read both layers, the suggestion lists and the lane defaults. */
  public async load(): Promise<void> {
    this.requested = true;
    const seq = ++this.loadSeq;
    this._loading.set(true);
    // `then` turns a synchronous throw into a rejection, so `load` never rejects.
    const attempt = <T>(call: () => Promise<T>): Promise<T> =>
      Promise.resolve().then(call);
    const [models, lists, config] = await Promise.allSettled([
      attempt(() => this.rpc.getAgentModels()),
      attempt(() => this.rpc.listCliModels()),
      attempt(() => this.rpc.getAgentLaneConfig()),
    ]);
    if (seq !== this.loadSeq) return;
    if (models.status === 'fulfilled') {
      this._snapshot.set(models.value);
      this._error.set(null);
    } else {
      this._snapshot.set(null);
      this._error.set(messageOf(models.reason));
    }
    this._suggestions.set(
      lists.status === 'fulfilled' ? suggestionIds(lists.value) : {},
    );
    this._laneDefaults.set(
      config.status === 'fulfilled' ? laneDefaults(config.value) : null,
    );
    this._loading.set(false);
  }

  /** Adopt a successful save's re-read layers and its classification. */
  public applySaved(
    scope: AgentModelSettingsScope,
    slug: string,
    provider: AgentModelProvider,
    result: SkillSynthesisSetAgentModelResult,
  ): void {
    this._snapshot.update((current) => {
      if (current === null) return current;
      const layer = { ...current.classification[scope] };
      const entry = { ...(layer[slug] ?? {}) };
      if (result.classification === 'empty') delete entry[provider];
      else entry[provider] = result.classification;
      layer[slug] = entry;
      return {
        ...current,
        machine: result.machine,
        workspace: result.workspace,
        classification: { ...current.classification, [scope]: layer },
      };
    });
  }
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
    if (!(await this.guard().confirm({ confirmLabel: 'Sync' }))) return;
    await this.harness.reconcile();
    this.reportReconcile(n.provider);
  }

  private async save(confirmUnlisted: boolean): Promise<void> {
    const e = this.edit();
    const workspaceRoot = this.store.snapshot()?.workspaceRoot ?? null;
    if (e === null) return;
    if (workspaceRoot === null) {
      this.patch({ phase: 'save-failed', message: NO_FOLDER_COPY });
      return;
    }
    this.patch({ phase: 'saving', message: null, confirmed: confirmUnlisted });

    const verdict = await this.runGuard();
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
      this.patch({ phase: 'save-failed', message: messageOf(err) });
      return;
    }

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

    this.store.applySaved(e.scope, this.slug(), e.provider, outcome.result);
    this.edit.set(null);
    this.draft.set('');
    await this.harness.reconcile();
    this.reportReconcile(e.provider);
  }

  /**
   * The guard, with its `false` split into Cancel and "could not check" from
   * the state it leaves in `HarnessHealthStore` (see the file header).
   */
  private async runGuard(): Promise<'confirmed' | 'cancelled' | 'unverified'> {
    const wasBusy = this.harness.busy();
    const before = this.harness.health();
    const confirmed = await this.guard().confirm({
      onlyWhenEdits: true,
      confirmLabel: 'Save model',
    });
    if (confirmed) return 'confirmed';
    const after = this.harness.health();
    const unverified =
      wasBusy ||
      this.harness.error() !== null ||
      after === null ||
      after === before;
    return unverified ? 'unverified' : 'cancelled';
  }

  private reportReconcile(provider: AgentModelProvider): void {
    const error = this.harness.error();
    this.notice.set(
      error === null
        ? null
        : {
            provider,
            kind: 'sync-failed',
            text: `Saved; provider copies not updated: ${error}`,
          },
    );
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
