/**
 * PlanLimitLedgerService — every piece of plan-limit evidence, per quota owner
 * (TASK_2026_596, Component 5; Decision 4; Decision 10 as amended by Gate 2).
 *
 * ## Writers
 *
 * - The native Claude stream, through `SessionPlanLimitCallbackRegistry`
 *   (agent-sdk). On each `turn-start` the session's owner is resolved again
 *   (G2): `ProviderOwnerResolver.ownerForSession` reads the route and, on a
 *   native route, `probe.readAccount(sessionId)` → `ownerForClaudeAccount`.
 *   The turn's evidence and its S1 success are filed under that owner. Earlier
 *   evidence stays under the owner it was recorded for, so an account change
 *   A→B moves the session to B without attributing anything of A to B (F79).
 * - The translation proxies, through `providerQuotaStore.onRateLimit` /
 *   `onSuccess`. A 429 is a cooldown on the owner captured at the proxy's
 *   response boundary. Without one it goes under
 *   `unknownOwnerKey(providerId, proxy instance id)`, which no lane or other
 *   proxy shares (F68). A proxy 2xx is billed `unknown`: it clears the
 *   cooldown of the same owner its 429 would land on (the captured key, else
 *   that proxy's own unknown owner) and nothing else (F66).
 * - cli-agent-runtime lanes, directly through the public write methods.
 *
 * ## Rules (Decision 4)
 *
 * - One current entry per allowance (owner + window key + model scope),
 *   replaced only when the shared `supersedes` precedence says so. Evidence
 *   keeps the instant it was observed at its source; the ledger never
 *   re-stamps, so stale data cannot pose as new.
 * - Known-reset exhaustion expires at its reset (the engine checks at read
 *   time; no timer). Unknown-reset exhaustion clears only on a newer
 *   below-limit full-table read of the same allowance, a `billing:'plan'`
 *   success on the same owner and scope, the provider's longest window
 *   elapsing, or a host restart (it is never persisted).
 * - Expired and superseded entries are removed on access. Nothing active is
 *   evicted early, and there is no owner cap; owners with nothing left drop.
 * - Only known-reset exhaustion and owner evidence are persisted (P6).
 * - A session idle for {@link SESSION_IDLE_MS} whose owner has no live
 *   evidence is forgotten on the next signal or read; its next turn-start
 *   re-registers it.
 *
 * Logs are debug-level and carry ids and failure kinds only.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type ClaudePlanLimitEvidence,
  type SessionPlanLimitCallbackRegistry,
  type SessionPlanLimitEvent,
  type SessionPlanLimitSignal,
} from '@ptah-extension/agent-sdk';
import {
  parseRetryAfterDeadline,
  supersedes,
  type OwnerLimitEvidence,
  type PlanLimitCooldown,
  type PlanLimitSessionOwner,
  type PlanLimitWindow,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type {
  ProviderQuotaObservation,
  ProviderQuotaStore,
} from '../auth/provider-quota.store';
import {
  quotaOwnerRefFromKey,
  unknownOwnerKey,
  type ProviderOwnerResolver,
} from './provider-owner.resolver';
import {
  ALL_MODELS,
  allowanceId,
  carryExhaustion,
  clearUnknownResetEvidence,
  cooldownEnd,
  evidenceExpired,
  evidenceStamp,
  longestWindowMs,
  normaliseScope,
  windowExpired,
  windowFromClaudeEvidence,
  windowStamp,
  withoutExpiredExhaustion,
  type OwnerState,
  type WindowEntry,
} from './plan-limit-ledger.rules';
import {
  PLAN_LIMIT_LEDGER_STORAGE_KEY,
  restoreLedger,
  serializeLedger,
} from './plan-limit-ledger.persistence';

export { PLAN_LIMIT_LEDGER_STORAGE_KEY };

/**
 * A session with no signal for this long, whose owner holds no live evidence,
 * is dropped from the session index so it cannot grow with host lifetime.
 */
export const SESSION_IDLE_MS = 86_400_000;

/** How a success was billed. Only `plan` clears exhaustion. */
export type PlanLimitBilling = 'plan' | 'overage' | 'fallback' | 'unknown';

/** A request served for an owner (Decision 4, S1-S4). */
export interface PlanLimitSuccess {
  readonly ownerKey: string;
  /** Model families the request ran on; empty when unknown. */
  readonly modelScopes: readonly string[];
  readonly billing: PlanLimitBilling;
  readonly observedAt: number;
}

export interface PlanLimitWindowRecordOptions {
  /** The caller judged the data stale; it then never clears live evidence. */
  readonly stale?: boolean;
}

/** The ledger's evidence for one owner. */
export interface PlanLimitLedgerOwnerSnapshot {
  readonly owner: QuotaOwnerRef;
  readonly windows: readonly PlanLimitWindow[];
  readonly ownerEvidence: readonly OwnerLimitEvidence[];
  readonly cooldown?: PlanLimitCooldown;
}

export type PlanLimitLedgerChange =
  | { readonly kind: 'owner'; readonly ownerKey: string }
  | { readonly kind: 'session'; readonly sessionId: string };

export type PlanLimitLedgerListener = (change: PlanLimitLedgerChange) => void;

/** The registry surface the ledger subscribes to. */
export type PlanLimitSignalSource = Pick<
  SessionPlanLimitCallbackRegistry,
  'register'
>;
/** The resolver surface the ledger needs for a session's owner. */
export type PlanLimitSessionOwnerResolver = Pick<
  ProviderOwnerResolver,
  'ownerForSession'
>;
/** The quota-store surface the ledger observes. */
export type PlanLimitProxyObservations = Pick<
  ProviderQuotaStore,
  'onRateLimit' | 'onSuccess'
>;

interface SessionState {
  owner: QuotaOwnerRef | null;
  modelScope: string | null;
  ownerRequested: boolean;
  /** Last signal or owner change, on the ledger clock. */
  lastSignalAt: number;
  /** Serialises this session's signals so each lands under its turn's owner. */
  pending: Promise<void>;
}

@injectable()
export class PlanLimitLedgerService {
  private readonly owners = new Map<string, OwnerState>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly listeners = new Set<PlanLimitLedgerListener>();
  private readonly disposers: Array<() => void>;
  private lastPersisted: string | undefined;
  private disposed = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly storage: IStateStorage,
    @inject(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY)
    signals: PlanLimitSignalSource,
    @inject(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER)
    private readonly resolver: PlanLimitSessionOwnerResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE)
    proxies: PlanLimitProxyObservations,
    /** Test seam; the DI factory leaves the default. */
    private readonly now: () => number = Date.now,
  ) {
    this.load();
    this.disposers = [
      signals.register((event) => this.onSessionSignal(event)),
      proxies.onRateLimit((observation) => this.onProxyRateLimit(observation)),
      proxies.onSuccess((observation) => this.onProxySuccess(observation)),
    ];
  }

  // ---------------------------------------------------------------- writes

  /**
   * Record what a source says about one window. Replaces the held entry only
   * when `supersedes` allows it. A held unknown-reset exhaustion survives the
   * replacement unless the new reading clears it (a fresh, non-estimated
   * reading below the limit, observed after the exhaustion).
   */
  recordWindowEvidence(
    owner: QuotaOwnerRef,
    window: PlanLimitWindow,
    options: PlanLimitWindowRecordOptions = {},
  ): void {
    const now = this.now();
    const id = allowanceId(window);
    const prev = this.owners.get(owner.key)?.windows.get(id);
    const next: WindowEntry = { window, stale: options.stale === true };
    if (
      prev &&
      !supersedes(
        windowStamp(next),
        windowStamp(prev),
        prev.window.lastResetAt ?? window.lastResetAt,
      )
    ) {
      return;
    }
    this.ownerState(owner).windows.set(id, {
      window: carryExhaustion(prev, next, now),
      stale: next.stale,
    });
    this.changed(owner.key);
  }

  /** Record a limit hit whose window is unknown; one entry per model scope. */
  recordOwnerEvidence(
    owner: QuotaOwnerRef,
    evidence: OwnerLimitEvidence,
  ): void {
    const scope = normaliseScope(evidence.modelScope) ?? ALL_MODELS;
    const prev = this.owners.get(owner.key)?.ownerEvidence.get(scope);
    if (prev && !supersedes(evidenceStamp(evidence), evidenceStamp(prev))) {
      return;
    }
    this.ownerState(owner).ownerEvidence.set(scope, evidence);
    this.changed(owner.key);
  }

  /** Record a provider-imposed wait. The later deadline wins. */
  recordCooldown(owner: QuotaOwnerRef, cooldown: PlanLimitCooldown): void {
    const end = cooldownEnd(cooldown);
    if (!Number.isFinite(end) || !Number.isFinite(cooldown.observedAt)) return;
    const prev = this.owners.get(owner.key)?.cooldown;
    if (prev && cooldownEnd(prev) >= end) return;
    this.ownerState(owner).cooldown = cooldown;
    this.changed(owner.key);
  }

  /**
   * Record a served request. Any success clears the owner's cooldown observed
   * before it. Only `billing:'plan'` clears unknown-reset exhaustion, and
   * only `five_hour`, `weekly` and the success's own `weekly_model:<scope>`
   * windows plus owner evidence of that scope or of every model. Overage,
   * monthly, other scopes, other owners and known resets are never touched.
   */
  recordSuccess(success: PlanLimitSuccess): void {
    const state = this.owners.get(success.ownerKey);
    if (!state || !Number.isFinite(success.observedAt)) return;
    let changed = false;
    if (state.cooldown && state.cooldown.observedAt <= success.observedAt) {
      state.cooldown = undefined;
      changed = true;
    }
    if (success.billing === 'plan') {
      const scopes = new Set(
        success.modelScopes
          .map((scope) => normaliseScope(scope))
          .filter((scope): scope is string => scope !== undefined),
      );
      changed =
        clearUnknownResetEvidence(
          state,
          scopes,
          success.observedAt,
          this.now(),
        ) || changed;
    }
    if (changed) this.changed(state.owner.key);
  }

  /**
   * Set the current owner and model scope of a chat session. Earlier
   * evidence stays under whichever owner it was recorded for.
   */
  setSessionOwner(
    sessionId: string,
    owner: QuotaOwnerRef | null,
    modelScope: string | null,
  ): void {
    const state = this.sessionState(sessionId);
    state.lastSignalAt = this.now();
    const scope = normaliseScope(modelScope ?? undefined) ?? null;
    if (state.owner?.key === owner?.key && state.modelScope === scope) return;
    state.owner = owner;
    state.modelScope = scope;
    this.notify({ kind: 'session', sessionId });
  }

  // ----------------------------------------------------------------- reads

  /** The owner's current evidence, or `undefined` when the ledger holds none. */
  snapshotFor(ownerKey: string): PlanLimitLedgerOwnerSnapshot | undefined {
    const state = this.owners.get(ownerKey);
    if (!state || !this.prune(state, this.now())) return undefined;
    return {
      owner: state.owner,
      windows: [...state.windows.values()].map((entry) => entry.window),
      ownerEvidence: [...state.ownerEvidence.values()],
      ...(state.cooldown && { cooldown: state.cooldown }),
    };
  }

  /** Owners with live evidence, plus every session's current owner. */
  knownOwners(): QuotaOwnerRef[] {
    const now = this.now();
    const found = new Map<string, QuotaOwnerRef>();
    for (const state of [...this.owners.values()]) {
      if (this.prune(state, now)) found.set(state.owner.key, state.owner);
    }
    this.evictIdleSessions(now);
    for (const session of this.sessions.values()) {
      if (session.owner) found.set(session.owner.key, session.owner);
    }
    return [...found.values()];
  }

  /** Current owner and scope of every session the ledger has seen. */
  sessionOwners(): Record<string, PlanLimitSessionOwner> {
    const result: Record<string, PlanLimitSessionOwner> = {};
    this.evictIdleSessions(this.now());
    for (const [sessionId, session] of this.sessions) {
      result[sessionId] = {
        ownerKey: session.owner?.key ?? null,
        modelScope: session.modelScope,
      };
    }
    return result;
  }

  /** Observe every change. Returns the unsubscribe function. */
  onChange(listener: PlanLimitLedgerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Release the registry and both quota-store subscriptions. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.listeners.clear();
  }

  // ------------------------------------------------------- session signals

  private onSessionSignal({ sessionId, signal }: SessionPlanLimitEvent): void {
    if (this.disposed) return;
    const now = this.now();
    this.evictIdleSessions(now);
    const state = this.sessionState(sessionId);
    state.lastSignalAt = now;
    const resolveOwner = signal.kind === 'turn-start' || !state.ownerRequested;
    state.ownerRequested = true;
    // `then` defers past the synchronous fan-out, so the probe's own
    // turn-start handler has dropped last turn's account before this reads it.
    state.pending = state.pending
      .then(async () => {
        if (resolveOwner) await this.refreshSessionOwner(sessionId);
        if (!this.disposed) this.applySessionSignal(sessionId, signal);
      })
      .catch((error: unknown) => {
        this.logger.debug('[PlanLimitLedger] session signal dropped', {
          sessionId,
          signal: signal.kind,
          reason: errorKind(error),
        });
      });
  }

  private async refreshSessionOwner(sessionId: string): Promise<void> {
    const owner = await this.resolver.ownerForSession(sessionId);
    if (this.disposed) return;
    this.setSessionOwner(
      sessionId,
      owner,
      this.sessions.get(sessionId)?.modelScope ?? null,
    );
  }

  private applySessionSignal(
    sessionId: string,
    signal: SessionPlanLimitSignal,
  ): void {
    const owner = this.sessions.get(sessionId)?.owner;
    if (!owner) return;
    if (signal.kind === 'evidence') {
      this.recordClaudeEvidence(owner, signal.evidence);
    } else if (signal.kind === 'success') {
      this.recordSuccess({
        ownerKey: owner.key,
        modelScopes: signal.turnScopes,
        billing: signal.billing,
        observedAt: signal.observedAt,
      });
      const lastScope = signal.turnScopes[signal.turnScopes.length - 1];
      if (lastScope !== undefined) {
        this.setSessionOwner(sessionId, owner, lastScope);
      }
    }
  }

  private recordClaudeEvidence(
    owner: QuotaOwnerRef,
    evidence: ClaudePlanLimitEvidence,
  ): void {
    if (evidence.kind === 'window') {
      this.recordWindowEvidence(owner, windowFromClaudeEvidence(evidence));
      return;
    }
    this.recordOwnerEvidence(owner, {
      observedAt: evidence.observedAt,
      source: evidence.source,
      ...(evidence.resetsAt !== undefined && {
        resetsAt: evidence.resetsAt,
        resetSource: evidence.source,
      }),
    });
    if (evidence.cooldown) this.recordCooldown(owner, evidence.cooldown);
  }

  // ------------------------------------------------------- proxy observers

  private onProxyRateLimit(observation: ProviderQuotaObservation): void {
    if (this.disposed) return;
    const rawUntil = parseRetryAfterDeadline(
      observation.retryAfterRaw,
      observation.observedAt,
    );
    const until = observation.gateUntil ?? rawUntil;
    if (until === undefined) return;
    this.recordCooldown(proxyOwner(observation), {
      until,
      observedAt: observation.observedAt,
      ...(rawUntil !== undefined && { rawUntil }),
    });
  }

  private onProxySuccess(observation: ProviderQuotaObservation): void {
    if (this.disposed) return;
    // The same owner the proxy's 429 lands on, so an unattributed proxy's
    // own 2xx clears its own cooldown and no other proxy's. No in-scope proxy
    // provider is provably plan-billed (Decision 4, S4), so exhaustion stays.
    this.recordSuccess({
      ownerKey: proxyOwner(observation).key,
      modelScopes: [],
      billing: 'unknown',
      observedAt: observation.observedAt,
    });
  }

  // ------------------------------------------------------------- internals

  private ownerState(owner: QuotaOwnerRef): OwnerState {
    let state = this.owners.get(owner.key);
    if (!state) {
      state = { owner, windows: new Map(), ownerEvidence: new Map() };
      this.owners.set(owner.key, state);
    }
    return state;
  }

  private sessionState(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        owner: null,
        modelScope: null,
        ownerRequested: false,
        lastSignalAt: this.now(),
        pending: Promise.resolve(),
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  /**
   * Forget sessions idle for {@link SESSION_IDLE_MS} whose owner holds no
   * live evidence. A session with a recent signal, or whose owner still has
   * evidence, keeps its current owner.
   */
  private evictIdleSessions(now: number): void {
    for (const [sessionId, session] of [...this.sessions]) {
      if (now - session.lastSignalAt < SESSION_IDLE_MS) continue;
      const ownerState = session.owner && this.owners.get(session.owner.key);
      if (ownerState && this.prune(ownerState, now)) continue;
      this.sessions.delete(sessionId);
    }
  }

  /** Drop what has expired. Returns false (and forgets the owner) when nothing is left. */
  private prune(state: OwnerState, now: number): boolean {
    const longest = longestWindowMs(state);
    for (const [id, entry] of [...state.windows]) {
      const window = withoutExpiredExhaustion(entry.window, now, longest);
      if (
        window.exhaustion === undefined &&
        windowExpired(window, now, longest)
      ) {
        state.windows.delete(id);
      } else if (window !== entry.window) {
        state.windows.set(id, { window, stale: entry.stale });
      }
    }
    for (const [scope, evidence] of [...state.ownerEvidence]) {
      if (evidenceExpired(evidence, now, longest)) {
        state.ownerEvidence.delete(scope);
      }
    }
    if (state.cooldown && cooldownEnd(state.cooldown) <= now) {
      state.cooldown = undefined;
    }
    const empty =
      state.windows.size === 0 &&
      state.ownerEvidence.size === 0 &&
      state.cooldown === undefined;
    if (empty) this.owners.delete(state.owner.key);
    return !empty;
  }

  private changed(ownerKey: string): void {
    const state = this.owners.get(ownerKey);
    if (state) this.prune(state, this.now());
    this.persist();
    this.notify({ kind: 'owner', ownerKey });
  }

  private notify(change: PlanLimitLedgerChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error: unknown) {
        this.logger.debug('[PlanLimitLedger] change listener threw', {
          change: change.kind,
          reason: errorKind(error),
        });
      }
    }
  }

  // ----------------------------------------------------------- persistence

  private persist(): void {
    const payload = serializeLedger(this.owners.values(), this.now());
    const serialized = JSON.stringify(payload);
    if (serialized === this.lastPersisted) return;
    this.lastPersisted = serialized;
    try {
      // Memory stays authoritative when the write fails.
      void this.storage
        .update(PLAN_LIMIT_LEDGER_STORAGE_KEY, payload)
        .catch((error: unknown) => this.logPersistFailure(error));
    } catch (error: unknown) {
      this.logPersistFailure(error);
    }
  }

  private logPersistFailure(error: unknown): void {
    this.lastPersisted = undefined;
    this.logger.debug('[PlanLimitLedger] persist failed', {
      reason: errorKind(error),
    });
  }

  /** Restore known-reset evidence still ahead of its reset; drop the rest. */
  private load(): void {
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(PLAN_LIMIT_LEDGER_STORAGE_KEY);
    } catch (error: unknown) {
      this.logger.debug('[PlanLimitLedger] persisted state unreadable', {
        reason: errorKind(error),
      });
      return;
    }
    if (raw === undefined) return;
    const restored = restoreLedger(raw, this.now());
    for (const { owner, windows, ownerEvidence } of restored.owners) {
      const state = this.ownerState(owner);
      for (const window of windows) {
        state.windows.set(allowanceId(window), { window, stale: false });
      }
      for (const evidence of ownerEvidence) {
        state.ownerEvidence.set(
          normaliseScope(evidence.modelScope) ?? ALL_MODELS,
          evidence,
        );
      }
    }
    if (!restored.validEnvelope || restored.dropped > 0) {
      this.logger.debug('[PlanLimitLedger] persisted state dropped', {
        envelope: restored.validEnvelope ? 'valid' : 'invalid',
        dropped: restored.dropped,
      });
    }
  }
}

/**
 * The owner a proxy observation belongs to: the key captured at the response
 * boundary, else an unknown owner of that proxy instance alone.
 */
function proxyOwner(observation: ProviderQuotaObservation): QuotaOwnerRef {
  if (observation.ownerKey !== null) {
    const owner = ownerRefOrUndefined(observation.ownerKey);
    if (owner) return owner;
  }
  return quotaOwnerRefFromKey(
    unknownOwnerKey(
      observation.providerId,
      `proxy:${observation.sourceId ?? 'unidentified'}`,
    ),
  );
}

function ownerRefOrUndefined(key: string): QuotaOwnerRef | undefined {
  try {
    return quotaOwnerRefFromKey(key);
  } catch {
    return undefined;
  }
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
