import type { Logger } from '@ptah-extension/vscode-core';

/** The capabilities the shutdown drain needs from a named-account flow. */
export interface SettleableNamedAdmission {
  /** Terminal and idempotent: repeat calls return the same settlement. */
  dispose(): Promise<void>;
  /**
   * Resolves once the flow holds no lease it has not settled (released,
   * retained, or never reserved), on every completion path: natural child
   * exit, abort, refusal or shutdown. Never rejects.
   */
  readonly terminal: Promise<void>;
}

/**
 * Named-account flows whose run lease may still be unsettled, so a host
 * shutdown can wait for every release (or retain) write before it closes the
 * database those writes go through.
 *
 * A flow leaves the set when its `terminal` resolves, not when it is aborted:
 * a session ended just before quit still has its release in flight, and that
 * release is exactly what the shutdown drain must wait for. Shutdown closes the
 * set first, so a flow that arrives during the drain is refused before it can
 * ask for a reservation and the drain's snapshot is complete.
 */
export class NamedAdmissionSettlements {
  private readonly live = new Set<SettleableNamedAdmission>();
  private closed = false;

  constructor(private readonly logger: Pick<Logger, 'warn'>) {}

  /** Number of flows still tracked. */
  get size(): number {
    return this.live.size;
  }

  /** True once shutdown has started: no further flow is admitted. */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Track `named` until its `terminal` resolves. Call right after the flow is
   * constructed and before it asks for a reservation. Returns false, and tracks
   * nothing, once shutdown has closed admission: the caller must refuse the
   * flow before it reserves.
   */
  track(named: SettleableNamedAdmission): boolean {
    if (this.closed) return false;
    this.live.add(named);
    void named.terminal.then(() => {
      this.live.delete(named);
    });
    return true;
  }

  /**
   * Close admission, dispose every tracked flow and wait until each is
   * terminal, including a flow whose admission call is still in flight and may
   * yet return a reservation. Each dispose closes the flow's child and waits
   * for it to exit, bounded by the flow's own deadline. Never rejects: a failed
   * settlement is logged and leaves that lease held for the stale-lease reclaim.
   */
  async settleAll(): Promise<void> {
    this.closed = true;
    const flows = Array.from(this.live);
    await Promise.all(flows.map((named) => this.settle(named)));
  }

  private async settle(named: SettleableNamedAdmission): Promise<void> {
    // The first dispose aborts the flow; with an admission still in flight it
    // resolves before the late reservation exists, so wait for `terminal` and
    // read the final settlement from a second, idempotent dispose.
    await Promise.allSettled([named.dispose(), named.terminal]);
    try {
      await named.dispose();
    } catch (error: unknown) {
      this.logger.warn(
        '[SessionLifecycle] Named account settlement failed at shutdown',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    this.live.delete(named);
  }
}
