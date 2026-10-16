import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ChevronDown, LucideAngularModule, X } from 'lucide-angular';
import {
  NativePopoverComponent,
  PROVIDER_MODELS_LOADER,
  ProviderMarkComponent,
  type ProviderIdentityOption,
} from '@ptah-extension/ui';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type {
  AgentSetConfigParams,
  DecisionModelStatusDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  DECISION_KIND_OPTIONS,
  JEV_DEFAULT_MODEL,
  buildDecisionRow,
  decisionDraftForKind,
  decisionDraftFrom,
  decisionModelInput,
  parseDecisionModelStatus,
  sameDecisionSelection,
  type DecisionModelDraft,
  type DecisionModelKind,
} from './provider-consumer-rows';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
const ACTION = `btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[11px] font-medium text-base-content underline underline-offset-2 ${FOCUS}`;
const CELL = `flex w-full min-w-0 items-center gap-1 whitespace-nowrap rounded px-1 text-left text-xs text-base-content hover:bg-base-200 hover:underline ${FOCUS}`;
const SELECT = `select select-bordered select-sm min-h-8 w-full border-base-content-muted bg-base-100 text-xs text-base-content ${FOCUS}`;
const INPUT = `input input-bordered input-sm min-h-8 w-full min-w-0 border-base-content-muted bg-base-100 font-mono text-xs text-base-content ${FOCUS}`;
const LABEL = 'block text-xs font-semibold text-base-content-muted';
const RPC_TIMEOUT_MS = 5_000;
const SAVE_FAILED =
  'Could not save the decision model. The saved choice is unchanged.';
const KEY_REMOVE_FAILED = 'Could not remove the TypeSafe Jev API key.';

type WriteResult = { ok: true } | { ok: false; message: string };

/** Model-name suggestions for the draft's server; `idle` when the kind has no list source (Unset, Jev). */
interface Suggestions {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly ids: readonly string[];
}

/**
 * The Decision model row of Background Model Roles (TASK_2026_646 Req 1, plan part A §11). It reads and writes only
 * through `agent:getConfig` / `agent:setConfig` (`decisionModel`, write-only `decisionModelJevApiKey`), and saves
 * through `SettingsSaveFeedbackService.saveGeneric` like the other Settings writes outside the Providers state.
 * - The kind picker offers exactly Unset | Ollama decision model | TypeSafe Jev | Structured-output model. Unset
 *   saves at once; the other kinds save with Save once their required fields are filled.
 * - Ollama's model is free text; its suggestions come from the page's `PROVIDER_MODELS_LOADER` for `ollama` (the
 *   catalogue the provider picker uses), never a list fixed in code (Req 1.2). A structured-output model is one of
 *   the configured providers (`providers`) and a model of its catalogue that supports tool use.
 * - The Jev key field is a password input that is never prefilled; a stored key is never shown. Removing the key is
 *   its own button, so an empty field never deletes it.
 * - A status read that fails shows "not reachable" and never blocks saving. Host `detail` is plain text.
 */
@Component({
  selector: 'ptah-decision-model-row',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent, ProviderMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <article
      data-testid="consumer-row-decision"
      [class.surface-2]="!editing()"
      [class.surface-3]="editing()"
      class="flex h-full min-w-0 flex-col gap-2 rounded-lg p-3"
    >
      <div class="flex min-w-0 items-start justify-between gap-2">
        <h3
          class="text-xs font-bold text-base-content"
          data-testid="consumer-name-decision"
        >
          {{ row().name }}
        </h3>
        <span
          class="badge badge-xs shrink-0 whitespace-nowrap border-base-300 bg-base-300 text-[9px] text-base-content"
          data-testid="consumer-tier-decision"
          >{{ load() === 'loading' ? 'loading' : row().stateLabel }}</span
        >
      </div>
      @if (load() === 'loading') {
        <div
          class="mt-auto flex flex-wrap items-center gap-1.5"
          data-testid="consumer-notloaded-decision"
        >
          <span class="text-xs text-base-content" role="status">Loading…</span>
        </div>
      } @else {
        <div class="mt-auto min-w-0 space-y-1.5">
          <ptah-native-popover
            class="consumer-cell-popover block w-full min-w-0"
            [isOpen]="editing()"
            placement="bottom-start"
            [hasBackdrop]="true"
            backdropClass="transparent"
            (closed)="close()"
          >
            <button
              #cell
              trigger
              type="button"
              [class]="cellClass"
              [attr.aria-disabled]="busy() ? 'true' : null"
              [attr.aria-label]="
                row().name + ': ' + row().cellLabel + '. Change'
              "
              [attr.aria-expanded]="editing()"
              [title]="row().cellLabel"
              aria-haspopup="dialog"
              (click)="toggle()"
              data-testid="consumer-edit-decision"
            >
              <ptah-provider-mark
                [providerId]="markProviderId()"
                fallback="Bot"
              />
              <span
                class="min-w-0 truncate"
                data-testid="consumer-summary-decision"
                >{{ row().cellLabel }}</span
              >
              <lucide-angular
                [img]="ChevronIcon"
                class="h-3 w-3 shrink-0 text-base-content-muted"
                aria-hidden="true"
              />
            </button>
            @if (editing()) {
              <div
                content
                role="dialog"
                aria-label="Choose the decision model"
                class="relative w-[27rem] max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal p-2 text-left text-xs"
                data-testid="consumer-editor-decision"
              >
                <button
                  type="button"
                  [class]="
                    'btn btn-ghost btn-xs btn-square absolute right-3 top-3 z-10 min-h-6 ' +
                    focusRing
                  "
                  aria-label="Close"
                  (click)="close()"
                  data-testid="consumer-close-decision"
                >
                  <lucide-angular
                    [img]="CloseIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </button>
                <label for="decision-model-kind" [class]="label"
                  >Decision model</label
                >
                <select
                  id="decision-model-kind"
                  [class]="selectClass"
                  [disabled]="busy() || disabled()"
                  (change)="onKind($event)"
                  data-testid="decision-kind"
                >
                  @for (option of kinds; track option.value) {
                    <option
                      [value]="option.value"
                      [selected]="draft().kind === option.value"
                    >
                      {{ option.label }}
                    </option>
                  }
                </select>
                @if (draft().kind === 'structured') {
                  <label for="decision-model-provider" [class]="label"
                    >Provider</label
                  >
                  <select
                    id="decision-model-provider"
                    [class]="selectClass"
                    [disabled]="busy() || disabled()"
                    (change)="onProvider($event)"
                    data-testid="decision-provider"
                  >
                    <option value="" [selected]="draft().providerId === ''">
                      Choose a provider
                    </option>
                    @for (provider of providers(); track provider.id) {
                      <option
                        [value]="provider.id"
                        [selected]="draft().providerId === provider.id"
                      >
                        {{ provider.name }}
                      </option>
                    }
                  </select>
                  @if (providers().length === 0) {
                    <p
                      class="text-xs text-base-content"
                      data-testid="decision-no-providers"
                    >
                      No provider is configured. Set one up on Providers first.
                    </p>
                  }
                }
                @if (draft().kind !== 'unset') {
                  <label for="decision-model-model" [class]="label">{{
                    modelLabel()
                  }}</label>
                  <input
                    id="decision-model-model"
                    type="text"
                    list="decision-model-suggestions"
                    [class]="inputClass"
                    autocomplete="off"
                    spellcheck="false"
                    aria-describedby="decision-model-model-help"
                    [placeholder]="
                      draft().kind === 'jev' ? jevDefaultModel : ''
                    "
                    [value]="draft().model"
                    [disabled]="busy() || disabled()"
                    (input)="onModel($event)"
                    (keydown.enter)="save()"
                    data-testid="decision-model"
                  />
                  <datalist id="decision-model-suggestions">
                    @for (id of suggestions().ids; track id) {
                      <option [value]="id"></option>
                    }
                  </datalist>
                  <p
                    id="decision-model-model-help"
                    class="text-xs text-base-content-muted"
                    data-testid="decision-model-help"
                  >
                    {{ modelHelp() }}
                  </p>
                }
                @if (draft().kind === 'jev') {
                  <label for="decision-model-jev-key" [class]="label"
                    >TypeSafe Jev API key</label
                  >
                  <input
                    id="decision-model-jev-key"
                    type="password"
                    [class]="inputClass"
                    autocomplete="new-password"
                    spellcheck="false"
                    aria-describedby="decision-model-jev-key-help"
                    placeholder="Enter a new key to store it"
                    [value]="jevKey()"
                    [disabled]="busy() || disabled()"
                    (input)="onKey($event)"
                    data-testid="decision-jev-key"
                  />
                  <p
                    id="decision-model-jev-key-help"
                    class="text-xs text-base-content-muted"
                  >
                    Stored in this machine's secret storage. A stored key is
                    never shown here.
                  </p>
                  <button
                    type="button"
                    [class]="action"
                    [disabled]="busy() || disabled()"
                    (click)="removeJevKey()"
                    data-testid="decision-jev-key-remove"
                  >
                    Remove stored key
                  </button>
                }
                @if (draft().kind !== 'unset') {
                  <button
                    type="button"
                    [class]="
                      'btn btn-primary btn-sm min-h-8 disabled:border-base-content-muted disabled:bg-base-200 disabled:text-base-content-muted ' +
                      focusRing
                    "
                    [disabled]="!canSave()"
                    (click)="save()"
                    data-testid="decision-save"
                  >
                    Save decision model
                  </button>
                }
                <p class="px-1 text-xs text-base-content-muted">
                  Unset saves at once and sends no decision request. Other
                  choices save with Save, with Undo.
                </p>
              </div>
            }
          </ptah-native-popover>
          <p
            class="text-xs text-base-content"
            [attr.role]="row().attention ? 'alert' : null"
            data-testid="decision-state"
          >
            {{ row().stateMessage }}
          </p>
          @if (row().detail; as detail) {
            <p
              class="break-words text-xs text-base-content-muted"
              data-testid="decision-detail"
            >
              Detail: {{ detail }}
            </p>
          }
          @if (row().localityMessage; as locality) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="decision-locality"
            >
              {{ locality }}
            </p>
          }
          @if (row().confidenceMessage; as confidence) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="decision-confidence"
            >
              {{ confidence }}
            </p>
          }
          @if (row().setupProviderId; as providerId) {
            <button
              type="button"
              [class]="action"
              [attr.aria-label]="'Set up ' + row().setupProviderName"
              (click)="setupProviderRequested.emit(providerId)"
              data-testid="decision-setup"
            >
              Set up {{ row().setupProviderName }}
            </button>
          }
          @if (load() === 'error') {
            <button
              type="button"
              [class]="action"
              aria-label="Retry reading the decision model status"
              [disabled]="busy()"
              (click)="reload()"
              data-testid="decision-retry"
            >
              Retry
            </button>
          }
        </div>
      }
    </article>
  `,
  styles: `
    /* Same as the sibling rows: block width lets the cell's label truncate (its full text is the title). */
    :host ::ng-deep .consumer-cell-popover > .popover-trigger {
      display: block;
      min-width: 0;
    }
  `,
})
export class DecisionModelRowComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly feedback = inject(SettingsSaveFeedbackService);
  private readonly loader = inject(PROVIDER_MODELS_LOADER);
  private readonly injector = inject(Injector);

  protected readonly ChevronIcon = ChevronDown;
  protected readonly CloseIcon = X;
  protected readonly focusRing = FOCUS;
  protected readonly action = ACTION;
  protected readonly cellClass = CELL;
  protected readonly selectClass = SELECT;
  protected readonly inputClass = INPUT;
  protected readonly label = LABEL;
  protected readonly kinds = DECISION_KIND_OPTIONS;
  protected readonly jevDefaultModel = JEV_DEFAULT_MODEL;

  readonly disabled = input<boolean>(false);
  /** The configured provider connections a structured-output model can run on. */
  readonly providers = input<readonly ProviderIdentityOption[]>([]);
  readonly setupProviderRequested = output<string>();

  /** `agent:getConfig` state of this row; `error` shows "not reachable" and leaves saving open. */
  protected readonly load = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly status = signal<DecisionModelStatusDto | null>(null);
  protected readonly editing = signal(false);
  protected readonly draft = signal<DecisionModelDraft>(
    decisionDraftFrom(null),
  );
  /** The key being typed; never filled from the host. */
  protected readonly jevKey = signal('');
  protected readonly suggestions = signal<Suggestions>({
    status: 'idle',
    ids: [],
  });
  private suggestionRequest = 0;

  private readonly cellRef = viewChild<ElementRef<HTMLButtonElement>>('cell');

  /** Save triggers wait while any save runs (D3). */
  protected readonly busy = this.feedback.saving;
  protected readonly row = computed(() => buildDecisionRow(this.status()));
  protected readonly markProviderId = computed(() => {
    const selection = this.status()?.selection;
    if (selection?.kind === 'ollama') return 'ollama';
    return selection?.kind === 'structured' ? selection.providerId : '';
  });
  private readonly pendingInput = computed(() =>
    decisionModelInput(this.draft()),
  );
  protected readonly canSave = computed(() => {
    const selection = this.pendingInput();
    if (!selection || this.busy() || this.disabled()) return false;
    const keyTyped = selection.kind === 'jev' && this.jevKey().trim() !== '';
    return (
      keyTyped ||
      !sameDecisionSelection(selection, this.status()?.selection ?? null)
    );
  });
  protected readonly modelLabel = computed(() => {
    const kind = this.draft().kind;
    if (kind === 'jev') return 'Jev model (optional)';
    return kind === 'ollama' ? 'Ollama model' : 'Model with structured output';
  });
  protected readonly modelHelp = computed(() => {
    const { kind, providerId } = this.draft();
    const { status, ids } = this.suggestions();
    if (kind === 'jev') return `Empty uses ${JEV_DEFAULT_MODEL}.`;
    if (kind === 'structured' && !providerId)
      return 'Choose a provider to list its models.';
    if (status === 'loading') return 'Loading model suggestions…';
    if (status === 'error') return 'Could not list models. Type a model name.';
    if (ids.length === 0) return 'No model suggestions. Type a model name.';
    return kind === 'ollama'
      ? 'Suggestions come from your Ollama endpoint. Any model name it serves works.'
      : 'Suggestions list the models that support tool use, which structured output needs.';
  });

  ngOnInit(): void {
    void this.reload();
  }

  /** Reads the row's status. A failed read keeps the last status out of view and shows "not reachable". */
  protected async reload(): Promise<void> {
    if (!this.status()) this.load.set('loading');
    try {
      const result = await this.rpc.call('agent:getConfig', undefined, {
        timeout: RPC_TIMEOUT_MS,
      });
      const status = result.isSuccess()
        ? parseDecisionModelStatus(result.data.decisionModel)
        : null;
      this.status.set(status);
      this.load.set(status ? 'ready' : 'error');
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'agent:getConfig failed', error);
      this.status.set(null);
      this.load.set('error');
    }
  }

  protected toggle(): void {
    if (this.editing()) {
      this.close();
      return;
    }
    // While a save runs the cell is only aria-disabled (it keeps focus): the click is refused here (D3).
    if (this.busy()) return;
    this.draft.set(decisionDraftFrom(this.status()?.selection ?? null));
    this.jevKey.set('');
    this.editing.set(true);
    void this.refreshSuggestions();
  }

  /** Closes the editor; focus goes back to the row's cell. The typed key is dropped. */
  protected close(): void {
    if (!this.editing()) return;
    this.editing.set(false);
    this.jevKey.set('');
    afterNextRender(() => this.cellRef()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected onKind(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const kind = DECISION_KIND_OPTIONS.find(
      (option) => option.value === value,
    )?.value;
    if (!kind) return;
    this.draft.set(
      decisionDraftForKind(kind, this.status()?.selection ?? null),
    );
    if (kind !== 'jev') this.jevKey.set('');
    void this.refreshSuggestions();
    if (kind === 'unset') void this.save();
  }

  protected onProvider(event: Event): void {
    const providerId = (event.target as HTMLSelectElement).value;
    this.draft.update((draft) => ({ ...draft, providerId, model: '' }));
    void this.refreshSuggestions();
  }

  protected onModel(event: Event): void {
    const model = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => ({ ...draft, model }));
  }

  protected onKey(event: Event): void {
    this.jevKey.set((event.target as HTMLInputElement).value);
  }

  /**
   * Saves the draft with Undo. A typed Jev key goes in the same write (trimmed; blank is never sent, so it cannot
   * delete the stored key) and that save offers no Undo: a key cannot be put back.
   */
  protected async save(): Promise<void> {
    const selection = this.pendingInput();
    if (!selection || !this.canSave()) return;
    const key = selection.kind === 'jev' ? this.jevKey().trim() : '';
    const previous = this.status()?.selection ?? null;
    const params: AgentSetConfigParams = key
      ? { decisionModel: selection, decisionModelJevApiKey: key }
      : { decisionModel: selection };
    const result = await this.feedback.saveGeneric({
      label: 'decision model',
      write: () => this.write(params, SAVE_FAILED),
      undo:
        previous && !key
          ? () => this.write({ decisionModel: previous }, SAVE_FAILED)
          : null,
    });
    if (result === 'saved') this.jevKey.set('');
  }

  /** The explicit delete: `decisionModelJevApiKey: ''` removes the stored key (no Undo). */
  protected async removeJevKey(): Promise<void> {
    if (this.busy() || this.disabled()) return;
    this.jevKey.set('');
    await this.feedback.saveGeneric({
      label: 'removal of the TypeSafe Jev API key',
      write: () =>
        this.write({ decisionModelJevApiKey: '' }, KEY_REMOVE_FAILED),
      undo: null,
    });
  }

  /**
   * One `agent:setConfig` write, then a status re-read; a failed re-read shows "not reachable", not a failed save.
   * The toast carries a fixed sentence, never host text (the Settings save convention).
   */
  private async write(
    params: AgentSetConfigParams,
    failed: string,
  ): Promise<WriteResult> {
    try {
      const result = await this.rpc.call('agent:setConfig', params, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (!result.isSuccess() || !result.data.success)
        return { ok: false, message: failed };
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'agent:setConfig failed', error);
      return { ok: false, message: failed };
    }
    await this.reload();
    return { ok: true };
  }

  /** Loads the suggestions for the draft's server; a newer request wins. */
  private async refreshSuggestions(): Promise<void> {
    const request = ++this.suggestionRequest;
    const { kind, providerId } = this.draft();
    const source = suggestionSource(kind, providerId);
    if (!source) {
      this.suggestions.set({ status: 'idle', ids: [] });
      return;
    }
    this.suggestions.set({ status: 'loading', ids: [] });
    try {
      const result = await this.loader.listModels(source);
      const models =
        kind === 'structured'
          ? result.models.filter((model) => model.supportsToolUse)
          : result.models;
      if (request === this.suggestionRequest) {
        this.suggestions.set({
          status: result.error ? 'error' : 'ready',
          ids: models.map((model) => model.id),
        });
      }
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'model suggestions failed', error);
      if (request === this.suggestionRequest)
        this.suggestions.set({ status: 'error', ids: [] });
    }
  }
}

/** The provider whose catalogue suggests model names: Ollama for the Ollama kind, the chosen one for structured. */
function suggestionSource(
  kind: DecisionModelKind,
  providerId: string,
): string | null {
  if (kind === 'ollama') return 'ollama';
  return kind === 'structured' && providerId ? providerId : null;
}
