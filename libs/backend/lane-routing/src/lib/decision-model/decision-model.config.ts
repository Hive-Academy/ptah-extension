import { createHmac, randomBytes } from 'node:crypto';
import type {
  ISecretStorage,
  IStateStorage,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { OLLAMA_PROVIDER_ENTRY } from '@ptah-extension/shared';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { keyOf, normaliseBaseUrl, toRowState } from './decision-model.probe';
import { DECISION_MODEL_DETAIL, errorName } from './decision-model.detail';
import {
  DecisionEndpointProber,
  type DecisionProbeRequest,
} from './decision-model.prober';
import { DecisionModelKeys } from './decision-model.keys';
import {
  isBlockedDecisionEndpoint,
  localityOfSelection,
  resolveDecisionEndpoint,
  type DecisionEndpoint,
  type DecisionEndpointDeps,
  type DecisionEndpointResolution,
} from './decision-model.target';
import {
  DECISION_MODEL_CONFIG_KEY,
  DECISION_MODEL_CONFIG_SECTION,
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

/**
 * Where a System One call goes for the current selection: the resolved
 * endpoint (Component 5), with its per-request `timeoutMs` (DC8).
 */
export type SystemOneTarget = DecisionEndpoint;

/** Test seams; the DI factory leaves the defaults. */
export interface DecisionModelConfigSeams {
  /** Node's global `fetch` by default. */
  readonly fetch?: SystemOneFetch;
  readonly now?: () => number;
  /** Shared budget of one probe; `DECISION_MODEL_PROBE_TIMEOUT_MS` by default. */
  readonly probeTimeoutMs?: number;
}

/** Selections whose row status comes from a probe of the resolved endpoint. */
type ProbedSelection = Extract<
  DecisionModelSelection,
  { kind: 'ollama' | 'ollama-cloud' | 'custom' }
>;

/** What one status run of a probed selection does: probe, or show a fixed row. */
type ProbePlan =
  | { readonly kind: 'probe'; readonly request: DecisionProbeRequest }
  | { readonly kind: 'row'; readonly row: DecisionModelStatusDto };

/**
 * What a probe, a re-check or a mark is evidence for. `target` is
 * `keyOf(selection, baseUrl)`, the persisted mark key. `credential` is a
 * non-secret fingerprint of the key sent with the probe (`''` without one):
 * an HMAC under a random per-instance salt, so it is neither the key nor a
 * reversible or dictionary-checkable form of it, and it never leaves memory.
 */
interface ProbeIdentity {
  readonly target: string;
  readonly credential: string;
}

/** The System One call that answered 404/405 (`recheckAfterLiveNotFound`). */
export interface DecisionLiveCall {
  /** The selection the call was made for. */
  readonly selection: DecisionModelSelection;
  /** The base URL the call went to. */
  readonly baseUrl: string;
}

interface ProbeRecord {
  /** Fingerprint of the key the re-check ran with. */
  readonly credential: string;
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
 * Status of an `ollama`, `ollama-cloud` or `custom` selection comes from a
 * probe of the resolved endpoint (`DecisionEndpointProber`, built here from
 * the `fetch` and `probeTimeoutMs` seams) sharing one 1500 ms budget. The
 * resolver picks the mode: `daemon` checks `GET /api/version` (>= 0.35.0,
 * 0.40.0 for `laya*`) first; `endpoint` skips it and sends the key. Both then
 * `POST /v1/systemone {}` and the same `POST` to a control path no server
 * serves, compared after normalisation (decision #42). A live 404/405 never
 * marks the endpoint by itself: `recheckAfterLiveNotFound` re-runs the probe,
 * coalesced to one per `(selection, baseUrl)` per 60 s (decision #46). Probe,
 * re-check and mark evidence is also bound to a non-secret fingerprint of
 * the key sent (`ProbeIdentity`), so a key change discards it.
 *
 * The unsupported mark is persisted in global `IStateStorage` under
 * `ptah.decisionModel.unsupported.v1` as `{ selection, baseUrl, detail, at }`
 * and reloaded at construction, so it survives a restart. Its base URL is the
 * resolved one, so a key change that switches the Ollama Cloud path also
 * switches the mark key.
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
  /** Every key the decision model reads or writes (Component 4). */
  readonly keys: DecisionModelKeys;
  private readonly prober: DecisionEndpointProber;
  private readonly now: () => number;
  private mark: DecisionModelUnsupportedMark | null;
  /**
   * Key fingerprint the mark is evidence for; `null` while it is unverified.
   * A mark written this session carries the fingerprint of the key its probe
   * sent. The fingerprint is never persisted, so a mark loaded from storage
   * is unverified (see `loadedMarkCredential`): it matches no key until a
   * probe under the current key writes it again or clears it.
   */
  private markCredential: string | null;
  /** Salt of `credentialFingerprint`; random per instance, never stored. */
  private readonly fingerprintSalt = randomBytes(32);
  /** In memory only: cleared by a success, a selection change or a restart. */
  private lastCallFailure: LastCallFailure | null = null;
  /** Last re-check per `ProbeIdentity.target`; a key change misses it. */
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
    /** `PLATFORM_TOKENS.SECRET_STORAGE`, owned by `keys` */
    secrets: ISecretStorage,
    /** `PLATFORM_TOKENS.STATE_STORAGE` (global scope) */
    private readonly storage: IStateStorage,
    /** `LANE_ROUTING_TOKENS.LOGGER` */
    private readonly logger: LaneRoutingLogger,
    /** `LANE_ROUTING_TOKENS.STRUCTURED_DECISION`, when the host registers it */
    private readonly structured?: StructuredDecisionCompleter,
    seams: DecisionModelConfigSeams = {},
  ) {
    this.keys = new DecisionModelKeys(secrets, logger);
    this.prober = new DecisionEndpointProber(logger, {
      fetch: seams.fetch ?? fetch,
      timeoutMs: seams.probeTimeoutMs ?? DECISION_MODEL_PROBE_TIMEOUT_MS,
    });
    this.now = seams.now ?? Date.now;
    this.mark = this.loadMark();
    this.markCredential = loadedMarkCredential(this.mark);
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
    if (this.mark && !this.markMatches(await this.probeKeyOf(selection))) {
      await this.clearMark('selection changed');
    }
    return selection;
  }

  // ----------------------------------------------------------- credential

  /**
   * The resolved endpoint for a System One call, or `null` when the
   * selection does not use System One (`unset`, `structured`) or the
   * resolver blocks it (a key would cross plain http, D4). Callers already
   * treat `null` as "no call". A rejected secret read propagates.
   *
   * `selection` defaults to the stored one. A caller that already holds a
   * selection passes it, so the target always belongs to that selection
   * even when the setting changes while the key is read.
   */
  async resolveSystemOneTarget(
    selection: DecisionModelSelection = this.getSelection(),
  ): Promise<SystemOneTarget | null> {
    const resolution = await resolveDecisionEndpoint(
      selection,
      this.endpointDeps(),
    );
    return isBlockedDecisionEndpoint(resolution) ? null : resolution;
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

  /**
   * Req 1.4: where the request text and lane data go. Sync and key-free
   * (PD-5), so the status DTO can use it; same rule as the resolver (DC7).
   */
  localityOf(selection: DecisionModelSelection): DecisionModelLocality | null {
    return localityOfSelection(selection, {
      ollamaBaseUrl: () => this.ollamaBaseUrl(),
    });
  }

  // --------------------------------------------------------------- status

  /**
   * Row status. Probes the resolved endpoint for `ollama`, `ollama-cloud`
   * and `custom`; makes no paid call for any kind.
   */
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
      case 'ollama':
      case 'ollama-cloud':
      case 'custom': {
        const plan = await this.probePlan(selection);
        if (plan.kind === 'row') {
          return plan.row;
        }
        const started = this.identityOf(selection, plan.request);
        const probe = await this.prober.probe(plan.request);
        return this.applyProbe(
          selection,
          plan.request,
          probe,
          null,
          started,
          allowRetry,
        );
      }
    }
  }

  /**
   * True when a verified mark matches the current selection, the base URL
   * it resolves to now and the key it was written under. A mark loaded from
   * storage for a selection that can send a key is unverified until a probe
   * under the current key confirms it. Async: the Ollama Cloud base depends
   * on whether its key is stored.
   */
  async isMarkedUnsupported(): Promise<boolean> {
    return this.markMatches(await this.currentProbeKey());
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
   *
   * `probed` is the base URL and key the probe used: a mark is written only
   * while the current selection still resolves to that base with that key,
   * so a probe under an old key cannot mark the endpoint for a new one.
   */
  async markUnsupported(
    probed: Pick<DecisionProbeRequest, 'baseUrl' | 'apiKey'>,
    detail: string,
    selection: DecisionModelSelection,
  ): Promise<void> {
    const normalised = normaliseBaseUrl(probed.baseUrl);
    const identity = this.identityOf(selection, {
      baseUrl: normalised,
      apiKey: probed.apiKey,
    });
    if (!sameIdentity(await this.currentProbeKey(), identity)) {
      return;
    }
    await this.enqueueMark(async () => {
      if (!sameIdentity(await this.currentProbeKey(), identity)) {
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
      this.markCredential = identity.credential;
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
   * re-check per `(selection, baseUrl, key fingerprint)` and at most one per
   * 60 s; a live 404/405 inside the window reuses the last result unless
   * the key changed since it ran.
   * - `unsupported-endpoint` → the mark is persisted.
   * - `ready` → no mark is written, an existing mark is cleared, and the row
   *   stays `ready` with detail `last call failed: <liveDetail>`.
   * - any other outcome → no mark and no clear; the row shows that state.
   *
   * `failed` is the call that answered 404/405. When the current selection
   * is not the one that call was made for, its detail is stale: nothing is
   * recorded, probed or marked. The probe goes to the endpoint the
   * selection resolves to now, in its mode and with its key. When that is
   * no longer `failed.baseUrl` (the settings or the key changed since the
   * live call), nothing is probed or marked either.
   */
  async recheckAfterLiveNotFound(
    failed: DecisionLiveCall,
    liveDetail: string,
  ): Promise<DecisionModelStatusDto> {
    const selection = this.getSelection();
    if (keyOf(selection, '') !== keyOf(failed.selection, '')) {
      this.logger.debug(
        '[lane-routing] decision model re-check skipped: selection changed since the call',
        { kind: selection.kind, failedKind: failed.selection.kind },
      );
      return this.currentRowWithoutProbe();
    }
    switch (selection.kind) {
      case 'unset':
      case 'structured':
        // These kinds do not call System One: nothing to re-check.
        return this.getStatus();
      case 'jev':
        // TypeSafe Jev's route is a documented contract
        // (`research-decision-models.md:155`), so a live 404/405 there is a
        // model failure: no probe.
        this.lastCallFailure = {
          key: keyOf(selection, JEV_BASE_URL),
          detail: liveDetail,
        };
        return this.getStatus();
      case 'ollama':
      case 'ollama-cloud':
      case 'custom': {
        const plan = await this.probePlan(selection);
        if (plan.kind === 'row') {
          return plan.row;
        }
        if (plan.request.baseUrl !== normaliseBaseUrl(failed.baseUrl)) {
          return this.currentRowWithoutProbe();
        }
        const started = this.identityOf(selection, plan.request);
        const probe = await this.coalescedRecheck(started, plan.request);
        return this.applyProbe(
          selection,
          plan.request,
          probe,
          liveDetail,
          started,
          false,
        );
      }
    }
  }

  // ---------------------------------------------------------- internals

  private async jevStatus(
    selection: Extract<DecisionModelSelection, { kind: 'jev' }>,
  ): Promise<DecisionModelStatusDto> {
    let hasKey: boolean;
    try {
      hasKey = await this.keys.has('jev');
    } catch (error: unknown) {
      // The rejection text is untrusted (it can echo the key): only its name
      // is logged, and the row shows fixed text.
      this.logger.warn('[lane-routing] Jev credential lookup failed', {
        errorName: errorName(error),
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
        false,
      );
    }
    return this.dto(
      selection,
      'ready',
      this.lastFailureDetail(keyOf(selection, JEV_BASE_URL)),
      true,
    );
  }

  /**
   * Resolves a probed selection to its probe request (mode, base URL and
   * key from the resolver), or to the row shown without a probe:
   * - the credential store rejects → `unreachable`, fixed text;
   * - a key would cross plain http (D4) → `no-credential`, fixed text.
   */
  private async probePlan(selection: ProbedSelection): Promise<ProbePlan> {
    let resolution: DecisionEndpointResolution;
    try {
      resolution = await resolveDecisionEndpoint(
        selection,
        this.endpointDeps(),
      );
    } catch (error: unknown) {
      // The rejection text is untrusted (it can echo the key): only its name
      // is logged, and the row shows fixed text.
      this.logger.warn('[lane-routing] decision model key lookup failed', {
        kind: selection.kind,
        errorName: errorName(error),
      });
      return {
        kind: 'row',
        row: this.dto(
          selection,
          'unreachable',
          DECISION_MODEL_DETAIL.credentialStore,
        ),
      };
    }
    if (isBlockedDecisionEndpoint(resolution)) {
      if (resolution.reason === 'invalid-base-url') {
        // The row tells the user. The refused URL is never logged: it may
        // hold a pasted secret. Debug, since every status read reaches here.
        this.logger.debug(
          '[lane-routing] decision model base URL setting is invalid; not calling it',
          { kind: selection.kind },
        );
        return {
          kind: 'row',
          row: this.dto(selection, 'unreachable', resolution.detail),
        };
      }
      // A stored key that would cross plain http (D4).
      return {
        kind: 'row',
        row: this.dto(selection, 'no-credential', resolution.detail, true),
      };
    }
    const request = resolution === null ? null : probeRequestOf(resolution);
    if (request === null) {
      // The resolver gives every probed kind an endpoint with a probe mode;
      // this row only keeps the switch total.
      return {
        kind: 'row',
        row: this.dto(selection, 'unreachable', null),
      };
    }
    return { kind: 'probe', request };
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
      // Untrusted text (a provider can echo its credential): name only.
      this.logger.warn('[lane-routing] structured provider readiness failed', {
        providerId: selection.providerId,
        errorName: errorName(error),
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
    selection: ProbedSelection,
    request: DecisionProbeRequest,
    probe: DecisionModelProbeResult,
    liveDetail: string | null,
    started: ProbeIdentity,
    allowRetry: boolean,
  ): Promise<DecisionModelStatusDto> {
    // A result for another selection, base URL or key is stale: discarded.
    if (!sameIdentity(await this.currentProbeKey(), started)) {
      return allowRetry
        ? this.statusForCurrent(false)
        : this.currentRowWithoutProbe();
    }
    const key = identityKey(started);
    const keyStored = request.apiKey !== undefined;
    if (probe.outcome === 'unsupported-endpoint') {
      const base = probe.detail ?? 'endpoint does not serve /v1/systemone';
      const detail =
        liveDetail === null ? base : `${base}; last call: ${liveDetail}`;
      if (!this.markMatches(started)) {
        await this.markUnsupported(request, detail, selection);
      }
      if (!sameIdentity(await this.currentProbeKey(), started)) {
        return this.currentRowWithoutProbe();
      }
      return this.dto(
        selection,
        'unsupported-endpoint',
        this.mark?.detail ?? detail,
        keyStored,
      );
    }
    if (probe.outcome === 'ready') {
      if (this.mark) {
        await this.clearMark('probe proved the route');
      }
      if (!sameIdentity(await this.currentProbeKey(), started)) {
        return this.currentRowWithoutProbe();
      }
      if (liveDetail !== null) {
        this.lastCallFailure = { key, detail: liveDetail };
      }
      return this.dto(
        selection,
        'ready',
        this.lastFailureDetail(key) ?? probe.detail,
        keyStored,
      );
    }
    return this.dto(
      selection,
      toRowState(probe.outcome),
      probe.detail,
      keyStored,
    );
  }

  /**
   * One in-flight re-check per identity and one per 60 s per target. A
   * cached result from another key is not reused (and is dropped), so a key
   * change inside the window probes again with the new key. A result that
   * lands after the key changed is still discarded by `applyProbe`.
   */
  private coalescedRecheck(
    identity: ProbeIdentity,
    request: DecisionProbeRequest,
  ): Promise<DecisionModelProbeResult> {
    const startedAt = this.now();
    const recent = this.recentRechecks.get(identity.target);
    if (recent && recent.credential !== identity.credential) {
      this.recentRechecks.delete(identity.target);
    } else if (
      recent &&
      startedAt - recent.startedAt < DECISION_MODEL_RECHECK_WINDOW_MS
    ) {
      this.logger.debug('[lane-routing] decision model re-check reused', {
        outcome: recent.result.outcome,
      });
      return Promise.resolve(recent.result);
    }
    const flightKey = identityKey(identity);
    const pending = this.inFlightRechecks.get(flightKey);
    if (pending) {
      return pending;
    }
    const run = this.prober
      .probe(request)
      .then((result) => {
        this.recentRechecks.set(identity.target, {
          credential: identity.credential,
          startedAt,
          result,
        });
        return result;
      })
      .finally(() => {
        this.inFlightRechecks.delete(flightKey);
      });
    this.inFlightRechecks.set(flightKey, run);
    return run;
  }

  private loadMark(): DecisionModelUnsupportedMark | null {
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(DECISION_MODEL_UNSUPPORTED_STORAGE_KEY);
    } catch (error: unknown) {
      // degradation-audit: reported - a failed unsupported-mark read starts with no mark so routing can continue
      this.logger.warn(
        '[lane-routing] decision model unsupported mark could not be read',
        { errorName: errorName(error) },
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

  private markMatches(identity: ProbeIdentity): boolean {
    return (
      this.mark !== null &&
      keyOf(this.mark.selection, this.mark.baseUrl) === identity.target &&
      this.markCredential !== null &&
      this.markCredential === identity.credential
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
        { errorName: errorName(error) },
      );
    }
  }

  /**
   * Row for the selection now, without a probe. An unmarked probed selection
   * uses `unreachable`: decision #46 fixes the state set and has no pending
   * state.
   */
  private async currentRowWithoutProbe(): Promise<DecisionModelStatusDto> {
    const selection = this.getSelection();
    switch (selection.kind) {
      case 'unset':
        return this.dto(selection, 'unset', null);
      case 'jev':
        return this.jevStatus(selection);
      case 'structured':
        return this.structuredStatus(selection);
      case 'ollama':
      case 'ollama-cloud':
      case 'custom': {
        const plan = await this.probePlan(selection);
        if (plan.kind === 'row') {
          return plan.row;
        }
        const keyStored = plan.request.apiKey !== undefined;
        const mark = this.mark;
        if (
          mark !== null &&
          this.markMatches(this.identityOf(selection, plan.request))
        ) {
          return this.dto(
            selection,
            'unsupported-endpoint',
            mark.detail,
            keyStored,
          );
        }
        return this.dto(selection, 'unreachable', null, keyStored);
      }
    }
  }

  private async clearMark(reason: string): Promise<void> {
    this.mark = null;
    this.markCredential = null;
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

  /**
   * `apiKeyStored` is reported for `jev` and `custom` only (DC13), and only
   * when the caller read the key; it is never the key itself.
   */
  private dto(
    selection: DecisionModelSelection,
    state: DecisionModelState,
    detail: string | null,
    apiKeyStored?: boolean,
  ): DecisionModelStatusDto {
    const row: DecisionModelStatusDto = {
      selection,
      locality: this.localityOf(selection),
      reportsConfidence: reportsConfidence(selection),
      state,
      detail,
    };
    const keyed = selection.kind === 'jev' || selection.kind === 'custom';
    return keyed && apiKeyStored !== undefined ? { ...row, apiKeyStored } : row;
  }

  private endpointDeps(): DecisionEndpointDeps {
    return {
      workspace: this.workspace,
      keys: this.keys,
      ollamaBaseUrl: () => this.ollamaBaseUrl(),
    };
  }

  /** Current selection plus the base URL and key it would be probed with now. */
  private currentProbeKey(): Promise<ProbeIdentity> {
    return this.probeKeyOf(this.getSelection());
  }

  /**
   * Mark and coalescing identity of a selection: the selection, the base URL
   * its probe goes to now (the resolved one) and the fingerprint of the key
   * it would send. A selection that is not probed, or not probed now
   * (blocked, unreadable key), has an empty base, which matches no probe.
   */
  private async probeKeyOf(
    selection: DecisionModelSelection,
  ): Promise<ProbeIdentity> {
    switch (selection.kind) {
      case 'unset':
      case 'structured':
        return { target: keyOf(selection, ''), credential: '' };
      case 'jev':
        return { target: keyOf(selection, JEV_BASE_URL), credential: '' };
      case 'ollama':
      case 'ollama-cloud':
      case 'custom': {
        const plan = await this.probePlan(selection);
        return plan.kind === 'probe'
          ? this.identityOf(selection, plan.request)
          : { target: keyOf(selection, ''), credential: '' };
      }
    }
  }

  private identityOf(
    selection: DecisionModelSelection,
    probed: Pick<DecisionProbeRequest, 'baseUrl' | 'apiKey'>,
  ): ProbeIdentity {
    return {
      target: keyOf(selection, probed.baseUrl),
      credential: this.credentialFingerprint(probed.apiKey),
    };
  }

  /**
   * Non-secret identity of a key: `''` without one, else an HMAC-SHA256 of
   * the key under this instance's random salt. Used only for equality in
   * memory; never logged, persisted or sent.
   */
  private credentialFingerprint(apiKey: string | undefined): string {
    if (apiKey === undefined) {
      return '';
    }
    return createHmac('sha256', this.fingerprintSalt)
      .update(apiKey)
      .digest('hex');
  }
}

/**
 * Credential binding of a mark loaded from storage. The persisted mark has
 * no key identity (the fingerprint salt lives in memory only), so a mark for
 * a selection that may send a key (`ollama-cloud`, `custom`) is unverified
 * (`null`) and matches no key until it is probed again under the current
 * key. A local `ollama` selection never sends a key (`resolveDecisionEndpoint`
 * passes none), so its mark is evidence for the only credential it can have,
 * none (`''`), and survives a restart.
 */
function loadedMarkCredential(
  mark: DecisionModelUnsupportedMark | null,
): string | null {
  return mark !== null && mark.selection.kind === 'ollama' ? '' : null;
}

function sameIdentity(a: ProbeIdentity, b: ProbeIdentity): boolean {
  return a.target === b.target && a.credential === b.credential;
}

/** Map key of an identity (`keyOf` output never contains a newline). */
function identityKey(identity: ProbeIdentity): string {
  return `${identity.target}\n${identity.credential}`;
}

/** Every System One kind reports a confidence; `structured` and `unset` do not. */
function reportsConfidence(selection: DecisionModelSelection): boolean {
  switch (selection.kind) {
    case 'unset':
    case 'structured':
      return false;
    case 'ollama':
    case 'ollama-cloud':
    case 'jev':
    case 'custom':
      return true;
  }
}

/** The probe request of a resolved endpoint; `null` for `none` (key-presence status). */
function probeRequestOf(
  endpoint: DecisionEndpoint,
): DecisionProbeRequest | null {
  switch (endpoint.probe) {
    case 'none':
      return null;
    case 'daemon':
    case 'endpoint': {
      const request: DecisionProbeRequest = {
        mode: endpoint.probe,
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
      };
      return endpoint.apiKey === undefined
        ? request
        : { ...request, apiKey: endpoint.apiKey };
    }
  }
}
