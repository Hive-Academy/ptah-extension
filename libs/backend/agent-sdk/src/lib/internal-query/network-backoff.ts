/**
 * Exponential back-off for background LLM work while the provider is
 * unreachable — TASK_2026_437 C14 (f).
 *
 * ## The gap it closes
 *
 * The `claude` subprocess already retries ONE request (0.5 s doubling to about
 * 30 s, ten attempts). Nothing above it waited at all: when a request gave up,
 * the memory curator dispatched its next window at once and skill-synthesis
 * re-ran the same call without `outputFormat`, so every background call paid
 * the subprocess's whole three-minute ladder again against an endpoint that
 * had just failed (`Ptah Electron-2026-09-14.log:1037-1180`, 41 failed
 * forwards in six minutes). This is the layer above that ladder: after a
 * network-class failure (`classifyThrownNetworkFailure`,
 * `QueryNetworkObserver`) background work waits 30 s, then 60 s, doubling
 * to a 15-minute ceiling, and the first call that gets an answer resets it.
 *
 * ## What it is not
 *
 * It gates nothing by itself. It is state: each consumer asks
 * {@link NetworkBackoff.remainingMs} before it dispatches BACKGROUND work and
 * reports what its calls observed. Work a user is waiting on is never held by
 * it — the consumer skips the check for `userInitiated` calls — but its
 * outcome still counts, because a user's successful call is proof the network
 * is back. User-scheduled cron prompts never reach a consumer of this class.
 *
 * ## One window per level
 *
 * A failure that lands while a window is already open does not raise the
 * level. Two calls failing together (a background call and a user's call)
 * would otherwise double the wait for one outage. The next level is reached
 * only by a call dispatched AFTER the window ended — the probe.
 *
 * ## Jitter
 *
 * ±20 % on each window, the same ratio `retryWithBackoff`
 * (`libs/shared/src/lib/utils/retry.utils.ts`) uses, so hosts sharing one
 * provider do not all probe it on the same tick. The jittered value is still
 * clamped to the 15-minute ceiling.
 *
 * ## An in-flight 429 `Retry-After` is NOT honoured
 *
 * The ladder is fixed. A 429 that arrives MID-CALL is classified `http-429`
 * and waits 30 s doubling to 15 min, whatever `Retry-After` the provider sent:
 * the SDK stream carries the status, never the header, so there is nothing to
 * read. The provider's own cooldown is honoured one layer earlier, by the
 * pre-flight quota gate — `ProviderQuotaError.retryAfterMs`, surfaced as
 * `quota-exhausted` by skill-synthesis's lane resolver and as a
 * `provider-cooling-down` stall by the curator adapter — which stops a call
 * before dispatch. The two share the word `retryAfterMs` and are separate
 * mechanisms.
 *
 * ## Not persisted
 *
 * The level lives in memory and a restart starts at zero. A network outage is
 * a property of the moment, and the first call after a restart is exactly the
 * probe a reset asks for. Work the queue already deferred keeps its own
 * persisted `not_before` (skill-synthesis) or its unprocessed input (memory
 * curator), so nothing is lost by forgetting the level.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { NetworkFailureSignal } from './network-failure';

/** The first window after a network-class failure. */
export const NETWORK_BACKOFF_INITIAL_MS = 30_000;

/** The ceiling: a window never exceeds 15 minutes, jitter included. */
export const NETWORK_BACKOFF_MAX_MS = 15 * 60_000;

/** Each window is scaled by a factor drawn from `[1 - ratio, 1 + ratio]`. */
export const NETWORK_BACKOFF_JITTER_RATIO = 0.2;

/**
 * The first level whose base window is the ceiling (6: 30 s → 60 → 120 → 240 →
 * 480 → 900). A failure at or past it renews the window and keeps the level.
 * Derived from the two constants above, so tuning either moves it with them.
 */
export const NETWORK_BACKOFF_CEILING_LEVEL =
  Math.ceil(Math.log2(NETWORK_BACKOFF_MAX_MS / NETWORK_BACKOFF_INITIAL_MS)) + 1;

export interface NetworkBackoffOptions {
  readonly logger: Pick<Logger, 'info'>;
  /** Log tag of the owning pipeline, e.g. `'[memory-curator]'`. */
  readonly logPrefix: string;
  /** Clock seam for specs. */
  readonly now?: () => number;
  /** `[0, 1)` source for jitter. Specs pass a constant. */
  readonly random?: () => number;
}

export class NetworkBackoff {
  private level = 0;
  private deferUntil = 0;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: NetworkBackoffOptions) {
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? (() => Math.random());
  }

  /** `0` when no back-off is in effect; `1` is the 30 s window. */
  get currentLevel(): number {
    return this.level;
  }

  /** Milliseconds until background work may dispatch again; `0` when it may now. */
  remainingMs(now: number = this.now()): number {
    return Math.max(0, this.deferUntil - now);
  }

  /**
   * A call observed a network-class failure. Opens the next window, unless a
   * window is already open (see the file header). `signal` only annotates the
   * log line; a caller whose port does not carry it passes nothing.
   */
  recordFailure(signal?: NetworkFailureSignal): void {
    const now = this.now();
    if (this.remainingMs(now) > 0) return;
    const atCeiling = this.level >= NETWORK_BACKOFF_CEILING_LEVEL;
    const nextLevel = atCeiling ? this.level : this.level + 1;
    const windowMs = Math.min(
      NETWORK_BACKOFF_MAX_MS,
      Math.round(backoffBaseMs(nextLevel) * jitterFactor(this.random())),
    );
    this.deferUntil = now + windowMs;
    // A failure at the ceiling renews the window without changing the level,
    // and says nothing: the line is written once per level, not per attempt.
    if (atCeiling) return;
    this.level = nextLevel;
    this.options.logger.info(
      `${this.options.logPrefix} provider unreachable; background LLM work backs off`,
      { level: this.level, windowMs, ...(signal ? { signal } : {}) },
    );
  }

  /** A call reached the provider and got an answer. Clears any back-off. */
  recordSuccess(): void {
    if (this.level === 0) return;
    const previousLevel = this.level;
    this.level = 0;
    this.deferUntil = 0;
    this.options.logger.info(
      `${this.options.logPrefix} provider reachable again; network back-off cleared`,
      { previousLevel },
    );
  }
}

/** `30 s × 2^(level − 1)`, capped at the ceiling. Level 0 has no window. */
function backoffBaseMs(level: number): number {
  if (level <= 0) return 0;
  const exponent = Math.min(level - 1, 30);
  return Math.min(
    NETWORK_BACKOFF_INITIAL_MS * 2 ** exponent,
    NETWORK_BACKOFF_MAX_MS,
  );
}

function jitterFactor(sample: number): number {
  const bounded = Number.isFinite(sample)
    ? Math.min(Math.max(sample, 0), 1)
    : 0.5;
  return (
    1 -
    NETWORK_BACKOFF_JITTER_RATIO +
    2 * NETWORK_BACKOFF_JITTER_RATIO * bounded
  );
}
