import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  OLLAMA_CLOUD_DIRECT_BASE_URL,
  OLLAMA_CLOUD_PROVIDER_ENTRY,
  isCloudTag,
  toCloudId,
} from '@ptah-extension/shared';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_REQUEST_TIMEOUT_REMOTE_MS,
} from '../routing-constants';
import { isLoopbackBase, keyTransportAllowed } from './decision-endpoint.url';
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
 * Every selection the resolver understands. `OllamaCloudSelection` and
 * `CustomEndpointSelection` join `DecisionModelSelection` only when the
 * union widens with its consumers (PD-1); until then they are listed here.
 */
export type DecisionEndpointSelection =
  | DecisionModelSelection
  | OllamaCloudSelection
  | CustomEndpointSelection;

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
  /** Per-request budget for this locality (DC8). */
  readonly timeoutMs: number;
}

/**
 * A selection that would send a key where the transport rule (D4) forbids
 * it. `detail` is a fixed `DECISION_MODEL_DETAIL` text with no host in it.
 */
export interface BlockedDecisionEndpoint {
  readonly blocked: true;
  readonly detail: string;
}

/** `null` when the selection does not use System One (`unset`, `structured`). */
export type DecisionEndpointResolution =
  | DecisionEndpoint
  | BlockedDecisionEndpoint
  | null;

/** What the resolver reads. Keys are read per call and never cached (1.4). */
export interface DecisionEndpointDeps {
  /** `ptah` section settings (the Ollama Cloud base URL override). */
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
 * instead (D4, DC6). A rejected secret read propagates to the caller.
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
      );
    case 'jev':
      return endpoint(
        JEV_BASE_URL,
        selection.model,
        await deps.keys.get('jev'),
        'none',
        'remote',
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

/** Per-request budget for a locality (DC8). */
function timeoutForLocality(locality: DecisionModelLocality): number {
  return locality === 'local'
    ? DECISION_REQUEST_TIMEOUT_MS
    : DECISION_REQUEST_TIMEOUT_REMOTE_MS;
}

async function resolveOllamaCloud(
  selection: OllamaCloudSelection,
  deps: DecisionEndpointDeps,
): Promise<DecisionEndpoint | BlockedDecisionEndpoint> {
  const model = toCloudId(selection.model);
  const override = ollamaCloudOverride(deps.workspace);
  const key = await deps.keys.readOllamaCloudKey();
  if (key === null) {
    return endpoint(
      override ?? normaliseBaseUrl(OLLAMA_CLOUD_PROVIDER_ENTRY.baseUrl),
      model,
      null,
      'daemon',
      'remote',
    );
  }
  const baseUrl = override ?? OLLAMA_CLOUD_DIRECT_BASE_URL;
  if (!keyTransportAllowed(baseUrl)) {
    return { blocked: true, detail: DECISION_MODEL_DETAIL.keyNeedsHttps };
  }
  return endpoint(baseUrl, model, key, 'endpoint', 'remote');
}

async function resolveCustom(
  selection: CustomEndpointSelection,
  deps: DecisionEndpointDeps,
): Promise<DecisionEndpoint | BlockedDecisionEndpoint> {
  const baseUrl = normaliseBaseUrl(selection.baseUrl);
  const key = await deps.keys.get('custom', baseUrl);
  if (key !== null && !keyTransportAllowed(baseUrl)) {
    return { blocked: true, detail: DECISION_MODEL_DETAIL.keyNeedsHttps };
  }
  return endpoint(
    baseUrl,
    selection.model,
    key,
    'endpoint',
    localityOf(baseUrl, selection.model),
  );
}

/** `provider.ollama-cloud.baseUrl`, normalised, or `null` when not set. */
function ollamaCloudOverride(
  workspace: Pick<IWorkspaceProvider, 'getConfiguration'>,
): string | null {
  const raw = workspace.getConfiguration<unknown>(
    DECISION_MODEL_CONFIG_SECTION,
    OLLAMA_CLOUD_BASE_URL_CONFIG_KEY,
  );
  return typeof raw === 'string' && raw.trim().length > 0
    ? normaliseBaseUrl(raw)
    : null;
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
): DecisionEndpoint {
  const target = {
    baseUrl,
    model,
    probe,
    locality,
    timeoutMs: timeoutForLocality(locality),
  };
  return apiKey === null ? target : { ...target, apiKey };
}
