/**
 * ConversationRegistry — TASK_2026_106 Phase 1.
 *
 * Single source of truth for the `ConversationId → ClaudeSessionId[]` relation.
 * A conversation is the user-perceived thread that survives compaction and
 * survives multi-tab fan-out (canvas grid mode).
 *
 * Pure data: this service knows nothing about tabs, streaming, or UI. It
 * exposes signals so consumers (the future StreamRouter, the chat shell,
 * tests) can read reactively without having to subscribe through other
 * services.
 *
 * Phase 1 ships this service in additive mode — no caller writes to it yet.
 * Phase 2 wires the StreamRouter; Phase 3 makes it authoritative.
 */

import { Injectable, computed, signal } from '@angular/core';
import { ClaudeSessionId, ConversationId } from './identity/ids';

/**
 * Snapshot of a single conversation. Returned by read APIs as a deeply
 * frozen value — callers must never mutate.
 */
export interface ConversationRecord {
  readonly id: ConversationId;
  /** Ordered, oldest-first. Head of the list is the *current* SDK session. */
  readonly sessions: readonly ClaudeSessionId[];
  readonly createdAt: number;
  /** True between `compaction_start` and `compaction_complete` events. */
  readonly compactionInFlight: boolean;
  readonly lastCompactionAt: number | null;
}

/** Internal mutable shape — never exposed. */
interface MutableRecord {
  id: ConversationId;
  sessions: ClaudeSessionId[];
  createdAt: number;
  compactionInFlight: boolean;
  lastCompactionAt: number | null;
  /**
   * TASK_2026_109 C1 — single source of truth for compaction state.
   * `trigger` / `preTokens` / `startedAt` are populated when known
   * (compaction_start event payload, Wave 2). `null` otherwise.
   */
  compactionTrigger: 'manual' | 'auto' | null;
  compactionPreTokens: number | null;
  compactionStartedAt: number | null;
}

/**
 * TASK_2026_109 C1 — patch shape for `setCompactionState`. All fields except
 * `inFlight` are optional and additive; omitted fields keep their prior value
 * so callers can incrementally enrich state (e.g. start-event payload first,
 * then complete-event later).
 */
export interface CompactionStatePatch {
  readonly inFlight: boolean;
  readonly trigger?: 'manual' | 'auto';
  readonly preTokens?: number;
  readonly startedAt?: number;
}

/**
 * TASK_2026_109 C1 — extended compaction-state read shape returned by
 * `compactionStateFor`. Existing readers only consume `inFlight` /
 * `lastCompactionAt`; new readers (header freeze, instrumentation) can
 * additionally consume `trigger` / `preTokens` / `startedAt` when present.
 */
export interface CompactionStateView {
  readonly inFlight: boolean;
  readonly lastCompactionAt: number | null;
  readonly trigger: 'manual' | 'auto' | null;
  readonly preTokens: number | null;
  readonly startedAt: number | null;
}

@Injectable({ providedIn: 'root' })
export class ConversationRegistry {
  private readonly _byId = signal<ReadonlyMap<ConversationId, MutableRecord>>(
    new Map(),
  );

  /** All conversations, frozen view. */
  readonly conversations = computed<readonly ConversationRecord[]>(() =>
    Array.from(this._byId().values()).map(freeze),
  );

  /** Get a single record by id; null if unknown. */
  getRecord(convId: ConversationId): ConversationRecord | null {
    const r = this._byId().get(convId);
    return r ? freeze(r) : null;
  }

  /**
   * Create a new conversation. Optionally seed it with an initial session.
   * Returns the new id.
   */
  create(initialSession?: ClaudeSessionId): ConversationId {
    const id = ConversationId.create();
    const record: MutableRecord = {
      id,
      sessions: initialSession ? [initialSession] : [],
      createdAt: Date.now(),
      compactionInFlight: false,
      lastCompactionAt: null,
      compactionTrigger: null,
      compactionPreTokens: null,
      compactionStartedAt: null,
    };
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.set(id, record);
      return next;
    });
    return id;
  }

  /**
   * Append a session id to the conversation. No-op if the session is already
   * the current head (idempotent on repeat events). Throws on unknown convId.
   */
  appendSession(convId: ConversationId, sessionId: ClaudeSessionId): void {
    const existing = this._byId().get(convId);
    if (!existing) {
      throw new Error(
        `[ConversationRegistry] appendSession on unknown conversation: ${convId}`,
      );
    }
    if (existing.sessions[existing.sessions.length - 1] === sessionId) {
      return;
    }
    const updated: MutableRecord = {
      ...existing,
      sessions: [...existing.sessions, sessionId],
    };
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.set(convId, updated);
      return next;
    });
  }

  /**
   * Find the conversation whose *current head* session matches `sessionId`.
   * This is the fast path for routing live stream events.
   */
  findByCurrentSession(sessionId: ClaudeSessionId): ConversationRecord | null {
    for (const record of this._byId().values()) {
      if (record.sessions[record.sessions.length - 1] === sessionId) {
        return freeze(record);
      }
    }
    return null;
  }

  /**
   * Find any conversation that contains `sessionId` anywhere in its history.
   * Used when historical messages reference a previous (pre-compaction) session.
   */
  findContainingSession(sessionId: ClaudeSessionId): ConversationRecord | null {
    for (const record of this._byId().values()) {
      if (record.sessions.includes(sessionId)) {
        return freeze(record);
      }
    }
    return null;
  }

  markCompactionStart(convId: ConversationId): void {
    // Legacy strict path used by StreamRouter and tests: throws on unknown
    // conversation. The new `setCompactionState` is the defensive write-
    // through API used by lifecycle services that may race with router-
    // driven (un)registration.
    this.patch(convId, (r) => ({ ...r, compactionInFlight: true }));
  }

  markCompactionComplete(convId: ConversationId): void {
    this.patch(convId, (r) => ({
      ...r,
      compactionInFlight: false,
      lastCompactionAt: Date.now(),
    }));
  }

  /**
   * TASK_2026_109 C1 — single source of truth for compaction state.
   *
   * Idempotent. No-ops on unknown conversation id (defensive — close races
   * may fire setters after the conversation has already been removed). When
   * `inFlight` flips true, optional `trigger` / `preTokens` / `startedAt`
   * fields are stored (omitted fields default to existing values, which on
   * a fresh record means `null`). When `inFlight` flips false, the start
   * payload is preserved and `lastCompactionAt` is stamped to `Date.now()`
   * so receiver-side consumers (the SESSION_STATS late-event filter) can
   * compute a grace window without touching the tab.
   */
  setCompactionState(
    convId: ConversationId,
    patch: CompactionStatePatch,
  ): void {
    if (!this._byId().has(convId)) {
      // Defensive: lifecycle services may write through here for tabs that
      // are not yet (or no longer) registered. Silent no-op preserves the
      // legacy "graceful skip" behavior the per-tab path used to provide.
      return;
    }
    this.patch(convId, (r) => {
      if (patch.inFlight) {
        return {
          ...r,
          compactionInFlight: true,
          compactionTrigger: patch.trigger ?? r.compactionTrigger,
          compactionPreTokens: patch.preTokens ?? r.compactionPreTokens,
          compactionStartedAt: patch.startedAt ?? r.compactionStartedAt,
        };
      }
      // Completing — stamp lastCompactionAt; keep start-payload fields so
      // post-complete readers can still report what triggered the compaction
      // until the next start arrives and overwrites them.
      return {
        ...r,
        compactionInFlight: false,
        lastCompactionAt: Date.now(),
      };
    });
  }

  /**
   * TASK_2026_106 Phase 4c — compaction-on-conversation.
   *
   * Returns the compaction state of the conversation, or `null` if the
   * conversation is unknown. Reads through the same internal `_byId` signal
   * as `getRecord`, so callers wrapping this in `computed()` get reactive
   * updates whenever `markCompactionStart` / `markCompactionComplete` fires.
   *
   * The compaction banner UI uses this to render banner state from the
   * conversation rather than the tab — so closing one of two side-by-side
   * canvas tiles bound to the same session does not lose banner state on
   * the surviving tile.
   */
  compactionStateFor(convId: ConversationId): CompactionStateView | null {
    const r = this._byId().get(convId);
    if (!r) return null;
    return {
      inFlight: r.compactionInFlight,
      lastCompactionAt: r.lastCompactionAt,
      trigger: r.compactionTrigger,
      preTokens: r.compactionPreTokens,
      startedAt: r.compactionStartedAt,
    };
  }

  /**
   * Remove a conversation. The router calls this once the last bound tab
   * unbinds *and* the underlying SDK session(s) have been cleaned up.
   * No-op on unknown id (defensive — close races can fire twice).
   */
  remove(convId: ConversationId): void {
    if (!this._byId().has(convId)) return;
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.delete(convId);
      return next;
    });
  }

  private patch(
    convId: ConversationId,
    fn: (r: MutableRecord) => MutableRecord,
  ): void {
    const existing = this._byId().get(convId);
    if (!existing) {
      throw new Error(
        `[ConversationRegistry] patch on unknown conversation: ${convId}`,
      );
    }
    const updated = fn(existing);
    this._byId.update((prev) => {
      const next = new Map(prev);
      next.set(convId, updated);
      return next;
    });
  }
}

function freeze(r: MutableRecord): ConversationRecord {
  return {
    id: r.id,
    sessions: Object.freeze([...r.sessions]),
    createdAt: r.createdAt,
    compactionInFlight: r.compactionInFlight,
    lastCompactionAt: r.lastCompactionAt,
  };
}
