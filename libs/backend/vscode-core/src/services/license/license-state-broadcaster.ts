/**
 * License State Broadcaster (Wave C7a — TASK_2025_291)
 *
 * Extracted from {@link LicenseService}.
 *
 * Responsibilities:
 * - Duplicate-suppressed license event decisions (verified / expired)
 * - Owns the `lastEmittedStatus` deduplication tracker
 *
 * This helper is **library-internal** — it is not `@injectable()` and is not
 * exported from the public barrel. It is **not** an EventEmitter itself;
 * instead it returns a {@link BroadcastDecision} and {@link LicenseService}
 * (which already extends EventEmitter) owns emission. This preserves the
 * coordinator's public EventEmitter surface unchanged.
 *
 * @packageDocumentation
 */

import type { Logger } from '../../logging';
import type { LicenseStatus, LicenseTierValue } from './license-types';

/**
 * Decision returned by {@link LicenseStateBroadcaster.decide}:
 * - `'verified'`: caller should emit `license:verified`
 * - `'expired'`: caller should emit `license:expired`
 * - `'suppressed'`: caller should NOT emit (duplicate of the last event)
 */
export type BroadcastDecision = 'verified' | 'expired' | 'suppressed';

/**
 * Computes duplicate-suppressed event decisions for license status updates.
 *
 * Preserves the exact semantics of the original
 * `LicenseService.emitLicenseEvent()`:
 * - If the previous emitted (valid, tier) tuple equals the current one, the
 *   event is suppressed (returns `'suppressed'`).
 * - Otherwise, the new tuple is recorded and either `'verified'` or
 *   `'expired'` is returned based on `status.valid`.
 */
export class LicenseStateBroadcaster {
  /** Tracks the last emitted status to suppress duplicate events. */
  private lastEmittedStatus: { valid: boolean; tier: LicenseTierValue } | null =
    null;

  constructor(private readonly logger: Logger) {}

  /**
   * Decide what to do with a new license status.
   *
   * Side-effect: on a non-suppressed decision, updates the internal
   * `lastEmittedStatus` so subsequent equal statuses are suppressed.
   */
  decide(status: LicenseStatus): BroadcastDecision {
    const previous = this.lastEmittedStatus;
    if (
      previous &&
      previous.valid === status.valid &&
      previous.tier === status.tier
    ) {
      this.logger.debug(
        '[LicenseService.emitLicenseEvent] Suppressed duplicate event',
        { tier: status.tier, valid: status.valid },
      );
      return 'suppressed';
    }

    this.lastEmittedStatus = { valid: status.valid, tier: status.tier };

    return status.valid ? 'verified' : 'expired';
  }

  /**
   * Clear the deduplication tracker. Called on setLicenseKey /
   * clearLicenseKey so the next emission is never suppressed.
   */
  reset(): void {
    this.lastEmittedStatus = null;
  }
}
