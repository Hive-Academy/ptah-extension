/**
 * In-memory link between parent chat sessions and the child sessions they
 * started (TASK_2026_584).
 *
 * One instance per host, lifetime = process. Records are plain serialisable
 * objects so TASK_2026_580 can persist them without a shape change; nothing
 * here touches SQLite or the filesystem.
 *
 * Records are never mutated in place: every change replaces the record, so a
 * caller holding an older reference never observes a half-applied update.
 */
import { resolve } from 'path';
import { injectable } from 'tsyringe';
import type {
  SessionChildCompletionEnvelope,
  SessionChildSnapshot,
  SessionChildTerminalStatus,
} from './session-spawner.port';

/** Ended records kept for `ptah_session_status`; older ones are pruned. */
export const SESSION_CHILD_ENDED_HISTORY_SIZE = 20;

/** A completion the parent has not yet received (it was not live at settle time). */
export interface SessionChildHeldCompletion {
  readonly heldSince: string;
  readonly envelope: SessionChildCompletionEnvelope;
}

/**
 * The stored form of a child. The snapshot's `status` is derived by the
 * spawner at read time; only the terminal status is stored.
 */
export interface SessionChildRecord extends Omit<
  SessionChildSnapshot,
  'status' | 'heldCompletion'
> {
  /** The task as given to `ptah_session_start` (without the contract). */
  readonly task: string;
  /** Set once by {@link SessionChildRegistry.markEnded}; never cleared. */
  readonly terminalStatus?: SessionChildTerminalStatus;
  readonly heldCompletion?: SessionChildHeldCompletion;
}

/** Fields a caller may change. Identity, link and end state are not among them. */
type MutableRecordFields = Omit<
  SessionChildRecord,
  | 'childSessionId'
  | 'parentSessionId'
  | 'startedAt'
  | 'terminalStatus'
  | 'endedAt'
  | 'endReason'
>;

/**
 * A patch for {@link SessionChildRegistry.update}. A key present with the
 * value `undefined` CLEARS that optional field (e.g. `pendingPermission`).
 */
export type SessionChildRecordPatch = {
  readonly [K in keyof MutableRecordFields]?:
    MutableRecordFields[K] | undefined;
};

/** An outstanding claim on one concurrency slot, taken before a child exists. */
export interface SessionChildReservation {
  readonly id: number;
}

/** Path key for cwd lookups: resolved, no trailing separator, case-folded on Windows. */
function pathKey(path: string): string {
  const resolved = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

@injectable()
export class SessionChildRegistry {
  /** Keyed by child tab id (`childSessionId`). Insertion order = start order. */
  private readonly records = new Map<string, SessionChildRecord>();
  /** SDK session id → child tab id. */
  private readonly bySdkId = new Map<string, string>();
  /** Reservations taken by `reserveSlot` and not yet consumed or released. */
  private readonly reservations = new Set<number>();
  private nextReservationId = 1;
  /** Child ids in the order they ended, for pruning. */
  private readonly endedOrder: string[] = [];

  /**
   * Claim one slot synchronously, or `null` when `max` is already taken by
   * live children plus outstanding reservations. Synchronous on purpose: two
   * concurrent starts both run their guard before either awaits, so the
   * second one sees the first one's reservation.
   */
  reserveSlot(max: number): SessionChildReservation | null {
    if (this.liveCount() + this.reservations.size >= max) return null;
    const id = this.nextReservationId++;
    this.reservations.add(id);
    return { id };
  }

  /** Give back a reservation that did not become a child. Idempotent. */
  release(reservation: SessionChildReservation): void {
    this.reservations.delete(reservation.id);
  }

  /**
   * Store a new child, consuming its reservation. Throws on a reservation that
   * is not outstanding or an id already in use: both are spawner bugs, and
   * silently accepting either would break the cap.
   */
  add(
    record: SessionChildRecord,
    reservation: SessionChildReservation,
  ): SessionChildRecord {
    if (!this.reservations.has(reservation.id)) {
      throw new Error(
        `SessionChildRegistry.add: reservation ${reservation.id} is not outstanding`,
      );
    }
    if (this.records.has(record.childSessionId)) {
      throw new Error(
        `SessionChildRegistry.add: child ${record.childSessionId} already exists`,
      );
    }
    this.reservations.delete(reservation.id);
    const stored: SessionChildRecord = { ...record };
    this.records.set(stored.childSessionId, stored);
    if (stored.sdkSessionId) {
      this.bySdkId.set(stored.sdkSessionId, stored.childSessionId);
    }
    if (stored.terminalStatus) this.endedOrder.push(stored.childSessionId);
    return stored;
  }

  /** Remove a child entirely (start rollback). Returns whether it existed. */
  remove(childSessionId: string): boolean {
    const record = this.records.get(childSessionId);
    if (!record) return false;
    this.records.delete(childSessionId);
    if (record.sdkSessionId) this.bySdkId.delete(record.sdkSessionId);
    const index = this.endedOrder.indexOf(childSessionId);
    if (index >= 0) this.endedOrder.splice(index, 1);
    return true;
  }

  /** Look a child up by its tab id or its SDK session id. */
  get(id: string | undefined): SessionChildRecord | undefined {
    const key = id?.trim();
    if (!key) return undefined;
    const direct = this.records.get(key);
    if (direct) return direct;
    const tabId = this.bySdkId.get(key);
    return tabId ? this.records.get(tabId) : undefined;
  }

  /**
   * The child whose worktree is `path`, preferring a live one. Used when a
   * turn event arrives before the SDK id was bound.
   */
  findByCwd(path: string | undefined): SessionChildRecord | undefined {
    if (!path?.trim()) return undefined;
    const key = pathKey(path);
    let ended: SessionChildRecord | undefined;
    for (const record of this.records.values()) {
      if (pathKey(record.worktreePath) !== key) continue;
      if (!record.terminalStatus) return record;
      ended = record;
    }
    return ended;
  }

  /**
   * True when `id` belongs to any recorded child, live OR ended. This is the
   * depth guard (depth 1: children cannot start children), and a child the
   * user resumes from its tab after it ended is still a child. Use
   * {@link live} where liveness matters. A child pruned from the ended
   * history is no longer known here (see {@link pruneEnded}).
   */
  isChild(id: string | undefined): boolean {
    return this.get(id) !== undefined;
  }

  /** Every child (live or ended) whose recorded parent tab id or SDK id is in `parentIds`. */
  childrenOf(
    parentIds: readonly (string | undefined)[],
  ): readonly SessionChildRecord[] {
    const ids = new Set(
      parentIds.map((id) => id?.trim()).filter((id): id is string => !!id),
    );
    if (ids.size === 0) return [];
    return [...this.records.values()].filter(
      (record) =>
        ids.has(record.parentSessionId) ||
        (!!record.parentSdkSessionId && ids.has(record.parentSdkSessionId)),
    );
  }

  /** Every child not yet ended, in start order. */
  live(): readonly SessionChildRecord[] {
    return [...this.records.values()].filter((r) => !r.terminalStatus);
  }

  /** Record the child's SDK session id once the SDK resolved it. */
  bindSdkSessionId(
    childSessionId: string,
    sdkSessionId: string,
  ): SessionChildRecord | undefined {
    const record = this.records.get(childSessionId);
    const sdkId = sdkSessionId.trim();
    if (!record || !sdkId) return undefined;
    if (record.sdkSessionId === sdkId) return record;
    if (record.sdkSessionId) this.bySdkId.delete(record.sdkSessionId);
    this.bySdkId.set(sdkId, childSessionId);
    return this.replace({ ...record, sdkSessionId: sdkId });
  }

  markReportDelivered(childSessionId: string): SessionChildRecord | undefined {
    const record = this.records.get(childSessionId);
    if (!record) return undefined;
    return this.replace({
      ...record,
      reportsDelivered: record.reportsDelivered + 1,
    });
  }

  /** A report refused because the parent was not live: counted, never queued. */
  markReportRefused(
    childSessionId: string,
    summary: string,
  ): SessionChildRecord | undefined {
    const record = this.records.get(childSessionId);
    if (!record) return undefined;
    return this.replace({
      ...record,
      reportsRefused: record.reportsRefused + 1,
      lastRefusedReport: summary,
    });
  }

  /** Apply a patch; a key set to `undefined` clears that field. */
  update(
    childSessionId: string,
    patch: SessionChildRecordPatch,
  ): SessionChildRecord | undefined {
    const record = this.records.get(childSessionId);
    if (!record) return undefined;
    const next: Record<string, unknown> = { ...record };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    const updated = next as unknown as SessionChildRecord;
    if (updated.sdkSessionId !== record.sdkSessionId) {
      if (record.sdkSessionId) this.bySdkId.delete(record.sdkSessionId);
      if (updated.sdkSessionId) {
        this.bySdkId.set(updated.sdkSessionId, childSessionId);
      }
    }
    return this.replace(updated);
  }

  /**
   * End a child. Idempotent: the first terminal status and reason win, so a
   * stop followed by the session-end callback keeps the stop's reason. Prunes
   * the ended history to {@link SESSION_CHILD_ENDED_HISTORY_SIZE}.
   */
  markEnded(
    childSessionId: string,
    status: SessionChildTerminalStatus,
    reason: string,
    endedAt: string = new Date().toISOString(),
  ): SessionChildRecord | undefined {
    const record = this.records.get(childSessionId);
    if (!record) return undefined;
    if (record.terminalStatus) return record;
    // An ended child is waiting on nothing: its prompt died with it.
    const next: SessionChildRecord = {
      ...record,
      terminalStatus: status,
      endedAt,
      endReason: reason,
    };
    delete (next as { pendingPermission?: unknown }).pendingPermission;
    const ended = this.replace(next);
    this.endedOrder.push(childSessionId);
    this.pruneEnded();
    return ended;
  }

  /**
   * Drop the oldest ended records beyond `keep`. Live records are never pruned.
   *
   * The bound exists to cap memory in a long-lived host. Its consequence: a
   * pruned ended child is treated exactly like a child after a host restart
   * (implementation-plan.md, "State or persistence") — its reports are no
   * longer attributed (`unattributed-caller`) and, if the user resumes it from
   * its tab, it is no longer depth-guarded by {@link isChild}. TASK_2026_580's
   * durable link removes that gap.
   */
  pruneEnded(keep: number = SESSION_CHILD_ENDED_HISTORY_SIZE): void {
    const excess = this.endedOrder.length - Math.max(keep, 0);
    if (excess <= 0) return;
    for (const id of this.endedOrder.splice(0, excess)) {
      const record = this.records.get(id);
      if (!record) continue;
      this.records.delete(id);
      if (record.sdkSessionId) this.bySdkId.delete(record.sdkSessionId);
    }
  }

  /** Children not yet ended. Reservations are not counted. */
  liveCount(): number {
    let count = 0;
    for (const record of this.records.values()) {
      if (!record.terminalStatus) count++;
    }
    return count;
  }

  private replace(record: SessionChildRecord): SessionChildRecord {
    this.records.set(record.childSessionId, record);
    return record;
  }
}
