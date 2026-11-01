import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  DECISION_MODEL_TIMEOUT_MAX_MS,
  DECISION_MODEL_TIMEOUT_MIN_MS,
  DECISION_MODEL_TIMEOUT_SETTING_KEY,
  OLLAMA_CLOUD_DIRECT_BASE_URL,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  isCloudTag,
  toCloudId,
} from '@ptah-extension/shared';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_REQUEST_TIMEOUT_REMOTE_MS,
} from '../routing-constants';
import {
  isLoopbackBase,
  keyTransportAllowed,
  parseEndpointBaseUrl,
} from './decision-endpoint.url';
import { DECISION_MODEL_DETAIL } from './decision-model.detail';
import type { DecisionModelKeys } from './decision-model.keys';
import { normaliseBaseUrl } from './decision-model.probe';
import {
  DECISION_MODEL_CONFIG_SECTION,
  JEV_BASE_URL,
  OLLAMA_CLOUD_BASE_URL_CONFIG_KEY,
  type CustomEndpointSelection,
  type DecisionModelLocality,
  type DecisionModelSelection,
  type OllamaCloudSelection,
} from './decision-model.types';

/**
 * Every selection the resolver understands. `DecisionModelSelection` already
 * includes `OllamaCloudSelection` and `CustomEndpointSelection`; they are
 * listed again only for readability.
 */
export type DecisionEndpointSelection =
  DecisionModelSelection | OllamaCloudSelection | CustomEndpointSelection;

/**
 * How the row status checks an endpoint:
 * - `daemon`: `GET /api/version`, then the route and control POSTs.
 * - `endpoint`: the route and control POSTs only, with the key when present.
 * - `none`: no probe (Jev status is key presence).
 */
export type DecisionEndpointProbe = 'daemon' | 'endpoint' | 'none';

/** Where one System One call goes, with the key bound to that base URL. */
export interface DecisionEndpoint {
  /** Normalised base URL; joins use `systemOneUrl` (DC11). */
  readonly baseUrl: string;
  /** The model id sent on the wire (`toCloudId` for `ollama-cloud`, DC5). */
  readonly model: string;
  /** Present only when a key is stored for this exact base URL. */
  readonly apiKey?: string;
  readonly probe: DecisionEndpointProbe;
  readonly locality: DecisionModelLocality;
  /**
   * Per-request budget: the `agentOrchestration.decisionModelTimeoutMs`
   * setting when set, else the default for this locality (DC8).
   */
  readonly timeoutMs: number;
}

/**
 * A selection that must not be called:
 * - `key-needs-https`: a key would go where the transport rule (D4) forbids;
 * - `invalid-base-url`: the Ollama Cloud base URL override is set but fails
 *   `parseEndpointBaseUrl` (userinfo, query, fragment, not http(s)), so the
 *   malformed URL is never used.
 * `detail` is a fixed `DECISION_MODEL_DETAIL` text with no URL or host in it.
 */
export interface BlockedDecisionEndpoint {
  readonly blocked: true;
  readonly reason: 'key-needs-https' | 'invalid-base-url';
  readonly detail: string;
}

/** `null` when the selection does not use System One (`unset`, `structured`). */
export type DecisionEndpointResolution =
  DecisionEndpoint | BlockedDecisionEndpoint | null;

/** What the resolver reads. Keys are read per call and never cached (1.4). */
export interface DecisionEndpointDeps {
  /**
   * `ptah` section settings: the Ollama Cloud base URL override and the
   * request timeout override.
   */
  readonly workspace: Pick<IWorkspaceProvider, 'getConfiguration'>;
  readonly keys: Pick<DecisionModelKeys, 'get' | 'readOllamaCloudKey'>;
  /** `provider.ollama.baseUrl`, normalised (`DecisionModelConfig.ollamaBaseUrl`). */
  readonly ollamaBaseUrl: () => string;
}

export function isBlockedDecisionEndpoint(
  resolution: DecisionEndpointResolution,
): resolution is BlockedDecisionEndpoint {
  return resolution !== null && 'blocked' in resolution;
}

/**
 * Turns a selection plus settings plus keys into one endpoint (Component 5).
 * This is the one place that holds the per-kind rules:
 *
 * | Kind | Base URL | Key | Probe | Locality |
 * | --- | --- | --- | --- | --- |
 * | `ollama` | `ollamaBaseUrl()` | none | `daemon` | DC7 |
 * | `ollama-cloud`, key | override, else `OLLAMA_CLOUD_DIRECT_BASE_URL` | Ollama Cloud key (DC6) | `endpoint` | `remote` |
 * | `ollama-cloud`, no key | override, else the provider entry's daemon | none | `daemon` | `remote` |
 * | `jev` | `JEV_BASE_URL` | Jev key when stored | `none` | `remote` |
 * | `custom` | `selection.baseUrl` | custom key bound to its origin (DC3) | `endpoint` | DC7 |
 *
 * A key goes only to the base URL resolved for it (1.2, 2.3). A key that
 * would travel over plain http to a non-loopback host blocks the selection
 * instead (D4, DC6). An Ollama Cloud override that fails the base URL policy
 * blocks the selection too, before any key is read. A rejected secret read
 * propagates to the caller.
 */
export async function resolveDecisionEndpoint(
  selection: DecisionEndpointSelection,
  deps: DecisionEndpointDeps,
): Promise<DecisionEndpointResolution> {
  switch (selection.kind) {
    case 'unset':
    case 'structured':
      return null;
    case 'ollama':
      return endpoint(
        deps.ollamaBaseUrl(),
        selection.model,
        null,
        'daemon',
        localityOf(deps.ollamaBaseUrl(), selection.model),
        deps.workspace,
      );
    case 'jev':
      return endpoint(
        JEV_BASE_URL,
        selection.model,
        await deps.keys.get('jev'),
        'none',
        'remote',
        deps.workspace,
      );
    case 'ollama-cloud':
      return resolveOllamaCloud(selection, deps);
    case 'custom':
      return resolveCustom(selection, deps);
  }
}

/**
 * Locality of a selection without reading any key (PD-5), so sync callers
 * such as the status DTO can use it. Same rule as the resolver (DC7):
 * `remote` when the base URL is not loopback or the model is a cloud tag;
 * `ollama-cloud` and `jev` are always `remote`.
 */
export function localityOfSelection(
  selection: DecisionEndpointSelection,
  deps: Pick<DecisionEndpointDeps, 'ollamaBaseUrl'>,
): DecisionModelLocality | null {
  switch (selection.kind) {
    case 'unset':
      return null;
    case 'jev':
    case 'ollama-cloud':
      return 'remote';
    case 'ollama':
      return localityOf(deps.ollamaBaseUrl(), selection.model);
    case 'custom':
      return localityOf(selection.baseUrl, selection.model);
    case 'structured':
      return selection.providerId === 'ollama'
        ? localityOf(deps.ollamaBaseUrl(), selection.model)
        : 'remote';
  }
}

/**
 * Per-request budget of one System One call: the request timeout setting
 * when it holds a usable value, else the default for the locality (DC8).
 */
function requestTimeoutMs(
  locality: DecisionModelLocality,
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): number {
  const configured = configuredRequestTimeoutMs(workspace);
  if (configured !== null) return configured;
  return locality === 'local'
    ? DECISION_REQUEST_TIMEOUT_MS
    : DECISION_REQUEST_TIMEOUT_REMOTE_MS;
}

/**
 * `agentOrchestration.decisionModelTimeoutMs`, read per call like the other
 * decision-model settings: a finite number above zero, rounded and clamped
 * to `DECISION_MODEL_TIMEOUT_MIN_MS..DECISION_MODEL_TIMEOUT_MAX_MS`. `null`
 * when unset or not such a number, so the locality default applies.
 */
function configuredRequestTimeoutMs(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): number | null {
  const raw = workspace.getConfiguration<unknown>(
    DECISION_MODEL_CONFIG_SECTION,
    DECISION_MODEL_TIMEOUT_SETTING_KEY,
  );
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return Math.min(
    DECISION_MODEL_TIMEOUT_MAX_MS,
    Math.max(DECISION_MODEL_TIMEOUT_MIN_MS, Math.round(raw)),
  );
}

async function resolveOllamaCloud(
  selection: OllamaCloudSelection,
  deps: DecisionEndpointDeps,
): Promise<DecisionEndpoint | BlockedDecisionEndpoint> {
  const model = toCloudId(selection.model);
  const override = ollamaCloudOverride(deps.workspace);
  if (override === INVALID_OVERRIDE) {
    return {
      blocked: true,
      reason: 'invalid-base-url',
      detail: DECISION_MODEL_DETAIL.invalidCloudBaseUrl,
    };
  }
  const key = await deps.keys.readOllamaCloudKey();
  if (key === null) {
    return endpoint(
      override ?? normaliseBaseUrl(OLLAMA_CLOUD_PROVIDER_ENTRY.baseUrl),
      model,
      null,
      'daemon',
      'remote',
      deps.workspace,
    );
  }
  const baseUrl = override ?? OLLAMA_CLOUD_DIRECT_BASE_URL;
  if (!keyTransportAllowed(baseUrl)) {
    return keyNeedsHttps();
  }
  return endpoint(baseUrl, model, key, 'endpoint', 'remote', deps.workspace);
}

async function resolveCustom(
  selection: CustomEndpointSelection,
  deps: DecisionEndpointDeps,
): Promise<DecisionEndpoint | BlockedDecisionEndpoint> {
  const baseUrl = normaliseBaseUrl(selection.baseUrl);
  const key = await deps.keys.get('custom', baseUrl);
  if (key !== null && !keyTransportAllowed(baseUrl)) {
    return keyNeedsHttps();
  }
  return endpoint(
    baseUrl,
    selection.model,
    key,
    'endpoint',
    localityOf(baseUrl, selection.model),
    deps.workspace,
  );
}

function keyNeedsHttps(): BlockedDecisionEndpoint {
  return {
    blocked: true,
    reason: 'key-needs-https',
    detail: DECISION_MODEL_DETAIL.keyNeedsHttps,
  };
}

/** Marks an override that is set but refused by `parseEndpointBaseUrl`. */
const INVALID_OVERRIDE: unique symbol = Symbol('invalid-override');

/**
 * `provider.ollama-cloud.baseUrl` through the custom-endpoint URL policy
 * (`parseEndpointBaseUrl`): the normalised base, `null` when not set (absent,
 * not a string, or blank), or `INVALID_OVERRIDE` when it is set but has
 * userinfo, a query, a fragment or no http(s) scheme. The raw value is never
 * returned, so it cannot reach a request, a log or a persisted mark.
 */
function ollamaCloudOverride(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): string | null | typeof INVALID_OVERRIDE {
  const raw = workspace.getConfiguration<unknown>(
    DECISION_MODEL_CONFIG_SECTION,
    OLLAMA_CLOUD_BASE_URL_CONFIG_KEY,
  );
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const parsed = parseEndpointBaseUrl(raw);
  return parsed.ok ? parsed.baseUrl : INVALID_OVERRIDE;
}

/** DC7: `local` only for a loopback base URL and a model that is not a cloud tag. */
function localityOf(baseUrl: string, model: string): DecisionModelLocality {
  return isLoopbackBase(baseUrl) && !isCloudTag(model) ? 'local' : 'remote';
}

function endpoint(
  baseUrl: string,
  model: string,
  apiKey: string | null,
  probe: DecisionEndpointProbe,
  locality: DecisionModelLocality,
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): DecisionEndpoint {
  const target = {
    baseUrl,
    model,
    probe,
    locality,
    timeoutMs: requestTimeoutMs(locality, workspace),
  };
  return apiKey === null ? target : { ...target, apiKey };
}
