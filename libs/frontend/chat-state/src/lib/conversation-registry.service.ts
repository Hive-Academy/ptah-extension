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
  compactionStateFor(
    convId: ConversationId,
  ): { inFlight: boolean; lastCompactionAt: number | null } | null {
    const r = this._byId().get(convId);
    if (!r) return null;
    return {
      inFlight: r.compactionInFlight,
      lastCompactionAt: r.lastCompactionAt,
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
