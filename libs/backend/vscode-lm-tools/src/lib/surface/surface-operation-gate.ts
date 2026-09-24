/**
 * The operation-id side of every UI mutation (Req 6.4, 6.5): reserve the id
 * before any side effect, answer replays and conflicts from the record, and
 * settle it. A thin layer over `SurfaceOperationLedger`, used only by
 * `SurfaceStateService`.
 *
 * The ledger's byte-admission callback is answered with the store's
 * `makeRoom`, exactly as its contract says: `true` is byte room for that one
 * record, protecting the targeted surface. The gate never pushes. It RETURNS
 * the surfaces `makeRoom` evicted, and the facade pushes them from its single
 * push site. Never throws.
 */
import type {
  SurfaceOperationStatus,
  SurfaceRejectReason,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SurfaceOperationLedger,
  SurfaceOperationRequest,
} from './surface-operation-ledger';
import type {
  SurfaceStateStore,
  SurfaceStorePair,
} from './surface-state.store';
import {
  outcomeFromRecord,
  type SurfaceMutationOutcome,
  type SurfaceUiRejection,
} from './surface-ui-mutations';

/** `operationStatus` (Req 6.5). `unknown`: never received, or forgotten. */
export interface SurfaceOperationStatusResult {
  readonly status: SurfaceOperationStatus;
  readonly reason?: SurfaceRejectReason;
  readonly detail?: string;
  readonly revision?: number;
}

export interface SurfaceReservation {
  /** Surfaces `makeRoom` evicted; the caller pushes them. */
  readonly evicted: readonly SurfaceStorePair[];
  /** Set when there is nothing to do: a replay, a conflict or a refusal. */
  readonly outcome?: SurfaceMutationOutcome;
}

export class SurfaceOperationGate {
  constructor(
    private readonly ledger: SurfaceOperationLedger,
    private readonly store: Pick<SurfaceStateStore, 'makeRoom'>,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  /** Reserve `request` for `routingId` before any side effect. */
  reserve(
    routingId: string,
    request: SurfaceOperationRequest,
    protect: SurfaceStorePair,
  ): SurfaceReservation {
    const evicted: SurfaceStorePair[] = [];
    const reservation = this.ledger.reserve(routingId, request, (charge) => {
      const room = this.store.makeRoom(charge, protect);
      if (room.ok) evicted.push(...room.evicted);
      return room.ok;
    });
    const operationId = request.operationId;
    switch (reservation.outcome) {
      case 'reserved':
        return { evicted };
      case 'replay':
        return { evicted, outcome: outcomeFromRecord(reservation.record) };
      case 'conflict':
        return {
          evicted,
          outcome: {
            status: 'rejected',
            operationId,
            reason: reservation.reason,
            detail: reservation.detail,
          },
        };
      default:
        this.logger.warn('[Surface] operation refused', {
          routingId,
          operationId,
          reason: reservation.reason,
        });
        return {
          evicted,
          outcome: {
            status: 'rejected',
            operationId,
            reason: reservation.reason,
            detail: reservation.detail,
          },
        };
    }
  }

  /**
   * Reserve `request` on the surface `record` the caller read, or, when the
   * surface is absent, answer through `absent`. Either way `outcome` is set
   * when there is nothing to do.
   */
  reserveOn(
    routingId: string,
    record:
      { readonly surfaceId: string; readonly incarnation: number } | undefined,
    request: Pick<
      SurfaceOperationRequest,
      'operationId' | 'kind' | 'fingerprint'
    >,
  ): SurfaceReservation {
    if (record === undefined)
      return {
        evicted: [],
        outcome: this.absent(
          routingId,
          request.operationId,
          request.fingerprint,
        ),
      };
    return this.reserve(
      routingId,
      {
        ...request,
        surfaceId: record.surfaceId,
        incarnation: record.incarnation,
      },
      { routingId, surfaceId: record.surfaceId },
    );
  }

  /**
   * The surface is absent under this routing id (never created, deleted,
   * evicted, or owned by another routing id). A retry of an operation that
   * was recorded still answers with its record; anything else is the same
   * `not-found`, with no revision, and nothing is reserved (Req 6.3, 9.6).
   */
  absent(
    routingId: string,
    operationId: string,
    fingerprint: string,
  ): SurfaceMutationOutcome {
    const lookup = this.ledger.lookup(routingId, operationId);
    if (lookup.status === 'unknown')
      return { status: 'not-found', operationId };
    return lookup.record.fingerprint === fingerprint
      ? outcomeFromRecord(lookup.record)
      : {
          status: 'rejected',
          operationId,
          reason: 'operation-conflict',
          detail: `Operation ${operationId} was already used for a different request.`,
        };
  }

  /** Settle a reserved operation as rejected; nothing else changes. */
  reject(
    routingId: string,
    operationId: string,
    rejection: SurfaceUiRejection,
  ): SurfaceMutationOutcome {
    this.ledger.settle(routingId, operationId, {
      status: 'rejected',
      reason: rejection.reason,
      detail: rejection.detail,
      ...(rejection.currentRevision === undefined
        ? {}
        : { revision: rejection.currentRevision }),
    });
    this.logger.warn('[Surface] UI operation rejected', {
      routingId,
      operationId,
      reason: rejection.reason,
    });
    return {
      status: 'rejected',
      operationId,
      reason: rejection.reason,
      detail: rejection.detail,
      ...(rejection.currentRevision === undefined
        ? {}
        : { currentRevision: rejection.currentRevision }),
      ...(rejection.issues === undefined ? {} : { issues: rejection.issues }),
    };
  }

  /** Settle a reserved operation as applied at `revision`. */
  apply(
    routingId: string,
    operationId: string,
    revision: number,
  ): SurfaceMutationOutcome {
    this.ledger.settle(routingId, operationId, { status: 'applied', revision });
    return { status: 'applied', operationId, revision };
  }

  /** The outcome of a UI operation id (Req 6.5). */
  status(routingId: string, operationId: string): SurfaceOperationStatusResult {
    const lookup = this.ledger.lookup(routingId, operationId);
    if (lookup.status === 'unknown') return { status: 'unknown' };
    const record = lookup.record;
    return {
      status: record.status,
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      ...(record.detail === undefined ? {} : { detail: record.detail }),
      ...(record.revision === undefined ? {} : { revision: record.revision }),
    };
  }
}
