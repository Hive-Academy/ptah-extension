/**
 * Draft connection verification behind `auth:verifyDraftConnection` /
 * `auth:cancelDraftVerification` (TASK_2026_523 A2).
 *
 * The setup wizard asks a user for a credential BEFORE anything is persisted.
 * This service answers "does this draft actually work?" without the round
 * trip the old flow required (save → `auth:testConnection` → revert on
 * failure), and without ever writing the draft to disk:
 *
 * - `ProviderAuthResolver.buildDraftOverride` assembles the probe's env from
 *   the draft itself, by the same `buildLaneEnv` / `buildTierValues` machinery
 *   the persisted routes use. The probe exercises the DRAFT, never the
 *   persisted route.
 * - The probe is a single minimal inference call through
 *   `InternalQueryService.execute` with that override passed as `auth` — the
 *   read-only per-call snapshot (see `InternalQueryConfig.auth`). Nothing is
 *   written to settings, secrets or `process.env`.
 * - The draft credential lives in the config passed to the runner only. It is
 *   never stored on an entry, logged, echoed back, or written to
 *   `~/.ptah/settings.json` or the encrypted secrets file.
 * - `detail` in the result is a sanitized diagnostic string — status, socket
 *   code, retry hint. A raw secret or a raw `error.message` never reaches it
 *   (the message is read internally for the model-name match in rule 5 of
 *   {@link classifyDraftProbeFailure} only).
 *
 * ## Lifetime of a probe
 *
 * A probe is identified by the client-generated `probeId` echoed back on the
 * wire so the frontend can drop superseded results. The map below holds only
 * IN-FLIGHT probes; an entry is deleted the moment its probe settles (by
 * identity, not by key — a superseding probe may already own the same id, the
 * same idiom as `AuthRpcHandlers.statusInFlight`). Cancelling aborts the
 * probe's `AbortController`; the awaiting `verify` resolves `cancelled`. There
 * are no timers beyond the per-probe deadline: expired entries are reaped
 * lazily on the next insert.
 */

import os from 'node:os';

import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  InternalQueryService,
  SDK_TOKENS,
  USER_ACTION_QUERY_LANE,
  QueryNetworkObserver,
  classifyThrownNetworkFailure,
  type NetworkObservableMessage,
  type NetworkFailureSignal,
  type OneShotAuthOverride,
  type QueryNetworkVerdict,
} from '@ptah-extension/agent-sdk';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAnthropicProvider,
} from '@ptah-extension/shared';
import type {
  AuthVerifyDraftConnectionParams,
  AuthVerifyDraftConnectionResult,
  ProbeFailureReason,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import {
  ProviderAuthResolver,
  type DraftConnectionInput,
} from './provider-auth-resolver';

/** The probe's own prompt: one turn, no tools, one short answer. */
const PROBE_PROMPT = 'Reply with the single word: ok';

/** Timeout applied when the draft names none. */
const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
/** Server-side clamp on `timeoutMs`. A draft cannot hold a slot for minutes. */
const MIN_PROBE_TIMEOUT_MS = 1_000;
const MAX_PROBE_TIMEOUT_MS = 30_000;

/**
 * Backstop for a probe that never settles. Longer than the clamp above, so it
 * only fires on pathology inside the SDK stream; reaped lazily, no timers.
 */
const PROBE_ENTRY_TTL_MS = 60_000;

/** Hard cap on concurrent in-flight probes; the oldest is dropped past it. */
const MAX_IN_FLIGHT_PROBES = 32;

/** How long the probe waits for a concurrency slot before giving up. */
const PROBE_QUEUE_TIMEOUT_MS = 5_000;

/** How far down a `cause` chain a status or socket code is looked for. */
const MAX_CAUSE_DEPTH = 8;

/** The `authMode` values the draft resolver's strategy matrix handles. */
const DRAFT_AUTH_MODES: readonly string[] = [
  'apiKey',
  'oauth',
  'cli',
  'local-native',
  'local-proxy',
  'custom',
];

/** Modes whose credential is a stored provider key (`credential.kind === 'stored'`). */
const STORED_KEY_AUTH_MODES: readonly string[] = [
  'apiKey',
  'local-native',
  'local-proxy',
  'custom',
];

/** Compare endpoints ignoring case of the origin and trailing slashes. */
function normalizeUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/** One in-flight probe. Deleted as soon as its `verify` settles. */
interface DraftProbeEntry {
  readonly probeId: string;
  readonly startedAt: number;
  readonly abortController: AbortController;
  /** Set by `cancel` (or supersession/eviction) — classification rule 1. */
  cancelled: boolean;
  /** Set by the probe's own deadline — classification rule 7. */
  timedOut: boolean;
}

/** Evidence `classifyDraftProbeFailure` reads, all of it captured from one probe. */
export interface DraftProbeFailureInput {
  /** The error the probe threw, or `undefined` when the stream completed. */
  readonly thrown: unknown;
  /** The network verdict the stream carried. */
  readonly verdict: QueryNetworkVerdict;
  /** `api_error_status` of the stream's `result` message, when present. */
  readonly resultStatus: number | null;
  /** `error` of the stream's last `assistant` message, when present. */
  readonly assistantError: unknown;
  /** `true` when `cancelDraftVerification` (or supersession) aborted this probe. */
  readonly cancelled: boolean;
  /** `true` when the probe's own deadline fired. */
  readonly timedOut: boolean;
  /** The model the probe ran with, for the name match in rule 5. */
  readonly model: string | null;
}

/** The network verdict `classifyDraftProbeFailure` starts from pre-flight. */
const UNDETERMINED: QueryNetworkVerdict = { kind: 'undetermined' };

/**
 * Why a draft probe failed, by the fixed precedence table the
 * `ProbeFailureReason` docblock in `rpc-auth.types.ts` promises. The rules are
 * evaluated IN ORDER and the FIRST match wins, so the order is behaviour, not
 * presentation:
 *
 * 1. Our own abort from `cancel` → `cancelled`.
 * 2. `ProviderQuotaError` (the resolver's cooldown gate) → `quota-exhausted`.
 * 3. `ProviderAuthError` (the resolver refused the draft pre-flight) →
 *    `credential-rejected`.
 * 4. HTTP 401 / 403 — from the stream's `result.api_error_status`, or from a
 *    thrown error's `status` / `statusCode` walked up its `cause` chain →
 *    `credential-rejected` / `permission-denied`.
 * 5. HTTP 404, or a provider message naming the requested model →
 *    `model-unavailable`.
 * 6. The network classifier's `'http-429'` → `rate-limited`.
 * 7. The classifier's `'timeout'`, or our own deadline → `timeout`.
 * 8. `'connection'` or `'dns'` → `unreachable`.
 * 9. `'http-5xx'` → `unclassified`. A 5xx is NEVER a credential verdict.
 * 10. Anything else → `unclassified`.
 *
 * A probe that matches several rules reports the first matching one: a 429
 * outranks a later deadline, a 401 outranks a 5xx that followed it.
 */
export function classifyDraftProbeFailure(
  input: DraftProbeFailureInput,
): ProbeFailureReason {
  // Rule 1: the probe was cancelled on request. Nothing else can be true
  // after our own abort mid-stream.
  if (input.cancelled) return 'cancelled';

  // Rules 2-3: the resolver's own pre-flight verdicts, discriminated by name
  // — the documented convention (`ProviderQuotaError` / `ProviderAuthError`
  // docblocks), not `instanceof`, so a mirrored check stays possible.
  const thrownName = errorName(input.thrown);
  if (thrownName === 'ProviderQuotaError') return 'quota-exhausted';
  if (thrownName === 'ProviderAuthError') return 'credential-rejected';

  // Rule 4: the two statuses that are a CREDENTIAL verdict, read straight off
  // the evidence rather than through the network classifier, which
  // deliberately ignores 401/403.
  const status =
    input.resultStatus ?? httpStatusFromThrown(input.thrown) ??
    httpStatusFromAssistantError(input.assistantError);
  if (status === 401) return 'credential-rejected';
  if (status === 403) return 'permission-denied';

  // Rule 5: the endpoint answered but refused the MODEL (or the path to it).
  if (status === 404) return 'model-unavailable';
  if (
    input.model !== null &&
    messageNamesModel(input.thrown, input.assistantError, input.model)
  ) {
    return 'model-unavailable';
  }

  // Rules 6-9: the network classifier, on the thrown error first — a throw is
  // the more specific evidence — then on the stream verdict.
  const signal =
    classifyThrownNetworkFailure(input.thrown) ?? streamSignal(input.verdict);
  if (signal === 'http-429') return 'rate-limited'; // rule 6
  if (input.timedOut || signal === 'timeout') return 'timeout'; // rule 7
  if (signal === 'connection' || signal === 'dns') return 'unreachable'; // rule 8
  if (signal === 'http-5xx') return 'unclassified'; // rule 9

  // Rule 10: everything else.
  return 'unclassified';
}

/**
 * Runs draft connection probes for `auth:verifyDraftConnection` and
 * `auth:cancelDraftVerification`. Holds the in-flight registry only — one
 * entry per unsettled probe, no timers, no persistence, no credential.
 */
@injectable()
export class DraftVerificationService {
  /** In-flight probes by `probeId`; insertion order = age order. */
  private readonly entries = new Map<string, DraftProbeEntry>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_PROVIDER_AUTH_RESOLVER)
    private readonly resolver: ProviderAuthResolver,
    @inject(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE)
    private readonly internalQuery: InternalQueryService,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
  ) {}

  /**
   * Probe a DRAFT connection with one minimal inference call. Writes nothing
   * anywhere: the draft credential lives in the returned override's env for
   * the duration of the call and is gone when this promise settles.
   */
  async verify(
    params: AuthVerifyDraftConnectionParams,
  ): Promise<AuthVerifyDraftConnectionResult> {
    const {
      probeId,
      draft: parsedDraft,
      timeoutMs,
      useStoredCredential,
    } = this.normalizeParams(params);
    let draft = parsedDraft;

    this.pruneExpiredEntries();

    // Supersession: a client re-issuing an id retires the probe it names.
    const superseded = this.entries.get(probeId);
    if (superseded) this.retireEntry(superseded, probeId);

    // Hard cap: drop the OLDEST in-flight probe (insertion order) when full.
    if (this.entries.size >= MAX_IN_FLIGHT_PROBES) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId !== undefined) {
        const evicted = this.entries.get(oldestId);
        if (evicted) this.retireEntry(evicted, oldestId);
      }
    }

    const entry: DraftProbeEntry = {
      probeId,
      startedAt: Date.now(),
      abortController: new AbortController(),
      cancelled: false,
      timedOut: false,
    };
    this.entries.set(probeId, entry);

    this.logger.debug('Draft probe: start', {
      probeId,
      providerId: draft.providerId,
      authMode: draft.authMode,
      timeoutMs,
    });

    try {
      // Pre-flight. The resolver throws ProviderQuotaError (cooldown gate) or
      // ProviderAuthError (the draft cannot produce a credential) — rules 2-3.
      // The probe never started, so latency and modelUsed stay null.
      let override: OneShotAuthOverride;
      let model: string | null = null;
      try {
        if (useStoredCredential) {
          // A stored key may only travel to the destination it was saved for.
          // Bind mode and endpoint to host-side config BEFORE the key is read;
          // a changed endpoint needs a typed key, never the stored one.
          const bound = this.bindStoredDraft(draft);
          if (!bound) {
            this.logger.info('Draft probe: stored credential rejected for this destination', {
              probeId,
              providerId: draft.providerId,
              authMode: draft.authMode,
            });
            return this.finish(probeId, {
              outcome: 'failed',
              reason: 'stored-credential-mismatch',
              detail: 'The stored key can only be verified against its saved endpoint. Enter a key to verify a changed connection.',
              latencyMs: null,
              modelUsed: null,
            });
          }
          draft = bound;
          // The stored key is read here, on the host, and joins the draft
          // exactly like a typed key: it lives only in this call's override
          // env, is never logged, never echoed in `detail`, never written.
          const stored = (await this.readStoredKey(draft.providerId))?.trim();
          if (!stored) {
            this.logger.info('Draft probe: no stored credential', { probeId });
            return this.finish(probeId, {
              outcome: 'failed',
              reason: 'no-stored-credential',
              detail: 'No key is stored for this provider. Enter a key to verify.',
              latencyMs: null,
              modelUsed: null,
            });
          }
          draft = { ...draft, credential: { kind: 'apiKey', value: stored } };
        }
        override = await this.resolver.buildDraftOverride(draft);
        model = this.resolveProbeModel(draft.providerId, params.model);
      } catch (error: unknown) {
        const reason = classifyDraftProbeFailure({
          thrown: error,
          verdict: UNDETERMINED,
          resultStatus: null,
          assistantError: undefined,
          cancelled: false,
          timedOut: false,
          model: null,
        });
        this.logger.info('Draft probe: pre-flight failed', { probeId, reason });
        return this.finish(probeId, {
          outcome: 'failed',
          reason,
          detail: this.preFlightDetail(reason, error),
          latencyMs: null,
          modelUsed: null,
        });
      }

      // A cancel that landed while the resolver was assembling the override
      // has nothing to abort — honour the flag instead of probing into the
      // void.
      if (entry.cancelled) {
        return this.finish(probeId, {
          outcome: 'cancelled',
          reason: 'cancelled',
          detail: null,
          latencyMs: null,
          modelUsed: null,
        });
      }

      const timer = setTimeout(() => {
        entry.timedOut = true;
        entry.abortController.abort();
      }, timeoutMs);
      timer.unref?.();
      const probeStartedAt = Date.now();

      try {
        const handle = await this.internalQuery.execute({
          // The probe has no workspace; `os.tmpdir()` is a safe cwd (the
          // runner resolves unsafe cwds itself) that no directory can be
          // poisoned by.
          cwd: os.tmpdir(),
          model,
          prompt: PROBE_PROMPT,
          mcpServerRunning: false,
          maxTurns: 1,
          lane: USER_ACTION_QUERY_LANE,
          abortController: entry.abortController,
          auth: override,
          queueTimeoutMs: PROBE_QUEUE_TIMEOUT_MS,
        });

        const observer = new QueryNetworkObserver();
        let assistantError: unknown = undefined;
        let resultStatus: number | null = null;
        let thrown: unknown = undefined;

        try {
          // Same shape as every other consumer: iterate to the `result`
          // message and break — the guarded stream releases the slot on the
          // `return()` the break performs.
          for await (const msg of handle.stream) {
            const evidence: NetworkObservableMessage = msg;
            observer.observe(evidence);
            if (evidence.type === 'assistant') {
              // The LAST assistant message decides; the observer does the
              // same, this copy only feeds the classifier's model match.
              if (evidence.error !== undefined) assistantError = evidence.error;
            } else if (evidence.type === 'result') {
              resultStatus =
                typeof evidence.api_error_status === 'number'
                  ? evidence.api_error_status
                  : null;
              break;
            }
          }
        } catch (error: unknown) {
          thrown = error;
        }

        const latencyMs = Date.now() - probeStartedAt;
        const verdict = observer.verdict();

        if (
          !entry.cancelled &&
          !entry.timedOut &&
          thrown === undefined &&
          verdict.kind === 'answered'
        ) {
          this.logger.info('Draft probe: verified', {
            probeId,
            model,
            latencyMs,
          });
          return this.finish(probeId, {
            outcome: 'verified',
            reason: null,
            detail: null,
            latencyMs,
            modelUsed: model,
          });
        }

        const reason = classifyDraftProbeFailure({
          thrown,
          verdict,
          resultStatus,
          assistantError,
          cancelled: entry.cancelled,
          timedOut: entry.timedOut,
          model,
        });
        this.logger.info('Draft probe: finished', {
          probeId,
          reason,
          latencyMs,
        });
        return this.finish(probeId, {
          outcome: reason === 'cancelled' ? 'cancelled' : 'failed',
          reason,
          detail: this.probeDetail(reason, {
            thrown,
            status: resultStatus,
            timeoutMs,
            model,
          }),
          latencyMs,
          modelUsed: model,
        });
      } finally {
        clearTimeout(timer);
      }
    } finally {
      // Delete by IDENTITY: supersession may already have replaced this id,
      // and evicting that one would cancel the newer probe.
      if (this.entries.get(probeId) === entry) this.entries.delete(probeId);
    }
  }

  /**
   * Abort an in-flight probe. Never throws: an unknown or already-settled
   * probe answers `cancelled: false`.
   */
  cancel(params: { readonly probeId: string }): { readonly cancelled: boolean } {
    const entry = this.entries.get(params.probeId);
    if (!entry) return { cancelled: false };
    entry.cancelled = true;
    entry.abortController.abort();
    this.entries.delete(params.probeId);
    return { cancelled: true };
  }

  /** The key the host already holds for `providerId`; Anthropic-direct uses the apiKey credential. */
  /**
   * Rebuild a stored-credential draft from host-side config, or `null` when the
   * caller asked for a destination the key was not saved for. Direct Anthropic
   * is `apiKey` only; `custom` is allowed only for a saved custom entry; a
   * caller-supplied base URL must equal the saved one and is then replaced by it.
   */
  private bindStoredDraft(draft: DraftConnectionInput): DraftConnectionInput | null {
    const { providerId, authMode } = draft;
    const isDirectAnthropic = providerId === ANTHROPIC_DIRECT_PROVIDER_ID;
    const provider = isDirectAnthropic ? undefined : getAnthropicProvider(providerId);
    if (isDirectAnthropic) {
      return authMode === 'apiKey' && draft.baseUrl === undefined
        ? { providerId, authMode }
        : null;
    }
    if (!provider) return null;
    if (authMode === 'custom' && !provider.isCustom) return null;
    const saved = this.resolver.getSavedBaseUrl(providerId);
    const requested = draft.baseUrl?.trim();
    if (requested !== undefined && normalizeUrl(requested) !== normalizeUrl(saved)) {
      return null;
    }
    // `custom` and the local modes only carry a key on their draft-URL branch
    // (ProviderAuthResolver.buildDraftOverride), so they keep the SAVED URL;
    // `apiKey` resolves the saved URL itself.
    return authMode === 'apiKey'
      ? { providerId, authMode }
      : { providerId, authMode, baseUrl: saved };
  }

  private readStoredKey(providerId: string): Promise<string | undefined> {
    return providerId === ANTHROPIC_DIRECT_PROVIDER_ID
      ? this.authSecrets.getCredential('apiKey')
      : this.authSecrets.getProviderKey(providerId);
  }

  /** Validate the wire payload and shape the resolver's input. */
  private normalizeParams(params: AuthVerifyDraftConnectionParams): {
    readonly probeId: string;
    readonly draft: DraftConnectionInput;
    readonly timeoutMs: number;
    readonly useStoredCredential: boolean;
  } {
    const probeId = requireNonEmptyString(params.probeId, 'probeId');
    const providerId = requireNonEmptyString(params.providerId, 'providerId');
    if (
      typeof params.authMode !== 'string' ||
      !DRAFT_AUTH_MODES.includes(params.authMode)
    ) {
      throw new Error(
        `auth:verifyDraftConnection: authMode must be one of ${DRAFT_AUTH_MODES.join(', ')}`,
      );
    }
    const credential: unknown = params.credential;
    const useStoredCredential =
      typeof credential === 'object' &&
      credential !== null &&
      (credential as { kind?: unknown }).kind === 'stored';
    const typedCredential =
      typeof credential === 'object' &&
      credential !== null &&
      (credential as { kind?: unknown }).kind === 'apiKey' &&
      typeof (credential as { value?: unknown }).value === 'string'
        ? { kind: 'apiKey' as const, value: (credential as { value: string }).value }
        : undefined;
    if (credential !== undefined && !useStoredCredential && !typedCredential) {
      throw new Error(
        'auth:verifyDraftConnection: credential must be an apiKey or stored credential',
      );
    }
    if (useStoredCredential && !STORED_KEY_AUTH_MODES.includes(params.authMode)) {
      throw new Error(
        'auth:verifyDraftConnection: a stored credential applies to key-carrying modes only',
      );
    }
    if (
      params.timeoutMs !== undefined &&
      (typeof params.timeoutMs !== 'number' || !(params.timeoutMs > 0))
    ) {
      throw new Error('auth:verifyDraftConnection: timeoutMs must be a positive number');
    }
    if (params.model !== undefined && typeof params.model !== 'string') {
      throw new Error('auth:verifyDraftConnection: model must be a string');
    }
    if (params.baseUrl !== undefined && typeof params.baseUrl !== 'string') {
      throw new Error('auth:verifyDraftConnection: baseUrl must be a string');
    }

    const draft: DraftConnectionInput = {
      providerId,
      authMode: params.authMode,
      ...(typedCredential !== undefined ? { credential: typedCredential } : {}),
      ...(params.baseUrl !== undefined ? { baseUrl: params.baseUrl } : {}),
    };
    return {
      probeId,
      draft,
      timeoutMs: clampTimeoutMs(params.timeoutMs),
      useStoredCredential,
    };
  }

  /**
   * The model the probe runs with. The draft's own model first; otherwise the
   * provider's live derived `sonnet` tier (what the tiers actually resolve to
   * today), then the registry's `defaultTiers.sonnet`, then the bare alias —
   * the same precedence the resolver's tier layering uses.
   */
  private resolveProbeModel(
    providerId: string,
    requested: string | undefined,
  ): string {
    const requestedModel = requested?.trim();
    if (requestedModel) return requestedModel;
    const derived = this.providerModels.getLiveDerivedTiers(providerId).sonnet;
    if (derived) return derived;
    return getAnthropicProvider(providerId)?.defaultTiers?.sonnet ?? 'sonnet';
  }

  /** Abort an entry and take it out of the map if it is still the one there. */
  private retireEntry(entry: DraftProbeEntry, probeId: string): void {
    entry.cancelled = true;
    entry.abortController.abort();
    if (this.entries.get(probeId) === entry) this.entries.delete(probeId);
  }

  /**
   * Reap entries past {@link PROBE_ENTRY_TTL_MS}. Lazy on purpose: every probe
   * is deadline-bounded by the clamp, so this is pathology cover, not a timer.
   */
  private pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [probeId, entry] of this.entries) {
      if (now - entry.startedAt <= PROBE_ENTRY_TTL_MS) continue;
      entry.timedOut = true;
      entry.abortController.abort();
      this.entries.delete(probeId);
    }
  }

  private finish(
    probeId: string,
    fields: {
      readonly outcome: AuthVerifyDraftConnectionResult['outcome'];
      readonly reason: ProbeFailureReason | null;
      readonly detail: string | null;
      readonly latencyMs: number | null;
      readonly modelUsed: string | null;
    },
  ): AuthVerifyDraftConnectionResult {
    return { probeId, ...fields, checkedAt: new Date().toISOString() };
  }

  /** Detail for a failure the probe never started. Never quotes the error. */
  private preFlightDetail(
    reason: ProbeFailureReason,
    error: unknown,
  ): string {
    switch (reason) {
      case 'quota-exhausted': {
        const retryAfterMs = quotaRetryAfterMs(error);
        return retryAfterMs === null
          ? 'The provider is still cooling down after rate limiting.'
          : `The provider is still cooling down after rate limiting (retry after ${Math.max(1, Math.round(retryAfterMs / 1000))}s).`;
      }
      case 'credential-rejected':
        return 'The draft is missing a usable credential for this mode.';
      default:
        return 'The probe did not start.';
    }
  }

  /** Detail for a failure the probe ran into. Statuses and codes only. */
  private probeDetail(
    reason: ProbeFailureReason,
    context: {
      readonly thrown: unknown;
      readonly status: number | null;
      readonly timeoutMs: number;
      readonly model: string | null;
    },
  ): string {
    switch (reason) {
      case 'cancelled':
        return 'The probe was cancelled.';
      // Assigned before the probe starts; listed for exhaustiveness.
      case 'no-stored-credential':
        return 'No key is stored for this provider. Enter a key to verify.';
      case 'stored-credential-mismatch':
        return 'The stored key can only be verified against its saved endpoint. Enter a key to verify a changed connection.';
      case 'credential-rejected':
        return 'The provider rejected the credential (HTTP 401).';
      case 'permission-denied':
        return 'The provider denied access (HTTP 403).';
      case 'unreachable': {
        const code = nodeErrorCode(context.thrown);
        return code === null
          ? 'Could not reach the provider endpoint.'
          : `Could not reach the provider endpoint (${code}).`;
      }
      case 'timeout':
        return `The provider did not answer within ${context.timeoutMs} ms.`;
      case 'rate-limited':
        return 'The provider rate-limited the probe (HTTP 429).';
      case 'model-unavailable':
        return `The provider does not offer ${context.model ?? 'the requested model'}.`;
      // The cooldown gate fires pre-flight only; it cannot reach the stream
      // path, but the switch must cover every reason.
      case 'quota-exhausted':
        return 'The provider is still cooling down after rate limiting.';
      case 'unclassified': {
        const name = errorName(context.thrown);
        if (name === 'InternalQueryQueueTimeoutError') {
          return 'The model runtime was busy; the probe never started.';
        }
        if (name === 'SdkError') {
          return 'The model runtime is not available; save the draft settings first.';
        }
        if (context.status !== null && context.status >= 500) {
          return `The provider returned an unexpected error (HTTP ${context.status}).`;
        }
        return 'The probe ended without a verifiable answer.';
      }
    }
  }
}

/** Server-side clamp on the draft's own timeout. */
function clampTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(
    MAX_PROBE_TIMEOUT_MS,
    Math.max(MIN_PROBE_TIMEOUT_MS, Math.floor(timeoutMs)),
  );
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `auth:verifyDraftConnection requires a non-empty ${field}`,
    );
  }
  return value;
}

function errorName(error: unknown): string | null {
  return error instanceof Error ? error.name : null;
}

/** `retryAfterMs` of a `ProviderQuotaError`, by the documented name contract. */
function quotaRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof Error) || error.name !== 'ProviderQuotaError') {
    return null;
  }
  const value = (error as { readonly retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * An HTTP status on a thrown error or anywhere down its `cause` chain.
 * Depth-bounded: the chain is caller-supplied data and may cycle.
 */
function httpStatusFromThrown(error: unknown): number | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return null;
    const fields = current as {
      readonly status?: unknown;
      readonly statusCode?: unknown;
      readonly cause?: unknown;
    };
    for (const candidate of [fields.status, fields.statusCode]) {
      if (typeof candidate === 'number' && Number.isInteger(candidate)) {
        return candidate;
      }
    }
    current = fields.cause;
  }
  return null;
}

/**
 * The same read for the stream's `assistant.error` — the SDK puts the HTTP
 * status of a failed request on that object.
 */
function httpStatusFromAssistantError(assistantError: unknown): number | null {
  if (typeof assistantError !== 'object' || assistantError === null) {
    return null;
  }
  const value = (assistantError as { status?: unknown }).status;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** The Node socket code behind a thrown error, if any. Detail input only. */
function nodeErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return null;
    const fields = current as { readonly code?: unknown; readonly cause?: unknown };
    if (typeof fields.code === 'string') return fields.code;
    current = fields.cause;
  }
  return null;
}

/** The network signal the stream verdict carries, or `null`. */
function streamSignal(verdict: QueryNetworkVerdict): NetworkFailureSignal | null {
  return verdict.kind === 'network-failure' ? verdict.signal : null;
}

/**
 * Rule 5's message match. The provider's own words name the missing model —
 * read internally here, never surfaced in `detail`.
 */
function messageNamesModel(
  thrown: unknown,
  assistantError: unknown,
  model: string,
): boolean {
  let current: unknown = thrown;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === 'string') {
      if (current.includes(model)) return true;
      break;
    }
    if (!(current instanceof Error)) break;
    if (current.message.includes(model)) return true;
    current = (current as { readonly cause?: unknown }).cause;
  }
  return (
    typeof assistantError === 'string' && assistantError.includes(model)
  );
}