/**
 * The single authoritative, bounded host copy of every surface, keyed by
 * routing id (plan Component 10). Pure storage: it validates nothing and
 * pushes nothing. The facade (Batch 10) runs the conflict check, applies ops,
 * re-validates, then swaps the record in here with `commit` and pushes the
 * evictions this store reports.
 *
 * Recency: every read (`get`, `list`) and every write (`commit`) touches the
 * surface and its routing id.
 *
 * Eviction order after a commit (the committed record is never evicted):
 * 1. the least-recently-used surface of the committing routing id while it
 *    holds more than `maxSurfacesPerRoutingId`;
 * 2. the least-recently-used routing id (all of its surfaces) while more than
 *    `maxRoutingIds` routing ids hold surfaces;
 * 3. the globally least-recently-used surfaces while the accounted bytes
 *    exceed `maxStoreBytes`.
 * Every eviction is returned as a `(routingId, surfaceId)` pair so the caller
 * can push `{ kind: 'deleted', reason: 'evicted' }`.
 *
 * Byte accounting: JSON UTF-8 bytes of each record's content (which carries
 * the data model), selection, last submit and write log; plus the charge of
 * every unforgotten ledger record (`operationRecordBytes` each, read from the
 * charge source); plus every pending submit ticket (frozen values and the
 * formatted message), reserved before dispatch and released at settlement.
 * Ledger charges and tickets are never evicted; only surfaces are. A commit or
 * a reservation that could not fit even after evicting every evictable
 * surface is refused before anything changes.
 *
 * Worst-case memory: at most `maxStoreBytes` (24 MiB) of accounted JSON. That
 * figure already includes the ledger charges (at most `maxLedgerRoutingIds`
 * 64 x `maxOperationRecordsPerRoutingId` 128 x 1 KiB = 8 MiB) and the pending
 * tickets (at most one pending submit per routing id by the busy rule, each at
 * most 2 x `maxSubmitMessageBytes` = 64 KiB, so at most 4 MiB across 64 routing
 * ids). Surfaces alone could reach 32 x 8 x ~256 KiB = ~64 MiB, so the byte cap
 * is the binding limit. JS heap overhead is estimated at 2-3x the accounted
 * bytes, about 48-72 MiB in the worst case.
 *
 * `highWaterRevision` is the largest revision ever committed in this store. It
 * never goes down (deletes and evictions keep it), so a surface created at
 * `highWaterRevision + 1` sits above every revision of any older incarnation.
 */
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type {
  SurfaceContent,
  SurfaceSelection,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared';
import {
  SURFACE_STORE_LIMITS,
  createSurfaceWriteLog,
  type SurfaceWriteLog,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

export interface SurfaceRecord {
  readonly surfaceId: string;
  /** The revision the surface was created at; identifies this incarnation. */
  readonly incarnation: number;
  readonly revision: number;
  readonly content: SurfaceContent;
  readonly selection: SurfaceSelection | null;
  readonly lastSubmit: SurfaceSubmitRecord | null;
  readonly writeLog: SurfaceWriteLog;
}

export interface SurfaceStorePair {
  readonly routingId: string;
  readonly surfaceId: string;
}

/** Defaults are `SURFACE_STORE_LIMITS`; tests override single values. */
export type SurfaceStoreLimits = {
  readonly [
    K in 'maxRoutingIds' | 'maxSurfacesPerRoutingId' | 'maxStoreBytes'
  ]: number;
};

/** Non-evictable accounted bytes held elsewhere (the operation ledger). */
export interface SurfaceStoreChargeSource {
  chargedBytes(): number;
}

export interface SurfaceStateStoreOptions {
  readonly limits?: Partial<SurfaceStoreLimits>;
  readonly charges?: SurfaceStoreChargeSource;
  readonly countBytes?: (value: unknown) => number;
}

export type SurfaceStoreCommitResult =
  | {
      readonly ok: true;
      readonly bytes: number;
      readonly evicted: readonly SurfaceStorePair[];
    }
  | { readonly ok: false; readonly reason: 'budget'; readonly detail: string };

export type SurfaceStoreRoomResult =
  | { readonly ok: true; readonly evicted: readonly SurfaceStorePair[] }
  | {
      readonly ok: false;
      readonly reason: 'too-many-operations';
      readonly detail: string;
    };

export interface SurfaceStoreUsage {
  readonly routingIds: number;
  readonly surfaces: number;
  readonly surfaceBytes: number;
  readonly ticketBytes: number;
  readonly chargedBytes: number;
  readonly totalBytes: number;
}

/** A fresh record for a new incarnation created at `revision`. */
export function createSurfaceRecord(
  surfaceId: string,
  content: SurfaceContent,
  revision: number,
): SurfaceRecord {
  return {
    surfaceId,
    incarnation: revision,
    revision,
    content,
    selection: null,
    lastSubmit: null,
    writeLog: createSurfaceWriteLog(revision),
  };
}

interface StoredSurface {
  record: SurfaceRecord;
  bytes: number;
  touchedAt: number;
}

interface RoutingEntry {
  readonly surfaces: Map<string, StoredSurface>;
  touchedAt: number;
}

const NO_CHARGES: SurfaceStoreChargeSource = { chargedBytes: () => 0 };

export class SurfaceStateStore {
  private readonly limits: SurfaceStoreLimits;
  private readonly charges: SurfaceStoreChargeSource;
  private readonly countBytes: (value: unknown) => number;
  private readonly routing = new Map<string, RoutingEntry>();
  private readonly tickets = new Map<string, number>();
  private surfaceBytes = 0;
  private ticketBytes = 0;
  private tick = 0;
  private highWater = 0;

  constructor(options: SurfaceStateStoreOptions = {}) {
    this.limits = { ...SURFACE_STORE_LIMITS, ...options.limits };
    this.charges = options.charges ?? NO_CHARGES;
    this.countBytes = options.countBytes ?? jsonUtf8Bytes;
  }

  get highWaterRevision(): number {
    return this.highWater;
  }

  /** The record, touching it and its routing id. Undefined when absent. */
  get(routingId: string, surfaceId: string): SurfaceRecord | undefined {
    const entry = this.routing.get(routingId);
    const stored = entry?.surfaces.get(surfaceId);
    if (entry === undefined || stored === undefined) return undefined;
    const tick = this.nextTick();
    entry.touchedAt = tick;
    stored.touchedAt = tick;
    return stored.record;
  }

  /** Every record of one routing id, sorted by surface id; each is touched. */
  list(routingId: string): readonly SurfaceRecord[] {
    const entry = this.routing.get(routingId);
    if (entry === undefined) return [];
    const tick = this.nextTick();
    entry.touchedAt = tick;
    const stored = [...entry.surfaces.values()].sort((a, b) =>
      compareIds(a.record.surfaceId, b.record.surfaceId),
    );
    for (const surface of stored) surface.touchedAt = tick;
    return stored.map((surface) => surface.record);
  }

  /**
   * Insert or replace a record, then evict in the documented order. Refused
   * with `budget`, changing nothing, when the record plus the non-evictable
   * bytes cannot fit under `maxStoreBytes`.
   */
  commit(routingId: string, record: SurfaceRecord): SurfaceStoreCommitResult {
    const bytes = this.recordBytes(record);
    const fixed = this.ticketBytes + this.charges.chargedBytes();
    if (bytes + fixed > this.limits.maxStoreBytes)
      return {
        ok: false,
        reason: 'budget',
        detail: `Surface ${record.surfaceId} needs ${bytes} bytes; the surface store holds at most ${this.limits.maxStoreBytes} bytes and ${fixed} are reserved.`,
      };
    const tick = this.nextTick();
    let entry = this.routing.get(routingId);
    if (entry === undefined) {
      entry = { surfaces: new Map(), touchedAt: tick };
      this.routing.set(routingId, entry);
    }
    entry.touchedAt = tick;
    const previous = entry.surfaces.get(record.surfaceId);
    if (previous !== undefined) this.surfaceBytes -= previous.bytes;
    entry.surfaces.set(record.surfaceId, { record, bytes, touchedAt: tick });
    this.surfaceBytes += bytes;
    this.highWater = Math.max(this.highWater, record.revision);

    const protect: SurfaceStorePair = {
      routingId,
      surfaceId: record.surfaceId,
    };
    const evicted: SurfaceStorePair[] = [];
    while (entry.surfaces.size > this.limits.maxSurfacesPerRoutingId) {
      const victim = this.lruSurface(protect, routingId);
      if (victim === undefined) break;
      evicted.push(this.evict(victim));
    }
    while (this.routing.size > this.limits.maxRoutingIds) {
      const victim = this.lruRouting(routingId);
      if (victim === undefined) break;
      evicted.push(...this.evictRouting(victim));
    }
    evicted.push(...this.shrinkTo(0, protect));
    return { ok: true, bytes, evicted };
  }

  /** Remove one surface (agent delete). Returns the removed record. */
  delete(routingId: string, surfaceId: string): SurfaceRecord | undefined {
    const entry = this.routing.get(routingId);
    const stored = entry?.surfaces.get(surfaceId);
    if (entry === undefined || stored === undefined) return undefined;
    entry.touchedAt = this.nextTick();
    this.remove({ routingId, surfaceId });
    return stored.record;
  }

  /**
   * Make room for `bytes` more non-evictable bytes (a ledger record), evicting
   * least-recently-used surfaces other than `protect`. Refused, changing
   * nothing, when even evicting every evictable surface would not be enough.
   */
  makeRoom(bytes: number, protect?: SurfaceStorePair): SurfaceStoreRoomResult {
    const protectedBytes =
      protect === undefined
        ? 0
        : (this.routing.get(protect.routingId)?.surfaces.get(protect.surfaceId)
            ?.bytes ?? 0);
    const fixed = this.ticketBytes + this.charges.chargedBytes();
    if (
      !(bytes >= 0) ||
      fixed + protectedBytes + bytes > this.limits.maxStoreBytes
    )
      return {
        ok: false,
        reason: 'too-many-operations',
        detail: `The surface store cannot reserve ${bytes} more bytes under its ${this.limits.maxStoreBytes}-byte cap.`,
      };
    return { ok: true, evicted: this.shrinkTo(bytes, protect) };
  }

  /**
   * Reserve the bytes of one pending submit ticket before dispatch. One ticket
   * per `(routingId, operationId)`; a second reservation for the same key is
   * refused. Released by `releaseTicket` at settlement.
   */
  reserveTicket(
    routingId: string,
    operationId: string,
    bytes: number,
    protect?: SurfaceStorePair,
  ): SurfaceStoreRoomResult {
    const key = ticketKey(routingId, operationId);
    if (this.tickets.has(key))
      return {
        ok: false,
        reason: 'too-many-operations',
        detail: `Operation ${operationId} already holds a submit reservation.`,
      };
    const room = this.makeRoom(bytes, protect);
    if (!room.ok) return room;
    this.tickets.set(key, bytes);
    this.ticketBytes += bytes;
    return room;
  }

  /** Release a ticket reservation. False when none was held. */
  releaseTicket(routingId: string, operationId: string): boolean {
    const key = ticketKey(routingId, operationId);
    const bytes = this.tickets.get(key);
    if (bytes === undefined) return false;
    this.tickets.delete(key);
    this.ticketBytes -= bytes;
    return true;
  }

  /** Accounting snapshot. Does not touch recency. */
  usage(): SurfaceStoreUsage {
    const chargedBytes = this.charges.chargedBytes();
    let surfaces = 0;
    for (const entry of this.routing.values()) surfaces += entry.surfaces.size;
    return {
      routingIds: this.routing.size,
      surfaces,
      surfaceBytes: this.surfaceBytes,
      ticketBytes: this.ticketBytes,
      chargedBytes,
      totalBytes: this.surfaceBytes + this.ticketBytes + chargedBytes,
    };
  }

  private recordBytes(record: SurfaceRecord): number {
    return (
      this.countBytes(record.content) +
      this.countBytes(record.selection) +
      this.countBytes(record.lastSubmit) +
      this.countBytes(record.writeLog)
    );
  }

  /** Evict global LRU surfaces (not `protect`) until `extra` more bytes fit. */
  private shrinkTo(
    extra: number,
    protect?: SurfaceStorePair,
  ): SurfaceStorePair[] {
    const evicted: SurfaceStorePair[] = [];
    while (this.totalBytes() + extra > this.limits.maxStoreBytes) {
      const victim = this.lruSurface(protect);
      if (victim === undefined) break;
      evicted.push(this.evict(victim));
    }
    return evicted;
  }

  private totalBytes(): number {
    return this.surfaceBytes + this.ticketBytes + this.charges.chargedBytes();
  }

  private lruSurface(
    protect: SurfaceStorePair | undefined,
    onlyRoutingId?: string,
  ): SurfaceStorePair | undefined {
    let best: { pair: SurfaceStorePair; touchedAt: number } | undefined;
    for (const [routingId, entry] of this.routing) {
      if (onlyRoutingId !== undefined && routingId !== onlyRoutingId) continue;
      for (const [surfaceId, stored] of entry.surfaces) {
        if (
          protect !== undefined &&
          protect.routingId === routingId &&
          protect.surfaceId === surfaceId
        )
          continue;
        if (best === undefined || stored.touchedAt < best.touchedAt)
          best = {
            pair: { routingId, surfaceId },
            touchedAt: stored.touchedAt,
          };
      }
    }
    return best?.pair;
  }

  private lruRouting(except: string): string | undefined {
    let best: { routingId: string; touchedAt: number } | undefined;
    for (const [routingId, entry] of this.routing) {
      if (routingId === except) continue;
      if (best === undefined || entry.touchedAt < best.touchedAt)
        best = { routingId, touchedAt: entry.touchedAt };
    }
    return best?.routingId;
  }

  private evictRouting(routingId: string): SurfaceStorePair[] {
    const entry = this.routing.get(routingId);
    if (entry === undefined) return [];
    const pairs = [...entry.surfaces.keys()]
      .sort(compareIds)
      .map((surfaceId) => ({ routingId, surfaceId }));
    for (const pair of pairs) this.remove(pair);
    return pairs;
  }

  private evict(pair: SurfaceStorePair): SurfaceStorePair {
    this.remove(pair);
    return pair;
  }

  /** Drop one surface; a routing id without surfaces is dropped too. */
  private remove(pair: SurfaceStorePair): void {
    const entry = this.routing.get(pair.routingId);
    const stored = entry?.surfaces.get(pair.surfaceId);
    if (entry === undefined || stored === undefined) return;
    entry.surfaces.delete(pair.surfaceId);
    this.surfaceBytes -= stored.bytes;
    if (entry.surfaces.size === 0) this.routing.delete(pair.routingId);
  }

  private nextTick(): number {
    this.tick += 1;
    return this.tick;
  }
}

function ticketKey(routingId: string, operationId: string): string {
  return JSON.stringify([routingId, operationId]);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
