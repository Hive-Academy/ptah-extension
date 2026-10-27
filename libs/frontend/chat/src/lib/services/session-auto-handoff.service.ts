import { Injectable, signal } from '@angular/core';
import type { QueuedCommand } from './chat-store/conversation.service';

/** `fired`: the automatic hand-off ran for the session; `cancelled`: the user cancelled it. */
export type AutoHandoffState = 'fired' | 'cancelled';

/** One session's automatic hand-off, as far as it got. */
export interface AutoHandoffEntry {
  readonly state: AutoHandoffState;
  /**
   * The queue entry the command became, by identity (not by text); `null`
   * before the send and when it was sent straight away.
   */
  readonly queued: QueuedCommand | null;
  /** True while that entry waits behind other queued text (held). */
  readonly held: boolean;
}

/**
 * SessionAutoHandoffService - "hand off automatically at 100%" bookkeeping.
 *
 * `SessionBudgetActionsService` is provided per chat view, so two views of the
 * same session (the main panel and a conductor tile) each run the trigger. This
 * root store holds one entry per session id, set before the send, so only the
 * first view fires and no view fires again after a cancel or a failed send.
 *
 * In memory only: a reload starts empty (the backend's handoff refusal and
 * the skill's fallback cover a second run). It holds one small entry per
 * session that reached its limit with the setting on, so it is not pruned.
 */
@Injectable({ providedIn: 'root' })
export class SessionAutoHandoffService {
  private readonly _entries = signal<ReadonlyMap<string, AutoHandoffEntry>>(
    new Map(),
  );

  /** The session's entry, or `null` when the automatic hand-off is still armed. */
  entry(sessionId: string): AutoHandoffEntry | null {
    return this._entries().get(sessionId) ?? null;
  }

  /**
   * Claim the session's one automatic hand-off. Returns false when it was
   * already claimed (fired or cancelled), so the caller must not send.
   */
  claim(sessionId: string): boolean {
    if (this._entries().has(sessionId)) return false;
    this.set(sessionId, { state: 'fired', queued: null, held: false });
    return true;
  }

  /** Record the queue entry a fired session's command became. */
  recordQueued(
    sessionId: string,
    queued: QueuedCommand | null,
    held: boolean,
  ): void {
    const current = this.entry(sessionId);
    if (current?.state !== 'fired') return;
    this.set(sessionId, { ...current, queued, held });
  }

  /** The user cancelled it: it never fires again for the session. */
  cancel(sessionId: string): void {
    const current = this.entry(sessionId);
    this.set(sessionId, {
      state: 'cancelled',
      queued: current?.queued ?? null,
      held: false,
    });
  }

  private set(sessionId: string, entry: AutoHandoffEntry): void {
    this._entries.update((entries) => new Map(entries).set(sessionId, entry));
  }
}
