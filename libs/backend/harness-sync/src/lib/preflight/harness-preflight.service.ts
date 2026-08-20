/**
 * The session-start check: make sure the harness is on disk before a model is
 * asked to read it.
 *
 * Every other trigger in this lib is an EVENT — something changed, so
 * propagate it. Preflight is the opposite: nothing is known to have changed,
 * but a session is about to start in a workspace no host may have reconciled at
 * all. `ptah tui` in a directory VS Code has never opened, a cron job in a
 * second checkout, a rival CLI spawned for a sub-package, the gateway answering
 * a Telegram message an hour after the desktop app quit — none of those had an
 * activation pass, and before Batch 3 all of them started with whatever the
 * last GUI host happened to leave behind.
 *
 * Three properties make it safe to call on EVERY session start:
 *
 * 1. **Bounded.** The reconcile races a timer (`DEFAULT_PREFLIGHT_TIMEOUT_MS`,
 *    overridable via `harness.preflightTimeoutMs`). On expiry the session
 *    proceeds and the pass keeps running in the background — it will finish,
 *    update `getLastHealth()`, and be complete for the next session. A harness
 *    check must never be the reason a user's first message hangs.
 * 2. **Throttled per workspace.** `minIntervalMs` collapses bursts. This is not
 *    an optimisation, it is what makes the background drain affordable: the
 *    skill-synthesis lanes start dozens of one-shot sessions in a night, each
 *    through the same shared path, and `mode: 'preflight'` still has to build
 *    the desired state (a walk of `~/.ptah/user` plus a hash per skill dir)
 *    before it can compare anything. Un-throttled, a nightly drain would pay
 *    that walk once per LLM call.
 * 3. **Silent on failure.** Every path returns a health report or `null`.
 *    Nothing thrown here may reach a session.
 *
 * The `pending-download` retry is the E2 half. A cold first run starts the
 * content download fire-and-forget, so the first preflight legitimately finds
 * an empty user layer. Rather than reporting "no skills" and moving on, it
 * waits on the download's own in-flight promise for the REMAINING budget and
 * runs one more pass. Offline, that wait ends immediately and the report says
 * `pending-download` — which is the honest answer, not an error.
 */

import type { HarnessHealth } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

/** Bounded wait for a fire-and-forget content download (E2). */
export interface IHarnessContentGate {
  /**
   * Resolve once content is on disk, or once `timeoutMs` elapses.
   *
   * @returns whether content is available now. Never throws.
   */
  awaitContentReady(timeoutMs: number): Promise<boolean>;
}

/**
 * 1.5 s. Long enough for a warm no-op pass (a directory walk and a few dozen
 * hashes) on a cold filesystem cache, short enough that a user who hits it
 * reads the session as slow to start rather than hung.
 */
export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 1500;

/**
 * 60 s. A session starting a minute after the last verified pass is
 * overwhelmingly likely to find the same disk; the events that genuinely change
 * the harness all fire `HarnessPropagationService.propagate` themselves, which
 * is not throttled.
 */
export const DEFAULT_PREFLIGHT_MIN_INTERVAL_MS = 60_000;

export interface HarnessPreflightOptions {
  /** Overrides the configured default for this one call. */
  timeoutMs?: number;
  /** Run even if this workspace was verified inside `minIntervalMs`. */
  force?: boolean;
}

export interface HarnessPreflightDeps {
  /** Reads `harness.preflightTimeoutMs`; `undefined` means "use the default". */
  readTimeoutMs?: () => number | undefined;
  contentGate?: IHarnessContentGate;
  minIntervalMs?: number;
}

export class HarnessPreflightService {
  /** Resolved workspace root → epoch ms of the last completed pass. */
  private readonly lastPassAt = new Map<string, number>();
  private readonly minIntervalMs: number;

  constructor(
    private readonly logger: Logger,
    private readonly reconciler: HarnessReconcilerService,
    private readonly deps: HarnessPreflightDeps = {},
  ) {
    this.minIntervalMs =
      deps.minIntervalMs ?? DEFAULT_PREFLIGHT_MIN_INTERVAL_MS;
  }

  /**
   * @param cwd The session's working directory — may be any folder inside the
   *   workspace (E14); it is normalized to the root before anything is keyed on
   *   it.
   * @returns The health report, `null` when the pass was throttled, skipped or
   *   timed out. Callers must treat `null` as "carry on".
   */
  async ensure(
    cwd: string,
    options: HarnessPreflightOptions = {},
  ): Promise<HarnessHealth | null> {
    if (typeof cwd !== 'string' || cwd.trim() === '') return null;

    let workspaceRoot: string;
    try {
      workspaceRoot = resolveHarnessWorkspaceRoot(cwd);
    } catch (error: unknown) {
      this.logger.debug('[harness-sync] Preflight could not resolve a root', {
        cwd,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (options.force !== true && this.throttled(workspaceRoot)) return null;
    // Stamped BEFORE the pass, not after: two sessions starting together must
    // not both decide the other has not run yet.
    this.lastPassAt.set(workspaceRoot, Date.now());

    const budgetMs = this.resolveTimeout(options.timeoutMs);
    const startedAt = Date.now();

    const health = await this.runBounded(workspaceRoot, budgetMs, 'preflight');
    if (health === null) {
      this.logger.info(
        '[harness-sync] preflight: timed out, session continues',
        {
          workspaceRoot,
          budgetMs,
        },
      );
      return null;
    }

    if (health.sources !== 'pending-download') {
      this.log(health, Date.now() - startedAt);
      return health;
    }

    const remainingMs = budgetMs - (Date.now() - startedAt);
    const retried = await this.retryAfterDownload(workspaceRoot, remainingMs);
    const finalHealth = retried ?? health;
    this.log(finalHealth, Date.now() - startedAt);
    return finalHealth;
  }

  /**
   * Wait for the in-flight content download, then run one more pass.
   *
   * Returns `null` — leaving the caller with the original `pending-download`
   * report — when there is no gate wired, no budget left, or the download did
   * not land. All three are the same answer to the user: the harness is empty
   * because the content is not here yet, which is a state, not a failure.
   */
  private async retryAfterDownload(
    workspaceRoot: string,
    remainingMs: number,
  ): Promise<HarnessHealth | null> {
    const gate = this.deps.contentGate;
    if (gate === undefined || remainingMs <= 0) return null;

    let ready = false;
    try {
      ready = await gate.awaitContentReady(remainingMs);
    } catch (error: unknown) {
      this.logger.debug('[harness-sync] Content gate failed (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (!ready) return null;

    // A second full pass, not a preflight: the download just wrote the sources,
    // so the manifest is guaranteed to disagree and a drift check would only
    // fall through to the same apply one call later.
    return this.runBounded(workspaceRoot, remainingMs, 'full');
  }

  /**
   * Race the reconcile against the budget.
   *
   * The losing reconcile is NOT cancelled. It holds the workspace lock and is
   * mid-way through writing copies; aborting it would leave a target half
   * populated with no manifest entry for what landed. Letting it finish costs
   * nothing the session can observe and leaves the next preflight with nothing
   * to do.
   */
  private async runBounded(
    workspaceRoot: string,
    budgetMs: number,
    mode: 'preflight' | 'full',
  ): Promise<HarnessHealth | null> {
    const pass = this.reconciler
      .reconcile(workspaceRoot, { mode, reason: `session-preflight:${mode}` })
      .catch((error: unknown) => {
        this.logger.warn('[harness-sync] Preflight pass failed (non-fatal)', {
          workspaceRoot,
          mode,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), Math.max(0, budgetMs));
      // A pending timer must not hold a `ptah` CLI process open past its work.
      timer.unref?.();
    });

    try {
      return await Promise.race([pass, expiry]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private throttled(workspaceRoot: string): boolean {
    const last = this.lastPassAt.get(workspaceRoot);
    return last !== undefined && Date.now() - last < this.minIntervalMs;
  }

  private resolveTimeout(override: number | undefined): number {
    const candidate = override ?? this.deps.readTimeoutMs?.();
    if (
      typeof candidate === 'number' &&
      Number.isFinite(candidate) &&
      candidate > 0
    ) {
      return candidate;
    }
    return DEFAULT_PREFLIGHT_TIMEOUT_MS;
  }

  /**
   * One line, per the Batch 3 brief:
   * `harness preflight: claude 32/32, codex 30/30 (missing 1) [ok, 240ms]`.
   * Undetected targets are omitted — a machine without Codex should not read
   * its own log as though something were wrong.
   */
  private log(health: HarnessHealth, durationMs: number): void {
    const detected = health.targets.filter((target) => target.detected);
    const summary = detected
      .map((target) => {
        const missing =
          target.missing.length > 0
            ? ` (missing ${target.missing.length})`
            : '';
        return `${target.target} ${target.found}/${target.expected}${missing}`;
      })
      .join(', ');
    const line = `harness preflight: ${summary || 'no targets detected'} [${health.sources}, ${durationMs}ms]`;

    const degraded =
      health.sources !== 'ok' ||
      detected.some(
        (target) => target.missing.length > 0 || target.writeFailed.length > 0,
      );
    if (degraded) {
      this.logger.warn(`[harness-sync] ${line}`, {
        workspaceRoot: health.workspaceRoot,
      });
      return;
    }
    this.logger.debug(`[harness-sync] ${line}`, {
      workspaceRoot: health.workspaceRoot,
    });
  }
}
