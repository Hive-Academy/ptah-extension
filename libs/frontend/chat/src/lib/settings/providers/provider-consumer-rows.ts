import { getAnthropicProvider, type ProviderModelTier, type SkillLaneIdDto } from '@ptah-extension/shared';
import type { ProvidersSettingsPatch, ProvidersSettingsSection } from '@ptah-extension/core';
import type { SettingScopeDisplay } from './setting-scope-row.component';

/**
 * Background-role rows (Batch 35, plan :765-774): the row derivation moved out of
 * `ProviderConsumerAssignmentsComponent` so the component only renders. Every function here is pure: the caller
 * passes in the state it read.
 */

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

export const JUDGING_HELPER_COPY =
  'Used for judging and for Enhance now on skills, agents, and commands. The Judge lane is configured separately above.';

/** The main agent's route as the summaries need it (`ProvidersSettingsStateService.route().data`). */
export interface ConsumerRouteInfo {
  readonly driverProviderId?: string | null;
  readonly resolvedAuthModality?: string | null;
}

/** The scope source of a setting key, or `null` when unknown (`ProvidersSettingsStateService.scopeEntry`). */
export type ScopeLookup = (key: string) => SettingScopeDisplay | null | undefined;

/** One row's identity and where its values live. */
export interface ConsumerRowSpec {
  readonly id: BackgroundConsumerId;
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
function routeLabel(route: ConsumerRouteInfo | null, withModality: boolean): string {
  if (!route?.driverProviderId) return 'Active provider';
  const modality = withModality && route.resolvedAuthModality ? ` · ${route.resolvedAuthModality}` : '';
  return `${formatProviderDisplayName(route.driverProviderId)}${modality}`;
}

export function formatResolvedSummary(
  route: ConsumerRouteInfo | null, provider: string, model: string, defaultTier: ProviderModelTier,
): string {
  const modelStr = model || `Default (${defaultTier} tier)`;
  if (!provider) return `Follows main agent → ${routeLabel(route, true)} → ${modelStr}`;
  return `${formatProviderDisplayName(provider)} · ${modelStr}`;
}

export function makeRow(spec: ConsumerRowSpec, route: ConsumerRouteInfo | null, scopeOf: ScopeLookup): BackgroundConsumerRow {
  const { id, name, provider, model, tier } = spec;
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
    // Provenance not known renders as Mixed sources (Decision 6); never a guessed 'global' source badge.
    providerScope: scopeOf(spec.providerKey) ?? 'mixed',
    modelScope: scopeOf(spec.modelKey) ?? 'mixed',
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
  readonly memory: ProvidersSettingsSection<{ readonly curatorProvider?: string; readonly curatorModel?: string }>;
  readonly lanes: ProvidersSettingsSection<Partial<Record<SkillLaneIdDto, LaneSource>>>;
  readonly judging: ProvidersSettingsSection<{ readonly judgeProvider?: string; readonly judgeModel?: string }>;
}

const LANES: readonly { readonly id: SkillLaneIdDto & BackgroundConsumerId; readonly name: string }[] = [
  { id: 'archaeologist', name: 'Archaeologist lane' },
  { id: 'synthesis', name: 'Synthesis lane' },
  { id: 'judge', name: 'Judge lane' },
  { id: 'replay', name: 'Replay lane' },
];

/** The six rows, in the fixed order: Memory curator, the four lanes, Judging & enhancement. */
export function buildConsumerRows(
  sources: ConsumerSources, route: ConsumerRouteInfo | null, scopeOf: ScopeLookup,
): readonly BackgroundConsumerRow[] {
  const { memory, lanes, judging } = sources;
  const memoryRow = makeRow({
    id: 'memory-curator', name: 'Memory curator', helperCopy: null, tier: 'haiku', toolUse: false,
    provider: memory.data?.curatorProvider ?? '', model: memory.data?.curatorModel ?? '',
    providerKey: 'memory.curatorProvider', modelKey: 'memory.curatorModel', section: memory, retryKey: 'memory',
  }, route, scopeOf);
  const laneRows = LANES.map(({ id, name }) => {
    const lane = lanes.data?.[id];
    return makeRow({
      id, name, helperCopy: null, tier: lane?.defaultTier ?? 'haiku', toolUse: lane?.toolUse === 'required',
      provider: lane?.provider ?? '', model: lane?.model ?? '',
      providerKey: `skillSynthesis.${id}.provider`, modelKey: `skillSynthesis.${id}.model`, section: lanes, retryKey: 'lanes',
    }, route, scopeOf);
  });
  const judgingRow = makeRow({
    id: 'judging-enhancement', name: 'Judging & enhancement', helperCopy: JUDGING_HELPER_COPY, tier: 'haiku', toolUse: false,
    provider: judging.data?.judgeProvider ?? '', model: toPickerModel(judging.data?.judgeModel),
    providerKey: 'skillSynthesis.judgeProvider', modelKey: 'skillSynthesis.judgeModel', section: judging, retryKey: 'judging',
  }, route, scopeOf);
  return [memoryRow, ...laneRows, judgingRow];
}

/** The settings patch that assigns `provider`/`model` to one role (the picker's `''` model is "inherit"). */
export function consumerPatch(id: BackgroundConsumerId, provider: string, model: string): ProvidersSettingsPatch {
  if (id === 'memory-curator') return { memory: { curatorProvider: provider, curatorModel: model } };
  if (id === 'judging-enhancement') return { judging: { judgeProvider: provider, judgeModel: toBackendJudgeModel(model) } };
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
  provider: string, providers: readonly ProviderRouteStatus[], hasActiveProvider: boolean,
): ProviderReadiness | null {
  if (!provider) {
    return hasActiveProvider ? null : {
      message: 'Choose a provider to start the main agent.', setupProviderId: '', providerDisplayName: 'main provider', blocking: true,
    };
  }
  const name = formatProviderDisplayName(provider);
  const status = providers.find((entry) => entry.id === provider)?.status ?? 'not-configured';
  if (status === 'connected' || status === 'reachable') return null;
  // Local servers are `skipped` and some sign-ins `unknown`: the host cannot check them. Not a failure.
  if (status === 'skipped' || status === 'unknown') {
    return {
      message: `Ptah cannot check ${name} before use. If requests fail, check that it is running and reachable.`,
      setupProviderId: null, providerDisplayName: name, blocking: false,
    };
  }
  const MESSAGES: Readonly<Record<string, string>> = {
    'needs-key': `Add an API key to connect ${name}.`,
    unauthenticated: 'Your credential is missing or expired; authenticate again.',
    unreachable: `Could not reach ${name}; check the connection and retry.`,
    'not-installed': `Install ${name} to use this connection.`,
  };
  return { message: MESSAGES[status] ?? `Set up ${name} when you are ready.`, setupProviderId: provider, providerDisplayName: name, blocking: true };
}
