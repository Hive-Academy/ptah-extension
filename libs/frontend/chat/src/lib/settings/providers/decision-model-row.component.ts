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
import {
  type AgentSetConfigParams,
  type DecisionModelStatusDto,
} from '@ptah-extension/shared';
import { SettingsSaveFeedbackService } from '../feedback/settings-save-feedback.service';
import {
  DECISION_KIND_OPTIONS,
  JEV_DEFAULT_MODEL,
  buildDecisionRow,
  decisionDraftForKind,
  decisionDraftFrom,
  decisionModelInput,
  decisionModelLabel,
  endpointFieldError,
  hostSaveSentence,
  parseDecisionModelStatus,
  sameDecisionSelection,
  type DecisionEndpointField,
  type DecisionModelDraft,
} from './decision-model-row.view';
import {
  DECISION_ACTION,
  DECISION_FOCUS,
  DECISION_INPUT,
  DECISION_INPUT_INVALID,
  DECISION_KEY_TEXT,
  DECISION_LABEL,
  DECISION_SELECT,
  DecisionModelKeyFieldComponent,
  type DecisionKeyedKind,
} from './decision-model-key-field.component';
import {
  IDLE_SUGGESTIONS,
  decisionModelHelp,
  hasDecisionSuggestions,
  loadDecisionSuggestions,
  type DecisionSuggestions,
} from './decision-model-suggestions';

const CELL = `flex w-full min-w-0 items-center gap-1 whitespace-nowrap rounded px-1 text-left text-xs text-base-content hover:bg-base-200 hover:underline ${DECISION_FOCUS}`;
const RPC_TIMEOUT_MS = 5_000;
const SAVE_FAILED =
  'Could not save the decision model. The saved choice is unchanged.';

type WriteResult = { ok: true } | { ok: false; message: string };

/**
 * The Decision model row of Background Model Roles (TASK_2026_646 Req 1; TASK_2026_684 C13). It reads and writes only
 * through `agent:getConfig` / `agent:setConfig` (`decisionModel`, write-only `decisionModelJevApiKey` and
 * `decisionModelCustomApiKey`), and saves through `SettingsSaveFeedbackService.saveGeneric` like the other Settings
 * writes outside the Providers state.
 * - Kinds: Unset | Ollama decision model | Ollama Cloud | TypeSafe Jev | Custom endpoint | Structured-output model.
 *   Unset saves at once; the other kinds save with Save once their required fields are filled and valid.
 * - Ollama and Ollama Cloud models are free text; their suggestions list only decision-capable models
 *   (`agent:listDecisionModels`), with a notice when that filter could not be fully applied. Nothing is ever
 *   preselected. A structured-output model lists its provider's catalogue unfiltered (it has no structured-output flag).
 * - Ollama Cloud has no key field: it uses the Ollama Cloud provider key, set up through the provider wizard.
 * - The custom endpoint takes a base URL, a model and an optional key. Field hints mirror the host's URL rule and
 *   D4 (a key needs https unless the endpoint is on this machine); the host stays the authority on save.
 * - The key field (Jev, custom) is a password input that is never prefilled; a stored key is never shown. Removing the
 *   key is its own button, so an empty field never deletes it; it is hidden while the host reports no stored key.
 * - A status read that fails shows "not reachable" and never blocks saving. So does an `unset` selection the host
 *   reports as `unreachable` (it could not read the stored selection): that save offers no Undo, so it can never
 *   write `unset` over the real stored choice. Host `detail` is plain text. Logs carry fixed text and an error type.
 */
@Component({
  selector: 'ptah-decision-model-row',
  standalone: true,
  imports: [
    LucideAngularModule,
    NativePopoverComponent,
    ProviderMarkComponent,
    DecisionModelKeyFieldComponent,
  ],
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
                @if (draft().kind === 'ollama-cloud') {
                  <p
                    class="text-xs text-base-content-muted"
                    data-testid="decision-cloud-help"
                  >
                    Uses your Ollama Cloud provider key and calls ollama.com
                    directly. Without a key, requests go through your signed-in
                    local Ollama. Chat and routing share one Ollama Cloud plan.
                  </p>
                  <button
                    type="button"
                    [class]="action"
                    (click)="setUpOllamaCloud()"
                    data-testid="decision-cloud-setup"
                  >
                    Set up Ollama Cloud
                  </button>
                }
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
                @if (draft().kind === 'custom') {
                  <label for="decision-model-base-url" [class]="label"
                    >Base URL</label
                  >
                  <input
                    id="decision-model-base-url"
                    type="text"
                    inputmode="url"
                    [class]="
                      fieldError('baseUrl') ? invalidInputClass : inputClass
                    "
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://decide.example.com"
                    [attr.aria-invalid]="fieldError('baseUrl') ? 'true' : null"
                    [attr.aria-describedby]="describedBy('baseUrl')"
                    [value]="draft().baseUrl"
                    [disabled]="busy() || disabled()"
                    (input)="onField('baseUrl', $event)"
                    (keydown.enter)="save()"
                    data-testid="decision-base-url"
                  />
                  <p
                    id="decision-model-base-url-help"
                    class="text-xs text-base-content-muted"
                    data-testid="decision-base-url-help"
                  >
                    Requests go to this URL plus /v1/systemone. With an API key
                    it must use https, unless the endpoint is on this machine
                    (localhost, [::1] or 127.x.x.x).
                  </p>
                  @if (fieldError('baseUrl'); as message) {
                    <p
                      id="decision-model-base-url-error"
                      role="alert"
                      class="text-xs text-error"
                      data-testid="decision-base-url-error"
                    >
                      {{ message }}
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
                    [class]="
                      fieldError('model') ? invalidInputClass : inputClass
                    "
                    autocomplete="off"
                    spellcheck="false"
                    [attr.aria-invalid]="fieldError('model') ? 'true' : null"
                    [attr.aria-describedby]="describedBy('model')"
                    [placeholder]="
                      draft().kind === 'jev' ? jevDefaultModel : ''
                    "
                    [value]="draft().model"
                    [disabled]="busy() || disabled()"
                    (input)="onField('model', $event)"
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
                  @if (fieldError('model'); as message) {
                    <p
                      id="decision-model-model-error"
                      role="alert"
                      class="text-xs text-error"
                      data-testid="decision-model-error"
                    >
                      {{ message }}
                    </p>
                  }
                }
                @if (keyedKind(); as keyKind) {
                  <ptah-decision-model-key-field
                    [label]="keyText[keyKind].label"
                    [value]="apiKey()"
                    [disabled]="busy() || disabled()"
                    [showRemove]="keyMayBeStored()"
                    (valueChange)="apiKey.set($event)"
                    (remove)="removeKey()"
                  />
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
                <p
                  class="px-1 text-xs text-base-content-muted"
                  data-testid="decision-footer"
                >
                  {{ footer() }}
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
  protected readonly focusRing = DECISION_FOCUS;
  protected readonly action = DECISION_ACTION;
  protected readonly cellClass = CELL;
  protected readonly selectClass = DECISION_SELECT;
  protected readonly inputClass = DECISION_INPUT;
  protected readonly invalidInputClass = DECISION_INPUT_INVALID;
  protected readonly label = DECISION_LABEL;
  protected readonly kinds = DECISION_KIND_OPTIONS;
  protected readonly jevDefaultModel = JEV_DEFAULT_MODEL;
  protected readonly keyText = DECISION_KEY_TEXT;

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
  /** The key being typed for the draft's kind (Jev or custom); never filled from the host, never logged. */
  protected readonly apiKey = signal('');
  protected readonly suggestions =
    signal<DecisionSuggestions>(IDLE_SUGGESTIONS);
  private suggestionRequest = 0;
  /** The kind whose key this row just removed; a later key save or a host status that knows the key wins. */
  private readonly keyRemoved = signal<DecisionKeyedKind | null>(null);

  private readonly cellRef = viewChild<ElementRef<HTMLButtonElement>>('cell');
  private readonly keyFieldRef = viewChild(DecisionModelKeyFieldComponent);

  /** Save triggers wait while any save runs (D3). */
  protected readonly busy = this.feedback.saving;
  protected readonly row = computed(() => buildDecisionRow(this.status()));
  protected readonly markProviderId = computed(() => {
    const selection = this.status()?.selection;
    if (selection?.kind === 'ollama' || selection?.kind === 'ollama-cloud')
      return selection.kind;
    return selection?.kind === 'structured' ? selection.providerId : '';
  });
  private readonly pendingInput = computed(() =>
    decisionModelInput(this.draft()),
  );
  /** The draft's kind when its key is entered in this row. */
  protected readonly keyedKind = computed((): DecisionKeyedKind | null => {
    const kind = this.draft().kind;
    return kind === 'jev' || kind === 'custom' ? kind : null;
  });
  private readonly keyTyped = computed(
    () => this.keyedKind() !== null && this.apiKey().trim() !== '',
  );
  /**
   * The host's knowledge of the draft kind's stored key: `apiKeyStored` when the saved selection is that kind and
   * reports it, else a saved Jev selection's state (`ready` = stored, `no-credential` = none); `null` when unknown.
   */
  private readonly keyStoredKnown = computed((): boolean | null => {
    const kind = this.keyedKind();
    const status = this.status();
    if (!kind || status?.selection.kind !== kind) return null;
    if (status.apiKeyStored !== undefined) return status.apiKeyStored;
    if (kind === 'jev' && status.state === 'ready') return true;
    if (kind === 'jev' && status.state === 'no-credential') return false;
    return null;
  });
  /**
   * Whether "Remove stored key" is offered: what the host knows, else shown unless this row has just removed the key
   * of that kind.
   */
  protected readonly keyMayBeStored = computed(() => {
    const kind = this.keyedKind();
    if (!kind) return false;
    return this.keyStoredKnown() ?? this.keyRemoved() !== kind;
  });
  /** The first invalid custom endpoint field (D4 counts a typed key or one the host reports stored). */
  private readonly endpointError = computed(() =>
    endpointFieldError(
      this.draft(),
      this.keyTyped() ||
        (this.keyedKind() === 'custom' && this.keyStoredKnown() === true),
    ),
  );
  protected readonly canSave = computed(() => {
    const selection = this.pendingInput();
    if (!selection || this.busy() || this.disabled()) return false;
    if (this.endpointError()) return false;
    return (
      this.keyTyped() ||
      !sameDecisionSelection(selection, this.status()?.selection ?? null)
    );
  });
  protected readonly modelLabel = computed(() =>
    decisionModelLabel(this.draft().kind),
  );
  protected readonly modelHelp = computed(() =>
    decisionModelHelp(this.draft(), this.suggestions()),
  );
  /** The editor footer: only claims an Undo the next save will really offer (see `save`). */
  protected readonly footer = computed(() => {
    const base =
      'Unset saves at once and sends no decision request. Other choices save with Save.';
    if (!this.status())
      return `${base} The saved choice could not be read, so a save offers no Undo.`;
    return this.keyedKind()
      ? `${base} Undo puts the previous choice back; a key change has no Undo.`
      : `${base} Undo puts the previous choice back.`;
  });

  ngOnInit(): void {
    void this.reload();
  }

  /**
   * The inline hint of a custom endpoint field, or `null`. A field that is still empty shows none: Save is disabled
   * until it is filled, and a hint before any typing would only be noise.
   */
  protected fieldError(field: DecisionEndpointField): string | null {
    const error = this.endpointError();
    if (!error || error.field !== field) return null;
    return this.draft()[field].trim() ? error.message : null;
  }

  protected describedBy(field: DecisionEndpointField): string {
    const id = `decision-model-${field === 'baseUrl' ? 'base-url' : 'model'}`;
    return this.fieldError(field) ? `${id}-help ${id}-error` : `${id}-help`;
  }

  /**
   * Reads the row's status. A failed read keeps the last status out of view and shows "not reachable". So does an
   * unread selection (`unset` + `unreachable`, agent-rpc.handlers.ts `readDecisionModelStatus`): with no status, a
   * save offers no Undo, so the row never writes `unset` over the real stored selection.
   */
  protected async reload(): Promise<void> {
    if (!this.status()) this.load.set('loading');
    try {
      const result = await this.rpc.call('agent:getConfig', undefined, {
        timeout: RPC_TIMEOUT_MS,
      });
      const parsed = result.isSuccess()
        ? parseDecisionModelStatus(result.data.decisionModel)
        : null;
      const status = parsed && !selectionNotRead(parsed) ? parsed : null;
      this.status.set(status);
      this.load.set(status ? 'ready' : 'error');
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'agent:getConfig failed', {
        errorType: errorTypeOf(error),
      });
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
    this.apiKey.set('');
    this.editing.set(true);
    void this.refreshSuggestions();
  }

  /** Closes the editor; focus goes back to the row's cell. The typed key is dropped. */
  protected close(): void {
    if (!this.editing()) return;
    this.editing.set(false);
    this.apiKey.set('');
    afterNextRender(() => this.cellRef()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected onKind(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const value = event.target.value;
    const kind = DECISION_KIND_OPTIONS.find(
      (option) => option.value === value,
    )?.value;
    if (!kind) return;
    this.draft.set(
      decisionDraftForKind(kind, this.status()?.selection ?? null),
    );
    // A key typed for one kind is never sent for another.
    this.apiKey.set('');
    void this.refreshSuggestions();
    if (kind === 'unset') void this.save();
  }

  protected onProvider(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement)) return;
    const providerId = event.target.value;
    this.draft.update((draft) => ({ ...draft, providerId, model: '' }));
    void this.refreshSuggestions();
  }

  /** A typed base URL or model; suggestions never write here (no preselection). */
  protected onField(field: DecisionEndpointField, event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const value = event.target.value;
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  /** Ollama Cloud's key is the provider key (D1): the provider wizard sets it up, not this row. */
  protected setUpOllamaCloud(): void {
    this.close();
    this.setupProviderRequested.emit('ollama-cloud');
  }

  /**
   * Saves the draft with Undo. A typed Jev or custom endpoint key goes in the same write (trimmed; blank is never
   * sent, so it cannot delete the stored key) and that save offers no Undo: a key cannot be put back. With no status
   * read (`status` is `null`, including an unread selection) there is no Undo either: the previous choice is unknown.
   */
  protected async save(): Promise<void> {
    const selection = this.pendingInput();
    if (!selection || !this.canSave()) return;
    const keyKind = this.keyedKind();
    const key = keyKind ? this.apiKey().trim() : '';
    const previous = this.status()?.selection ?? null;
    const params: AgentSetConfigParams = !key
      ? { decisionModel: selection }
      : keyKind === 'jev'
        ? { decisionModel: selection, decisionModelJevApiKey: key }
        : { decisionModel: selection, decisionModelCustomApiKey: key };
    const result = await this.feedback.saveGeneric({
      label: 'decision model',
      write: () => this.write(params, SAVE_FAILED),
      undo:
        previous && !key
          ? () => this.write({ decisionModel: previous }, SAVE_FAILED)
          : null,
    });
    if (result !== 'saved') return;
    this.apiKey.set('');
    if (key) this.keyRemoved.set(null);
  }

  /**
   * The explicit delete: `''` for the draft kind's key field removes the stored key (no Undo). The button then goes
   * away, so focus moves to the key field.
   */
  protected async removeKey(): Promise<void> {
    const kind = this.keyedKind();
    if (!kind || this.busy() || this.disabled()) return;
    this.apiKey.set('');
    const params: AgentSetConfigParams =
      kind === 'jev'
        ? { decisionModelJevApiKey: '' }
        : { decisionModelCustomApiKey: '' };
    const result = await this.feedback.saveGeneric({
      label: DECISION_KEY_TEXT[kind].removal,
      write: () => this.write(params, DECISION_KEY_TEXT[kind].removeFailed),
      undo: null,
    });
    if (result !== 'saved') return;
    this.keyRemoved.set(kind);
    afterNextRender(() => this.keyFieldRef()?.focus(), {
      injector: this.injector,
    });
  }

  /**
   * One `agent:setConfig` write, then a status re-read; a failed re-read shows "not reachable", not a failed save.
   * The toast carries a fixed sentence: the row's own, or one of the host's fixed shared constants (DC12).
   */
  private async write(
    params: AgentSetConfigParams,
    failed: string,
  ): Promise<WriteResult> {
    try {
      const result = await this.rpc.call('agent:setConfig', params, {
        timeout: RPC_TIMEOUT_MS,
      });
      if (!result.isSuccess() || !result.data.success) {
        const hostError = result.isSuccess() ? result.data.error : undefined;
        return { ok: false, message: hostSaveSentence(hostError) ?? failed };
      }
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'agent:setConfig failed', {
        errorType: errorTypeOf(error),
      });
      return { ok: false, message: failed };
    }
    await this.reload();
    return { ok: true };
  }

  /** Loads the suggestions for the draft's kind; a newer request wins. Never writes `draft.model` (no preselection). */
  private async refreshSuggestions(): Promise<void> {
    const request = ++this.suggestionRequest;
    const { kind, providerId } = this.draft();
    if (!hasDecisionSuggestions(kind, providerId)) {
      this.suggestions.set(IDLE_SUGGESTIONS);
      return;
    }
    this.suggestions.set({ status: 'loading', ids: [], filter: null });
    try {
      const next = await loadDecisionSuggestions(
        kind,
        providerId,
        this.rpc,
        this.loader,
      );
      if (request === this.suggestionRequest) this.suggestions.set(next);
    } catch (error: unknown) {
      this.logger.warn('DecisionModelRow', 'model suggestions failed', {
        errorType: errorTypeOf(error),
      });
      if (request === this.suggestionRequest)
        this.suggestions.set({ status: 'error', ids: [], filter: null });
    }
  }
}

/**
 * The host's answer when it could not read the stored selection (Batch 40a D1): an `unset` selection with state
 * `unreachable`. A stored `unset` comes back with state `unset`, so this pair never describes a real choice.
 */
function selectionNotRead(status: DecisionModelStatusDto): boolean {
  return status.selection.kind === 'unset' && status.state === 'unreachable';
}

/** A safe log classification: the constructor name, never the error's message, stack or fields (P4 S-3). */
function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}
