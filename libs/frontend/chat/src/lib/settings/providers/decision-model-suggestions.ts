import type { ClaudeRpcService } from '@ptah-extension/core';
import type { ProviderModelsLoader } from '@ptah-extension/ui';
import type {
  DecisionModelCatalogFilter,
  DecisionModelCatalogSource,
} from '@ptah-extension/shared';
import {
  JEV_DEFAULT_MODEL,
  type DecisionModelKind,
} from './decision-model-row.view';

/**
 * Model-name suggestions of the decision-model row (TASK_2026_684 C13, Requirement 4). Ollama and Ollama Cloud list
 * only the models their host reports as decision-capable (`agent:listDecisionModels`); a structured-output model
 * lists its provider's catalogue through `PROVIDER_MODELS_LOADER`; Unset, Jev and the custom endpoint have no list.
 * Suggestions only fill the datalist: they never choose a model (no preselection, 4.5).
 */

/** Help text when some models could not be checked (`filter: 'partial'`, 4.3). */
export const DECISION_SUGGESTIONS_PARTIAL =
  'Some models could not be checked for decision support, so they are not listed. Type a model name to use one.';
/** Help text when decision support could not be checked at all (`filter: 'unavailable'` or a failed read, 4.3). */
export const DECISION_SUGGESTIONS_UNAVAILABLE =
  'Could not check decision support. Type a model name.';

/** Same budget as the row's other reads; the host's catalog gives up after 4000 ms. */
const RPC_TIMEOUT_MS = 5_000;

export interface DecisionSuggestions {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly ids: readonly string[];
  /** How far the decision filter applied; `null` for lists without one (structured, idle). */
  readonly filter: DecisionModelCatalogFilter | null;
}

export const IDLE_SUGGESTIONS: DecisionSuggestions = {
  status: 'idle',
  ids: [],
  filter: null,
};

/** The catalog source of a kind, or `null` when the kind does not list decision-capable models. */
function catalogSourceOf(
  kind: DecisionModelKind,
): DecisionModelCatalogSource | null {
  if (kind === 'ollama') return 'ollama';
  return kind === 'ollama-cloud' ? 'ollama-cloud' : null;
}

/**
 * The model field's help text for a draft and its suggestions. Decision catalogs say when the filter could not be
 * applied (4.3); every text says a typed name works, so a list never limits the choice (4.4).
 */
export function decisionModelHelp(
  draft: { readonly kind: DecisionModelKind; readonly providerId: string },
  suggestions: DecisionSuggestions,
): string {
  const { kind, providerId } = draft;
  const { status, ids, filter } = suggestions;
  if (kind === 'jev') return `Empty uses ${JEV_DEFAULT_MODEL}.`;
  if (kind === 'custom') return 'Type the model name this endpoint serves.';
  if (kind === 'structured' && !providerId)
    return 'Choose a provider to list its models.';
  if (status === 'loading') return 'Loading model suggestions…';
  if (isDecisionCatalogKind(kind)) {
    if (status === 'error' || filter === 'unavailable')
      return DECISION_SUGGESTIONS_UNAVAILABLE;
    if (filter === 'partial') return DECISION_SUGGESTIONS_PARTIAL;
    if (ids.length === 0) return 'No decision models found. Type a model name.';
    return kind === 'ollama'
      ? 'Suggestions list the models on your Ollama endpoint that support decisions. Any model name it serves works.'
      : 'Suggestions list the Ollama Cloud models that support decisions. Any model name works.';
  }
  if (status === 'error') return 'Could not list models. Type a model name.';
  if (ids.length === 0) return 'No model suggestions. Type a model name.';
  return "Suggestions list this provider's models. Pick one that supports structured output (JSON schema); not every listed model does.";
}

/** Whether the kind's catalog is filtered for decision support (Ollama and Ollama Cloud). */
export function isDecisionCatalogKind(kind: DecisionModelKind): boolean {
  return catalogSourceOf(kind) !== null;
}

/** Whether a draft has a list to load; otherwise its suggestions stay idle. */
export function hasDecisionSuggestions(
  kind: DecisionModelKind,
  providerId: string,
): boolean {
  return isDecisionCatalogKind(kind) || (kind === 'structured' && !!providerId);
}

/**
 * Loads the suggestions for a draft's kind. A failed catalog read resolves as `error` with filter `unavailable`; a
 * rejection of the RPC transport or the loader propagates, so the caller logs its error type.
 */
export async function loadDecisionSuggestions(
  kind: DecisionModelKind,
  providerId: string,
  rpc: Pick<ClaudeRpcService, 'call'>,
  loader: ProviderModelsLoader,
): Promise<DecisionSuggestions> {
  const source = catalogSourceOf(kind);
  if (source) {
    const result = await rpc.call(
      'agent:listDecisionModels',
      { source },
      { timeout: RPC_TIMEOUT_MS },
    );
    const parsed = result.isSuccess() ? parseCatalogResult(result.data) : null;
    return parsed ?? { status: 'error', ids: [], filter: 'unavailable' };
  }
  if (kind !== 'structured' || !providerId) return IDLE_SUGGESTIONS;
  // Unfiltered: the catalogue has no structured-output flag, and tool use is not what the adapter needs.
  const listed = await loader.listModels(providerId);
  return {
    status: listed.error ? 'error' : 'ready',
    ids: listed.models.map((model) => model.id),
    filter: null,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isFilter = (value: unknown): value is DecisionModelCatalogFilter =>
  value === 'applied' || value === 'partial' || value === 'unavailable';

const isModelId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isModelIdList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isModelId);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Validates the host's whole catalog answer (`AgentListDecisionModelsResult`) before it reaches view state: every
 * model id must be a non-blank string. Any other shape is `null` (not read), shown as "could not check".
 */
function parseCatalogResult(value: unknown): DecisionSuggestions | null {
  if (!isRecord(value)) return null;
  const { models, filter, undetermined } = value;
  if (!isFilter(filter) || !isModelIdList(models) || !isCount(undetermined))
    return null;
  return { status: 'ready', ids: [...models], filter };
}
