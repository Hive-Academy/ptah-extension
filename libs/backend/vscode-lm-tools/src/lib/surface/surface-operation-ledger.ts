/**
 * Idempotency ledger for UI-started surface operations (plan Component 10,
 * lane findings 4 and 5). One ledger per routing id maps an operation id to
 * the fingerprint of the validated request and its outcome.
 *
 * Invariants, each pinned by `surface-operation-ledger.spec.ts`:
 *
 * - `reserve()` looks the id up FIRST. An existing record answers `replay`
 *   (same fingerprint, pending or terminal) or `conflict` (different
 *   fingerprint), whatever the id's issue time.
 * - Only an absent id is checked for expiry. It is refused `operation-expired`
 *   when its issue time lies outside `[now - retention, now + skew]`, or when
 *   the id carries no readable issue time (fail closed, Req 6.4).
 * - A terminal record is forgotten only when `now > forgetAt`, with
 *   `forgetAt = max(settledAt, issuedAt) + retention`. By then its issue time
 *   is older than `now - retention`, so the same id can never pass the
 *   absent-id expiry check again (future-dated ids included). Pending records
 *   are never forgotten.
 * - `now` is `max(clock(), lastNow)`, so a clock rollback cannot shrink the
 *   window and resurrect an old id.
 * - Capacity refuses with `too-many-operations`; no young record is ever
 *   evicted to make room. A routing ledger is dropped only when every record
 *   in it is past `forgetAt`.
 * - `lookup()` answers `unknown` for an absent id. Ledgers outlive surface
 *   eviction: nothing here is keyed to a surface's lifetime.
 *
 * Never throws; every outcome is a typed result.
 */
import { createHash } from 'node:crypto';
import type { SurfaceRejectReason } from '@ptah-extension/shared';
import {
  SURFACE_OPERATION_ID_PATTERN,
  SURFACE_STORE_LIMITS,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';

/** The UI operations that reserve an id (Revision 6 item 3: app-started mutations). */
export type SurfaceLedgerOperationKind = 'change' | 'select' | 'submit';

export type SurfaceLedgerTerminalStatus =
  'applied' | 'rejected' | 'indeterminate';

/** Defaults are `SURFACE_STORE_LIMITS`; tests override single values. */
export type SurfaceLedgerLimits = {
  readonly [
    K in
      | 'maxOperationRecordsPerRoutingId'
      | 'operationRecordBytes'
      | 'operationRetentionMs'
      | 'maxPendingOperationsPerRoutingId'
      | 'maxOperationClockSkewMs'
      | 'maxLedgerRoutingIds'
  ]: number;
};

export interface SurfaceLedgerOptions {
  readonly limits?: Partial<SurfaceLedgerLimits>;
  /** Epoch milliseconds. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

export interface SurfaceOperationRequest {
  readonly operationId: string;
  readonly kind: SurfaceLedgerOperationKind;
  readonly surfaceId: string;
  /** Creation revision of the targeted surface incarnation; null when none exists. */
  readonly incarnation: number | null;
  /** `fingerprintSurfaceOperation` of the validated request. */
  readonly fingerprint: string;
}

export interface SurfaceOperationRecord {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly kind: SurfaceLedgerOperationKind;
  readonly surfaceId: string;
  readonly incarnation: number | null;
  readonly status: 'pending' | SurfaceLedgerTerminalStatus;
  readonly reason?: SurfaceRejectReason;
  readonly detail?: string;
  readonly revision?: number;
  /** The issue time carried in the id (epoch ms). */
  readonly issuedAt: number;
  /** Ledger time at reservation. */
  readonly createdAt: number;
  readonly settledAt?: number;
  readonly forgetAt?: number;
}

/**
 * Called once, only when a NEW record would be created, with the accounting
 * charge of that record. Returning false refuses the reservation
 * `too-many-operations` (the store's byte cap, plan Component 10).
 *
 * The callback may re-enter the ledger (housekeeping, or even reservations of
 * its own). `reserve` re-checks identity and every count cap after it
 * returns, so reentrancy never breaks a ledger bound. A `true` answer is
 * taken as byte room for this one record; a callback that spends that room on
 * nested reservations is outside the store contract.
 */
export type SurfaceLedgerAdmission = (chargeBytes: number) => boolean;

export type SurfaceLedgerReservation =
  | { readonly outcome: 'reserved'; readonly record: SurfaceOperationRecord }
  | { readonly outcome: 'replay'; readonly record: SurfaceOperationRecord }
  | {
      readonly outcome: 'conflict';
      readonly reason: 'operation-conflict';
      readonly detail: string;
      readonly record: SurfaceOperationRecord;
    }
  | {
      readonly outcome: 'refused';
      readonly reason: 'operation-expired' | 'too-many-operations';
      readonly detail: string;
    };

export type SurfaceOperationSettlement =
  | { readonly status: 'applied'; readonly revision?: number }
  | {
      readonly status: 'rejected';
      readonly reason: SurfaceRejectReason;
      readonly detail: string;
      readonly revision?: number;
    }
  | {
      readonly status: 'indeterminate';
      readonly detail: string;
      readonly revision?: number;
    };

export type SurfaceLedgerSettleResult =
  | { readonly ok: true; readonly record: SurfaceOperationRecord }
  | {
      readonly ok: false;
      readonly reason: 'unknown' | 'already-settled';
      readonly record?: SurfaceOperationRecord;
    };

export type SurfaceOperationLookup =
  | { readonly status: 'unknown' }
  | {
      readonly status: SurfaceOperationRecord['status'];
      readonly record: SurfaceOperationRecord;
    };

/**
 * The issue time carried by an operation id (`op-<13 digit epoch ms>-<nonce>`),
 * or undefined when the id does not have that shape.
 */
export function surfaceOperationIssuedAt(
  operationId: string,
): number | undefined {
  if (!SURFACE_OPERATION_ID_PATTERN.test(operationId)) return undefined;
  const issuedAt = Number(operationId.slice(3, 16));
  return Number.isSafeInteger(issuedAt) ? issuedAt : undefined;
}

/**
 * Canonical JSON of a VALIDATED request: object keys sorted by code unit and
 * written as string literals (never assigned onto an object, so a
 * `__proto__` key cannot reach a prototype). Precondition: the input is
 * finite JSON data that already passed the boundary schema, so its nesting is
 * bounded. It is not an injective encoding of arbitrary JavaScript values
 * (`undefined` members are dropped, holes, non-finite numbers and non-JSON
 * values become `null`, `-0` becomes `0`); do not use it outside that domain.
 */
export function canonicalSurfaceJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'object':
      break;
    default:
      return 'null';
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    // An index loop, not `map`: `map` skips holes and would drop them.
    for (let index = 0; index < value.length; index++) {
      const item: unknown = value[index];
      items.push(
        item === undefined ||
          typeof item === 'function' ||
          typeof item === 'symbol'
          ? 'null'
          : canonicalSurfaceJson(item),
      );
    }
    return `[${items.join(',')}]`;
  }
  const members: string[] = [];
  // Code-unit order, not localeCompare: the fingerprint must not depend on locale.
  for (const key of Object.keys(value).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const member: unknown = (value as Record<string, unknown>)[key];
    if (
      member === undefined ||
      typeof member === 'function' ||
      typeof member === 'symbol'
    )
      continue;
    members.push(`${JSON.stringify(key)}:${canonicalSurfaceJson(member)}`);
  }
  return `{${members.join(',')}}`;
}

/** sha-256 (hex) over the canonical JSON of a validated request. */
export function fingerprintSurfaceOperation(request: unknown): string {
  return createHash('sha256')
    .update(canonicalSurfaceJson(request), 'utf8')
    .digest('hex');
}

export class SurfaceOperationLedger {
  private readonly limits: SurfaceLedgerLimits;
  private readonly clock: () => number;
  private readonly ledgers = new Map<
    string,
    Map<string, SurfaceOperationRecord>
  >();
  /** Epoch 0 until the first finite reading; only ever moves forward. */
  private lastNow = 0;

  constructor(options: SurfaceLedgerOptions = {}) {
    this.limits = { ...SURFACE_STORE_LIMITS, ...options.limits };
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Monotonic ledger time, `max(clock(), lastNow)`: never earlier than any
   * time it returned before. A non-finite reading is ignored.
   */
  now(): number {
    const reading = this.clock();
    if (Number.isFinite(reading) && reading > this.lastNow)
      this.lastNow = reading;
    return this.lastNow;
  }

  reserve(
    routingId: string,
    request: SurfaceOperationRequest,
    admit?: SurfaceLedgerAdmission,
  ): SurfaceLedgerReservation {
    const now = this.now();
    const ledger = this.ledgers.get(routingId);
    if (ledger !== undefined) this.sweep(ledger, now);

    // 1. Look up first: an existing record answers whatever its issue time.
    const existing = ledger?.get(request.operationId);
    if (existing !== undefined)
      return existing.fingerprint === request.fingerprint
        ? { outcome: 'replay', record: existing }
        : {
            outcome: 'conflict',
            reason: 'operation-conflict',
            detail: `Operation ${request.operationId} was already used for a different request.`,
            record: existing,
          };

    // 2. Only an absent id is checked for expiry (fail closed).
    const issuedAt = surfaceOperationIssuedAt(request.operationId);
    if (issuedAt === undefined)
      return this.refuse(
        'operation-expired',
        `Operation id ${request.operationId} carries no issue time.`,
      );
    if (issuedAt < now - this.limits.operationRetentionMs)
      return this.refuse(
        'operation-expired',
        `Operation ${request.operationId} was issued more than ${this.limits.operationRetentionMs} ms ago.`,
      );
    if (issuedAt > now + this.limits.maxOperationClockSkewMs)
      return this.refuse(
        'operation-expired',
        `Operation ${request.operationId} is issued more than ${this.limits.maxOperationClockSkewMs} ms in the future.`,
      );

    // 3. Capacity. Nothing young is evicted to make room.
    if (ledger !== undefined) {
      const full = this.routingCapacityRefusal(ledger);
      if (full !== undefined) return full;
    } else if (!this.makeRoomForLedger(now)) {
      return this.refuse(
        'too-many-operations',
        `Operation ledgers are full (${this.limits.maxLedgerRoutingIds} conversations hold recent operations).`,
      );
    }
    if (admit !== undefined && !admit(this.limits.operationRecordBytes))
      return this.refuse(
        'too-many-operations',
        'The surface store has no room to record another operation.',
      );

    // The admission callback re-enters ledger housekeeping (the store reads
    // `chargedBytes()`, which drops ledgers emptied by a sweep), so the Map
    // read above may no longer be registered. Publish into the Map that is
    // registered NOW, never into a reference held across the callback.
    // A callback may also reserve operations of its own (in this routing id or
    // another), so every check made before admission is made again against
    // the current state: identity (replay/conflict), the per-routing record
    // and pending caps, and the routing-id cap. Each refusal returns before
    // any write, exactly like the refusals above.
    let target = this.ledgers.get(routingId);
    const raced = target?.get(request.operationId);
    if (raced !== undefined)
      return raced.fingerprint === request.fingerprint
        ? { outcome: 'replay', record: raced }
        : {
            outcome: 'conflict',
            reason: 'operation-conflict',
            detail: `Operation ${request.operationId} was already used for a different request.`,
            record: raced,
          };
    if (target !== undefined) {
      const full = this.routingCapacityRefusal(target);
      if (full !== undefined) return full;
    } else if (this.ledgers.size >= this.limits.maxLedgerRoutingIds) {
      return this.refuse(
        'too-many-operations',
        `Operation ledgers are full (${this.limits.maxLedgerRoutingIds} conversations hold recent operations).`,
      );
    } else {
      target = new Map<string, SurfaceOperationRecord>();
      this.ledgers.set(routingId, target);
    }

    const record: SurfaceOperationRecord = {
      operationId: request.operationId,
      fingerprint: request.fingerprint,
      kind: request.kind,
      surfaceId: request.surfaceId,
      incarnation: request.incarnation,
      status: 'pending',
      issuedAt,
      createdAt: now,
    };
    target.set(record.operationId, record);
    return { outcome: 'reserved', record };
  }

  /** Settle a pending record once. A settled record is never rewritten. */
  settle(
    routingId: string,
    operationId: string,
    settlement: SurfaceOperationSettlement,
  ): SurfaceLedgerSettleResult {
    const now = this.now();
    const ledger = this.ledgers.get(routingId);
    const existing = ledger?.get(operationId);
    if (ledger === undefined || existing === undefined)
      return { ok: false, reason: 'unknown' };
    if (existing.status !== 'pending')
      return { ok: false, reason: 'already-settled', record: existing };
    const record: SurfaceOperationRecord = {
      ...existing,
      status: settlement.status,
      ...(settlement.status === 'applied'
        ? {}
        : settlement.status === 'rejected'
          ? { reason: settlement.reason, detail: settlement.detail }
          : { detail: settlement.detail }),
      ...(settlement.revision === undefined
        ? {}
        : { revision: settlement.revision }),
      settledAt: now,
      forgetAt:
        Math.max(now, existing.issuedAt) + this.limits.operationRetentionMs,
    };
    ledger.set(operationId, record);
    return { ok: true, record };
  }

  lookup(routingId: string, operationId: string): SurfaceOperationLookup {
    const ledger = this.ledgers.get(routingId);
    if (ledger === undefined) return { status: 'unknown' };
    this.sweep(ledger, this.now());
    const record = ledger.get(operationId);
    return record === undefined
      ? { status: 'unknown' }
      : { status: record.status, record };
  }

  /** Pending records of one routing id, optionally of one kind (the busy rule). */
  pendingCount(routingId: string, kind?: SurfaceLedgerOperationKind): number {
    const ledger = this.ledgers.get(routingId);
    return ledger === undefined ? 0 : countPending(ledger, kind);
  }

  /**
   * The accounting charge of every record not yet forgotten
   * (`operationRecordBytes` each). The store adds it to its byte total.
   */
  chargedBytes(): number {
    const now = this.now();
    let records = 0;
    for (const [routingId, ledger] of this.ledgers) {
      this.sweep(ledger, now);
      if (ledger.size === 0) this.ledgers.delete(routingId);
      else records += ledger.size;
    }
    return records * this.limits.operationRecordBytes;
  }

  /** Routing ids holding at least one unforgotten record. */
  routingIdCount(): number {
    this.chargedBytes();
    return this.ledgers.size;
  }

  private refuse(
    reason: 'operation-expired' | 'too-many-operations',
    detail: string,
  ): SurfaceLedgerReservation {
    return { outcome: 'refused', reason, detail };
  }

  /** The per-routing record and pending caps; undefined when there is room. */
  private routingCapacityRefusal(
    ledger: ReadonlyMap<string, SurfaceOperationRecord>,
  ): SurfaceLedgerReservation | undefined {
    if (ledger.size >= this.limits.maxOperationRecordsPerRoutingId)
      return this.refuse(
        'too-many-operations',
        `This conversation already holds ${ledger.size} recent operations.`,
      );
    const pending = countPending(ledger);
    if (pending >= this.limits.maxPendingOperationsPerRoutingId)
      return this.refuse(
        'too-many-operations',
        `This conversation already has ${pending} operations in progress.`,
      );
    return undefined;
  }

  /** Forget terminal records strictly past `forgetAt`. Pending records stay. */
  private sweep(
    ledger: Map<string, SurfaceOperationRecord>,
    now: number,
  ): void {
    for (const [operationId, record] of ledger)
      if (record.forgetAt !== undefined && now > record.forgetAt)
        ledger.delete(operationId);
  }

  /**
   * Room for one more routing ledger. Only a ledger whose every record is past
   * `forgetAt` (so empty after a sweep) is dropped.
   */
  private makeRoomForLedger(now: number): boolean {
    if (this.ledgers.size < this.limits.maxLedgerRoutingIds) return true;
    for (const [routingId, ledger] of this.ledgers) {
      this.sweep(ledger, now);
      if (ledger.size === 0) this.ledgers.delete(routingId);
    }
    return this.ledgers.size < this.limits.maxLedgerRoutingIds;
  }
}

function countPending(
  ledger: ReadonlyMap<string, SurfaceOperationRecord>,
  kind?: SurfaceLedgerOperationKind,
): number {
  let pending = 0;
  for (const record of ledger.values())
    if (
      record.status === 'pending' &&
      (kind === undefined || record.kind === kind)
    )
      pending++;
  return pending;
}
