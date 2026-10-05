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
    try {
      const snapshot = await this.snapshots.currentSnapshot();
      if (this.disposed) return;
      await this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
        snapshot,
      );
    } catch (error: unknown) {
      // Only the failure kind: a snapshot or transport error may quote a
      // response body. The next ledger change pushes again.
      this.logger.debug('[PlanLimitsBroadcaster] push failed', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      this.pushing = false;
      if (this.dirty && !this.disposed) {
        this.dirty = false;
        void this.push();
      }
    }
  }
}
