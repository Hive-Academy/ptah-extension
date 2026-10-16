import {
  getAnthropicProvider,
  type ProviderModelTier,
  type SkillLaneIdDto,
} from '@ptah-extension/shared';
import type {
  DecisionModelSelectionDto,
  DecisionModelSelectionInputDto,
  DecisionModelStateDto,
  DecisionModelStatusDto,
} from '@ptah-extension/shared';
import type {
  ProvidersSettingsPatch,
  ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { SettingScopeDisplay } from './setting-scope-row.component';

/**
 * Background-role rows (Batch 35, plan :765-774): the row derivation moved out of
 * `ProviderConsumerAssignmentsComponent` so the component only renders. Every function here is pure: the caller
 * passes in the state it read.
 */

/** The seven Background Model Roles: the six provider-assigned roles, then the decision model (TASK_2026_646 Req 1). */
export type BackgroundConsumerId =
  | 'memory-curator'
  | 'archaeologist'
  | 'synthesis'
  | 'judge'
  | 'replay'
  | 'judging-enhancement'
  | 'decision';

/** The six roles that take a provider and model from the providers settings; the decision model has its own row. */
export type ProviderConsumerId = Exclude<BackgroundConsumerId, 'decision'>;

/** The six provider-assigned roles in their fixed order. */
export const PROVIDER_CONSUMER_IDS: readonly ProviderConsumerId[] = [
  'memory-curator',
  'archaeologist',
  'synthesis',
  'judge',
  'replay',
  'judging-enhancement',
];

/** Every Background Model Roles row in display order (the summary's role count). */
export const BACKGROUND_ROLE_IDS: readonly BackgroundConsumerId[] = [
  ...PROVIDER_CONSUMER_IDS,
  'decision',
];

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
  readonly id: ProviderConsumerId;
  readonly name: string;
  readonly helperCopy: string | null;
  readonly defaultTier: ProviderModelTier;
  readonly requiresToolUse: boolean;
  readonly provider: string;
  readonly model: string;
  /** The full route in words, e.g. "Follows main agent → Claude · cli → Default (haiku tier)". */
  readonly resolvedSummary: string;
  /** The reassignment cell's text: "Follows main agent → {driver}" (no own provider) or "{provider} · {model}". */
  readonly cellLabel: string;
  /** True when the role has no provider of its own and runs on the main agent's route. */
  readonly followsMain: boolean;
  /** The Tier column: "{tier} tier" while the tier picks the model, else "direct model". */
  readonly tierLabel: string;
  readonly providerFieldName: string;
  readonly modelFieldName: string;
  readonly providerScope: SettingScopeDisplay;
  readonly modelScope: SettingScopeDisplay;
  /** True when a narrower layer than the default holds this key's value (the scope badge renders, D16). */
  readonly providerOverride: boolean;
  readonly modelOverride: boolean;
  /**
   * True when either key is not inherited (an override, or Mixed sources when the source is not known). Only then does
   * the row show its scope badges, inline after the Provider & model cell (D16; Gate V 36, V36-6: no Scope column).
   */
  readonly scopeShown: boolean;
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

export const JUDGING_HELPER_COPY =
  'Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.';

/** The main agent's route as the summaries need it (`ProvidersSettingsStateService.route().data`). */
export interface ConsumerRouteInfo {
  readonly driverProviderId?: string | null;
  readonly resolvedAuthModality?: string | null;
}

/** A setting key's source as `ProvidersSettingsStateService.scopeEntry` reports it. */
export interface ScopeSource {
  readonly scope: SettingScopeDisplay;
  readonly hasOverride: boolean;
}

/** The scope source of a setting key, or `null` when unknown (`ProvidersSettingsStateService.scopeEntry`). */
export type ScopeLookup = (key: string) => ScopeSource | null | undefined;

/** One row's identity and where its values live. */
export interface ConsumerRowSpec {
  readonly id: ProviderConsumerId;
  readonly name: string;
  readonly helperCopy: string | null;
  readonly tier: ProviderModelTier;
  readonly toolUse: boolean;
  readonly provider: string;
  readonly model: string;
  readonly providerKey: string;
  readonly modelKey: string;
  readonly section: ProvidersSettingsSection<unknown>;
  readonly retryKey: BackgroundConsumerRow['retryKey'];
}

/** The main agent's driver in words ("Claude · cli"), or "Active provider" before the route has loaded. */
function routeLabel(
  route: ConsumerRouteInfo | null,
  withModality: boolean,
): string {
  if (!route?.driverProviderId) return 'Active provider';
  const modality =
    withModality && route.resolvedAuthModality
      ? ` · ${route.resolvedAuthModality}`
      : '';
  return `${formatProviderDisplayName(route.driverProviderId)}${modality}`;
}

export function formatResolvedSummary(
  route: ConsumerRouteInfo | null,
  provider: string,
  model: string,
  defaultTier: ProviderModelTier,
): string {
  const modelStr = model || `Default (${defaultTier} tier)`;
  if (!provider)
    return `Follows main agent → ${routeLabel(route, true)} → ${modelStr}`;
  return `${formatProviderDisplayName(provider)} · ${modelStr}`;
}

export function makeRow(
  spec: ConsumerRowSpec,
  route: ConsumerRouteInfo | null,
  scopeOf: ScopeLookup,
): BackgroundConsumerRow {
  const { id, name, provider, model, tier } = spec;
  // Provenance not known renders as Mixed sources (Decision 6); never a guessed 'global' source badge.
  const providerSource = scopeOf(spec.providerKey),
    modelSource = scopeOf(spec.modelKey);
  const providerScope = providerSource?.scope ?? 'mixed',
    modelScope = modelSource?.scope ?? 'mixed';
  const providerOverride = providerSource?.hasOverride === true,
    modelOverride = modelSource?.hasOverride === true;
  return {
    id,
    name,
    helperCopy: spec.helperCopy,
    defaultTier: tier,
    requiresToolUse: spec.toolUse,
    provider,
    model,
    resolvedSummary: formatResolvedSummary(route, provider, model, tier),
    cellLabel: provider
      ? `${formatProviderDisplayName(provider)} · ${model || `Default (${tier} tier)`}`
      : `Follows main agent → ${routeLabel(route, false)}`,
    followsMain: !provider,
    tierLabel: model ? 'direct model' : `${tier} tier`,
    providerFieldName: `${name} provider`,
    modelFieldName: `${name} model`,
    providerScope,
    modelScope,
    providerOverride,
    modelOverride,
    scopeShown:
      providerOverride ||
      modelOverride ||
      providerScope === 'mixed' ||
      modelScope === 'mixed',
    sectionStatus: spec.section.status,
    loaded: spec.section.data !== null,
    retryKey: spec.retryKey,
  };
}

/** A lane as `skillSynthesis:getLanes` returns it. */
interface LaneSource {
  readonly provider?: string;
  readonly model?: string;
  readonly defaultTier?: ProviderModelTier;
  readonly toolUse?: string;
}

/** The three sections the six rows read. */
export interface ConsumerSources {
  readonly memory: ProvidersSettingsSection<{
    readonly curatorProvider?: string;
    readonly curatorModel?: string;
  }>;
  readonly lanes: ProvidersSettingsSection<
    Partial<Record<SkillLaneIdDto, LaneSource>>
  >;
  readonly judging: ProvidersSettingsSection<{
    readonly judgeProvider?: string;
    readonly judgeModel?: string;
  }>;
}

const LANES: readonly {
  readonly id: SkillLaneIdDto & ProviderConsumerId;
  readonly name: string;
}[] = [
  { id: 'archaeologist', name: 'Archaeologist lane' },
  { id: 'synthesis', name: 'Synthesis lane' },
  { id: 'judge', name: 'Judge lane' },
  { id: 'replay', name: 'Replay lane' },
];

/** The six rows, in the fixed order: Memory curator, the four lanes, Judging & enhancement. */
export function buildConsumerRows(
  sources: ConsumerSources,
  route: ConsumerRouteInfo | null,
  scopeOf: ScopeLookup,
): readonly BackgroundConsumerRow[] {
  const { memory, lanes, judging } = sources;
  const memoryRow = makeRow(
    {
      id: 'memory-curator',
      name: 'Memory curator',
      helperCopy: null,
      tier: 'haiku',
      toolUse: false,
      provider: memory.data?.curatorProvider ?? '',
      model: memory.data?.curatorModel ?? '',
      providerKey: 'memory.curatorProvider',
      modelKey: 'memory.curatorModel',
      section: memory,
      retryKey: 'memory',
    },
    route,
    scopeOf,
  );
  const laneRows = LANES.map(({ id, name }) => {
    const lane = lanes.data?.[id];
    return makeRow(
      {
        id,
        name,
        helperCopy: null,
        tier: lane?.defaultTier ?? 'haiku',
        toolUse: lane?.toolUse === 'required',
        provider: lane?.provider ?? '',
        model: lane?.model ?? '',
        providerKey: `skillSynthesis.${id}.provider`,
        modelKey: `skillSynthesis.${id}.model`,
        section: lanes,
        retryKey: 'lanes',
      },
      route,
      scopeOf,
    );
  });
  const judgingRow = makeRow(
    {
      id: 'judging-enhancement',
      name: 'Judging & enhancement',
      helperCopy: JUDGING_HELPER_COPY,
      tier: 'haiku',
      toolUse: false,
      provider: judging.data?.judgeProvider ?? '',
      model: toPickerModel(judging.data?.judgeModel),
      providerKey: 'skillSynthesis.judgeProvider',
      modelKey: 'skillSynthesis.judgeModel',
      section: judging,
      retryKey: 'judging',
    },
    route,
    scopeOf,
  );
  return [memoryRow, ...laneRows, judgingRow];
}

/** The settings patch that assigns `provider`/`model` to one role (the picker's `''` model is "inherit"). */
export function consumerPatch(
  id: ProviderConsumerId,
  provider: string,
  model: string,
): ProvidersSettingsPatch {
  if (id === 'memory-curator')
    return { memory: { curatorProvider: provider, curatorModel: model } };
  if (id === 'judging-enhancement')
    return {
      judging: {
        judgeProvider: provider,
        judgeModel: toBackendJudgeModel(model),
      },
    };
  return { lanes: { [id]: { provider, model } } };
}

/** Whether a chosen provider can be saved for a role; `blocking: false` is an advisory note only. */
export interface ProviderReadiness {
  readonly message: string;
  readonly setupProviderId: string | null;
  readonly providerDisplayName: string;
  readonly blocking: boolean;
}

/** Route statuses of the provider connections (`ProvidersSettingsStateService.route().data.providers`). */
export interface ProviderRouteStatus {
  readonly id: string;
  readonly status: string;
}

/**
 * The readiness of a draft provider. `''` follows the main agent and is blocked only while no main provider is
 * active. Fixed sentences only: never host text.
 */
export function providerReadiness(
  provider: string,
  providers: readonly ProviderRouteStatus[],
  hasActiveProvider: boolean,
): ProviderReadiness | null {
  if (!provider) {
    return hasActiveProvider
      ? null
      : {
          message: 'Choose a provider to start the main agent.',
          setupProviderId: '',
          providerDisplayName: 'main provider',
          blocking: true,
        };
  }
  const name = formatProviderDisplayName(provider);
  const status =
    providers.find((entry) => entry.id === provider)?.status ??
    'not-configured';
  if (status === 'connected' || status === 'reachable') return null;
  // Local servers are `skipped` and some sign-ins `unknown`: the host cannot check them. Not a failure.
  if (status === 'skipped' || status === 'unknown') {
    return {
      message: `Ptah cannot check ${name} before use. If requests fail, check that it is running and reachable.`,
      setupProviderId: null,
      providerDisplayName: name,
      blocking: false,
    };
  }
  const MESSAGES: Readonly<Record<string, string>> = {
    'needs-key': `Add an API key to connect ${name}.`,
    unauthenticated:
      'Your credential is missing or expired; authenticate again.',
    unreachable: `Could not reach ${name}; check the connection and retry.`,
    'not-installed': `Install ${name} to use this connection.`,
  };
  return {
    message: MESSAGES[status] ?? `Set up ${name} when you are ready.`,
    setupProviderId: provider,
    providerDisplayName: name,
    blocking: true,
  };
}

// ------------------------------------------------------------------ decision model (TASK_2026_646 Req 1)

/** The decision-model kinds (Req 1.2). */
export type DecisionModelKind = DecisionModelSelectionDto['kind'];

export const DECISION_ROW_NAME = 'Decision model';

/** Exactly the four choices of Req 1.2, in the picker's order; Unset is the default. */
export const DECISION_KIND_OPTIONS: readonly {
  readonly value: DecisionModelKind;
  readonly label: string;
}[] = [
  { value: 'unset', label: 'Unset' },
  { value: 'ollama', label: 'Ollama decision model' },
  { value: 'jev', label: 'TypeSafe Jev' },
  { value: 'structured', label: 'Structured-output model' },
];

/** The model the host applies when a Jev write omits one (`DecisionModelSelectionDto`, rpc-agents.types.ts). */
export const JEV_DEFAULT_MODEL = 'jev-1.13.0';

/** The decision-model row's view: fixed sentences, plus the host's `detail` shown as plain text. */
export interface DecisionModelRow {
  readonly id: 'decision';
  readonly name: string;
  /** The cell's text, e.g. "Ollama · tev1". */
  readonly cellLabel: string;
  /** The badge in the tier slot. */
  readonly stateLabel: string;
  readonly stateMessage: string;
  readonly detail: string | null;
  readonly localityMessage: string | null;
  readonly confidenceMessage: string | null;
  /** The provider the "Set up" link opens (Req 1.5); `null` offers no link (Jev's key is entered in this row). */
  readonly setupProviderId: string | null;
  readonly setupProviderName: string;
  /** The state needs the user's attention: no credential, not reachable, unsupported, or not read. */
  readonly attention: boolean;
}

const STATE_LABELS: Readonly<Record<DecisionModelStateDto, string>> = {
  unset: 'unset',
  ready: 'ready',
  'no-credential': 'no credential',
  unreachable: 'not reachable',
  'unsupported-endpoint': 'not supported',
};

/** Who serves the selection, in words. */
function servedBy(selection: DecisionModelSelectionDto): string {
  if (selection.kind === 'ollama') return 'Ollama';
  if (selection.kind === 'jev') return 'TypeSafe Jev';
  if (selection.kind === 'structured')
    return formatProviderDisplayName(selection.providerId);
  return 'No provider';
}

function stateMessageOf(
  selection: DecisionModelSelectionDto,
  state: DecisionModelStateDto,
): string {
  const name = servedBy(selection);
  switch (state) {
    case 'unset':
      return 'No decision model is set. Code ranking chooses lanes and models, and no decision request is sent.';
    case 'ready':
      return `${name} is ready to answer routing questions.`;
    case 'no-credential':
      return selection.kind === 'jev'
        ? 'No TypeSafe Jev API key is stored. Add one in this row to use Jev.'
        : `${name} has no credential. Set it up to use it.`;
    case 'unreachable':
      return `Could not reach ${name}. Check that it is running and reachable.`;
    case 'unsupported-endpoint':
      return selection.kind === 'ollama' ||
        (selection.kind === 'structured' && selection.providerId === 'ollama')
        ? 'This Ollama endpoint does not serve decision models. It needs Ollama 0.35 or later.'
        : `${name} does not support decision requests.`;
  }
}

/** The provider whose set-up wizard fixes the state; Jev has none (its key is entered in this row). */
function setupProviderOf(selection: DecisionModelSelectionDto): string | null {
  if (selection.kind === 'ollama') return 'ollama';
  if (selection.kind === 'structured') return selection.providerId;
  return null;
}

function localityMessageOf(status: DecisionModelStatusDto): string | null {
  if (status.selection.kind === 'unset') return null;
  if (status.locality === 'local')
    return 'Runs on this machine: the request text and lane data stay on this machine.';
  if (status.locality === 'remote')
    return `The request text and lane data are sent to ${servedBy(status.selection)}.`;
  return null;
}

/**
 * The decision-model row (Req 1.4, 1.5, 1.8). `status` is `null` when the status could not be read: the row then
 * says "not reachable" and saving stays open (plan part A §11, failure behaviour).
 */
export function buildDecisionRow(
  status: DecisionModelStatusDto | null,
): DecisionModelRow {
  if (!status) {
    return {
      id: 'decision',
      name: DECISION_ROW_NAME,
      cellLabel: 'Status not reachable',
      stateLabel: 'not reachable',
      stateMessage:
        'The decision model status is not reachable. You can still choose and save a decision model.',
      detail: null,
      localityMessage: null,
      confidenceMessage: null,
      setupProviderId: null,
      setupProviderName: '',
      attention: true,
    };
  }
  const { selection, state } = status;
  const needsSetup =
    state === 'no-credential' ||
    state === 'unreachable' ||
    state === 'unsupported-endpoint';
  return {
    id: 'decision',
    name: DECISION_ROW_NAME,
    cellLabel:
      selection.kind === 'unset'
        ? 'Unset · code ranking'
        : `${servedBy(selection)} · ${selection.model}`,
    stateLabel: STATE_LABELS[state],
    stateMessage: stateMessageOf(selection, state),
    detail: status.detail,
    localityMessage: localityMessageOf(status),
    confidenceMessage:
      selection.kind === 'structured' && !status.reportsConfidence
        ? 'This model reports no confidence, so its answers carry no confidence score.'
        : null,
    setupProviderId: needsSetup ? setupProviderOf(selection) : null,
    setupProviderName: servedBy(selection),
    attention: needsSetup,
  };
}

/** The decision-model editor's draft (one shape for every kind). */
export interface DecisionModelDraft {
  readonly kind: DecisionModelKind;
  readonly model: string;
  readonly providerId: string;
}

export function decisionDraftFrom(
  selection: DecisionModelSelectionDto | null,
): DecisionModelDraft {
  if (!selection || selection.kind === 'unset')
    return { kind: 'unset', model: '', providerId: '' };
  return {
    kind: selection.kind,
    model: selection.model,
    providerId: selection.kind === 'structured' ? selection.providerId : '',
  };
}

/** The draft for a newly picked kind: the saved values when that kind is the saved one, else empty fields. */
export function decisionDraftForKind(
  kind: DecisionModelKind,
  saved: DecisionModelSelectionDto | null,
): DecisionModelDraft {
  return saved?.kind === kind
    ? decisionDraftFrom(saved)
    : { kind, model: '', providerId: '' };
}

/** The `agent:setConfig` selection for a draft, or `null` while a required field is empty. Jev's model is optional. */
export function decisionModelInput(
  draft: DecisionModelDraft,
): DecisionModelSelectionInputDto | null {
  const model = draft.model.trim();
  switch (draft.kind) {
    case 'unset':
      return { kind: 'unset' };
    case 'ollama':
      return model ? { kind: 'ollama', model } : null;
    case 'jev':
      return model ? { kind: 'jev', model } : { kind: 'jev' };
    case 'structured':
      return draft.providerId && model
        ? { kind: 'structured', providerId: draft.providerId, model }
        : null;
  }
}

/** Whether a write would store the selection that is already saved (Jev without a model is the host default). */
export function sameDecisionSelection(
  input: DecisionModelSelectionInputDto,
  saved: DecisionModelSelectionDto | null,
): boolean {
  if (!saved) return false;
  switch (input.kind) {
    case 'unset':
      return saved.kind === 'unset';
    case 'jev':
      return (
        saved.kind === 'jev' &&
        (input.model ?? JEV_DEFAULT_MODEL) === saved.model
      );
    case 'ollama':
      return saved.kind === 'ollama' && input.model === saved.model;
    case 'structured':
      return (
        saved.kind === 'structured' &&
        input.providerId === saved.providerId &&
        input.model === saved.model
      );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isState = (value: unknown): value is DecisionModelStateDto =>
  value === 'unset' ||
  value === 'ready' ||
  value === 'no-credential' ||
  value === 'unreachable' ||
  value === 'unsupported-endpoint';

function parseSelection(value: unknown): DecisionModelSelectionDto | null {
  if (!isRecord(value)) return null;
  const { kind, model, providerId } = value;
  if (kind === 'unset') return { kind };
  if (typeof model !== 'string' || !model) return null;
  if (kind === 'ollama' || kind === 'jev') return { kind, model };
  if (kind === 'structured' && typeof providerId === 'string' && providerId)
    return { kind, providerId, model };
  return null;
}

/** Validates `agent:getConfig`'s `decisionModel` before it reaches view state; any other shape is `null` (not read). */
export function parseDecisionModelStatus(
  value: unknown,
): DecisionModelStatusDto | null {
  if (!isRecord(value)) return null;
  const selection = parseSelection(value['selection']);
  const { locality, reportsConfidence, state, detail } = value;
  if (!selection || !isState(state) || typeof reportsConfidence !== 'boolean')
    return null;
  if (locality !== null && locality !== 'local' && locality !== 'remote')
    return null;
  if (detail !== null && typeof detail !== 'string') return null;
  return { selection, locality, reportsConfidence, state, detail };
}
