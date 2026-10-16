import { PROVIDER_KEY_SECRET_PREFIX } from '@ptah-extension/platform-core';
import { z } from 'zod';
import { EndpointBaseUrlSchema } from './decision-endpoint.url';

/**
 * Decision-model setting (Req 1) and its status row, per the contract at
 * `implementation-plan-part-a.md:724-747`. The backend schema here is the
 * validator; `libs/shared/src/lib/types/rpc/rpc-agents.types.ts` mirrors the
 * plain types for the frontend (A11).
 */

export const DecisionModelSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unset') }).strict(),
  z
    .object({ kind: z.literal('ollama'), model: z.string().min(1).max(128) })
    .strict(),
  z
    .object({
      kind: z.literal('jev'),
      model: z.string().min(1).max(64).default('jev-1.13.0'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('structured'),
      providerId: z.string().min(1),
      model: z.string().min(1),
    })
    .strict(),
]);

/** A parsed selection (the Jev model default applied). */
export type DecisionModelSelection = z.infer<
  typeof DecisionModelSelectionSchema
>;

/** What a caller may submit before parsing (the Jev model may be omitted). */
export type DecisionModelSelectionInput = z.input<
  typeof DecisionModelSelectionSchema
>;

/**
 * Ollama Cloud selection (D1): the model id is the canonical cloud id
 * (DC5). Not yet a member of `DecisionModelSelectionSchema`: the union widens
 * together with every consumer that switches on `kind` (PD-1).
 */
export const OllamaCloudSelectionSchema = z
  .object({
    kind: z.literal('ollama-cloud'),
    model: z.string().trim().min(1).max(128),
  })
  .strict();

export type OllamaCloudSelection = z.infer<typeof OllamaCloudSelectionSchema>;

/**
 * Custom `/v1/systemone` endpoint selection (D2, DC2). `baseUrl` is
 * normalised by `EndpointBaseUrlSchema`. The model id is trimmed first, so a
 * whitespace-only id is refused on the `model` path (criterion 2.2). Not yet
 * a member of `DecisionModelSelectionSchema` (PD-1).
 */
export const CustomEndpointSelectionSchema = z
  .object({
    kind: z.literal('custom'),
    baseUrl: EndpointBaseUrlSchema,
    model: z.string().trim().min(1).max(128),
  })
  .strict();

export type CustomEndpointSelection = z.infer<
  typeof CustomEndpointSelectionSchema
>;

export type DecisionModelKind = DecisionModelSelection['kind'];

export type DecisionModelLocality = 'local' | 'remote';

/** Row states. The set is fixed by decision #46 (no `model-unavailable`). */
export type DecisionModelState =
  'unset' | 'ready' | 'no-credential' | 'unreachable' | 'unsupported-endpoint';

export interface DecisionModelStatusDto {
  readonly selection: DecisionModelSelection;
  /** `null` when unset. */
  readonly locality: DecisionModelLocality | null;
  /** `false` for `structured` (Req 1.8) and for `unset`. */
  readonly reportsConfidence: boolean;
  readonly state: DecisionModelState;
  /** For example `Ollama 0.34.2 < 0.35.0` or `last call failed: <error>`. */
  readonly detail: string | null;
  /**
   * Whether a key is stored for this selection (DC13). Set for `jev` and
   * `custom` only; never the key itself.
   */
  readonly apiKeyStored?: boolean;
}

/**
 * Outcome classes of one status probe. `auth` and `provider-error` are probe
 * causes, not row states; `toRowState` maps them onto the fixed state set.
 */
export type DecisionModelProbeOutcome =
  'ready' | 'unsupported-endpoint' | 'unreachable' | 'auth' | 'provider-error';

export interface DecisionModelProbeResult {
  readonly outcome: DecisionModelProbeOutcome;
  readonly detail: string | null;
}

/**
 * Persisted unsupported mark (part A §5): `{ selection, baseUrl, detail, at }`
 * under `DECISION_MODEL_UNSUPPORTED_STORAGE_KEY` in global state storage.
 * `at` is epoch milliseconds.
 */
export const DecisionModelUnsupportedMarkSchema = z
  .object({
    selection: DecisionModelSelectionSchema,
    baseUrl: z.string().min(1),
    detail: z.string(),
    at: z.number().int().nonnegative(),
  })
  .strict();

export type DecisionModelUnsupportedMark = z.infer<
  typeof DecisionModelUnsupportedMarkSchema
>;

/** Global `IStateStorage` key of the unsupported mark (decision #42, #46). */
export const DECISION_MODEL_UNSUPPORTED_STORAGE_KEY =
  'ptah.decisionModel.unsupported.v1';

/**
 * Settings location of the selection: section `ptah`, key
 * `agentOrchestration.decisionModel` (part A §5; the section/key split the
 * agent RPC handler uses, `agent-rpc.handlers.ts:1328-1335`).
 */
export const DECISION_MODEL_CONFIG_SECTION = 'ptah';
export const DECISION_MODEL_CONFIG_KEY = 'agentOrchestration.decisionModel';

/** `ISecretStorage` key of the TypeSafe Jev API key (part A §5). */
export const DECISION_MODEL_JEV_SECRET_KEY = 'ptah.laneRouting.jevApiKey';

/**
 * `ISecretStorage` key of the custom endpoint key (DC3). The value is JSON
 * `{ origin, key }`; the key goes only to that origin.
 */
export const DECISION_MODEL_CUSTOM_SECRET_KEY =
  'ptah.laneRouting.customEndpointApiKey';

/**
 * `ISecretStorage` key of the shared Ollama Cloud provider key (D1, DC1).
 * The decision model reads it and never writes it.
 */
export const OLLAMA_CLOUD_SECRET_KEY = `${PROVIDER_KEY_SECRET_PREFIX}ollama-cloud`;

/** Ollama Cloud base URL override: section `ptah`, key below (DC6). */
export const OLLAMA_CLOUD_BASE_URL_CONFIG_KEY = 'provider.ollama-cloud.baseUrl';

/** TypeSafe Jev base URL (part A §5). */
export const JEV_BASE_URL = 'https://api.typesafe.ai';

/**
 * Ollama base URL setting: section `ptah`, key `provider.ollama.baseUrl`
 * (`ollama-model-discovery.service.ts:271-284`, namespace `ptah` at
 * `config-manager.ts:49`).
 */
export const OLLAMA_BASE_URL_CONFIG_KEY = 'provider.ollama.baseUrl';

/** Minimum Ollama versions for `/v1/systemone` (Req 1.5). */
export const OLLAMA_MIN_SYSTEM_ONE_VERSION = '0.35.0';
export const OLLAMA_MIN_LAYA_VERSION = '0.40.0';

/** One budget for the version check and both probe POSTs (part A §5). */
export const DECISION_MODEL_PROBE_TIMEOUT_MS = 1500;

/** A path no server serves; its answer is the server's generic not-found. */
export const SYSTEM_ONE_CONTROL_PATH = '/v1/systemone-ptah-probe-absent';

/** Live-404/405 re-checks: at most one per this window per key (decision #46). */
export const DECISION_MODEL_RECHECK_WINDOW_MS = 60_000;
