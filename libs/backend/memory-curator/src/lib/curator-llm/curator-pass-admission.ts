/**
 * When a curation pass may take its turn — TASK_2026_437 C14 (f) and FU-16b-a.
 *
 * Two gates decide it, and both hold BACKGROUND passes only. A pass a user is
 * waiting on (`memory:runNow`, `userInitiated: true`) passes straight through.
 *
 * ## 1. Governor clearance BEFORE the job queue (FU-16b-a)
 *
 * `CuratorJobQueue` runs one pass at a time. A background pass used to enter
 * the queue first and meet the background-work governor only inside its first
 * LLM call, so while a chat turn generated it sat at the head of the queue for
 * up to the governor's 10-minute ceiling — and `memory:runNow` for any session
 * waited behind it, often ending as `CuratorQueueWaitTimeoutError` (180 s).
 *
 * The fix is ORDER: a background pass waits for `whenClear()` first and claims
 * its queue position after. A waiting background pass therefore holds nothing
 * a user-initiated pass needs. The queue's semantics are unchanged — it still
 * serialises every pass it is handed.
 *
 * One case needs more than order: `memory:runNow` for the SAME session as a
 * background pass still waiting for clearance. `curate()` coalesces the two
 * calls onto one promise, so the user would inherit the wait. {@link promote}
 * ends that wait and marks the pass user-initiated, so it runs on the
 * ungoverned `user-action` lane. A pass already past clearance cannot be
 * promoted: its queries are dispatched on the lane it started with (logged by
 * the service).
 *
 * ## 2. Network back-off
 *
 * After a network-class failure (`provider-unreachable` stall) background
 * passes back off 30 s doubling to 15 min, reset by the first pass that gets
 * an answer (`NetworkBackoff`). A background pass meeting an open window is
 * deferred with its input untouched. The check runs at dispatch — the service
 * asks {@link networkDeferralMs} when the pass reaches the head of the queue —
 * and a background pass does not wait for the governor while a window is open,
 * because it would only be deferred at the end of that wait.
 *
 * Only the EXTRACT outcome feeds the back-off. A resolve call that finds the
 * provider unreachable degrades to unmerged drafts inside the adapter
 * (`ICuratorLLM.resolve` has no stalled arm by contract), and a resolve that
 * throws is recorded as a curator error — neither opens a window. That is a
 * known gap, dormant while the adapter swallows resolve's network failures:
 * the next pass's extract is the probe.
 *
 * One back-off, not one per provider: the curator has a single provider path
 * (`memory.curatorProvider`, or the active provider), unlike skill-synthesis
 * lanes.
 *
 * Constructed by the service rather than injected, like `CuratorWindowRunner`.
 */
import type {
  BackgroundWorkAdmission,
  Logger,
} from '@ptah-extension/vscode-core';
import { NetworkBackoff } from '@ptah-extension/agent-sdk';
import type { WindowedExtraction } from './curator-window-runner';

/** The internal-query lane a background pass is charged to; names the ceiling log line. */
const CURATOR_GOVERNED_LANE = 'memory-curator';

/**
 * How a pass left the clearance gate.
 *
 * `promoted` — a user-initiated call for the same session ended the wait; the
 * pass must run as user-initiated. `cancelled` — the governor was disposed
 * (host shutdown) while the pass waited; it must defer without dispatching.
 */
export type CuratorClearance = 'proceed' | 'promoted' | 'cancelled';

interface PendingClearance {
  readonly controller: AbortController;
  promoted: boolean;
}

export class CuratorPassAdmission {
  private readonly pending = new Map<string, PendingClearance>();
  private readonly backoff: NetworkBackoff;

  constructor(
    logger: Logger,
    private readonly governor: BackgroundWorkAdmission | null,
    backoff?: NetworkBackoff,
  ) {
    this.backoff =
      backoff ?? new NetworkBackoff({ logger, logPrefix: '[memory-curator]' });
  }

  /**
   * The wait a pass must do before it may enter the job queue, or `null` when
   * it may enter now. `null` keeps the no-wait path synchronous, so
   * `curate()` submits to the queue in call order exactly as before.
   *
   * @param key The pass's coalescing key; `null` for a pass that cannot
   *   coalesce and therefore cannot be promoted.
   */
  clearance(
    key: string | null,
    userInitiated: boolean,
    signal: AbortSignal | undefined,
  ): Promise<CuratorClearance> | null {
    // A clear governor, like no governor, admits at once — synchronously.
    if (userInitiated || !this.governor || this.governor.isClear()) return null;
    // An open back-off window defers the pass at dispatch anyway.
    if (this.networkDeferralMs(false) > 0) return null;

    const entry: PendingClearance = {
      controller: new AbortController(),
      promoted: false,
    };
    const onCallerAbort = (): void => entry.controller.abort();
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (signal?.aborted) entry.controller.abort();
    if (key !== null) this.pending.set(key, entry);

    return this.governor
      .whenClear({
        signal: entry.controller.signal,
        lane: CURATOR_GOVERNED_LANE,
      })
      .then(
        (): CuratorClearance => (entry.promoted ? 'promoted' : 'proceed'),
        (error: unknown): CuratorClearance => {
          if (entry.promoted) return 'promoted';
          // The caller withdrew: let the pass reach dispatch, where
          // `doCurate` reports it as `caller-aborted` without running.
          if (signal?.aborted) return 'proceed';
          if (error instanceof Error && error.name === 'AbortError') {
            return 'cancelled';
          }
          // `whenClear` rejects only with `AbortError`. Anything else is a
          // governor defect, and a broken governor admits, as it does for
          // the internal-query gate (Batch 16).
          return 'proceed';
        },
      )
      .finally(() => {
        signal?.removeEventListener('abort', onCallerAbort);
        if (key !== null && this.pending.get(key) === entry) {
          this.pending.delete(key);
        }
      });
  }

  /**
   * A user-initiated call joined the pass coalesced under `key`. When that
   * pass is still waiting for clearance, end the wait and run it as
   * user-initiated. Returns whether it did.
   */
  promote(key: string | null): boolean {
    if (key === null) return false;
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.promoted = true;
    this.pending.delete(key);
    entry.controller.abort();
    return true;
  }

  /**
   * Milliseconds an open network back-off window still holds a pass; `0` when
   * the pass may dispatch. Always `0` for a user-initiated pass.
   */
  networkDeferralMs(userInitiated: boolean): number {
    return userInitiated ? 0 : this.backoff.remainingMs();
  }

  /**
   * Feed one pass's extraction outcome to the back-off. An unreachable
   * provider raises it; a pass the model answered — with drafts, or by working
   * through tools — clears it. Everything else is no evidence either way.
   */
  recordExtraction(extraction: WindowedExtraction): void {
    if (
      extraction.status === 'stalled' &&
      extraction.reason === 'provider-unreachable'
    ) {
      this.backoff.recordFailure();
      return;
    }
    if (
      extraction.status === 'extracted' ||
      (extraction.status === 'no-output' && extraction.usedTools)
    ) {
      this.backoff.recordSuccess();
    }
  }
}
