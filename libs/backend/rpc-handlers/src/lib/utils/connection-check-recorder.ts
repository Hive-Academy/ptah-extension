/**
 * In-memory record of the last explicit check per connection
 * (TASK_2026_555 Batch 28c, Task 28c.2).
 *
 * One instance per host container (`registerSharedRpcHandlers`), shared by the
 * check writers (`auth:checkConnection`, `provider:testCustomEntry`) and the
 * reader (`auth:getEffectiveRoute`). Nothing is persisted and no settings key
 * exists for it: a restart forgets every record.
 *
 * Ordering: a check takes a ticket when it STARTS. Its result is kept only if
 * nothing later (a check that started later, or a {@link clear}) has already
 * been recorded, so an older check that finishes late never replaces a newer
 * result and never resurrects a cleared one.
 */

import { injectable } from 'tsyringe';
import type { ConnectionCheckRecord } from '@ptah-extension/shared';

/** Proof of when a check started; hand it back to {@link ConnectionCheckRecorder.complete}. */
export interface ConnectionCheckTicket {
  readonly providerId: string;
  readonly sequence: number;
}

@injectable()
export class ConnectionCheckRecorder {
  private sequence = 0;
  /** `record: undefined` is a tombstone left by {@link clear}. */
  private readonly records = new Map<
    string,
    {
      readonly sequence: number;
      readonly record: ConnectionCheckRecord | undefined;
    }
  >();

  /** Call when a check starts, before its first await. */
  begin(providerId: string): ConnectionCheckTicket {
    this.sequence += 1;
    return { providerId, sequence: this.sequence };
  }

  /**
   * Store a finished check. Returns `false` (and stores nothing) when a check
   * that started later, or a clear, is already recorded for the connection.
   */
  complete(
    ticket: ConnectionCheckTicket,
    record: ConnectionCheckRecord,
  ): boolean {
    const current = this.records.get(ticket.providerId);
    if (current && current.sequence > ticket.sequence) return false;
    this.records.set(ticket.providerId, { sequence: ticket.sequence, record });
    return true;
  }

  /**
   * Forget a connection's check: its key was replaced or deleted, or its entry
   * was removed or re-pointed, so the old result no longer describes it. The
   * tombstone takes a new sequence, so a check that started before this call
   * and finishes after it is not recorded.
   */
  clear(providerId: string): void {
    this.sequence += 1;
    this.records.set(providerId, {
      sequence: this.sequence,
      record: undefined,
    });
  }

  /** The last recorded check of one connection, if any. */
  get(providerId: string): ConnectionCheckRecord | undefined {
    return this.records.get(providerId)?.record;
  }
}
