import { z } from 'zod';
import type {
  ISecretStorage,
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { OLLAMA_PROVIDER_ENTRY } from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  DECISION_MODEL_CONFIG_KEY,
  DECISION_MODEL_CONFIG_SECTION,
  DECISION_MODEL_JEV_SECRET_KEY,
  DECISION_MODEL_PROBE_TIMEOUT_MS,
  DECISION_MODEL_RECHECK_WINDOW_MS,
  DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
  DecisionModelSelectionSchema,
  DecisionModelUnsupportedMarkSchema,
  JEV_BASE_URL,
  OLLAMA_BASE_URL_CONFIG_KEY,
  OLLAMA_MIN_LAYA_VERSION,
  OLLAMA_MIN_SYSTEM_ONE_VERSION,
  SYSTEM_ONE_CONTROL_PATH,
  type DecisionModelLocality,
  type DecisionModelProbeResult,
  type DecisionModelSelection,
  type DecisionModelState,
  type DecisionModelStatusDto,
  type DecisionModelUnsupportedMark,
} from './decision-model.types';
import type { StructuredDecisionCompleter } from './structured-decision.port';
import { SYSTEM_ONE_PATH, type SystemOneFetch } from './system-one.client';

/** Where a System One call goes for the current selection. */
export interface SystemOneTarget {
  readonly baseUrl: string;
  readonly model: string;
  /** Present only for TypeSafe Jev with a stored key. */
  readonly apiKey?: string;
}

/** Test seams; the DI factory leaves the defaults. */
export interface DecisionModelConfigSeams {
  /** Node's global `fetch` by default. */
  readonly fetch?: SystemOneFetch;
  readonly now?: () => number;
  /** Shared budget of one probe; `DECISION_MODEL_PROBE_TIMEOUT_MS` by default. */
  readonly probeTimeoutMs?: number;
}

const OLLAMA_VERSION_PATH = '/api/version';
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OllamaVersionSchema = z.object({ version: z.string().min(1) });

type ProbeAnswer =
  | {
      readonly kind: 'answered';
      readonly status: number;
      readonly body: string;
    }
  | { readonly kind: 'failed'; readonly detail: string };

interface ProbeRecord {
  readonly startedAt: number;
  readonly result: DecisionModelProbeResult;
}

interface LastCallFailure {
  readonly key: string;
  readonly detail: string;
}

/**
 * Decision-model setting, credential, locality and status
 * (`LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG`, plan part A §5).
 *
 * Status of an Ollama selection comes from a two-step probe sharing one
 * 1500 ms budget: `GET /api/version` (>= 0.35.0, 0.40.0 for `laya*`), then
 * `POST /v1/systemone {}` and the same `POST` to a control path no server
 * serves, compared after normalisation (decision #42). A live 404/405 never
 * marks the endpoint by itself: `recheckAfterLiveNotFound` re-runs the probe,
 * coalesced to one per `(selection, baseUrl)` per 60 s (decision #46).
 *
 * The unsupported mark is persisted in global `IStateStorage` under
 * `ptah.decisionModel.unsupported.v1` as `{ selection, baseUrl, detail, at }`
 * and reloaded at construction, so it survives a restart.
 *
 * A plain class, not `@injectable`: `LANE_ROUTING_TOKENS.LOGGER` and the
 * optional `STRUCTURED_DECISION` port have no registration yet, and di-lint
 * (`tools/di-lint/check-injects.ts`) rejects an `@inject` of an unregistered
 * token. The lane-routing register function builds it with a `useFactory`
 * (precedent `auth-providers/src/lib/di/register.ts:223-226`), resolving the
 * three platform ports, the logger, and the structured port only when
 * `isRegistered(STRUCTURED_DECISION, true)`.
 */
export class DecisionModelConfig {
  private readonly fetchImpl: SystemOneFetch;
  private readonly now: () => number;
  private readonly probeTimeoutMs: number;
  private mark: DecisionModelUnsupportedMark | null;
  /** In memory only: cleared by a success, a selection change or a restart. */
  private lastCallFailure: LastCallFailure | null = null;
  private readonly recentRechecks = new Map<string, ProbeRecord>();
  private readonly inFlightRechecks = new Map<
    string,
    Promise<DecisionModelProbeResult>
  >();

  constructor(
    /** `PLATFORM_TOKENS.WORKSPACE_PROVIDER` */
    private readonly workspace: IWorkspaceProvider,
    /** `PLATFORM_TOKENS.SECRET_STORAGE` */
    private readonly secrets: ISecretStorage,
    /** `PLATFORM_TOKENS.STATE_STORAGE` (global scope) */
    private readonly storage: IStateStorage,
    /** `LANE_ROUTING_TOKENS.LOGGER` */
    private readonly logger: LaneRoutingLogger,
    /** `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`, when the host registers it */
    private readonly structured?: StructuredDecisionCompleter,
    seams: DecisionModelConfigSeams = {},
  ) {
    this.fetchImpl = seams.fetch ?? fetch;
    this.now = seams.now ?? Date.now;
    this.probeTimeoutMs =
      seams.probeTimeoutMs ?? DECISION_MODEL_PROBE_TIMEOUT_MS;
    this.mark = this.loadMark();
  }

  // ------------------------------------------------------------ selection

  /** The stored selection; a missing or hand-edited invalid value reads as unset. */
  getSelection(): DecisionModelSelection {
    const raw = this.workspace.getConfiguration<unknown>(
      DECISION_MODEL_CONFIG_SECTION,
      DECISION_MODEL_CONFIG_KEY,
    );
    if (raw === undefined || raw === null) {
      return { kind: 'unset' };
    }
    const parsed = DecisionModelSelectionSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        '[lane-routing] stored decision model selection is invalid; reading it as unset',
        { issue: parsed.error.issues[0]?.message ?? 'invalid selection' },
      );
      return { kind: 'unset' };
    }
    return parsed.data;
  }

  /**
   * Validates and stores a selection (global). A change of selection clears
   * the unsupported mark and the in-memory live-failure detail.
   * Throws when the input is not a valid selection.
   */
  async setSelection(input: unknown): Promise<DecisionModelSelection> {
    const parsed = DecisionModelSelectionSchema.safeParse(input);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const at = first && first.path.length > 0 ? first.path.join('.') : 'kind';
      throw new Error(
        `invalid decision model selection at ${at}: ${first?.message ?? 'invalid'}`,
      );
    }
    const selection = parsed.data;
    await this.workspace.setConfiguration(
      DECISION_MODEL_CONFIG_SECTION,
      DECISION_MODEL_CONFIG_KEY,
      selection,
    );
    this.lastCallFailure = null;
    this.recentRechecks.clear();
    if (
      this.mark &&
      !this.markMatches(keyOf(selection, this.ollamaBaseUrl()))
    ) {
      await this.clearMark('selection changed');
    }
    return selection;
  }

  // ----------------------------------------------------------- credential

  async hasJevApiKey(): Promise<boolean> {
    const key = await this.secrets.get(DECISION_MODEL_JEV_SECRET_KEY);
    return typeof key === 'string' && key.trim().length > 0;
  }

  /** Stores the Jev key; `null` or blank deletes it. The key is never logged or returned. */
  async setJevApiKey(key: string | null): Promise<void> {
    const trimmed = key?.trim() ?? '';
    if (trimmed.length === 0) {
      await this.secrets.delete(DECISION_MODEL_JEV_SECRET_KEY);
      return;
    }
    await this.secrets.store(DECISION_MODEL_JEV_SECRET_KEY, trimmed);
  }

  /**
   * Base URL, model and (Jev) key for a System One call, or `null` when the
   * selection does not use System One (`unset`, `structured`).
   */
  async resolveSystemOneTarget(): Promise<SystemOneTarget | null> {
    const selection = this.getSelection();
    if (selection.kind === 'ollama') {
      return { baseUrl: this.ollamaBaseUrl(), model: selection.model };
    }
    if (selection.kind === 'jev') {
      const key = await this.secrets.get(DECISION_MODEL_JEV_SECRET_KEY);
      const apiKey = key?.trim();
      return apiKey
        ? { baseUrl: JEV_BASE_URL, model: selection.model, apiKey }
        : { baseUrl: JEV_BASE_URL, model: selection.model };
    }
    return null;
  }

  // ------------------------------------------------------------- locality

  /** `provider.ollama.baseUrl`, trimmed, without trailing slashes. */
  ollamaBaseUrl(): string {
    const custom = this.workspace.getConfiguration<unknown>(
      DECISION_MODEL_CONFIG_SECTION,
      OLLAMA_BASE_URL_CONFIG_KEY,
    );
    if (typeof custom === 'string' && custom.trim().length > 0) {
      return normaliseBaseUrl(custom);
    }
    return normaliseBaseUrl(OLLAMA_PROVIDER_ENTRY.baseUrl);
  }

  /** Req 1.4: where the request text and lane data go. */
  localityOf(selection: DecisionModelSelection): DecisionModelLocality | null {
    switch (selection.kind) {
      case 'unset':
        return null;
      case 'jev':
        return 'remote';
      case 'ollama':
        return isLocalUrl(this.ollamaBaseUrl()) ? 'local' : 'remote';
      case 'structured':
        return selection.providerId === 'ollama' &&
          isLocalUrl(this.ollamaBaseUrl())
          ? 'local'
          : 'remote';
    }
  }

  // --------------------------------------------------------------- status

  /** Row status. Probes the endpoint for Ollama; makes no paid call for any kind. */
  async getStatus(): Promise<DecisionModelStatusDto> {
    const selection = this.getSelection();
    switch (selection.kind) {
      case 'unset':
        return this.dto(selection, 'unset', null);
      case 'jev':
        return this.jevStatus(selection);
      case 'structured':
        return this.structuredStatus(selection);
      case 'ollama': {
        const baseUrl = this.ollamaBaseUrl();
        const probe = await this.probe(baseUrl, selection.model);
        return this.applyProbe(selection, baseUrl, probe, null);
      }
    }
  }

  /** True when a persisted mark matches the current selection and Ollama base URL. */
  isMarkedUnsupported(): boolean {
    const selection = this.getSelection();
    return (
      selection.kind === 'ollama' &&
      this.markMatches(keyOf(selection, this.ollamaBaseUrl()))
    );
  }

  /** A successful live call clears the `last call failed` detail. */
  recordLiveSuccess(): void {
    this.lastCallFailure = null;
  }

  /**
   * Persists the unsupported mark for the current selection at `baseUrl`.
   * A persistence failure is logged at warn; the in-memory mark still holds
   * for this session.
   */
  async markUnsupported(baseUrl: string, detail: string): Promise<void> {
    const mark: DecisionModelUnsupportedMark = {
      selection: this.getSelection(),
      baseUrl: normaliseBaseUrl(baseUrl),
      detail,
      at: this.now(),
    };
    this.mark = mark;
    this.logger.info(
      '[lane-routing] decision model endpoint marked unsupported',
      {
        baseUrl: mark.baseUrl,
        detail,
      },
    );
    try {
      await this.storage.update(DECISION_MODEL_UNSUPPORTED_STORAGE_KEY, mark);
    } catch (error: unknown) {
      this.logger.warn(
        '[lane-routing] decision model unsupported mark was not persisted',
        { error: errorMessage(error) },
      );
    }
  }

  /**
   * Called by the pipeline after a live System One 404/405 (`notFound`).
   * Re-runs the probe (no request text is sent), coalesced to one in-flight
   * re-check per `(selection, baseUrl)` and at most one per 60 s; a live
   * 404/405 inside the window reuses the last result.
   * - `unsupported-endpoint` → the mark is persisted.
   * - `ready` → no mark is written, an existing mark is cleared, and the row
   *   stays `ready` with detail `last call failed: <liveDetail>`.
   * - any other outcome → no mark and no clear; the row shows that state.
   */
  async recheckAfterLiveNotFound(
    baseUrl: string,
    liveDetail: string,
  ): Promise<DecisionModelStatusDto> {
    const selection = this.getSelection();
    if (selection.kind !== 'ollama') {
      // TypeSafe Jev's route is a documented contract
      // (`research-decision-models.md:155`), and the other kinds do not call
      // System One, so a live 404/405 there is a model failure: no probe.
      if (selection.kind === 'jev') {
        this.lastCallFailure = {
          key: keyOf(selection, JEV_BASE_URL),
          detail: liveDetail,
        };
      }
      return this.getStatus();
    }
    const base = normaliseBaseUrl(baseUrl);
    const probe = await this.coalescedRecheck(
      keyOf(selection, base),
      base,
      selection.model,
    );
    return this.applyProbe(selection, base, probe, liveDetail);
  }

  // ---------------------------------------------------------- internals

  private async jevStatus(
    selection: Extract<DecisionModelSelection, { kind: 'jev' }>,
  ): Promise<DecisionModelStatusDto> {
    let hasKey: boolean;
    try {
      hasKey = await this.hasJevApiKey();
    } catch (error: unknown) {
      this.logger.warn('[lane-routing] Jev credential lookup failed', {
        error: errorMessage(error),
      });
      return this.dto(
        selection,
        'unreachable',
        `credential store unavailable: ${errorMessage(error)}`,
      );
    }
    if (!hasKey) {
      return this.dto(
        selection,
        'no-credential',
        'TypeSafe Jev API key is not set',
      );
    }
    return this.dto(
      selection,
      'ready',
      this.lastFailureDetail(keyOf(selection, JEV_BASE_URL)),
    );
  }

  private async structuredStatus(
    selection: Extract<DecisionModelSelection, { kind: 'structured' }>,
  ): Promise<DecisionModelStatusDto> {
    if (!this.structured) {
      return this.dto(
        selection,
        'unreachable',
        'structured-output models are not available in this host',
      );
    }
    let ready: boolean;
    try {
      ready = await this.structured.isReady(selection.providerId);
    } catch (error: unknown) {
      this.logger.warn('[lane-routing] structured provider readiness failed', {
        providerId: selection.providerId,
        error: errorMessage(error),
      });
      return this.dto(selection, 'unreachable', errorMessage(error));
    }
    return ready
      ? this.dto(selection, 'ready', null)
      : this.dto(
          selection,
          'no-credential',
          `provider ${selection.providerId} has no credential`,
        );
  }

  private async applyProbe(
    selection: Extract<DecisionModelSelection, { kind: 'ollama' }>,
    baseUrl: string,
    probe: DecisionModelProbeResult,
    liveDetail: string | null,
  ): Promise<DecisionModelStatusDto> {
    const key = keyOf(selection, baseUrl);
    if (probe.outcome === 'unsupported-endpoint') {
      const base = probe.detail ?? 'endpoint does not serve /v1/systemone';
      const detail =
        liveDetail === null ? base : `${base}; last call: ${liveDetail}`;
      if (!this.markMatches(key)) {
        await this.markUnsupported(baseUrl, detail);
      }
      return this.dto(
        selection,
        'unsupported-endpoint',
        this.mark?.detail ?? detail,
      );
    }
    if (probe.outcome === 'ready') {
      if (this.mark) {
        await this.clearMark('probe proved the route');
      }
      if (liveDetail !== null) {
        this.lastCallFailure = { key, detail: liveDetail };
      }
      return this.dto(
        selection,
        'ready',
        this.lastFailureDetail(key) ?? probe.detail,
      );
    }
    return this.dto(selection, toRowState(probe.outcome), probe.detail);
  }

  private coalescedRecheck(
    key: string,
    baseUrl: string,
    model: string,
  ): Promise<DecisionModelProbeResult> {
    const startedAt = this.now();
    const recent = this.recentRechecks.get(key);
    if (
      recent &&
      startedAt - recent.startedAt < DECISION_MODEL_RECHECK_WINDOW_MS
    ) {
      this.logger.debug('[lane-routing] decision model re-check reused', {
        outcome: recent.result.outcome,
      });
      return Promise.resolve(recent.result);
    }
    const pending = this.inFlightRechecks.get(key);
    if (pending) {
      return pending;
    }
    const run = this.probe(baseUrl, model)
      .then((result) => {
        this.recentRechecks.set(key, { startedAt, result });
        return result;
      })
      .finally(() => {
        this.inFlightRechecks.delete(key);
      });
    this.inFlightRechecks.set(key, run);
    return run;
  }

  /**
   * Version check, then the System One and control `POST {}` in parallel,
   * all under one abort budget. Never rejects.
   */
  private async probe(
    baseUrl: string,
    model: string,
  ): Promise<DecisionModelProbeResult> {
    const urls = buildProbeUrls(baseUrl);
    if (!urls) {
      return {
        outcome: 'unreachable',
        detail: 'base url is not a valid absolute url',
      };
    }
    const signal = AbortSignal.timeout(this.probeTimeoutMs);

    const version = await this.send(urls.version, { method: 'GET' }, signal);
    const versionResult = checkVersion(version, model);
    if (versionResult) {
      return this.loggedProbe(versionResult);
    }

    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    };
    const [route, control] = await Promise.all([
      this.send(urls.route, init, signal),
      this.send(urls.control, init, signal),
    ]);
    return this.loggedProbe(discriminate(route, control));
  }

  private async send(
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    signal: AbortSignal,
  ): Promise<ProbeAnswer> {
    try {
      const response = await this.fetchImpl(url, { ...init, signal });
      const body = await response.text();
      return { kind: 'answered', status: response.status, body };
    } catch (error: unknown) {
      return {
        kind: 'failed',
        detail: signal.aborted
          ? `probe timed out after ${this.probeTimeoutMs} ms`
          : errorMessage(error),
      };
    }
  }

  private loggedProbe(
    result: DecisionModelProbeResult,
  ): DecisionModelProbeResult {
    this.logger.debug('[lane-routing] decision model probe', {
      outcome: result.outcome,
      detail: result.detail,
    });
    return result;
  }

  private loadMark(): DecisionModelUnsupportedMark | null {
    const raw = this.storage.get<unknown>(
      DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
    );
    if (raw === undefined || raw === null) {
      return null;
    }
    const parsed = DecisionModelUnsupportedMarkSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        '[lane-routing] stored decision model unsupported mark is invalid; ignoring it',
        { issue: parsed.error.issues[0]?.message ?? 'invalid mark' },
      );
      return null;
    }
    return parsed.data;
  }

  private markMatches(key: string): boolean {
    return (
      this.mark !== null &&
      keyOf(this.mark.selection, this.mark.baseUrl) === key
    );
  }

  private async clearMark(reason: string): Promise<void> {
    this.mark = null;
    this.logger.info('[lane-routing] decision model unsupported mark cleared', {
      reason,
    });
    try {
      await this.storage.update(
        DECISION_MODEL_UNSUPPORTED_STORAGE_KEY,
        undefined,
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[lane-routing] decision model unsupported mark was not cleared in storage',
        { error: errorMessage(error) },
      );
    }
  }

  private lastFailureDetail(key: string): string | null {
    return this.lastCallFailure && this.lastCallFailure.key === key
      ? `last call failed: ${this.lastCallFailure.detail}`
      : null;
  }

  private dto(
    selection: DecisionModelSelection,
    state: DecisionModelState,
    detail: string | null,
  ): DecisionModelStatusDto {
    return {
      selection,
      locality: this.localityOf(selection),
      reportsConfidence:
        selection.kind === 'ollama' || selection.kind === 'jev',
      state,
      detail,
    };
  }
}

// ------------------------------------------------------------- helpers

/** Probe outcome → row state; the row state set is fixed (decision #46). */
function toRowState(
  outcome: DecisionModelProbeResult['outcome'],
): DecisionModelState {
  switch (outcome) {
    case 'auth':
      return 'no-credential';
    case 'provider-error':
      return 'unreachable';
    default:
      return outcome;
  }
}

/** `null` when the version passes (the POSTs run next); else the probe result. */
function checkVersion(
  answer: ProbeAnswer,
  model: string,
): DecisionModelProbeResult | null {
  if (answer.kind === 'failed') {
    return { outcome: 'unreachable', detail: answer.detail };
  }
  if (answer.status === 401 || answer.status === 403) {
    return {
      outcome: 'auth',
      detail: `version check answered http ${answer.status}`,
    };
  }
  if (answer.status === 404 || answer.status === 405) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `endpoint does not serve ${OLLAMA_VERSION_PATH}`,
    };
  }
  if (answer.status < 200 || answer.status >= 300) {
    return {
      outcome: 'provider-error',
      detail: `version check answered http ${answer.status}`,
    };
  }
  const parsed = OllamaVersionSchema.safeParse(parseJson(answer.body));
  if (!parsed.success) {
    return {
      outcome: 'provider-error',
      detail: 'version check answered an unreadable body',
    };
  }
  const minimum = model.toLowerCase().startsWith('laya')
    ? OLLAMA_MIN_LAYA_VERSION
    : OLLAMA_MIN_SYSTEM_ONE_VERSION;
  if (!isVersionAtLeast(parsed.data.version, minimum)) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `Ollama ${parsed.data.version} < ${minimum}`,
    };
  }
  return null;
}

/**
 * Route discriminator (decision #42, part A §5). 401/403 and other statuses
 * are not route evidence; otherwise an answer equal to the control's
 * normalised answer is ambiguous and therefore unsupported.
 */
function discriminate(
  route: ProbeAnswer,
  control: ProbeAnswer,
): DecisionModelProbeResult {
  if (route.kind === 'failed') {
    return { outcome: 'unreachable', detail: route.detail };
  }
  const notFound = route.status === 404 || route.status === 405;
  if (route.status === 401 || route.status === 403) {
    return { outcome: 'auth', detail: `route answered http ${route.status}` };
  }
  const routeSpecific =
    (route.status >= 200 && route.status < 300) ||
    route.status === 400 ||
    route.status === 422;
  if (!routeSpecific && !notFound) {
    return {
      outcome: 'provider-error',
      detail: `route answered http ${route.status}`,
    };
  }
  if (control.kind === 'failed') {
    return notFound
      ? {
          outcome: 'unsupported-endpoint',
          detail: `endpoint does not serve ${SYSTEM_ONE_PATH} (route answered ${route.status}; control request failed: ${control.detail})`,
        }
      : { outcome: 'ready', detail: null };
  }
  const same =
    normaliseAnswer(route.status, route.body, SYSTEM_ONE_PATH) ===
    normaliseAnswer(control.status, control.body, SYSTEM_ONE_CONTROL_PATH);
  if (same) {
    return {
      outcome: 'unsupported-endpoint',
      detail: `endpoint does not serve ${SYSTEM_ONE_PATH}`,
    };
  }
  return notFound
    ? { outcome: 'ready', detail: `route answered ${route.status}` }
    : { outcome: 'ready', detail: null };
}

/**
 * Status plus body with the request path masked as `<path>`; a JSON body is
 * compared by value (canonical key order), any other body as trimmed text.
 */
function normaliseAnswer(status: number, body: string, path: string): string {
  const masked = body.split(path).join('<path>').trim();
  const json = parseJson(masked);
  const value =
    json === NOT_JSON ? `text:${masked}` : `json:${canonicalJson(json)}`;
  return `${status}\n${value}`;
}

const NOT_JSON: unique symbol = Symbol('not-json');

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON body is a valid answer here: callers compare it as text or
    // reject it by schema. The sentinel is a unique symbol, never data.
    return NOT_JSON;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function buildProbeUrls(
  baseUrl: string,
): { version: string; route: string; control: string } | null {
  if (!URL.canParse(baseUrl)) {
    return null;
  }
  return {
    version: new URL(OLLAMA_VERSION_PATH, baseUrl).toString(),
    route: new URL(SYSTEM_ONE_PATH, baseUrl).toString(),
    control: new URL(SYSTEM_ONE_CONTROL_PATH, baseUrl).toString(),
  };
}

function isLocalUrl(baseUrl: string): boolean {
  return (
    URL.canParse(baseUrl) && LOCAL_HOSTNAMES.has(new URL(baseUrl).hostname)
  );
}

/** Same comparison as `ollama-model-discovery.service.ts:316-327`. */
function isVersionAtLeast(actual: string, minimum: string): boolean {
  const parse = (v: string): number[] =>
    v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(actual);
  const m = parse(minimum);
  for (let i = 0; i < Math.max(a.length, m.length); i++) {
    const av = a[i] ?? 0;
    const mv = m[i] ?? 0;
    if (av > mv) return true;
    if (av < mv) return false;
  }
  return true;
}

function normaliseBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Coalescing and mark key: canonical selection plus normalised base URL. */
function keyOf(selection: DecisionModelSelection, baseUrl: string): string {
  return `${canonicalJson(selection)}|${normaliseBaseUrl(baseUrl)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
