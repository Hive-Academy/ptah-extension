import type {
  ISecretStorage,
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { OLLAMA_PROVIDER_ENTRY } from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  buildProbeUrls,
  checkVersion,
  discriminate,
  errorMessage,
  isLocalUrl,
  keyOf,
  normaliseBaseUrl,
  toRowState,
  type ProbeAnswer,
} from './decision-model.probe';
import { DECISION_MODEL_DETAIL } from './decision-model.detail';
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
  type DecisionModelLocality,
  type DecisionModelProbeResult,
  type DecisionModelSelection,
  type DecisionModelState,
  type DecisionModelStatusDto,
  type DecisionModelUnsupportedMark,
} from './decision-model.types';
import type { StructuredDecisionCompleter } from './structured-decision.port';
import type { SystemOneFetch } from './system-one.client';

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
  /** Serialises mark writes so a stale persist cannot land last. */
  private markChain: Promise<void> = Promise.resolve();

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
    return this.statusForCurrent(true);
  }

  /**
   * `allowRetry` is true only for the caller-facing read. A probe that
   * finishes for a selection that is no longer current may probe the new
   * selection once; a further change returns that row with no extra probe.
   */
  private async statusForCurrent(
    allowRetry: boolean,
  ): Promise<DecisionModelStatusDto> {
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
        const startedKey = keyOf(selection, baseUrl);
        const probe = await this.probe(baseUrl, selection.model);
        return this.applyProbe(
          selection,
          baseUrl,
          probe,
          null,
          startedKey,
          allowRetry,
        );
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
   * Persists the unsupported mark for the selection this probe started with.
   * The storage write shares one chain with `clearMark`. Inside that chain
   * the key is checked again; a mark that is no longer current writes a
   * clear instead, so a delayed write cannot be the last persisted value.
   * A persistence failure is logged at warn; the in-memory mark still holds
   * for this session when the key was current at the write.
   */
  async markUnsupported(
    baseUrl: string,
    detail: string,
    selection: DecisionModelSelection,
  ): Promise<void> {
    const normalised = normaliseBaseUrl(baseUrl);
    const markKey = keyOf(selection, normalised);
    if (this.currentProbeKey() !== markKey) {
      return;
    }
    await this.enqueueMark(async () => {
      if (this.currentProbeKey() !== markKey) {
        await this.persistMark(undefined);
        return;
      }
      const mark: DecisionModelUnsupportedMark = {
        selection,
        baseUrl: normalised,
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
      await this.persistMark(mark);
    });
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
    const startedKey = keyOf(selection, base);
    const probe = await this.coalescedRecheck(
      startedKey,
      base,
      selection.model,
    );
    return this.applyProbe(
      selection,
      base,
      probe,
      liveDetail,
      startedKey,
      false,
    );
  }

  // ---------------------------------------------------------- internals

  private async jevStatus(
    selection: Extract<DecisionModelSelection, { kind: 'jev' }>,
  ): Promise<DecisionModelStatusDto> {
    let hasKey: boolean;
    try {
      hasKey = await this.hasJevApiKey();
    } catch (error: unknown) {
      // The rejection text is untrusted: logged, never shown in the row.
      this.logger.warn('[lane-routing] Jev credential lookup failed', {
        error: errorMessage(error),
      });
      return this.dto(
        selection,
        'unreachable',
        DECISION_MODEL_DETAIL.credentialStore,
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
      return this.dto(
        selection,
        'unreachable',
        DECISION_MODEL_DETAIL.providerCheck,
      );
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
    startedKey: string,
    allowRetry: boolean,
  ): Promise<DecisionModelStatusDto> {
    if (this.currentProbeKey() !== startedKey) {
      return allowRetry
        ? this.statusForCurrent(false)
        : this.currentRowWithoutProbe();
    }
    const key = startedKey;
    if (probe.outcome === 'unsupported-endpoint') {
      const base = probe.detail ?? 'endpoint does not serve /v1/systemone';
      const detail =
        liveDetail === null ? base : `${base}; last call: ${liveDetail}`;
      if (!this.markMatches(key)) {
        await this.markUnsupported(baseUrl, detail, selection);
      }
      if (this.currentProbeKey() !== startedKey) {
        return this.currentRowWithoutProbe();
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
      if (this.currentProbeKey() !== startedKey) {
        return this.currentRowWithoutProbe();
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
      // Classified by the abort signal, never by message (its only source is
      // the probe budget). The message is untrusted (it can name the host)
      // and goes to the log only; the row detail is fixed text. The URL is
      // not logged: a base URL can carry userinfo credentials.
      const timedOut = signal.aborted;
      this.logger.warn('[lane-routing] decision model probe request failed', {
        method: init.method,
        timedOut,
        timeoutMs: this.probeTimeoutMs,
        error: errorMessage(error),
      });
      return {
        kind: 'failed',
        detail: timedOut
          ? DECISION_MODEL_DETAIL.timedOut
          : DECISION_MODEL_DETAIL.unreachable,
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
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(DECISION_MODEL_UNSUPPORTED_STORAGE_KEY);
    } catch (error: unknown) {
      // degradation-audit: reported - a failed unsupported-mark read starts with no mark so routing can continue
      this.logger.warn(
        '[lane-routing] decision model unsupported mark could not be read',
        { name: error instanceof Error ? error.name : 'UnknownError' },
      );
      return null;
    }
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

  private enqueueMark(work: () => Promise<void>): Promise<void> {
    const run = this.markChain.then(work, work);
    this.markChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persistMark(
    value: DecisionModelUnsupportedMark | undefined,
  ): Promise<void> {
    try {
      await this.storage.update(DECISION_MODEL_UNSUPPORTED_STORAGE_KEY, value);
    } catch (error: unknown) {
      this.logger.warn(
        value === undefined
          ? '[lane-routing] decision model unsupported mark was not cleared in storage'
          : '[lane-routing] decision model unsupported mark was not persisted',
        { error: errorMessage(error) },
      );
    }
  }

  /**
   * Row for the selection now, without an Ollama probe. Unmarked Ollama uses
   * `unreachable`: decision #46 fixes the state set and has no pending state.
   */
  private currentRowWithoutProbe(): Promise<DecisionModelStatusDto> {
    const selection = this.getSelection();
    switch (selection.kind) {
      case 'unset':
        return Promise.resolve(this.dto(selection, 'unset', null));
      case 'jev':
        return this.jevStatus(selection);
      case 'structured':
        return this.structuredStatus(selection);
      case 'ollama': {
        const key = keyOf(selection, this.ollamaBaseUrl());
        const mark = this.mark;
        if (mark !== null && keyOf(mark.selection, mark.baseUrl) === key) {
          return Promise.resolve(
            this.dto(selection, 'unsupported-endpoint', mark.detail),
          );
        }
        return Promise.resolve(this.dto(selection, 'unreachable', null));
      }
    }
  }

  private async clearMark(reason: string): Promise<void> {
    this.mark = null;
    this.logger.info('[lane-routing] decision model unsupported mark cleared', {
      reason,
    });
    await this.enqueueMark(() => this.persistMark(undefined));
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

  /** Selection plus the base URL that selection would be probed against now. */
  private currentProbeKey(): string {
    const selection = this.getSelection();
    if (selection.kind === 'ollama') {
      return keyOf(selection, this.ollamaBaseUrl());
    }
    if (selection.kind === 'jev') {
      return keyOf(selection, JEV_BASE_URL);
    }
    return keyOf(selection, '');
  }
}
