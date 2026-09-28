/**
 * HarnessPolicySync — makes the harness catch up with the capability policy a
 * session was built against (TASK_2026_560, C5a / N4).
 *
 * A session is built under one policy, identified by its
 * `harnessPolicyFingerprint`. The harness (skill copies, plugin overlays) is
 * reconciled by a separate, throttled preflight that knows nothing about that
 * session. This class closes the gap:
 *
 * 1. `ensure(root, {force})`, forced whenever the fingerprint differs from the
 *    last one a pass acknowledged for this root — a toggle or a legacy
 *    `plugins:save-config` write changes the fingerprint, so it bypasses the
 *    throttle.
 * 2. A pass that stamped a different fingerprint planned against another
 *    policy. That is also what a JOINED pass looks like: the preflight joins a
 *    pass already in flight even when forced, and that pass carries the older
 *    fingerprint. Either way, one more forced pass runs — at most one.
 * 3. The fingerprint is recorded as acknowledged only when
 *    `isHarnessPassAcknowledged` says the pass applied it (same fingerprint,
 *    readable sources, no write failure).
 *
 * Callers decide what an unacknowledged answer means; for a Claude session it
 * is non-fatal, because `skillOverrides` already denies disabled skills.
 */

import { inject, injectable } from 'tsyringe';
import {
  isHarnessPassAcknowledged,
  type HarnessHealth,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  HARNESS_PREFLIGHT_TOKEN,
  type IHarnessPreflight,
} from './harness-preflight.port';

/** The outcome of one {@link HarnessPolicySync.apply}. */
export interface HarnessPolicySyncResult {
  /** A harness pass applied exactly the requested fingerprint. */
  acknowledged: boolean;
}

const LOG_PREFIX = '[HarnessPolicySync]';

@injectable()
export class HarnessPolicySync {
  /** Policy key → the last fingerprint a pass acknowledged for that root. */
  private readonly lastAck = new Map<string, string>();

  /** The missing-preflight note is written once, not once per session. */
  private reportedNoPreflight = false;

  constructor(
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
    /**
     * Optional: a host without `harness-sync` has no harness to catch up, and
     * every call answers unacknowledged.
     */
    @inject(HARNESS_PREFLIGHT_TOKEN, { isOptional: true })
    private readonly preflight: IHarnessPreflight | null = null,
  ) {}

  /**
   * Bring the harness for `physicalRoot` in line with the policy `fingerprint`.
   *
   * @param physicalRoot The real path of the workspace root. Used for the
   *   preflight call as-is; only the acknowledgement key is case-folded, and
   *   only on win32 (N7).
   */
  async apply(
    physicalRoot: string,
    fingerprint: string,
  ): Promise<HarnessPolicySyncResult> {
    const preflight = this.preflight;
    if (preflight === null) {
      if (!this.reportedNoPreflight) {
        this.reportedNoPreflight = true;
        this.output.appendLine(
          `${LOG_PREFIX} No harness preflight is registered on this host; the harness is not synced to the capability policy.`,
        );
      }
      return { acknowledged: false };
    }

    const key = policyKeyOf(physicalRoot);
    let health = await preflight.ensure(physicalRoot, {
      force: this.lastAck.get(key) !== fingerprint,
    });
    if (health !== null && health.policyFingerprint !== fingerprint) {
      health = await preflight.ensure(physicalRoot, { force: true });
    }

    if (isHarnessPassAcknowledged(health, fingerprint)) {
      this.lastAck.set(key, fingerprint);
      return { acknowledged: true };
    }

    // A pass that ran and did not apply the policy invalidates the old
    // acknowledgement, so the next call forces. No pass at all (throttled,
    // timed out) says nothing new about the harness, and keeping the entry
    // keeps an unchanged policy from forcing a pass on every session start.
    if (health !== null) this.lastAck.delete(key);
    this.output.appendLine(
      `${LOG_PREFIX} Harness pass did not acknowledge policy ${fingerprint} for ${physicalRoot}: ${describeMiss(health, fingerprint)}`,
    );
    return { acknowledged: false };
  }
}

/** The acknowledgement key: the physical root, case-folded on win32 only. */
function policyKeyOf(physicalRoot: string): string {
  return process.platform === 'win32'
    ? physicalRoot.toLowerCase()
    : physicalRoot;
}

/** Why `health` is not an acknowledgement of `fingerprint`, for the log. */
function describeMiss(health: HarnessHealth | null, fingerprint: string): string {
  if (health === null) {
    return 'no pass ran (throttled, timed out or no workspace)';
  }
  if (health.policyFingerprint !== fingerprint) {
    return `the pass applied policy ${health.policyFingerprint ?? 'none'}`;
  }
  if (health.sources !== 'ok') {
    return `harness sources are ${health.sources}`;
  }
  const failed = health.targets.filter(
    (target) => target.writeFailed.length > 0,
  );
  return `writes failed for ${failed.map((target) => target.target).join(', ')}`;
}
