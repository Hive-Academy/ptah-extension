import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeCliDetector } from '@ptah-extension/agent-sdk';
import { withProbeTimeout } from './probe-timeout';

/**
 * How long a Claude-CLI health verdict stays servable, independently of the
 * status cache entry.
 *
 * `ClaudeCliDetector.performHealthCheck` SPAWNS `claude --version`, which is a
 * ~2s `CreateProcessW` on a 253 MB executable and was the bulk of the measured
 * 2-5.3s handler durations. The detector now coalesces that spawn for 30s, but
 * that window is deliberately short and is not a health cache — this is.
 * Installing or removing a CLI is a rare, out-of-band event, so it gets a far
 * longer window than the rest of the payload.
 */
const CLAUDE_CLI_HEALTH_TTL_MS = 5 * 60_000;

/** A memoised Claude-CLI verdict and when it stops being servable. */
export interface ClaudeCliHealth {
  available: boolean;
  expiresAt: number;
}

/**
 * Memoised Claude-CLI health probe. Owned by `AuthStatusCache`, which supplies
 * the current cache generation and calls {@link forget} on every invalidation.
 */
export class ClaudeCliHealthProbe {
  /** Memoised Claude-CLI health — see {@link CLAUDE_CLI_HEALTH_TTL_MS}. */
  private memo: ClaudeCliHealth | null = null;

  /**
   * The Claude-CLI health check currently running, if any.
   *
   * Separate from the status in-flight map because it OUTLIVES the caller that
   * started it: when a probe trips `AUTH_PROBE_TIMEOUT_MS` the status is
   * answered from the last known verdict and this promise keeps running, so the
   * memo it eventually writes is what makes the next caller fast rather than
   * making it pay the same timeout again.
   */
  private running: Promise<boolean> | null = null;

  constructor(
    private readonly cliDetector: ClaudeCliDetector,
    private readonly logger: Logger,
    private readonly currentGeneration: () => number,
  ) {}

  /** The last memoised verdict, expired or not; `null` when nothing is known. */
  get health(): ClaudeCliHealth | null {
    return this.memo;
  }

  /** Drop the memo and release the running probe; see `AuthStatusCache.invalidate`. */
  forget(): void {
    this.memo = null;
    // Dropped for the same reason as the status in-flight map: a verdict
    // computed before the change must not be handed to a caller that arrives
    // after it. Coalescing the underlying SPAWN is `ClaudeCliDetector`'s job,
    // not this one's, so releasing the reference here costs nothing.
    this.running = null;
  }

  /**
   * Claude CLI probe, memoised for {@link CLAUDE_CLI_HEALTH_TTL_MS}.
   *
   * A FAILURE is deliberately not memoised — a detector that threw is not
   * evidence the CLI is absent, and retrying costs one spawn.
   *
   * `generation` guards the memo write for the same reason the status cache is
   * guarded, and it matters MORE here: this entry lives five minutes, so a
   * verdict written back after an invalidation would outlast a status entry by
   * twenty times.
   */
  async probe(generation: number): Promise<boolean> {
    const memo = this.memo;
    if (memo && memo.expiresAt > Date.now()) {
      return memo.available;
    }

    return withProbeTimeout(
      this.logger,
      'Claude CLI',
      this.start(generation),
      // An EXPIRED memo is still the best answer available. Reporting `false`
      // instead would tell the UI the CLI vanished — which flips the auth badge
      // and can bounce the user to a setup screen — on the evidence of a slow
      // spawn. `false` is only correct when nothing was ever known.
      () => memo?.available ?? false,
    );
  }

  /**
   * The health check itself, single-flighted so a caller arriving while one is
   * running (including one that already timed out) joins it instead of adding
   * a second `claude --version` spawn to a loop that is evidently busy.
   *
   * Never rejects: every failure mode resolves to `false`.
   */
  private start(generation: number): Promise<boolean> {
    const running = this.running;
    if (running) return running;

    const pending: Promise<boolean> = this.cliDetector
      .performHealthCheck()
      .then((cliHealth) => {
        if (generation === this.currentGeneration()) {
          this.memo = {
            available: cliHealth.available,
            expiresAt: Date.now() + CLAUDE_CLI_HEALTH_TTL_MS,
          };
        }
        return cliHealth.available;
      })
      .catch((cliError: unknown) => {
        this.logger.warn(
          'Claude CLI detection failed (non-fatal)',
          cliError instanceof Error ? cliError : new Error(String(cliError)),
        );
        return false;
      })
      .finally(() => {
        if (this.running === pending) {
          this.running = null;
        }
      });
    this.running = pending;
    return pending;
  }
}
