/**
 * `SurfaceStateService`: the facade over the host-owned surface state (plan
 * Component 10). One DI singleton per host, registered in
 * `registerVsCodeLmToolsServices`. It composes the bounded store, the
 * operation ledger and the reader, and it is the ONLY place that swaps a
 * record into the store and the ONLY place that pushes.
 *
 * Every commit runs, synchronously and with no `await` before the swap:
 * conflict check, apply ops, full re-validation, revision `current + 1` (a new
 * surface starts at `highWaterRevision + 1`), selection revalidation,
 * write-log append (all planned in `surface-agent-mutations.ts`,
 * `surface-ui-mutations.ts` and `surface-commit.ts`), then the atomic swap and
 * eviction (`SurfaceStateStore.commit`), then the push. JS runs one call at a
 * time, so each commit is atomic and two back-to-back commits push in
 * revision order: the delivery primitive enumerates and queues its sends in
 * call order.
 *
 * Eviction pushes: every eviction list the store returns, from `commit`,
 * from `makeRoom` (called by the ledger's byte-admission callback) and from
 * `reserveTicket`, is pushed as `{ kind: 'deleted', reason: 'evicted' }`
 * through the same push site, in the order it happened.
 *
 * Ledger charges count in the store's byte accounting (`charges: ledger`),
 * and the ledger's admission callback is answered with `makeRoom` as its
 * documented contract says: `true` is byte room for exactly that record.
 *
 * No `surfaceMode` precondition (Req 7.3): any routing id may hold surfaces.
 * Nothing throws to callers; every method returns a typed result. Delivery
 * failure never rolls a commit back; it is logged and reported separately.
 */
import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type {
  DashboardSpecEnvelope,
  SurfaceChange,
  SurfaceGetStateInput,
  SurfaceUpdateInput,
  SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import type { DashboardDeliveryOutcome } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import { VSCODE_LM_TOOLS_TOKENS } from '../di/tokens';
import { nonThrowingSurfaceLog, type SurfaceLog } from './surface-log';
import {
  agentOperationId,
  planAgentUpdate,
  planV1Proposal,
  surfaceIdOfUpdate,
  v1SurfaceId,
  type SurfaceAgentPlan,
  type SurfaceAgentUpdateResult,
} from './surface-agent-mutations';
import {
  SurfaceOperationGate,
  type SurfaceOperationStatusResult,
} from './surface-operation-gate';
import {
  SurfaceOperationLedger,
  type SurfaceLedgerLimits,
} from './surface-operation-ledger';
import {
  pushSurfaceChange,
  type SurfacePushHostProvider,
} from './surface-push';
import {
  SurfaceStateReader,
  toSurfaceStateView,
  type SurfaceAgentReadResult,
  type SurfaceStoreReadResult,
} from './surface-state-reader';
import {
  SurfaceStateStore,
  type SurfaceRecord,
  type SurfaceStoreLimits,
  type SurfaceStorePair,
  type SurfaceStoreUsage,
} from './surface-state.store';
import {
  fingerprintChange,
  fingerprintSelect,
  fingerprintSubmit,
  outcomeFromRecord,
  planBeginSubmit,
  planChange,
  planSelect,
  planSubmitSettlement,
  resolveStoredAction,
  submitRecordOf,
  type SurfaceActionResolution,
  type SurfaceChangeRequest,
  type SurfaceMutationOutcome,
  type SurfaceSelectRequest,
  type SurfaceSubmitDispatchOutcome,
  type SurfaceSubmitRequest,
  type SurfaceSubmitTicket,
  type SurfaceUiPlan,
  type SurfaceUiRejection,
} from './surface-ui-mutations';

/**
 * Optional construction options. Never registered in production, so every
 * host runs the documented defaults (`SURFACE_STORE_LIMITS`,
 * `SURFACE_LIMITS.maxStateReadBytes`, `Date.now`, `crypto.randomUUID`); specs
 * pass smaller bounds and a fixed clock.
 */
export const SURFACE_STATE_SERVICE_OPTIONS = Symbol.for(
  'SurfaceStateServiceOptions',
);

export interface SurfaceStateServiceOptions {
  readonly storeLimits?: Partial<SurfaceStoreLimits>;
  readonly ledgerLimits?: Partial<SurfaceLedgerLimits>;
  /** Epoch milliseconds for the ledger and `submittedAt`. */
  readonly clock?: () => number;
  readonly maxStateReadBytes?: number;
  /** Submit nonce source; must yield 16-64 characters of `[A-Za-z0-9-]`. */
  readonly createNonce?: () => string;
}

/** `beginSubmit`: a ticket to dispatch, or an outcome with nothing to dispatch. */
export type SurfaceSubmitBegin =
  | { readonly status: 'dispatch'; readonly ticket: SurfaceSubmitTicket }
  | SurfaceMutationOutcome;

export type { SurfaceActionResolution };

interface PushMeta {
  readonly origin: SurfaceUpdatedPayload['origin'];
  readonly operationId: string;
  readonly toolCallId?: string;
}

type CommitResult =
  | { readonly ok: true; readonly delivery: Promise<DashboardDeliveryOutcome> }
  | { readonly ok: false; readonly reason: 'budget'; readonly detail: string };

@injectable()
export class SurfaceStateService {
  /** Never throws: a failed log write cannot interrupt a transition (F1). */
  private readonly log: SurfaceLog;
  private readonly ledger: SurfaceOperationLedger;
  private readonly gate: SurfaceOperationGate;
  private readonly store: SurfaceStateStore;
  private readonly reader: SurfaceStateReader;
  private readonly createNonce: () => string;
  /**
   * The highest deletion revision issued. A delete produces `current + 1`
   * without committing a record, so the store's high-water mark does not see
   * it; new incarnations start above both.
   */
  private retiredRevision = 0;

  constructor(
    @inject(TOKENS.LOGGER) logger: Logger,
    @inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_PUSH_HOST)
    private readonly pushHost: SurfacePushHostProvider,
    @inject(SURFACE_STATE_SERVICE_OPTIONS, { isOptional: true })
    options?: SurfaceStateServiceOptions,
  ) {
    this.log = nonThrowingSurfaceLog(logger);
    this.ledger = new SurfaceOperationLedger({
      limits: options?.ledgerLimits,
      clock: options?.clock,
    });
    this.store = new SurfaceStateStore({
      limits: options?.storeLimits,
      charges: this.ledger,
    });
    this.gate = new SurfaceOperationGate(this.ledger, this.store, this.log);
    this.reader = new SurfaceStateReader(this.store, {
      maxStateReadBytes: options?.maxStateReadBytes,
    });
    this.createNonce = options?.createNonce ?? randomUUID;
  }

  // ---------------------------------------------------------------- agent

  /**
   * Apply one VALIDATED `ptah_surface_update` for `routingId` (from trusted
   * request context, never from arguments). The store reflects the result
   * before this returns (Req 7.1).
   */
  applyAgentUpdate(
    routingId: string,
    input: SurfaceUpdateInput,
    toolCallId: string,
  ): SurfaceAgentUpdateResult {
    const existing = this.store.get(routingId, surfaceIdOfUpdate(input));
    const plan = planAgentUpdate(existing, input, this.nextCreateRevision());
    return this.executeAgentPlan(routingId, plan, toolCallId);
  }

  /**
   * Record a validated v1 proposal at `v1:<specId>` (Req 8.7): an upsert with
   * a structure footprint; the envelope's own `revision` is kept verbatim.
   */
  recordV1Proposal(
    routingId: string,
    spec: DashboardSpecEnvelope,
    toolCallId: string,
  ): SurfaceAgentUpdateResult {
    const existing = this.store.get(routingId, v1SurfaceId(spec.specId));
    const plan = planV1Proposal(existing, spec, this.nextCreateRevision());
    return this.executeAgentPlan(routingId, plan, toolCallId);
  }

  // ------------------------------------------------------------------- UI

  /** `surface:change`: host state only, never a turn (Req 9.4). */
  change(
    routingId: string,
    request: SurfaceChangeRequest,
  ): SurfaceMutationOutcome {
    return this.runUiMutation(
      routingId,
      request,
      'change',
      fingerprintChange(request),
      (record) => planChange(record, request),
    );
  }

  /** `surface:select`, validated against the host copy (Req 7.5). */
  select(
    routingId: string,
    request: SurfaceSelectRequest,
  ): SurfaceMutationOutcome {
    return this.runUiMutation(
      routingId,
      request,
      'select',
      fingerprintSelect(request),
      (record) => planSelect(record, request),
    );
  }

  /**
   * First half of a submit: reserve the operation id, apply the busy rule
   * (at most one pending submit per routing id), check staleness and the
   * scoped values, freeze the snapshot, format the message with a fresh
   * nonce, and reserve the ticket's bytes. A replay returns the recorded
   * outcome (`pending` while in flight) and dispatches nothing (Req 10.5).
   * On `dispatch`, the caller MUST call `settleSubmit` exactly once.
   */
  beginSubmit(
    routingId: string,
    request: SurfaceSubmitRequest,
  ): SurfaceSubmitBegin {
    const reserved = this.reserve(
      routingId,
      request,
      'submit',
      fingerprintSubmit(request),
    );
    if (!reserved.ok) return reserved.outcome;
    const record = reserved.record;
    const protect = { routingId, surfaceId: record.surfaceId };
    if (this.ledger.pendingCount(routingId, 'submit') > 1)
      return this.gate.reject(routingId, request.operationId, {
        kind: 'rejected',
        reason: 'busy',
        detail:
          'Another submit for this conversation is still in progress; the form values are kept. Submit again when it finishes.',
      });
    const plan = planBeginSubmit(
      routingId,
      record,
      request,
      this.createNonce(),
    );
    if (plan.kind === 'rejected')
      return this.gate.reject(routingId, request.operationId, plan);
    const room = this.store.reserveTicket(
      routingId,
      request.operationId,
      plan.bytes,
      protect,
    );
    if (!room.ok)
      return this.gate.reject(routingId, request.operationId, {
        kind: 'rejected',
        reason: room.reason,
        detail: room.detail,
      });
    this.publishEvictions(room.evicted);
    this.log.info('[Surface] submit reserved', {
      routingId,
      surfaceId: record.surfaceId,
      operationId: request.operationId,
    });
    return { status: 'dispatch', ticket: plan.ticket };
  }

  /**
   * Record a `surface:action` refused before any side effect as a terminal
   * rejection, fingerprinted like a submit, so a replay returns the same
   * answer and other content is `operation-conflict` (Req 6.4). An existing
   * record answers first. No ticket is reserved.
   */
  refuseAction(
    routingId: string,
    request: SurfaceSubmitRequest,
    refusal: Omit<SurfaceUiRejection, 'kind' | 'issues'>,
  ): SurfaceMutationOutcome {
    const reserved = this.reserve(
      routingId,
      request,
      'submit',
      fingerprintSubmit(request),
    );
    if (!reserved.ok) return reserved.outcome;
    return this.gate.reject(routingId, request.operationId, {
      kind: 'rejected',
      ...refusal,
    });
  }

  /**
   * Second half of a submit (Req 10.3). Always settles the ledger. `applied`
   * and `indeterminate` write the last-submit record (revision `+1`, push)
   * only when the surface still exists with the ticket's incarnation; a
   * deleted, evicted or recreated surface gets a warn line and no last-submit
   * anywhere. The ticket reserved settlement headroom, so the live-surface
   * commit fits once it is released (F2). `rejected` changes nothing. A
   * second settlement returns the recorded outcome and writes nothing.
   */
  settleSubmit(
    ticket: SurfaceSubmitTicket,
    outcome: SurfaceSubmitDispatchOutcome,
  ): SurfaceMutationOutcome {
    const { routingId, operationId } = ticket;
    const lookup = this.ledger.lookup(routingId, operationId);
    this.store.releaseTicket(routingId, operationId);
    if (lookup.status === 'unknown') {
      this.log.warn('[Surface] submit settled without a ledger record', {
        routingId,
        operationId,
      });
      return { status: 'not-found', operationId };
    }
    if (lookup.status !== 'pending') return outcomeFromRecord(lookup.record);
    if (outcome.status === 'rejected') {
      this.ledger.settle(routingId, operationId, outcome);
      this.log.warn('[Surface] submit rejected at dispatch', {
        routingId,
        operationId,
        reason: outcome.reason,
      });
      return {
        status: 'rejected',
        operationId,
        reason: outcome.reason,
        detail: outcome.detail,
      };
    }

    const plan = planSubmitSettlement(
      this.store.get(routingId, ticket.surfaceId),
      ticket,
      submitRecordOf(ticket, outcome.status, this.ledger.now()),
    );
    let revision: number | undefined;
    if (plan.kind === 'commit') {
      const committed = this.commitRecord(routingId, plan.commit, {
        origin: 'host',
        operationId,
      });
      if (committed.ok) revision = plan.commit.record.revision;
      else
        this.log.warn('[Surface] last submit not recorded', {
          routingId,
          operationId,
          detail: committed.detail,
        });
    } else {
      this.log.warn('[Surface] last submit not recorded', {
        routingId,
        operationId,
        detail: plan.detail,
      });
    }

    if (outcome.status === 'applied') {
      this.ledger.settle(routingId, operationId, {
        status: 'applied',
        revision,
      });
      return revision === undefined
        ? { status: 'applied', operationId }
        : { status: 'applied', operationId, revision };
    }
    this.ledger.settle(routingId, operationId, {
      status: 'indeterminate',
      detail: outcome.detail,
      revision,
    });
    return {
      status: 'indeterminate',
      operationId,
      detail: outcome.detail,
      ...(revision === undefined ? {} : { revision }),
    };
  }

  // ---------------------------------------------------------------- reads

  /**
   * Complete read for RPC (Req 9.5). A routing id holding no surface, or a
   * named surface it does not hold, is `not-found`; nothing is created.
   */
  read(routingId: string, surfaceId?: string): SurfaceStoreReadResult {
    const result = this.reader.read(routingId, surfaceId);
    return result.status === 'found' && result.surfaces.length === 0
      ? { status: 'not-found' }
      : result;
  }

  /** Bounded text for `ptah_surface_get_state` (Req 8.3). */
  describeForAgent(
    routingId: string,
    input: SurfaceGetStateInput,
  ): SurfaceAgentReadResult {
    return this.reader.describeForAgent(routingId, input);
  }

  /** The outcome of a UI operation id (Req 6.5). */
  operationStatus(
    routingId: string,
    operationId: string,
  ): SurfaceOperationStatusResult {
    return this.gate.status(routingId, operationId);
  }

  /**
   * Resolve `actionId` from the STORED declaration (Req 6.7), for
   * `surface:action`. v1 actions carry no id, so a v1 surface declares none
   * that the UI can name.
   */
  resolveAction(
    routingId: string,
    surfaceId: string,
    actionId: string,
  ): SurfaceActionResolution {
    return resolveStoredAction(this.store.get(routingId, surfaceId), actionId);
  }

  /** Accounting snapshot (does not touch recency). */
  usage(): SurfaceStoreUsage {
    return this.store.usage();
  }

  // -------------------------------------------------------------- private

  /** Above every revision ever issued: committed, deleted or evicted. */
  private nextCreateRevision(): number {
    return this.highWaterRevision() + 1;
  }

  private highWaterRevision(): number {
    return Math.max(this.store.highWaterRevision, this.retiredRevision);
  }

  private executeAgentPlan(
    routingId: string,
    plan: SurfaceAgentPlan,
    toolCallId: string,
  ): SurfaceAgentUpdateResult {
    const operationId = agentOperationId(toolCallId);
    switch (plan.kind) {
      case 'rejected':
        this.log.warn('[Surface] agent update rejected', {
          routingId,
          surfaceId: plan.surfaceId,
          operation: plan.operation,
          reason: plan.reason,
        });
        return {
          status: 'rejected',
          operation: plan.operation,
          surfaceId: plan.surfaceId,
          operationId,
          reason: plan.reason,
          detail: plan.detail,
          ...(plan.currentRevision === undefined
            ? {}
            : { currentRevision: plan.currentRevision }),
        };
      case 'not-found':
        this.log.warn('[Surface] agent update named an unknown surface', {
          routingId,
          surfaceId: plan.surfaceId,
          operation: plan.operation,
        });
        return {
          status: 'not-found',
          operation: plan.operation,
          surfaceId: plan.surfaceId,
          operationId,
          detail: plan.detail,
        };
      case 'delete': {
        this.store.delete(routingId, plan.surfaceId);
        this.retiredRevision = Math.max(this.retiredRevision, plan.revision);
        const delivery = this.publish({
          routingId,
          surfaceId: plan.surfaceId,
          revision: plan.revision,
          origin: 'agent',
          change: { kind: 'deleted', reason: 'agent-deleted' },
          toolCallId,
          operationId,
        });
        this.log.info('[Surface] deleted', {
          routingId,
          surfaceId: plan.surfaceId,
          revision: plan.revision,
        });
        return {
          status: 'applied',
          operation: 'delete',
          surfaceId: plan.surfaceId,
          revision: plan.revision,
          operationId,
          toolCallId,
          view: null,
          delivery,
        };
      }
      default: {
        const { record } = plan.commit;
        const committed = this.commitRecord(routingId, plan.commit, {
          origin: 'agent',
          operationId,
          toolCallId,
        });
        if (!committed.ok)
          return this.executeAgentPlan(
            routingId,
            {
              kind: 'rejected',
              operation: plan.operation,
              surfaceId: record.surfaceId,
              reason: committed.reason,
              detail: committed.detail,
            },
            toolCallId,
          );
        return {
          status: 'applied',
          operation: plan.operation,
          surfaceId: record.surfaceId,
          revision: record.revision,
          operationId,
          toolCallId,
          view: toSurfaceStateView(record),
          delivery: committed.delivery,
        };
      }
    }
  }

  /**
   * The one commit path: atomic swap plus eviction in the store, then the
   * push of the committed change, then the pushes of its evictions. Nothing
   * is awaited, so no later commit can overtake this push.
   */
  private commitRecord(
    routingId: string,
    commit: { readonly record: SurfaceRecord; readonly change: SurfaceChange },
    meta: PushMeta,
  ): CommitResult {
    const stored = this.store.commit(routingId, commit.record);
    if (!stored.ok) return stored;
    const delivery = this.publish({
      routingId,
      surfaceId: commit.record.surfaceId,
      revision: commit.record.revision,
      origin: meta.origin,
      change: commit.change,
      operationId: meta.operationId,
      ...(meta.toolCallId === undefined ? {} : { toolCallId: meta.toolCallId }),
    });
    this.publishEvictions(stored.evicted);
    this.log.info('[Surface] committed', {
      routingId,
      surfaceId: commit.record.surfaceId,
      revision: commit.record.revision,
      origin: meta.origin,
    });
    return { ok: true, delivery };
  }

  /** Change, select: reserve, plan, commit, settle, all in one call. */
  private runUiMutation(
    routingId: string,
    request: {
      readonly surfaceId: string;
      readonly operationId: string;
    },
    kind: 'change' | 'select',
    fingerprint: string,
    plan: (record: SurfaceRecord) => SurfaceUiPlan,
  ): SurfaceMutationOutcome {
    const reserved = this.reserve(routingId, request, kind, fingerprint);
    if (!reserved.ok) return reserved.outcome;
    const planned = plan(reserved.record);
    if (planned.kind === 'rejected')
      return this.gate.reject(routingId, request.operationId, planned);
    const committed = this.commitRecord(routingId, planned.commit, {
      origin: 'ui',
      operationId: request.operationId,
    });
    if (!committed.ok)
      return this.gate.reject(routingId, request.operationId, {
        kind: 'rejected',
        reason: committed.reason,
        detail: committed.detail,
      });
    return this.gate.apply(
      routingId,
      request.operationId,
      planned.commit.record.revision,
    );
  }

  /**
   * Reserve a UI operation id before any side effect: an absent surface, a
   * replay, a conflict or a refusal ends here (`ok: false`).
   */
  private reserve(
    routingId: string,
    request: { readonly surfaceId: string; readonly operationId: string },
    kind: 'change' | 'select' | 'submit',
    fingerprint: string,
  ):
    | { readonly ok: false; readonly outcome: SurfaceMutationOutcome }
    | { readonly ok: true; readonly record: SurfaceRecord } {
    const operationId = request.operationId;
    const record = this.store.get(routingId, request.surfaceId);
    const reservation = this.gate.reserveOn(routingId, record, {
      operationId,
      kind,
      fingerprint,
    });
    this.publishEvictions(reservation.evicted);
    // `reserveOn` always sets `outcome` for an absent record.
    return reservation.outcome !== undefined || record === undefined
      ? {
          ok: false,
          outcome: reservation.outcome ?? { status: 'not-found', operationId },
        }
      : { ok: true, record };
  }

  private publishEvictions(pairs: readonly SurfaceStorePair[]): void {
    if (pairs.length === 0) return;
    const revision = this.highWaterRevision();
    for (const pair of pairs) {
      void this.publish({
        routingId: pair.routingId,
        surfaceId: pair.surfaceId,
        revision,
        origin: 'host',
        change: { kind: 'deleted', reason: 'evicted' },
      });
      this.log.info('[Surface] evicted', { ...pair });
    }
  }

  /**
   * THE push site. Called synchronously, in commit order; the delivery
   * primitive enumerates the host and queues its sends before it yields, so
   * pushes reach the host in call order. The returned promise never rejects.
   */
  private publish(
    payload: SurfaceUpdatedPayload,
  ): Promise<DashboardDeliveryOutcome> {
    return pushSurfaceChange(this.pushHost, this.log, payload)
      .then((outcome) => {
        if (outcome.status === 'failed')
          this.log.warn('[Surface] push not delivered', {
            routingId: payload.routingId,
            surfaceId: payload.surfaceId,
            revision: payload.revision,
            reason: outcome.reason,
          });
        return outcome;
      })
      .catch(
        // The primitive never rejects; this keeps the "never rejects" promise
        // even if logging itself fails. The commit stands either way.
        (error: unknown): DashboardDeliveryOutcome => ({
          status: 'failed',
          delivered: 0,
          surfaces: 0,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
  }
}
