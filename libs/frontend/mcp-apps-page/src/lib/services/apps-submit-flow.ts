import type { SurfaceActionUiState } from '@ptah-extension/declarative-dashboard';
import {
  checkSubmitValues,
  collectSubmitScope,
  findSurfaceAction,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceRejectReason,
  SurfaceSubmitIssue,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';
import { createSurfaceOperationId } from '../state/surface-operation-id';
import type { AppsSurfaceRpc } from './apps-surface-sync';
import { APPS_ECHO_GRACE_MS } from './apps-surface-sync';

/**
 * `AppsSubmitFlow` — `surface:action` for ONE conversation (routing id):
 * implementation-plan.md:583-615.
 *
 * A plain class, created by `AppsSurfaceOperations` per routing id and
 * released with `dispose()`. At most one submit is active per routing id (the
 * host's busy rule allows one pending submit), so at most ONE timer exists:
 * the sync-wait tick before the send, or the poll tick after it.
 *
 * Sequence: precondition (not processing) → wait until the surface queue is
 * drained and the materialized revision reached every expected one, with its
 * OWN read every grace period while behind (`AppsSurfaceSync` does not re-arm
 * after a failed grace read) → local pre-check → ONE `surface:action` with a
 * 30 s timeout → on a transport failure with no `errorCode` (including that
 * timeout), poll `surface:operation` every 3 s with a 10 s timeout per call
 * until terminal, 150 s after the send, or 3 consecutive poll failures, which
 * settle as `unknown`. Nothing is ever resent. It never calls `chat:*`.
 * Serialization is symmetric: the submit waits for the surface's lanes, and
 * while it is sending or polling the lanes hold (`isSubmitting`) until
 * `finish()` hands the surface back (`submitEnded`).
 *
 * Public methods never throw; `console.warn` names a step and at most an RPC
 * error code or reject reason, never a payload value.
 */

/** `surface:action` timeout: the RPC default, stated explicitly. */
export const APPS_SUBMIT_TIMEOUT_MS = 30_000;
/** Interval between two `surface:operation` polls. */
export const APPS_SUBMIT_POLL_INTERVAL_MS = 3_000;
/** Timeout of one `surface:operation` poll. */
export const APPS_SUBMIT_POLL_TIMEOUT_MS = 10_000;
/** Polling gives up this long after the send (the host allows 120 s). */
export const APPS_SUBMIT_POLL_LIMIT_MS = 150_000;
/** Consecutive poll transport failures that settle the submit as unknown. */
export const APPS_SUBMIT_POLL_MAX_FAILURES = 3;
/** How long a submit waits for the queue and the echo before it gives up. */
export const APPS_SUBMIT_SYNC_LIMIT_MS = 30_000;

export const APPS_SUBMIT_TEXT = {
  sending: 'Sending…',
  sent: 'Sent',
  indeterminate: 'May have been sent - do not resend.',
  unknown:
    'We could not confirm whether this was sent. Check the conversation before sending again.',
  stale: 'This app changed. Check the values and submit again.',
  busy: 'The agent is busy; try again when it finishes.',
  sessionUnavailable: 'This conversation is not running.',
  notSynced:
    'This app did not finish syncing. Check the values and submit again.',
  refused: 'The request was refused. Nothing was sent.',
  notFound: 'This app is no longer available.',
} as const;

/** Where the submit flow reads and writes; implemented by the facade. */
export interface AppsSubmitHost {
  /** The held entry of `surfaceId`, or null when it is gone or not shown. */
  entry(surfaceId: string): AppsSurfaceEntry | null;
  /** True while the conversation's agent is running a turn. */
  isProcessing(): boolean;
  /**
   * `draining`: a mutation of the surface is queued or in flight.
   * `behind`: an expected revision is above the materialized one.
   */
  syncState(surfaceId: string): 'settled' | 'draining' | 'behind';
  requestRead(): void;
  /** Rule 1: an acknowledged revision; never materialized by the flow. */
  expectRevision(surfaceId: string, revision: number): void;
  setAction(
    surfaceId: string,
    actionId: string,
    state: SurfaceActionUiState,
  ): void;
  /** Replaces the surface's per-input issues (component id → messages). */
  setIssues(
    surfaceId: string,
    issues: ReadonlyMap<string, readonly string[]>,
  ): void;
  /**
   * A host-started turn: the transcript shows "Submitted: {label}", stamped
   * with `sentAt`, the time `surface:action` was SENT, so the bubble sorts
   * before the reply it caused however late the result or the poll lands.
   */
  submitted(text: string, sentAt: number): void;
  /** The submit ended: mutations held behind it may send now. */
  submitEnded(): void;
}

interface ActiveSubmit {
  readonly surfaceId: string;
  readonly actionId: string;
  readonly label: string;
  readonly startedAt: number;
  phase: 'waiting' | 'sending' | 'polling';
  operationId: string | null;
  sentAt: number;
  pollFailures: number;
}

/** The terminal shapes both `surface:action` and `surface:operation` map to. */
type SubmitOutcome =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'applied' | 'indeterminate';
      readonly revision: number | null;
      readonly detail: string | null;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: SurfaceRejectReason | null;
      readonly detail: string;
      readonly issues: readonly SurfaceSubmitIssue[];
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unsupported'; readonly detail: string }
  | { readonly kind: 'unknown' };

const REJECT_REASONS: ReadonlySet<string> = new Set<SurfaceRejectReason>([
  'stale-revision',
  'invalid-value',
  'undeclared',
  'submit-invalid',
  'busy',
  'session-unavailable',
  'operation-conflict',
  'operation-expired',
  'too-many-operations',
  'budget',
  'unsupported',
]);

const WARN_PREFIX = '[AppsSubmitFlow]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Boundary guard for a host reject reason; null when not one of the set. */
export function readSurfaceRejectReason(
  value: unknown,
): SurfaceRejectReason | null {
  return typeof value === 'string' && REJECT_REASONS.has(value)
    ? (value as SurfaceRejectReason)
    : null;
}

function readIssues(value: unknown): SurfaceSubmitIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: SurfaceSubmitIssue[] = [];
  for (const candidate of value) {
    if (
      isRecord(candidate) &&
      typeof candidate['componentId'] === 'string' &&
      typeof candidate['message'] === 'string'
    ) {
      issues.push({
        componentId: candidate['componentId'],
        path: textOf(candidate['path']),
        message: candidate['message'],
      });
    }
  }
  return issues;
}

function surfaceStateRevision(value: unknown): number | null {
  return isRecord(value) &&
    value['kind'] === 'updated' &&
    isRevision(value['revision'])
    ? value['revision']
    : null;
}

/** Boundary guard for a `surface:action` result (`SurfaceActionResult`). */
export function readSubmitActionResult(data: unknown): SubmitOutcome {
  if (!isRecord(data)) return { kind: 'unknown' };
  switch (data['status']) {
    case 'pending':
      return { kind: 'pending' };
    case 'applied':
    case 'indeterminate':
      return {
        kind: data['status'],
        revision: surfaceStateRevision(data['surfaceState']),
        detail: typeof data['detail'] === 'string' ? data['detail'] : null,
      };
    case 'rejected':
      return {
        kind: 'rejected',
        reason: readSurfaceRejectReason(data['reason']),
        detail: textOf(data['detail']),
        issues: readIssues(data['issues']),
      };
    case 'not-found':
      return { kind: 'not-found' };
    case 'unsupported':
      return { kind: 'unsupported', detail: textOf(data['detail']) };
    default:
      return { kind: 'unknown' };
  }
}

/** Boundary guard for a `surface:operation` result (`SurfaceOperationResult`). */
export function readSubmitOperationResult(data: unknown): SubmitOutcome {
  if (!isRecord(data)) return { kind: 'unknown' };
  switch (data['status']) {
    case 'pending':
      return { kind: 'pending' };
    case 'applied':
    case 'indeterminate':
      return {
        kind: data['status'],
        revision: isRevision(data['revision']) ? data['revision'] : null,
        detail: typeof data['detail'] === 'string' ? data['detail'] : null,
      };
    case 'rejected': {
      const reason = readSurfaceRejectReason(data['reason']);
      return reason === 'unsupported'
        ? { kind: 'unsupported', detail: textOf(data['detail']) }
        : {
            kind: 'rejected',
            reason,
            detail: textOf(data['detail']),
            issues: [],
          };
    }
    default:
      return { kind: 'unknown' };
  }
}

function groupIssues(
  issues: readonly SurfaceSubmitIssue[],
): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const issue of issues) {
    const messages = grouped.get(issue.componentId) ?? [];
    messages.push(issue.message);
    grouped.set(issue.componentId, messages);
  }
  return grouped;
}

function rejectionText(
  reason: SurfaceRejectReason | null,
  detail: string,
): string {
  switch (reason) {
    case 'stale-revision':
      return APPS_SUBMIT_TEXT.stale;
    case 'busy':
      return APPS_SUBMIT_TEXT.busy;
    case 'session-unavailable':
      return APPS_SUBMIT_TEXT.sessionUnavailable;
    default:
      return detail.length > 0 ? detail : APPS_SUBMIT_TEXT.refused;
  }
}

export class AppsSubmitFlow {
  private disposed = false;
  private active: ActiveSubmit | null = null;
  /** The single timer of this routing id: the sync-wait or the poll tick. */
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Aborted by `dispose()`, which also releases the RPC timers in flight. */
  private readonly controller = new AbortController();

  public constructor(
    private readonly rpc: AppsSurfaceRpc,
    public readonly routingId: string,
    private readonly host: AppsSubmitHost,
  ) {}

  /** True while a submit of this routing id is waiting, sending or polling. */
  public get isActive(): boolean {
    return this.active !== null;
  }

  /**
   * True while a submit of `surfaceId` is sending or polling. Its changes and
   * selects hold until it ends; a submit still WAITING for the lanes does
   * not hold them (it waits for them instead).
   */
  public isSubmitting(surfaceId: string): boolean {
    return (
      this.active !== null &&
      this.active.surfaceId === surfaceId &&
      this.active.phase !== 'waiting'
    );
  }

  /** True while the tick timer is armed; for diagnostics and specs. */
  public get hasTimer(): boolean {
    return this.timer !== null;
  }

  /**
   * Submit `actionId` of `surfaceId`. Ignored while processing (the button
   * is disabled then) or while another submit of this routing id is active.
   */
  public submit(surfaceId: string, actionId: string): void {
    try {
      if (this.disposed || this.active !== null || this.host.isProcessing())
        return;
      const entry = this.host.entry(surfaceId);
      if (entry === null) return;
      this.active = {
        surfaceId,
        actionId,
        label: this.labelOf(entry, actionId),
        startedAt: Date.now(),
        phase: 'waiting',
        operationId: null,
        sentAt: 0,
        pollFailures: 0,
      };
      this.host.setIssues(surfaceId, new Map());
      this.host.setAction(surfaceId, actionId, {
        status: 'pending',
        detail: APPS_SUBMIT_TEXT.sending,
      });
      this.advance();
    } catch (error: unknown) {
      this.fail('submit', error);
    }
  }

  /**
   * The facade calls this whenever the surfaces or its queue changed: a
   * waiting submit sends as soon as the surface is settled.
   */
  public onStateChanged(): void {
    try {
      if (!this.disposed) this.advance();
    } catch (error: unknown) {
      this.fail('state change', error);
    }
  }

  /** Clears the timer and aborts the RPC in flight. Idempotent. */
  public dispose(): void {
    this.disposed = true;
    this.active = null;
    this.clearTimer();
    this.controller.abort();
  }

  private labelOf(entry: AppsSurfaceEntry, actionId: string): string {
    const renderable = entry.renderable;
    if (
      renderable.status !== 'accepted' ||
      renderable.content.contract !== 'dashboard-spec/2'
    )
      return actionId;
    const found = findSurfaceAction(
      renderable.content.surface.components,
      actionId,
    );
    return found?.action.label.text ?? actionId;
  }

  private advance(): void {
    const active = this.active;
    if (active === null || active.phase !== 'waiting') return;
    const state = this.host.syncState(active.surfaceId);
    if (state === 'settled') {
      this.clearTimer();
      this.preCheckAndSend(active);
      return;
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => this.onWaitTick(), APPS_ECHO_GRACE_MS);
    }
  }

  /** Rule 3 for the submit: its own read every grace period while behind. */
  private onWaitTick(): void {
    this.timer = null;
    const active = this.active;
    if (this.disposed || active === null || active.phase !== 'waiting') return;
    try {
      const state = this.host.syncState(active.surfaceId);
      if (state === 'settled') {
        this.advance();
        return;
      }
      if (Date.now() - active.startedAt >= APPS_SUBMIT_SYNC_LIMIT_MS) {
        console.warn(`${WARN_PREFIX} surface did not settle before submit`);
        this.finish({ status: 'rejected', detail: APPS_SUBMIT_TEXT.notSynced });
        return;
      }
      if (state === 'behind') this.host.requestRead();
      this.timer = setTimeout(() => this.onWaitTick(), APPS_ECHO_GRACE_MS);
    } catch (error: unknown) {
      this.fail('wait', error);
    }
  }

  private preCheckAndSend(active: ActiveSubmit): void {
    const entry = this.host.entry(active.surfaceId);
    if (entry === null) {
      this.finish({ status: 'not-found', detail: APPS_SUBMIT_TEXT.notFound });
      return;
    }
    if (this.host.isProcessing()) {
      this.finish({
        status: 'rejected',
        reason: 'busy',
        detail: APPS_SUBMIT_TEXT.busy,
      });
      return;
    }
    const renderable = entry.renderable;
    if (
      renderable.status !== 'accepted' ||
      renderable.content.contract !== 'dashboard-spec/2'
    ) {
      this.finish({ status: 'unsupported', detail: APPS_SUBMIT_TEXT.refused });
      return;
    }
    const scope = collectSubmitScope(
      renderable.content.surface.components,
      active.actionId,
    );
    if (!scope.ok) {
      this.finish({ status: 'rejected', detail: scope.reason });
      return;
    }
    const values = checkSubmitValues(
      scope.inputs,
      renderable.content.dataModel,
    );
    if (!values.ok) {
      // Nothing is sent: that saves a host ledger record.
      this.host.setIssues(active.surfaceId, groupIssues(values.issues));
      this.finish({
        status: 'rejected',
        reason: 'submit-invalid',
        detail: values.reason,
      });
      return;
    }
    void this.send(active, entry.materializedRevision).catch((error: unknown) =>
      this.fail('send', error),
    );
  }

  private async send(active: ActiveSubmit, revision: number): Promise<void> {
    const operationId = createSurfaceOperationId();
    active.phase = 'sending';
    active.operationId = operationId;
    active.sentAt = Date.now();
    let outcome: SubmitOutcome | 'transport';
    try {
      const result = await this.rpc.call(
        'surface:action',
        {
          routingId: this.routingId,
          surfaceId: active.surfaceId,
          revision,
          operationId,
          actionId: active.actionId,
        },
        { timeout: APPS_SUBMIT_TIMEOUT_MS, signal: this.controller.signal },
      );
      if (this.active !== active) return;
      if (result.isSuccess()) {
        outcome = readSubmitActionResult(result.data);
      } else if (result.errorCode !== undefined) {
        // A host refusal: nothing was recorded, nothing changed.
        console.warn(
          `${WARN_PREFIX} surface:action refused: ${result.errorCode}`,
        );
        this.finish({ status: 'rejected', detail: APPS_SUBMIT_TEXT.refused });
        return;
      } else {
        outcome = 'transport';
      }
    } catch (error: unknown) {
      if (this.active !== active) return;
      console.warn(`${WARN_PREFIX} surface:action failed: ${errorName(error)}`);
      outcome = 'transport';
    }
    // A transport failure (including the 30 s timeout) or `pending` is not a
    // result: poll the operation id, never resend.
    if (outcome === 'transport' || outcome.kind === 'pending') {
      this.startPolling(active);
      return;
    }
    this.settle(active, outcome);
  }

  private startPolling(active: ActiveSubmit): void {
    active.phase = 'polling';
    active.pollFailures = 0;
    this.schedulePoll(active);
  }

  private schedulePoll(active: ActiveSubmit): void {
    const remaining = active.sentAt + APPS_SUBMIT_POLL_LIMIT_MS - Date.now();
    this.clearTimer();
    this.timer = setTimeout(
      () =>
        void this.poll(active).catch((error: unknown) =>
          this.fail('poll', error),
        ),
      Math.max(0, Math.min(APPS_SUBMIT_POLL_INTERVAL_MS, remaining)),
    );
  }

  private async poll(active: ActiveSubmit): Promise<void> {
    this.timer = null;
    if (this.disposed || this.active !== active || active.operationId === null)
      return;
    if (Date.now() - active.sentAt >= APPS_SUBMIT_POLL_LIMIT_MS) {
      console.warn(`${WARN_PREFIX} polling stopped at the time limit`);
      this.settle(active, { kind: 'unknown' });
      return;
    }
    let outcome: SubmitOutcome | null = null;
    try {
      const result = await this.rpc.call(
        'surface:operation',
        { routingId: this.routingId, operationId: active.operationId },
        {
          timeout: APPS_SUBMIT_POLL_TIMEOUT_MS,
          signal: this.controller.signal,
        },
      );
      if (this.active !== active) return;
      if (result.isSuccess()) {
        outcome = readSubmitOperationResult(result.data);
      } else {
        console.warn(
          `${WARN_PREFIX} surface:operation failed: ${result.errorCode ?? 'transport'}`,
        );
      }
    } catch (error: unknown) {
      if (this.active !== active) return;
      console.warn(
        `${WARN_PREFIX} surface:operation failed: ${errorName(error)}`,
      );
    }
    if (outcome === null) {
      active.pollFailures += 1;
      if (active.pollFailures >= APPS_SUBMIT_POLL_MAX_FAILURES) {
        this.settle(active, { kind: 'unknown' });
        return;
      }
      this.schedulePoll(active);
      return;
    }
    active.pollFailures = 0;
    if (outcome.kind === 'pending') {
      this.schedulePoll(active);
      return;
    }
    this.settle(active, outcome);
  }

  private settle(active: ActiveSubmit, outcome: SubmitOutcome): void {
    switch (outcome.kind) {
      case 'applied':
      case 'indeterminate':
        // Rule 1: the committed revision is EXPECTED, never materialized.
        if (outcome.revision !== null)
          this.host.expectRevision(active.surfaceId, outcome.revision);
        // The host started the turn, not `chat:continue`.
        this.host.submitted(`Submitted: ${active.label}`, active.sentAt);
        this.finish(
          outcome.kind === 'applied'
            ? { status: 'applied', detail: APPS_SUBMIT_TEXT.sent }
            : {
                status: 'indeterminate',
                detail: APPS_SUBMIT_TEXT.indeterminate,
              },
        );
        return;
      case 'rejected':
        if (outcome.reason === 'stale-revision') this.host.requestRead();
        if (outcome.reason === 'submit-invalid' && outcome.issues.length > 0)
          this.host.setIssues(active.surfaceId, groupIssues(outcome.issues));
        this.finish({
          status: 'rejected',
          ...(outcome.reason !== null ? { reason: outcome.reason } : {}),
          detail: rejectionText(outcome.reason, outcome.detail),
        });
        return;
      case 'not-found':
        this.host.requestRead();
        this.finish({ status: 'not-found', detail: APPS_SUBMIT_TEXT.notFound });
        return;
      case 'unsupported':
        this.finish({
          status: 'unsupported',
          detail:
            outcome.detail.length > 0
              ? outcome.detail
              : APPS_SUBMIT_TEXT.refused,
        });
        return;
      case 'pending':
      case 'unknown':
        this.finish({ status: 'unknown', detail: APPS_SUBMIT_TEXT.unknown });
        return;
    }
  }

  /** Ends the active submit with its final state and releases the timer. */
  private finish(state: SurfaceActionUiState): void {
    const active = this.active;
    this.active = null;
    this.clearTimer();
    if (active === null || this.disposed) return;
    this.host.setAction(active.surfaceId, active.actionId, state);
    // The lanes held behind this submit send now, on the materialized base.
    this.host.submitEnded();
  }

  private fail(step: string, error: unknown): void {
    console.warn(`${WARN_PREFIX} ${step} failed: ${errorName(error)}`);
    // Before the send nothing left the page; after it, the outcome is open.
    const sent = this.active !== null && this.active.operationId !== null;
    this.finish(
      sent
        ? { status: 'unknown', detail: APPS_SUBMIT_TEXT.unknown }
        : { status: 'rejected', detail: APPS_SUBMIT_TEXT.notSynced },
    );
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
