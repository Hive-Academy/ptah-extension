import type { ClaudeRpcService } from '@ptah-extension/core';
import {
  applySurfacePush,
  applySurfaceRead,
  surfaceReadSeq,
} from '../state/apps-surface-reducer';
import type { AppsSurfaceState } from '../state/apps-surface-reducer';

/**
 * `AppsSurfaceSync` — push intake and `surface:read` coordination for ONE
 * workspace slice (implementation-plan.md:454-464, Rules 2-3 at :571-573).
 *
 * A plain class, created by `AppsSessionService` per conversation and
 * released with `dispose()`. It holds no surface state itself: it reads and
 * writes the slice through `AppsSurfaceStore` and runs every transition
 * through the pure reducer (`apps-surface-reducer.ts`).
 *
 * Guarantees:
 * - Rule 2: only an applied push or an applied read result moves a
 *   materialized revision. An RPC acknowledgement only raises the EXPECTED
 *   revision (`expectRevision`), never the materialized one.
 * - At most ONE `surface:read` in flight. Triggers that arrive meanwhile
 *   coalesce into at most one follow-up read, sent when the first settles.
 * - Every read has a 10 s timeout and an abort path (`dispose()`).
 * - A result older than a push applied after the read was SENT cannot undo
 *   it: the reducer's `readSeq` (captured at send time) keeps such entries.
 * - Rule 3: ONE grace timer (1,500 ms). It is armed when an expected revision
 *   is above the materialized one, never multiplied, cleared as soon as the
 *   view catches up, and cleared by `dispose()`. When it fires and the view is
 *   still behind, it requests exactly one read.
 * - Public methods never throw. `console.warn` names the step and at most an
 *   RPC error code, never a payload value.
 */

/** Timeout of one `surface:read` call. */
export const APPS_SURFACE_READ_TIMEOUT_MS = 10_000;

/** Rule 3: how long an acknowledged revision may wait for its echo. */
export const APPS_ECHO_GRACE_MS = 1_500;

/** The slice notice shown after a failed `surface:read` (plan :457). */
export const APPS_REFRESH_FAILED_NOTICE = 'Could not refresh this app';

/** Why a read was requested; used only in diagnostics. */
export type AppsSurfaceReadReason =
  /** The reducer asked for one (gap, unknown surface, ops failure, overflow). */
  | 'needs-read'
  /** Rule 3: an acknowledged revision was not echoed within the grace. */
  | 'echo-missing'
  /** A mutation was refused `stale-revision` or `not-found` (Batch 13). */
  | 'stale-revision'
  /** Triggers that arrived while a read was in flight. */
  | 'coalesced';

/** Where the slice's surface state lives; implemented by the facade. */
export interface AppsSurfaceStore {
  surfaces(): AppsSurfaceState;
  setSurfaces(next: AppsSurfaceState): void;
  setSyncNotice(notice: string | null): void;
}

/** The single RPC method this class needs from `ClaudeRpcService`. */
export type AppsSurfaceRpc = Pick<ClaudeRpcService, 'call'>;

const WARN_PREFIX = '[AppsSurfaceSync]';

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

export class AppsSurfaceSync {
  private disposed = false;
  /** The abort handle of the read in flight; null when none is. */
  private inFlight: AbortController | null = null;
  /** A trigger arrived while a read was in flight. */
  private followUp = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Surface id → highest acknowledged revision not yet materialized. */
  private readonly expected = new Map<string, number>();

  public constructor(
    private readonly rpc: AppsSurfaceRpc,
    public readonly routingId: string,
    private readonly store: AppsSurfaceStore,
  ) {}

  /** True while a `surface:read` is in flight. */
  public get isReading(): boolean {
    return this.inFlight !== null;
  }

  /** True while the Rule 3 grace timer is armed. */
  public get isGraceArmed(): boolean {
    return this.graceTimer !== null;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * One raw `surface:updated` payload from the inbox. A payload for another
   * routing id is dropped before the reducer sees it.
   */
  public onPush(raw: unknown): void {
    try {
      if (this.disposed || !this.isOwnPush(raw)) return;
      const current = this.store.surfaces();
      const result = applySurfacePush(current, raw);
      if (result.state !== current) this.store.setSurfaces(result.state);
      this.reconcileExpected(false);
      if (result.needsRead) this.requestRead('needs-read');
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} push not applied: ${errorName(error)}`);
    }
  }

  /**
   * Ask for a `surface:read`. Sends at once when none is in flight; otherwise
   * records ONE follow-up read, however many triggers arrive meanwhile.
   */
  public requestRead(reason: AppsSurfaceReadReason): void {
    if (this.disposed) return;
    if (this.inFlight !== null) {
      this.followUp = true;
      return;
    }
    // runRead is async: a throw anywhere in it arrives here as a rejection.
    this.runRead(reason).catch((error: unknown) =>
      console.warn(`${WARN_PREFIX} read not completed: ${errorName(error)}`),
    );
  }

  /**
   * Rule 1 → Rule 3: an operation on `surfaceId` settled `applied` at
   * `revision`. The expected revision becomes `max(expected, revision)`. If
   * the view is behind it, the grace timer is armed (once).
   */
  public expectRevision(surfaceId: string, revision: number): void {
    try {
      if (this.disposed || !Number.isSafeInteger(revision) || revision < 0)
        return;
      const previous = this.expected.get(surfaceId);
      this.expected.set(
        surfaceId,
        previous === undefined ? revision : Math.max(previous, revision),
      );
      this.reconcileExpected(false);
      if (this.expected.size > 0 && this.graceTimer === null) {
        this.graceTimer = setTimeout(
          () => this.onGraceElapsed(),
          APPS_ECHO_GRACE_MS,
        );
      }
    } catch (error: unknown) {
      console.warn(`${WARN_PREFIX} revision not expected: ${errorName(error)}`);
    }
  }

  /** The acknowledged revision still awaited for `surfaceId`, or null. */
  public expectedRevision(surfaceId: string): number | null {
    return this.expected.get(surfaceId) ?? null;
  }

  /**
   * Releases everything: the grace timer, the pending follow-up and the read
   * in flight (aborted, so its RPC timer is released too). Idempotent.
   */
  public dispose(): void {
    this.disposed = true;
    this.clearGrace();
    this.followUp = false;
    this.expected.clear();
    const inFlight = this.inFlight;
    this.inFlight = null;
    inFlight?.abort();
  }

  private isOwnPush(raw: unknown): boolean {
    return (
      typeof raw === 'object' &&
      raw !== null &&
      'routingId' in raw &&
      raw.routingId === this.routingId
    );
  }

  private async runRead(reason: AppsSurfaceReadReason): Promise<void> {
    const controller = new AbortController();
    this.inFlight = controller;
    this.followUp = false;
    // Captured at SEND time: entries changed after this survive the result.
    const readSeq = surfaceReadSeq(this.store.surfaces());
    let succeeded = false;
    let errorCode = 'transport';
    try {
      const result = await this.rpc.call(
        'surface:read',
        { routingId: this.routingId },
        { timeout: APPS_SURFACE_READ_TIMEOUT_MS, signal: controller.signal },
      );
      if (this.disposed || this.inFlight !== controller) return;
      if (result.isSuccess()) {
        const applied = applySurfaceRead(
          this.store.surfaces(),
          result.data,
          readSeq,
        );
        if (applied.outcome !== 'malformed') {
          this.store.setSurfaces(applied.state);
          succeeded = true;
        } else {
          errorCode = 'malformed';
        }
      } else if (result.errorCode !== undefined) {
        errorCode = result.errorCode;
      }
    } catch (error: unknown) {
      // degradation-audit: reported - a failed read keeps its error code,
      // which is logged below and published as the refresh-failed notice.
      // The early return only drops the result of a read that dispose() or
      // a newer read already replaced; that newer read reports for itself.
      if (this.disposed || this.inFlight !== controller) return;
      errorCode = errorName(error);
    }

    this.inFlight = null;
    if (succeeded) {
      this.store.setSyncNotice(null);
      this.reconcileExpected(true);
    } else {
      // Keep the last good view; the next trigger retries.
      console.warn(
        `${WARN_PREFIX} surface:read (${reason}) failed: ${errorCode}`,
      );
      this.store.setSyncNotice(APPS_REFRESH_FAILED_NOTICE);
    }
    if (this.followUp) this.requestRead('coalesced');
  }

  private onGraceElapsed(): void {
    this.graceTimer = null;
    if (this.disposed) return;
    this.reconcileExpected(false);
    if (this.expected.size > 0) this.requestRead('echo-missing');
  }

  /**
   * Drops every expectation the view has caught up with. After a read (the
   * host's complete state), an expectation for a surface the host no longer
   * holds can never be met and is dropped too. With nothing left to wait
   * for, the grace timer is cleared.
   */
  private reconcileExpected(afterRead: boolean): void {
    const entries = this.store.surfaces().entries;
    for (const [surfaceId, revision] of this.expected) {
      const entry = entries.get(surfaceId);
      if (entry === undefined) {
        if (afterRead) this.expected.delete(surfaceId);
      } else if (entry.materializedRevision >= revision) {
        this.expected.delete(surfaceId);
      }
    }
    if (this.expected.size === 0) this.clearGrace();
  }

  private clearGrace(): void {
    if (this.graceTimer === null) return;
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }
}
