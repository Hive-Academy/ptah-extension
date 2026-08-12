/**
 * ForegroundActivityTracker — "how long since the user's chat last moved?"
 *
 * `SessionActivityRegistry` (`agent-sdk`) is PUSH-ONLY: it exposes `register`
 * and `notifyAll` and nothing else (`session-activity-registry.ts:55-57`). There
 * is no "is a session active right now" query anywhere in the codebase, and the
 * drain needs exactly that one number to honour `foregroundBackoffMs`. Rather
 * than widen a port for a single consumer, this tracker keeps the one piece of
 * state the registry throws away — the timestamp of the last event.
 *
 * The registry is injected `{isOptional: true}` and referenced through a locally
 * declared `Symbol.for('SdkSessionActivityRegistry')`, the same way
 * `INTERNAL_QUERY_SERVICE_TOKEN` is (`di/tokens.ts:17-19`): a CLI or e2e host
 * that never registers the SDK still resolves this class, and simply reports
 * "no foreground activity ever", which is the correct answer there.
 *
 * `msSinceLastActivity()` returns `Number.POSITIVE_INFINITY` before the first
 * event. Infinity — not `0` — because the gate reads "less than the backoff
 * means someone is typing"; a fresh process with no activity must NOT look
 * busy, or the very first drain after start-up would always be suppressed.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SESSION_ACTIVITY_REGISTRY_TOKEN } from '../di/tokens';

/**
 * The one field this tracker reads off a session-activity event. Declared
 * locally (structurally compatible with `agent-sdk`'s `SessionActivityPayload`)
 * so the queue does not take a type dependency on the SDK-facing lib.
 */
export interface ForegroundActivityPayload {
  readonly timestamp?: number;
}

/** The push-only slice of `SessionActivityRegistry` that is consumed here. */
export interface ForegroundActivitySource {
  register(callback: (payload: ForegroundActivityPayload) => void): () => void;
}

@injectable()
export class ForegroundActivityTracker {
  private lastActivityAt: number | null = null;
  private disposer: (() => void) | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SESSION_ACTIVITY_REGISTRY_TOKEN, { isOptional: true })
    private readonly activity?: ForegroundActivitySource,
  ) {}

  /**
   * Subscribe to the registry. Idempotent, and a no-op when no registry is
   * registered — the drain calls this at the head of every tick so the
   * subscription exists without a second start-up wiring step to forget.
   */
  start(): void {
    if (this.disposer || !this.activity) return;
    this.disposer = this.activity.register((payload) => {
      this.onActivity(payload);
    });
    this.logger.debug('[skill-synthesis] foreground activity tracker started');
  }

  stop(): void {
    this.disposer?.();
    this.disposer = null;
  }

  /**
   * Milliseconds since the last chat turn, or `Number.POSITIVE_INFINITY` when
   * nothing has been observed in this process.
   */
  msSinceLastActivity(now: number = Date.now()): number {
    if (this.lastActivityAt === null) return Number.POSITIVE_INFINITY;
    return Math.max(0, now - this.lastActivityAt);
  }

  /** Test/diagnostic seam: the raw timestamp, or `null` before any event. */
  get lastActivityTimestamp(): number | null {
    return this.lastActivityAt;
  }

  private onActivity(payload: ForegroundActivityPayload): void {
    const stamped = payload.timestamp;
    const at =
      typeof stamped === 'number' && Number.isFinite(stamped)
        ? stamped
        : Date.now();
    // Monotonic: an out-of-order event must never make the session look older
    // than it is, or a stale event could unblock a drain mid-conversation.
    if (this.lastActivityAt === null || at > this.lastActivityAt) {
      this.lastActivityAt = at;
    }
  }
}
