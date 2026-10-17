/**
 * Decision-model catalog wire contract (TASK_2026_684, Requirement 4).
 *
 * `agent:listDecisionModels` is the read behind the decision-model row's
 * picker. It lists the models a host reports as `decision`-capable. The
 * result carries model ids and counts only: no host error text, no URL and
 * no key.
 */

// ---------------------------------------------------------------------------
// agent:listDecisionModels
// ---------------------------------------------------------------------------

/**
 * Every catalog source, the one runtime list: the RPC boundary schema is
 * built from it, so a new source is accepted wherever the type allows it.
 */
export const DECISION_MODEL_CATALOG_SOURCES = [
  'ollama',
  'ollama-cloud',
] as const;

/**
 * Which host to list: the configured Ollama daemon, or Ollama Cloud
 * (`https://ollama.com`, ids returned in the `-cloud` form).
 */
export type DecisionModelCatalogSource =
  (typeof DECISION_MODEL_CATALOG_SOURCES)[number];

/** Parameters for `agent:listDecisionModels`. */
export interface AgentListDecisionModelsParams {
  readonly source: DecisionModelCatalogSource;
}

/**
 * How far the capability filter could be applied:
 * - `applied`: every listed model's capabilities were determined.
 * - `partial`: some models could not be determined and are not listed.
 * - `unavailable`: the listing failed; `models` is empty.
 */
export type DecisionModelCatalogFilter = 'applied' | 'partial' | 'unavailable';

/** Result of `agent:listDecisionModels`. */
export interface AgentListDecisionModelsResult {
  /** Model ids whose capabilities include `decision`. */
  readonly models: string[];
  readonly filter: DecisionModelCatalogFilter;
  /** Count of models whose capabilities could not be determined. */
  readonly undetermined: number;
}
