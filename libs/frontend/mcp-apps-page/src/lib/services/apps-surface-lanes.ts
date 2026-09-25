import type { RpcResult } from '@ptah-extension/core';
import type { SurfaceMutationResult } from '@ptah-extension/shared';
import type {
  SurfaceDataValue,
  SurfaceRejectReason,
  SurfaceSelection,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { AppsOperationOverlays } from '../state/apps-operation-overlays';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';
import { createSurfaceOperationId } from '../state/surface-operation-id';
import { readSurfaceRejectReason } from './apps-submit-flow';
import type { AppsSurfaceRpc } from './apps-surface-sync';
import {
  APPS_ECHO_GRACE_MS,
  APPS_SURFACE_READ_TIMEOUT_MS,
} from './apps-surface-sync';

/**
 * `AppsSurfaceLanes` — the `surface:change` / `surface:select` send queues of
 * ONE conversation (routing id), one lane per surface
 * (implementation-plan.md:532-573, Rules 1-4).
 *
 * A plain class, created by `AppsSurfaceOperations` per routing id and
 * released with `dispose()`:
 * - one in-flight mutation per surface; the base revision is always the
 *   MATERIALIZED revision at send time, and never below the lane's expected
 *   revision: own writes never conflict with each other (plan :533-537);
 * - no change or select is sent while a submit of the same surface is
 *   sending or polling; the submit's end re-pumps the lane;
 * - before sending, a lane whose expected revision is above the materialized
 *   one waits for the echo. The slice's `AppsSurfaceSync` reads after the
 *   1.5 s grace; that sync does not re-arm after a failed read, so every
 *   later wait tick requests its own read. When the lane is still behind
 *   after `APPS_ECHO_WAIT_LIMIT_MS`, its queued mutations are NOT sent: their
 *   overlays retire and each gets a "not saved" notice;
 * - a queued unsent change for the same component is replaced and its overlay
 *   retired unsent; queued selects collapse to the latest;
 * - Rule 1: `applied` settles the overlay and raises the EXPECTED revision;
 * - a transport failure (no `errorCode`, or `pending`) asks
 *   `surface:operation` ONCE and never resends; a host refusal (`errorCode`)
 *   retires and shows a notice. It never calls `chat:*`.
 *
 * `console.warn` names a step and at most an error code or reject reason,
 * never a payload value. Public methods never throw.
 */

/** `surface:change` / `surface:select` / `surface:operation` timeout. */
export const APPS_MUTATION_TIMEOUT_MS = 10_000;

/**
 * How long a queued mutation waits for its expected revision before it is
 * dropped unsent: the grace read and one follow-up read each get their full
 * timeout.
 */
export const APPS_ECHO_WAIT_LIMIT_MS =
  APPS_ECHO_GRACE_MS + 2 * APPS_SURFACE_READ_TIMEOUT_MS;

export const APPS_CHANGE_TEXT = {
  stale: 'This field changed while you were editing. Your value was not saved.',
  failed: 'Your value was not saved.',
  unconfirmed: 'We could not confirm that your value was saved.',
  notSynced:
    'Your value was not saved: the page could not confirm the latest state of this app.',
} as const;

/** Req 6.6: the `role="status"` notice of a selection the host did not take. */
export const APPS_SELECTION_NOTICE_PREFIX =
  'Selection not shared with the agent: ';

const SELECTION_DETAIL = {
  refused: 'the request was refused.',
  unconfirmed: 'the request could not be confirmed.',
  notFound: 'this app is no longer available.',
  notSynced: 'the page could not confirm the latest state of this app.',
} as const;

/** The user's selection, shown until the host's own selection covers it. */
export interface AppsSelectionOverride {
  readonly value: SurfaceSelection | null;
  /** The latest select operation carrying this selection. */
  readonly operationId: string;
  /** The host selection when this override was last sent. */
  readonly hostKey: string;
  /** The `applied` ack revision; null until the host acknowledged it. */
  readonly ackRevision: number | null;
}

/** Where the lanes read and write; implemented by the facade. */
export interface AppsLaneHost {
  /** The held entry, or null when the slice is not shown or it is gone. */
  entry(surfaceId: string): AppsSurfaceEntry | null;
  /** True while this routing id is the slice the page shows. */
  isShown(): boolean;
  updateOverlays(
    surfaceId: string,
    update: (overlays: AppsOperationOverlays) => AppsOperationOverlays,
  ): void;
  /** Rule 1 → Rule 3 on the slice's sync; never materializes. */
  expectRevision(surfaceId: string, revision: number): void;
  requestRead(): void;
  setIssue(surfaceId: string, componentId: string, message: string): void;
  /** Updates the override only while `operationId` still carries it. */
  patchSelection(
    surfaceId: string,
    operationId: string,
    update: (override: AppsSelectionOverride) => AppsSelectionOverride,
  ): void;
  /** Req 6.6: marks the override of `operationId` unsynced with `notice`. */
  markUnsynced(surfaceId: string, operationId: string, notice: string): void;
  /** A mutation settled or a lane moved: a waiting submit may proceed. */
  settled(): void;
  /** True while a submit of `surfaceId` is sending or polling. */
  isSubmitting(surfaceId: string): boolean;
}

type LaneOp =
  | {
      readonly kind: 'change';
      readonly operationId: string;
      readonly componentId: string;
      readonly value: SurfaceDataValue;
    }
  | {
      readonly kind: 'select';
      readonly operationId: string;
      readonly selection: SurfaceSelection | null;
      /** A `stale-revision` re-send; it is never re-sent again. */
      readonly retried: boolean;
    };

interface Lane {
  readonly surfaceId: string;
  queue: LaneOp[];
  inFlight: LaneOp | null;
  /** Highest acknowledged revision this lane still waits to see. */
  expected: number | null;
  /** The echo-wait tick; armed only while the lane is behind. */
  waitTimer: ReturnType<typeof setTimeout> | null;
  /** When the current echo wait began; null when the lane is not waiting. */
  waitStartedAt: number | null;
}

type MutationOutcome =
  | { readonly kind: 'applied'; readonly revision: number }
  | {
      readonly kind: 'rejected';
      readonly reason: SurfaceRejectReason | null;
      readonly detail: string;
      readonly currentRevision: number | null;
    }
  | { readonly kind: 'not-found' }
  /** Host refusal (`readAfter` false) or an unconfirmed transport failure. */
  | {
      readonly kind: 'failed';
      readonly readAfter: boolean;
      readonly detail: string | null;
    };

const UNRESOLVED: MutationOutcome = {
  kind: 'failed',
  readAfter: true,
  detail: null,
};

const WARN_PREFIX = '[AppsSurfaceLanes]';

function revisionOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Boundary guard for a `surface:change` / `surface:select` result or a
 * `surface:operation` answer. `null`: not terminal or not understood.
 */
function readMutationOutcome(data: unknown): MutationOutcome | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  switch (record['status']) {
    case 'applied': {
      const revision = revisionOf(record['revision']);
      return revision === null ? null : { kind: 'applied', revision };
    }
    case 'rejected':
      return {
        kind: 'rejected',
        reason: readSurfaceRejectReason(record['reason']),
        detail: typeof record['detail'] === 'string' ? record['detail'] : '',
        currentRevision: revisionOf(record['currentRevision']),
      };
    case 'not-found':
      return { kind: 'not-found' };
    default:
      return null;
  }
}

/** The selection the host holds for `entry`, or null. */
export function hostSelectionOf(
  entry: AppsSurfaceEntry | null,
): SurfaceSelection | null {
  return entry !== null && entry.renderable.status === 'accepted'
    ? entry.renderable.selection
    : null;
}

/** Structural identity of a selection, for "did the host's one change". */
export function selectionKey(selection: SurfaceSelection | null): string {
  return JSON.stringify(selection);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

export class AppsSurfaceLanes {
  private readonly lanes = new Map<string, Lane>();
  /** Aborted by `dispose()`, which also releases the RPC timers in flight. */
  private readonly controller = new AbortController();

  public constructor(
    private readonly rpc: AppsSurfaceRpc,
    public readonly routingId: string,
    private readonly host: AppsLaneHost,
  ) {}

  /**
   * Queue a validated change. A queued unsent change of the same component
   * is replaced, and its overlay retired unsent; the new overlay is added.
   */
  public change(
    surfaceId: string,
    componentId: string,
    path: string,
    value: SurfaceDataValue,
    baseRevision: number,
  ): void {
    try {
      const lane = this.laneFor(surfaceId);
      const op: LaneOp = {
        kind: 'change',
        operationId: createSurfaceOperationId(),
        componentId,
        value,
      };
      const queued = lane.queue.findIndex(
        (candidate) =>
          candidate.kind === 'change' && candidate.componentId === componentId,
      );
      const replaced = queued >= 0 ? lane.queue[queued].operationId : null;
      if (queued >= 0) lane.queue[queued] = op;
      else lane.queue.push(op);
      this.host.updateOverlays(surfaceId, (overlays) =>
        (replaced === null ? overlays : overlays.retire(replaced)).add({
          operationId: op.operationId,
          path,
          value,
          baseRevision,
        }),
      );
      this.pump(lane);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} change not queued: ${errorName(error)}`);
    }
  }

  /** Queue a select under `operationId`; queued selects collapse to it. */
  public select(
    surfaceId: string,
    operationId: string,
    selection: SurfaceSelection | null,
  ): void {
    try {
      const lane = this.laneFor(surfaceId);
      lane.queue = lane.queue.filter(
        (candidate) => candidate.kind !== 'select',
      );
      lane.queue.push({
        kind: 'select',
        operationId,
        selection,
        retried: false,
      });
      this.pump(lane);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} select not queued: ${errorName(error)}`);
    }
  }

  /** Re-checks every lane: an echo or a read may let one send. */
  public pumpAll(): void {
    try {
      for (const lane of [...this.lanes.values()]) this.pump(lane);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} lanes not pumped: ${errorName(error)}`);
    }
  }

  /** True while `operationId` is queued or in flight on `surfaceId`. */
  public isPending(surfaceId: string, operationId: string): boolean {
    const lane = this.lanes.get(surfaceId);
    return (
      lane !== undefined &&
      (lane.inFlight?.operationId === operationId ||
        lane.queue.some((op) => op.operationId === operationId))
    );
  }

  /** What a submit must wait for on `surfaceId`. */
  public syncState(surfaceId: string): 'settled' | 'draining' | 'behind' {
    const lane = this.lanes.get(surfaceId);
    if (lane === undefined) return 'settled';
    if (lane.inFlight !== null || lane.queue.length > 0) return 'draining';
    const entry = this.host.entry(surfaceId);
    return entry !== null &&
      lane.expected !== null &&
      lane.expected > entry.materializedRevision
      ? 'behind'
      : 'settled';
  }

  /** Rule 1 → Rule 3: raise the expected revision; never materialize it. */
  public expect(surfaceId: string, revision: number): void {
    const lane = this.laneFor(surfaceId);
    lane.expected =
      lane.expected === null ? revision : Math.max(lane.expected, revision);
    this.host.expectRevision(surfaceId, revision);
  }

  /** Clears every wait timer and aborts every RPC in flight. Idempotent. */
  public dispose(): void {
    this.controller.abort();
    for (const lane of this.lanes.values()) this.clearWait(lane);
    this.lanes.clear();
  }

  private laneFor(surfaceId: string): Lane {
    const existing = this.lanes.get(surfaceId);
    if (existing !== undefined) return existing;
    const lane: Lane = {
      surfaceId,
      queue: [],
      inFlight: null,
      expected: null,
      waitTimer: null,
      waitStartedAt: null,
    };
    this.lanes.set(surfaceId, lane);
    return lane;
  }

  /** Sends the lane's next mutation when nothing is in flight and it may. */
  private pump(lane: Lane): void {
    if (
      this.controller.signal.aborted ||
      lane.inFlight !== null ||
      lane.queue.length === 0
    )
      return;
    // A submit of this surface is sending or polling: the lane holds until
    // the submit settles (the flow re-pumps then), so the submit's base and
    // the lane's base never race.
    if (this.host.isSubmitting(lane.surfaceId)) {
      this.clearWait(lane);
      return;
    }
    const entry = this.host.entry(lane.surfaceId);
    if (entry === null) {
      // Not shown (another workspace): pause, and resume when it is shown.
      // Gone: its overlays went with the entry, so the queue is dropped.
      this.clearWait(lane);
      if (!this.host.isShown()) return;
      this.lanes.delete(lane.surfaceId);
      return;
    }
    if (lane.expected !== null && lane.expected > entry.materializedRevision) {
      this.armWait(lane);
      return;
    }
    this.clearWait(lane);
    lane.expected = null;
    const op = lane.queue.shift();
    if (op === undefined) return;
    lane.inFlight = op;
    // Never below the expected revision: checked just above.
    const base = entry.materializedRevision;
    if (op.kind === 'select') {
      // A re-send after a read keeps the user's selection shown on the new base.
      const hostKey = selectionKey(hostSelectionOf(entry));
      this.host.patchSelection(lane.surfaceId, op.operationId, (override) =>
        override.hostKey === hostKey ? override : { ...override, hostKey },
      );
    }
    void this.send(lane, op, base).catch((error: unknown) => {
      console.warn(`${WARN_PREFIX} mutation not settled: ${errorName(error)}`);
      if (lane.inFlight === op) lane.inFlight = null;
    });
  }

  /** Arms the lane's single echo-wait tick (once per grace period). */
  private armWait(lane: Lane): void {
    if (lane.waitTimer !== null) return;
    lane.waitStartedAt ??= Date.now();
    lane.waitTimer = setTimeout(
      () => this.onWaitTick(lane),
      APPS_ECHO_GRACE_MS,
    );
  }

  /**
   * Rule 3 for a queued mutation. The first grace period is covered by the
   * read the expectation itself triggered (the sync's grace read, or the
   * `stale-revision` read); every later tick requests its OWN read, because
   * the sync does not re-arm after a failed read. Past the limit the queue
   * is dropped unsent: it is never sent on a base below the expected one.
   */
  private onWaitTick(lane: Lane): void {
    lane.waitTimer = null;
    if (this.controller.signal.aborted) return;
    try {
      const entry = this.host.entry(lane.surfaceId);
      const behind =
        entry !== null &&
        lane.expected !== null &&
        lane.expected > entry.materializedRevision;
      if (!behind || lane.queue.length === 0 || lane.inFlight !== null) {
        this.clearWait(lane);
        this.pump(lane);
        this.host.settled();
        return;
      }
      const waited = Date.now() - (lane.waitStartedAt ?? Date.now());
      if (waited >= APPS_ECHO_WAIT_LIMIT_MS) {
        this.dropQueue(lane);
        this.host.settled();
        return;
      }
      if (waited >= 2 * APPS_ECHO_GRACE_MS) this.host.requestRead();
      this.armWait(lane);
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} echo wait failed: ${errorName(error)}`);
    }
  }

  /**
   * The expected revision never materialized: drop every queued mutation
   * unsent, retire its overlay and tell the user it was not saved. The
   * expected revision stays, so a later mutation waits again.
   */
  private dropQueue(lane: Lane): void {
    const dropped = lane.queue;
    lane.queue = [];
    this.clearWait(lane);
    console.warn(
      `${WARN_PREFIX} expected revision not seen; ${dropped.length} queued mutation(s) not sent`,
    );
    for (const op of dropped) {
      if (op.kind === 'change') {
        this.host.updateOverlays(lane.surfaceId, (overlays) =>
          overlays.retire(op.operationId),
        );
        this.host.setIssue(
          lane.surfaceId,
          op.componentId,
          APPS_CHANGE_TEXT.notSynced,
        );
      } else {
        // Req 6.6: the selection stays shown, marked unsynced.
        this.host.markUnsynced(
          lane.surfaceId,
          op.operationId,
          `${APPS_SELECTION_NOTICE_PREFIX}${SELECTION_DETAIL.notSynced}`,
        );
      }
    }
  }

  private clearWait(lane: Lane): void {
    lane.waitStartedAt = null;
    if (lane.waitTimer === null) return;
    clearTimeout(lane.waitTimer);
    lane.waitTimer = null;
  }

  private async send(lane: Lane, op: LaneOp, base: number): Promise<void> {
    const signal = this.controller.signal;
    const common = {
      routingId: this.routingId,
      surfaceId: lane.surfaceId,
      revision: base,
      operationId: op.operationId,
    };
    const options = { timeout: APPS_MUTATION_TIMEOUT_MS, signal };
    let outcome: MutationOutcome;
    try {
      const result: RpcResult<SurfaceMutationResult> =
        op.kind === 'change'
          ? await this.rpc.call(
              'surface:change',
              { ...common, componentId: op.componentId, value: op.value },
              options,
            )
          : await this.rpc.call(
              'surface:select',
              { ...common, selection: op.selection },
              options,
            );
      if (signal.aborted) return;
      if (result.isSuccess()) {
        // `pending` is not expected for change and select: a transport failure.
        outcome =
          readMutationOutcome(result.data) ?? (await this.checkOperation(op));
      } else if (result.errorCode !== undefined) {
        console.warn(`${WARN_PREFIX} ${op.kind} refused: ${result.errorCode}`);
        outcome = {
          kind: 'failed',
          readAfter: false,
          detail: result.error ?? null,
        };
      } else {
        outcome = await this.checkOperation(op);
      }
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} ${op.kind} failed: ${errorName(error)}`);
      outcome = await this.checkOperation(op);
    }
    if (signal.aborted) return;
    lane.inFlight = null;
    if (op.kind === 'change') this.settleChange(lane, op, outcome);
    else this.settleSelect(lane, op, base, outcome);
    this.pump(lane);
    this.host.settled();
  }

  /** A transport failure: ask `surface:operation` ONCE; never resend. */
  private async checkOperation(op: LaneOp): Promise<MutationOutcome> {
    const signal = this.controller.signal;
    if (signal.aborted) return UNRESOLVED;
    try {
      const result = await this.rpc.call(
        'surface:operation',
        { routingId: this.routingId, operationId: op.operationId },
        { timeout: APPS_MUTATION_TIMEOUT_MS, signal },
      );
      if (!result.isSuccess()) {
        console.warn(
          `${WARN_PREFIX} surface:operation failed: ${result.errorCode ?? 'transport'}`,
        );
        return UNRESOLVED;
      }
      // `unknown`, `pending` or `indeterminate`: retire and read.
      const outcome = readMutationOutcome(result.data);
      return outcome === null || outcome.kind === 'not-found'
        ? UNRESOLVED
        : outcome;
    } catch (error: unknown) {
      console.warn(
        `${WARN_PREFIX} surface:operation failed: ${errorName(error)}`,
      );
      return UNRESOLVED;
    }
  }

  private settleChange(
    lane: Lane,
    op: Extract<LaneOp, { kind: 'change' }>,
    outcome: MutationOutcome,
  ): void {
    const { surfaceId } = lane;
    if (outcome.kind === 'applied') {
      // Rule 1: settle and expect; the overlay retires at the echo or a read.
      this.host.updateOverlays(surfaceId, (overlays) =>
        overlays.settle(op.operationId, outcome.revision),
      );
      this.expect(surfaceId, outcome.revision);
      return;
    }
    this.host.updateOverlays(surfaceId, (overlays) =>
      overlays.retire(op.operationId),
    );
    if (outcome.kind === 'rejected')
      console.warn(`${WARN_PREFIX} change rejected: ${outcome.reason ?? '?'}`);
    // `stale-revision` is never re-sent: it could overwrite an agent write.
    const stale =
      outcome.kind === 'rejected' && outcome.reason === 'stale-revision';
    const read =
      stale ||
      outcome.kind === 'not-found' ||
      (outcome.kind === 'failed' && outcome.readAfter);
    if (read) this.host.requestRead();
    // A not-found surface is gone with its input: no notice to show.
    if (outcome.kind === 'not-found') return;
    let message: string;
    if (stale) message = APPS_CHANGE_TEXT.stale;
    else if (outcome.kind === 'rejected')
      message =
        outcome.detail.length > 0 ? outcome.detail : APPS_CHANGE_TEXT.failed;
    else if (outcome.readAfter) message = APPS_CHANGE_TEXT.unconfirmed;
    else message = outcome.detail ?? APPS_CHANGE_TEXT.failed;
    this.host.setIssue(surfaceId, op.componentId, message);
  }

  private settleSelect(
    lane: Lane,
    op: Extract<LaneOp, { kind: 'select' }>,
    base: number,
    outcome: MutationOutcome,
  ): void {
    const { surfaceId } = lane;
    if (outcome.kind === 'applied') {
      this.host.patchSelection(surfaceId, op.operationId, (override) => ({
        ...override,
        ackRevision: outcome.revision,
      }));
      this.expect(surfaceId, outcome.revision);
      return;
    }
    const stale =
      outcome.kind === 'rejected' && outcome.reason === 'stale-revision';
    if (
      stale ||
      outcome.kind === 'not-found' ||
      (outcome.kind === 'failed' && outcome.readAfter)
    )
      this.host.requestRead();
    if (stale && !op.retried) {
      // Req 6.6: re-send ONCE with a new id on the new base. The lane waits
      // until the read reaches the revision the host reported.
      const reported =
        outcome.kind === 'rejected' ? outcome.currentRevision : null;
      const target = reported ?? base + 1;
      lane.expected = Math.max(lane.expected ?? target, target);
      if (lane.queue.some((queued) => queued.kind === 'select')) return;
      const retry: LaneOp = {
        kind: 'select',
        operationId: createSurfaceOperationId(),
        selection: op.selection,
        retried: true,
      };
      lane.queue.push(retry);
      this.host.patchSelection(surfaceId, op.operationId, (override) => ({
        ...override,
        operationId: retry.operationId,
      }));
      return;
    }
    let detail: string;
    if (outcome.kind === 'rejected') {
      console.warn(`${WARN_PREFIX} select rejected: ${outcome.reason ?? '?'}`);
      detail =
        outcome.detail.length > 0 ? outcome.detail : SELECTION_DETAIL.refused;
    } else if (outcome.kind === 'not-found') detail = SELECTION_DETAIL.notFound;
    else if (outcome.readAfter) detail = SELECTION_DETAIL.unconfirmed;
    else detail = outcome.detail ?? SELECTION_DETAIL.refused;
    // Req 6.6: the selection stays shown, marked unsynced, with a notice.
    this.host.markUnsynced(
      surfaceId,
      op.operationId,
      `${APPS_SELECTION_NOTICE_PREFIX}${detail}`,
    );
  }
}
