/**
 * SessionRegistry — sole owner of `byTabId`, `bySessionId`, and
 * `_lastActiveTabId` state for the session-lifecycle subsystem.
 *
 * Extracted state ownership out of `SessionLifecycleManager` so that
 * the streaming pump, query executor, and lifecycle-control sub-services all
 * mutate state through this single registry. There is exactly ONE recompute
 * site for `_lastActiveTabId` (`recomputeLastActiveOnRemoval`) shared by both
 * `remove(rec)` (both the endSession path and the executeQuery
 * init-failure rollback path), eliminating the duplicate fallback logic that
 * previously lived in two places.
 *
 * `activeSessions` and `tabIdToRealId` removed. All methods now read/write
 * through `byTabId` and `bySessionId` only. Both indexes point at the SAME
 * `SessionRecord` object — mutations via either lookup are immediately visible.
 *
 * This is a plain class — NOT @injectable, NOT registered with tsyringe. The
 * facade constructs it eagerly in its constructor body. See WAVE_C7i_DESIGN.md.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SessionId,
  AISessionConfig,
  AuthEnv,
  ContextCapacityRoute,
  PermissionLevel,
} from '@ptah-extension/shared';
import { blankToUndefined } from '@ptah-extension/shared';

import type { Query, SDKUserMessage } from '../session-lifecycle-manager';
import type { ActivityHold } from '../no-activity-watchdog';
import type { UsageCostSource } from '../../session-stats/session-stats-owner.service';

/**
 * A single session record held in the dual-index registry.
 * Both `byTabId` and `bySessionId` point at the SAME object so mutations
 * via either lookup are immediately visible from the other.
 *
 * Co-located here to avoid circular imports (sub-services import from the
 * registry, not from session-lifecycle-manager).
 */
export interface SessionRecord {
  /**
   * Opaque identity of THIS registration, minted fresh in `register()`.
   *
   * `tabId` and `realSessionId` are stable across re-registrations under the
   * same key — a slash-command re-query ends the old record and registers a new
   * one under the same id — so neither can answer "is the record I was holding
   * still the one registered?". The token can: two registrations never share
   * one. Compare it through `SessionControl.endSessionIfTokenMatches`, never by
   * reading it and acting later.
   */
  readonly token: string;
  /** Immutable tab ID assigned at tile creation. */
  readonly tabId: string;
  /** Null until the SDK system 'init' message fires; set ONCE via bindRealSessionId. */
  realSessionId: string | null;
  /** SDK Query handle; null during pre-registration before executeQuery starts. */
  query: Query | null;
  /** Session configuration (model, workspace, etc.). Immutable after register. */
  readonly config: AISessionConfig;
  /** Abort controller for this session. Immutable after register. */
  readonly abortController: AbortController;
  /** Queued user messages awaiting the streaming pump. */
  messageQueue: SDKUserMessage[];
  /** Callback to wake the streaming iterator when a message arrives. */
  resolveNext: (() => void) | null;
  /**
   * True from the moment the pump yields a user message until that turn's
   * `result` message arrives. While true the pump HOLDS further queued
   * messages instead of yielding them (TASK_2026_294).
   *
   * A prompt handed to the SDK mid-turn is classified as a queued command:
   * the SDK enqueues it, removes it, writes it as a `queued_command`
   * transcript attachment, and never materialises it as a user turn — the
   * model never sees it. Measured: 180 removed queue items, 0 delivered.
   */
  turnInFlight: boolean;
  /** Current model ID (may differ from config.model after setModel calls). */
  currentModel: string;
  /**
   * Live autopilot permission level for THIS session — the per-session source
   * of truth read by the canUseTool callback. Seeded at session start from the
   * global default and updated by setSessionPermissionLevel on live toggle, so
   * a tool call in one workspace's session never sees another workspace's level.
   */
  permissionLevel: PermissionLevel;
  /**
   * The session's `NoActivityWatchdog`, seen through its hold/release half.
   * The turn state owns exactly one hold on it: count 1 while no turn is in
   * flight, 0 while one is. Idle between turns is silence Ptah chose, not a
   * hung provider — without the hold the watchdog fired exactly 180 s after
   * every `result` and marked every running subagent interrupted
   * (TASK_2026_363). Null until `SessionQueryExecutor` builds the watchdog.
   */
  activityHold: ActivityHold | null;
  lastActivityAt: number;
  /**
   * Who is authoritative for this query's dollars, classified ONCE from the
   * effective auth route when the query was created (TASK_2026_533). Every
   * stream over this record — including an active-reuse stream — accounts
   * with it, so a later route change cannot re-price a running query.
   */
  readonly usageCostSource: UsageCostSource;
  /**
   * Snapshot of the query's EFFECTIVE auth env (a provider-profile override
   * wins), frozen with `usageCostSource`. Accounting resolves model aliases
   * for pricing against it, so a later change to the process-global env
   * cannot re-price a running query.
   */
  readonly accountingAuthEnv: Readonly<AuthEnv>;
  readonly capacityRoute?: ContextCapacityRoute;
}

/** Cost authority and pricing context of one query, frozen at creation. */
export interface QueryAccounting {
  readonly usageCostSource: UsageCostSource;
  readonly authEnv: Readonly<AuthEnv>;
}

/**
 * For a registration that never creates a query (no result can arrive):
 * price from the rate card with no route-specific alias mapping.
 */
const UNCLASSIFIED_ACCOUNTING: QueryAccounting = Object.freeze({
  usageCostSource: 'unreported',
  authEnv: Object.freeze({}) as Readonly<AuthEnv>,
});

/**
 * What `bindRealSessionId` did.
 *
 * The caller needs this because the fan-out that announces "this tab resolved
 * to this session" must not fire for a session the registry REFUSED. A stale
 * process that outlives a tab restart still emits its own init message against
 * the same tab, and announcing that id told every downstream consumer the tab
 * had moved back to the dead session (2026-09-17, tab `03497c14-…`).
 */
export type BindRealSessionIdOutcome =
  /** The record took this id; `bySessionId` now resolves it. */
  | 'bound'
  /** The record already carried this exact id. Nothing changed. */
  | 'already-bound'
  /**
   * The record carried a different id, and the caller proved it owns the
   * record by passing its token. The record now points at the new id — this is
   * the fork/re-init case, where the SAME process reports a new session id.
   */
  | 'rebound'
  /** The record carries a DIFFERENT id. The caller must not announce this one. */
  | 'stale-mismatch'
  /** No record is registered under this tab id. */
  | 'no-record'
  /** The id was blank or whitespace. */
  | 'invalid';

/**
 * Correlatable stand-in for a record's `token`, safe to write to a log.
 *
 * The token is a CAPABILITY: `bindRealSessionId` accepts it as proof that the
 * caller owns the record and moves the binding for whoever presents it. Writing
 * it verbatim would let anything that can read the log point a record at an
 * arbitrary session id. A truncated SHA-256 digest keeps two log lines about
 * one record comparable and cannot be replayed, because the bind compares the
 * token itself.
 */
function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_SWEEP_TTL_MS = 30 * 60 * 1000;

export class SessionRegistry {
  /**
   * Primary index: tabId → SessionRecord. Always populated at register().
   * This is the authoritative source for session iteration.
   */
  private byTabId = new Map<string, SessionRecord>();

  /**
   * Secondary index: realSessionId → SessionRecord. Populated when
   * bindRealSessionId() fires (SDK system 'init' message). Both maps
   * point at the SAME object — mutations visible from either lookup.
   */
  private bySessionId = new Map<string, SessionRecord>();

  /**
   * Tracks the most recently active tab ID.
   * Updated on session registration and message send.
   * Used by getActiveSessionIds() to return the most recently active
   * session first, so MCP tool calls (e.g., ptah_agent_spawn) attribute
   * agents to the correct session in multi-session scenarios.
   */
  private _lastActiveTabId: string | null = null;

  private _sweepTimer: ReturnType<typeof setInterval> | null = null;
  private _sweepTtlMs = DEFAULT_SWEEP_TTL_MS;
  private _now: () => number = () => Date.now();

  constructor(private readonly logger: Logger) {}

  /**
   * Register a new session into the registry.
   * Creates a SessionRecord with realSessionId = null and inserts it into
   * byTabId only. bySessionId entry is added later via bindRealSessionId().
   *
   * A record already registered under this tab id is DISPLACED first — see
   * `displaceExisting`. Before that, the overwrite dropped the old record from
   * `byTabId` while leaving its SDK query running and its `bySessionId` entry
   * in place, so a restarted tab left an orphan CLI process that still
   * answered for the tab.
   *
   * Also updates _lastActiveTabId so ordering semantics are preserved.
   *
   * The query's accounting (cost authority and pricing auth env) is frozen on
   * the record. A registration that never creates a query (no result can ever
   * arrive) takes {@link UNCLASSIFIED_ACCOUNTING}: rate card, never trust
   * dollars nobody classified.
   *
   * @returns The created SessionRecord (same object reference stored in byTabId).
   */
  register(
    tabId: string,
    config: AISessionConfig,
    abortController: AbortController,
    realSessionId?: string,
    accounting: QueryAccounting = UNCLASSIFIED_ACCOUNTING,
    capacityRoute: ContextCapacityRoute = { kind: 'proxy', providerId: null },
  ): SessionRecord {
    const rec: SessionRecord = {
      token: randomUUID(),
      usageCostSource: accounting.usageCostSource,
      accountingAuthEnv: accounting.authEnv,
      capacityRoute: Object.freeze({ ...capacityRoute }),
      tabId,
      realSessionId: realSessionId ?? null,
      query: null,
      config,
      abortController,
      messageQueue: [],
      resolveNext: null,
      turnInFlight: false,
      currentModel: config.model || '',
      permissionLevel: 'ask',
      activityHold: null,
      lastActivityAt: this._now(),
    };
    this.displaceExisting(tabId);
    this.byTabId.set(tabId, rec);
    if (realSessionId && realSessionId !== tabId) {
      this.bySessionId.set(realSessionId, rec);
    }
    this._lastActiveTabId = tabId;
    return rec;
  }

  /**
   * Bind the real SDK session UUID to an existing record.
   * Adds the record to bySessionId so find(realSessionId) works.
   *
   * Guard: realSessionId must be null on entry (set-once invariant).
   * If it is already set this call is a no-op (logs a warning).
   *
   * The set-once rule stays right even across a tab restart, because a restart
   * DISPLACES the old record and registers a fresh one whose `realSessionId` is
   * null — so the new process binds normally. What reaches the `stale-mismatch`
   * branch is only ever a late emitter: the displaced process's own stream.
   * The returned outcome is what lets the caller drop that announcement instead
   * of broadcasting a session id the registry just refused.
   *
   * `ownerToken` is the ONE exception to set-once, and it is an identity proof,
   * not an override flag: a caller that holds the registered record's token IS
   * that record's query, so its new id replaces the old one (`rebound`). A
   * caller without the token, or with a token from a displaced registration,
   * can never move the binding.
   *
   * Empty/whitespace realSessionId is rejected: a malformed SDK init
   * message yielding a blank UUID would otherwise let `find('')` resolve
   * a live query, attaching arbitrary callers to whichever session is
   * registered.
   */
  bindRealSessionId(
    tabId: string,
    realSessionId: string,
    ownerToken?: string,
  ): BindRealSessionIdOutcome {
    if (blankToUndefined(realSessionId) === undefined) {
      this.logger.warn(
        `[SessionRegistry] bindRealSessionId: rejected empty/whitespace realSessionId for tabId ${tabId}`,
      );
      return 'invalid';
    }
    const rec = this.byTabId.get(tabId);
    if (!rec) {
      this.logger.warn(
        `[SessionRegistry] bindRealSessionId: no record for tabId ${tabId}`,
      );
      return 'no-record';
    }
    if (rec.realSessionId === realSessionId) {
      this.logger.debug(
        `[SessionLifecycle] bindRealSessionId: realSessionId already bound for tabId ${tabId} (idempotent)`,
      );
      return 'already-bound';
    }
    if (rec.realSessionId !== null) {
      if (ownerToken !== undefined && ownerToken === rec.token) {
        // The registered record's OWN query is reporting a new id. A resume
        // with `forkSession` does exactly this: the record was registered
        // under the id being resumed, and the SDK answers with the forked id.
        // Refusing it here is what left the tab pointing at an id no live
        // process holds.
        this.bySessionId.delete(rec.realSessionId);
        this.logger.info(
          `[SessionRegistry] Rebinding tabId ${tabId} from ${rec.realSessionId} to ${realSessionId} (same record)`,
        );
        rec.realSessionId = realSessionId;
        rec.lastActivityAt = this._now();
        this.bySessionId.set(realSessionId, rec);
        return 'rebound';
      }
      this.logger.warn(
        `[SessionRegistry] bindRealSessionId: realSessionId already set for tabId ${tabId} (${rec.realSessionId}); ignoring ${realSessionId}`,
      );
      return 'stale-mismatch';
    }
    rec.realSessionId = realSessionId;
    rec.lastActivityAt = this._now();
    this.bySessionId.set(realSessionId, rec);
    this.logger.info(
      `[SessionRegistry] Bound real session ID: ${tabId} -> ${realSessionId}`,
    );
    return 'bound';
  }

  /**
   * Find a session record by either tabId or realSessionId.
   * Checks byTabId first, then bySessionId.
   *
   * Both lookups are O(1) — no scanning.
   */
  find(idOrTabId: string): SessionRecord | undefined {
    return this.byTabId.get(idOrTabId) ?? this.bySessionId.get(idOrTabId);
  }

  /**
   * Token of the record CURRENTLY registered under this id, or null when
   * nothing is registered. A caller that holds an old token can compare against
   * a fresh read to tell "still my record" from "replaced by a newer one".
   */
  getToken(idOrTabId: string): string | null {
    return this.find(idOrTabId)?.token ?? null;
  }

  /**
   * Remove a session record from both indexes and recompute _lastActiveTabId.
   * Safe to call when rec.realSessionId is null (skips bySessionId delete).
   *
   * **Removal is identity-conditional, per index.** A key alone is not proof of
   * ownership: `remove` runs after asynchronous work, and by then a RESTART may
   * have displaced `rec` and put a different record under the same tab id.
   * Deleting by key would then deregister the live replacement, which stays
   * running while `find(tabId)` reports nothing. Two real callers reach this
   * state — the `executeQuery` catch, which removes its record after a failed
   * initialization, and `SessionControl.endRecord`, which removes its record
   * after awaiting an interrupt. Each index is therefore cleared only when it
   * still maps to THIS record, and `_lastActiveTabId` is recomputed only when
   * this call actually took the tab entry away.
   */
  remove(rec: SessionRecord): void {
    const ownedTabIndex = this.byTabId.get(rec.tabId) === rec;
    if (ownedTabIndex) {
      this.byTabId.delete(rec.tabId);
    }
    if (
      rec.realSessionId !== null &&
      this.bySessionId.get(rec.realSessionId) === rec
    ) {
      this.bySessionId.delete(rec.realSessionId);
    }
    if (ownedTabIndex) {
      this.recomputeLastActiveOnRemoval(rec.tabId);
    }
  }

  /**
   * Set the SDK query for a pre-registered session.
   * Mutates the single SessionRecord stored in byTabId (and referenced by
   * bySessionId once bound), so the mutation is visible from either lookup.
   */
  setSessionQuery(sessionId: SessionId, query: Query): void {
    const rec = this.find(sessionId as string);
    if (!rec) {
      this.logger.error(
        `[SessionLifecycle] Cannot set query - session not found: ${sessionId}`,
      );
      return;
    }

    rec.query = query;
    rec.lastActivityAt = this._now();
    this.logger.debug(`[SessionLifecycle] Set query for session: ${sessionId}`);
  }

  /**
   * Get all active session IDs, most recently active first.
   * Returns real SDK UUIDs when resolved, tab IDs otherwise.
   * The ordering ensures that getActiveSessionIds()[0] returns the session
   * the user most recently interacted with, which is critical for MCP tools
   * like ptah_agent_spawn that pick ids[0] as the parentSessionId.
   */
  getActiveSessionIds(): SessionId[] {
    const keys = Array.from(this.byTabId.keys());
    if (this._lastActiveTabId && keys.length > 1) {
      const idx = keys.indexOf(this._lastActiveTabId);
      if (idx > 0) {
        keys.splice(idx, 1);
        keys.unshift(this._lastActiveTabId);
      }
    }

    return keys.map(
      (key) => (this.byTabId.get(key)?.realSessionId ?? key) as SessionId,
    );
  }

  /**
   * Get the workspace root (projectPath) for the most recently active session.
   * Used by MCP tools to resolve workspace per-session instead of globally.
   */
  getActiveSessionWorkspace(): string | undefined {
    if (this._lastActiveTabId) {
      const rec = this.byTabId.get(this._lastActiveTabId);
      if (rec?.config?.projectPath) {
        return rec.config.projectPath;
      }
    }
    for (const rec of this.byTabId.values()) {
      if (rec.config?.projectPath) {
        return rec.config.projectPath;
      }
    }
    return undefined;
  }

  /**
   * Get the workspace root (projectPath) for a specific session, by tabId or
   * realSessionId. Returns undefined when the session is unknown or has no
   * projectPath. Used to resolve an MCP tool call against the exact session
   * that issued it, rather than the most-recently-active one — the precise,
   * concurrency-safe form of {@link getActiveSessionWorkspace}.
   */
  getSessionWorkspace(idOrTabId: string): string | undefined {
    return this.find(idOrTabId)?.config?.projectPath;
  }

  /**
   * Get session count.
   */
  getActiveSessionCount(): number {
    return this.byTabId.size;
  }

  /**
   * Mark a tab as the most recently active. Used by `sendMessage` so that
   * MCP tool calls attribute spawned agents to the correct session in
   * multi-session scenarios.
   */
  markActive(tabId: string): void {
    this._lastActiveTabId = tabId;
    const rec = this.byTabId.get(tabId);
    if (rec) {
      rec.lastActivityAt = this._now();
    }
  }

  /**
   * Mark a turn as started. Called by the streaming pump immediately before it
   * yields a user message, so the pump's own drain loop stops after exactly one
   * message and holds the rest (TASK_2026_294).
   *
   * Releases the idle hold on the watchdog on the false→true transition only,
   * so the hold count owned by the turn state is 1 while no turn is in flight
   * and 0 while one is (TASK_2026_363).
   */
  markTurnStarted(rec: SessionRecord): void {
    if (!rec.turnInFlight) {
      rec.activityHold?.beginTurn?.();
      rec.activityHold?.release();
    }
    rec.turnInFlight = true;
    rec.lastActivityAt = this._now();
  }

  /**
   * Mark the current turn as finished and wake the parked pump so a message
   * held during the turn is yielded now.
   *
   * Called on the turn's `result` message (normal path) and after an explicit
   * turn interrupt. Session teardown removes the record outright, so it needs
   * no separate clear. A turn that emits neither is bounded by
   * `NoActivityWatchdog`, which aborts the controller and ends the pump loop.
   *
   * Re-takes the idle hold on the watchdog on the true→false transition only.
   * The guard is load-bearing: this is called from the `result` branch, the
   * interrupt path and the adapter, and a double call must not stack holds.
   * Invariant: the hold count owned by the turn state is 1 while no turn is in
   * flight, 0 while one is (TASK_2026_363).
   *
   * @returns true when a live record was found and cleared.
   */
  markTurnEnded(idOrTabId: string): boolean {
    const rec = this.find(idOrTabId);
    if (!rec) return false;
    rec.activityHold?.endTurn?.();
    if (rec.turnInFlight) {
      rec.activityHold?.hold();
    }
    rec.turnInFlight = false;
    if (rec.resolveNext) {
      const wake = rec.resolveNext;
      rec.resolveNext = null;
      wake();
    }
    return true;
  }

  /**
   * Iterate all session entries — for `disposeAllSessions`.
   */
  entries(): IterableIterator<[string, SessionRecord]> {
    return this.byTabId.entries();
  }

  /**
   * Atomic reset of all state fields. Used by `disposeAllSessions`.
   */
  clearAll(): void {
    this.byTabId.clear();
    this.bySessionId.clear();
    this._lastActiveTabId = null;
  }

  startEvictionSweep(
    intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS,
    ttlMs: number = DEFAULT_SWEEP_TTL_MS,
  ): void {
    this.stopEvictionSweep();
    this._sweepTtlMs = ttlMs;
    const timer = setInterval(() => {
      try {
        this.evictStale(this._now(), this._sweepTtlMs);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[SessionRegistry] eviction sweep threw: ${message}`);
      }
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this._sweepTimer = timer;
  }

  stopEvictionSweep(): void {
    if (this._sweepTimer !== null) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  evictStale(now: number, ttlMs: number): number {
    let evicted = 0;
    for (const rec of Array.from(this.byTabId.values())) {
      if (rec.query !== null) continue;
      if (now - rec.lastActivityAt < ttlMs) continue;
      this.byTabId.delete(rec.tabId);
      if (rec.realSessionId !== null) {
        this.bySessionId.delete(rec.realSessionId);
      }
      this.recomputeLastActiveOnRemoval(rec.tabId);
      evicted += 1;
      this.logger.warn(
        `[SessionRegistry] Evicted stale session record: ${rec.tabId} ` +
          `(idleMs=${now - rec.lastActivityAt}, realSessionId=${rec.realSessionId ?? 'null'})`,
      );
    }
    return evicted;
  }

  setClockForTesting(now: () => number): void {
    this._now = now;
  }

  /**
   * Drop the record currently registered under `tabId`, if any, before a new
   * one takes the key.
   *
   * Two halves, and both are load-bearing:
   *
   *  - **Both indexes go.** The old record's `bySessionId` entry survived the
   *    overwrite, so `find(<old real session id>)` kept resolving a record that
   *    no longer owned its tab.
   *  - **Its AbortController fires.** That controller is the ONLY handle on the
   *    displaced SDK query once the map entry is gone, and aborting it is what
   *    `endSession` itself relies on to stop the CLI process. Without it the
   *    old process stayed alive, kept its registry name, and kept emitting
   *    against the tab. `abort()` is idempotent, so a record whose owner
   *    already tore it down costs nothing here.
   *
   * This does NOT run the full `SessionControl.endRecord` teardown: that is
   * async, and registration must not await a 5 s interrupt race. The orderly
   * path still owns the orderly teardown. This is the backstop for the case
   * where nobody ran one.
   */
  private displaceExisting(tabId: string): void {
    const previous = this.byTabId.get(tabId);
    if (!previous) {
      return;
    }
    this.byTabId.delete(tabId);
    if (
      previous.realSessionId !== null &&
      this.bySessionId.get(previous.realSessionId) === previous
    ) {
      this.bySessionId.delete(previous.realSessionId);
    }
    this.logger.warn(
      `[SessionRegistry] Displacing the record registered under tabId ${tabId} ` +
        `(realSessionId=${previous.realSessionId ?? 'null'}, ` +
        `token=${tokenFingerprint(previous.token)}) — ` +
        'aborting its query so the restart leaves no orphan process',
    );
    try {
      previous.abortController.abort();
    } catch (error: unknown) {
      this.logger.warn(
        `[SessionRegistry] Abort of the displaced record for tabId ${tabId} threw: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * Recompute `_lastActiveTabId` after a session removal: if the removed tab
   * was the most-recent, fall back to the last entry of the remaining keys
   * (or null if the registry is now empty). Single source of truth for the
   * fallback semantics.
   */
  private recomputeLastActiveOnRemoval(removedTabId: string): void {
    if (this._lastActiveTabId === removedTabId) {
      const remaining = Array.from(this.byTabId.keys());
      this._lastActiveTabId =
        remaining.length > 0 ? remaining[remaining.length - 1] : null;
    }
  }
}
