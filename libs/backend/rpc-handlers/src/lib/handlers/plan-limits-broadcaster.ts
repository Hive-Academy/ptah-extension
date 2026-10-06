/**
 * PlanLimitsBroadcaster (TASK_2026_596, Component 12; Decision 7).
 *
 * Pushes `MESSAGE_TYPES.PLAN_LIMITS_CHANGED` with the full
 * `PlanLimitsSnapshot` after the plan-limit ledger changes, so stats tiles and
 * the dashboard update without a reload or a refresh.
 *
 * - Subscribes to `ledger.onChange` in its constructor. Constructing it is
 *   what creates the ledger at host startup: `activateSessionLifecycleNotifier`
 *   resolves this class on every host, and the ledger subscribes to the native
 *   stream and the proxies in its own constructor.
 * - One timer. The first change arms it for {@link PLAN_LIMITS_PUSH_DELAY_MS};
 *   changes while it is armed join that push. At most one push per window,
 *   and a steady stream of changes cannot postpone the push indefinitely.
 * - The snapshot repeats the scope of the last `provider:getPlanLimits` call
 *   (`PlanLimitsSnapshotService.currentSnapshot`), without a refresh.
 * - When two pushes overlap, only the newest one is sent.
 * - A failed snapshot or broadcast is logged at debug level and not retried;
 *   the next change, or the view's own 30 s load, recovers.
 * - One push is bounded by {@link PLAN_LIMITS_PUSH_BOUND_MS}: a snapshot or
 *   broadcast that never settles clears `pushing` after the bound instead of
 *   wedging the pipeline, logs a debug line, and the next change pushes again.
 *   A snapshot that settles after its push gave up is not broadcast; a
 *   broadcast already handed to the transport cannot be recalled.
 * - `dispose()` is synchronous and idempotent: it clears the timer and
 *   unsubscribes.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type PlanLimitLedgerService,
} from '@ptah-extension/auth-providers';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { PlanLimitsSnapshotService } from '../services/plan-limits-snapshot.service';
import type { WebviewBroadcaster } from './session-lifecycle-notifier';

/** Window over which ledger changes are folded into one push. */
export const PLAN_LIMITS_PUSH_DELAY_MS = 500;

/**
 * Upper bound on one push's snapshot and broadcast (Decision 5). A push that
 * exceeds it gives up, so `pushing` can never stay wedged; it stays below the
 * ledger's own slowest recovery paths (the next change re-pushes).
 */
export const PLAN_LIMITS_PUSH_BOUND_MS = 10_000;

/** Error name reported for a push leg that exceeded {@link PLAN_LIMITS_PUSH_BOUND_MS}. */
const PLAN_LIMITS_PUSH_TIMEOUT = 'PlanLimitsPushTimeout';

/** Rejection {@link withinBound} uses when its bound expires. */
class PlanLimitsPushTimeoutError extends Error {
  constructor() {
    super('plan limits push exceeded its bound');
    this.name = PLAN_LIMITS_PUSH_TIMEOUT;
  }
}

/**
 * Resolve with `work`'s result, or reject when `ms` elapses first. The timer is
 * cleared on settle (so a normally fast push leaves no live timer) and
 * `unref`'d (so a hung work never holds the host open). A late settlement
 * after expiry is a no-op: the derived promise has already rejected.
 */
function withinBound<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PlanLimitsPushTimeoutError()),
      ms,
    );
    timer.unref?.();
    work.then(
      (value: T) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type PlanLimitsChangeSource = Pick<PlanLimitLedgerService, 'onChange'>;
export type PlanLimitsCurrentSnapshot = Pick<
  PlanLimitsSnapshotService,
  'currentSnapshot'
>;

@injectable()
export class PlanLimitsBroadcaster {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private pushing = false;
  private dirty = false;
  private disposed = false;
  /** Bumped per push, so a push that gave up can tell its result is stale. */
  private pushGeneration = 0;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)
    ledger: PlanLimitsChangeSource,
    @inject(PlanLimitsSnapshotService)
    private readonly snapshots: PlanLimitsCurrentSnapshot,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
  ) {
    this.unsubscribe = ledger.onChange(() => this.schedule());
  }

  /** Clear the pending push and unsubscribe from the ledger. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    unsubscribe?.();
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.pushing) {
      this.dirty = true;
      return;
    }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.push();
    }, PLAN_LIMITS_PUSH_DELAY_MS);
    this.timer.unref?.();
  }

  private async push(): Promise<void> {
    if (this.disposed || this.pushing) return;
    this.pushing = true;
    const generation = ++this.pushGeneration;
    try {
      const snapshot = await withinBound(
        this.snapshots.currentSnapshot(),
        PLAN_LIMITS_PUSH_BOUND_MS,
      );
      // A newer push owns the next broadcast (this one timed out and a dirty
      // re-arm started, or the store re-opened); a snapshot handed on from a
      // stale push must not overwrite the newer one (Decision 5).
      if (this.disposed || generation !== this.pushGeneration) return;
      await withinBound(
        this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
          snapshot,
        ),
        PLAN_LIMITS_PUSH_BOUND_MS,
      );
    } catch (error: unknown) {
      // Only the failure kind: a snapshot or transport error may quote a
      // response body. The next ledger change pushes again.
      if (error instanceof PlanLimitsPushTimeoutError) {
        this.logger.debug('[PlanLimitsBroadcaster] push timed out', {
          errorName: error.name,
        });
      } else {
        this.logger.debug('[PlanLimitsBroadcaster] push failed', {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    } finally {
      this.pushing = false;
      if (this.dirty && !this.disposed) {
        this.dirty = false;
        void this.push();
      }
    }
  }
}
