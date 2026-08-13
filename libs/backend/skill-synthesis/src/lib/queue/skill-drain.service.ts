/**
 * SkillDrainService — the one place a queued synthesis stage is allowed to run.
 *
 * Three cron tiers (`frequent` / `nightly` / `weekly`) call `drain()`; nothing
 * else does. The signature takes `onBattery` as a PARAMETER rather than
 * injecting `IPowerMonitor`, because that port lives in `cron-scheduler` and
 * `skill-synthesis` must never depend on it (global invariant 8) — `thoth-runtime`
 * is the seam that reads the monitor and passes the boolean in.
 *
 * ## `drain()` NEVER THROWS (global invariant 11)
 *
 * Every gate, every stage failure and every unexpected error resolves to a
 * `DrainSummary`. A cron handler that rejects is recorded as a failed `job_run`
 * and re-scheduled; a drain that resolves `{skipped, reason}` is observable in
 * Activity and self-explaining. The whole body is wrapped accordingly.
 *
 * ## GATE ORDER IS THE CONTRACT
 *
 *   1. `skillSynthesis.enabled`            → 'disabled'
 *   2. `budget.spentToday >= maxTokensPerDay` → 'daily-token-budget-exhausted'
 *   3. `pauseOnBattery && onBattery`       → 'on-battery'
 *   4. `msSinceLastActivity() < foregroundBackoffMs` → 'foreground-active'
 *   5. `signal.aborted`                    → 'aborted'
 *   → reap stale claims → per-workspace round-robin → per-item CAS claim
 *   → stage dispatch.
 *
 * `enabled` is FIRST and short-circuits everything else on purpose: the Electron
 * tray's "Pause background learning" writes that same settings key (decision
 * Q-B), so "paused" must mean "reads no settings, touches no database, spends
 * nothing" — not "evaluates four more conditions first". The order is pinned by
 * `skill-drain.gates.spec.ts`, which asserts the reason string produced when
 * several gates are true at once.
 *
 * ## R3 — cost scales with session count
 *
 * The budget is a HARD stop, not a target. Gate 2 stops a tick that starts over
 * budget. Inside the tick the check runs again PER ITEM, because a lane can
 * exhaust the budget halfway through: once it is exhausted, token-spending
 * stages are left untouched (still `queued`, eligible next tick) while the free
 * stages — prefilter, embedding, clustering, trigger-eval — keep draining. From
 * 80 % of the budget onward the eligible window is ordered cheap-stages-first,
 * so the last of the budget buys the most work.
 *
 * The drain is also where a spend LEARNS ITS STAGE: `runItem` dispatches the
 * handler inside `SkillBudgetStore.withStage(row.stage, …)`, so the ledger write
 * `LaneRunner` makes several frames down is attributed to the queue stage rather
 * than to the lane it happened to run on. Those are different taxonomies and
 * inferring one from the other would be quietly wrong.
 *
 * ## R4 — starvation
 *
 * Selection NEVER orders by `enqueued_at` globally. It walks distinct eligible
 * workspaces least-recently-drained first (`listEligibleWorkspaces`), takes at
 * most `perWorkspaceBatch` (default 1) from each, stops at `maxItemsPerRun`, and
 * bumps the cursor of every workspace it VISITED — including one whose rows all
 * belong to another tier, or the cursor would never advance past it.
 *
 * ## R5 — stale-claim TTL
 *
 * `staleClaimTtlMs` must exceed the longest a stage can legitimately run, or a
 * live run is reaped mid-flight and re-run at full cost. `assertStaleClaimTtl`
 * checks `ttl >= 3 × max(stage timeout)` at the head of every tick and warns
 * loudly; it does not throw, because a misconfigured TTL degrades throughput
 * rather than corrupting data.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { SkillQueueRow, SkillQueueStage } from './skill-queue.types';
import type { SkillQueueStore } from './skill-queue.store';
import type { SkillBudgetStore } from './skill-budget.store';
import type { ForegroundActivityTracker } from './foreground-activity.tracker';

/** Which cron tier is draining. Each tier owns a superset of the cheaper one. */
export type DrainTier = 'frequent' | 'nightly' | 'weekly';

/** The exact strings the gates emit. Asserted verbatim by the gate spec. */
export type DrainSkipReason =
  | 'disabled'
  | 'daily-token-budget-exhausted'
  | 'on-battery'
  | 'foreground-active'
  | 'aborted';

export interface DrainOptions {
  tier: DrainTier;
  signal: AbortSignal;
  /** Read from `IPowerMonitor.isOnBattery()` by the caller (`thoth-runtime`). */
  onBattery: boolean;
  /** Test seam for a deterministic clock. */
  now?: number;
}

/** What one tick did. Returned in every path, including every failure. */
export interface DrainSummary {
  tier: DrainTier;
  /** `true` when a gate stopped the tick before any claim was attempted. */
  skipped: boolean;
  reason?: DrainSkipReason;
  reaped: number;
  workspacesVisited: number;
  claimed: number;
  /** Rows another worker claimed first. Normal, not an error. */
  lostClaims: number;
  done: number;
  failed: number;
  unscored: number;
  skippedItems: number;
  /** Token-spending items deferred because the budget ran out mid-tick. */
  budgetDeferred: number;
  budgetExhausted: boolean;
  durationMs: number;
  /** Diagnostic only, never rendered. Set when the drain itself threw. */
  error?: string;
}

/** What a stage handler is handed. */
export interface SkillStageContext {
  row: SkillQueueRow;
  tier: DrainTier;
  signal: AbortSignal;
  /**
   * Heartbeat the claim. Returns `false` when the claim has already been lost
   * (reaped or finished elsewhere) — the handler MUST then stop writing.
   */
  touch(): boolean;
}

/** What a stage handler reports back. Mirrors the store's terminal states. */
export type SkillStageResult =
  | { outcome: 'done'; reason?: string; candidateId?: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'unscored'; reason: string; retryInMs?: number }
  | { outcome: 'failed'; error: string; reason?: string };

export type SkillStageHandler = (
  ctx: SkillStageContext,
) => Promise<SkillStageResult>;

export const SKILL_DRAIN_SECTION = 'ptah';

export const SKILL_DRAIN_KEYS = {
  enabled: 'skillSynthesis.enabled',
  maxItemsPerRun: 'skillSynthesis.drain.maxItemsPerRun',
  perWorkspaceBatch: 'skillSynthesis.drain.perWorkspaceBatch',
  foregroundBackoffMs: 'skillSynthesis.drain.foregroundBackoffMs',
  pauseOnBattery: 'skillSynthesis.drain.pauseOnBattery',
  maxAttempts: 'skillSynthesis.drain.maxAttempts',
  staleClaimTtlMs: 'skillSynthesis.drain.staleClaimTtlMs',
  maxTokensPerDay: 'skillSynthesis.budget.maxTokensPerDay',
} as const;

/**
 * Mirrors `FILE_BASED_SETTINGS_DEFAULTS`. Duplicated deliberately: the drain
 * must behave identically in a host that has never written a settings file, and
 * `getConfiguration` needs a fallback value at every call site anyway.
 */
export const SKILL_DRAIN_DEFAULTS = {
  enabled: true,
  maxItemsPerRun: 4,
  perWorkspaceBatch: 1,
  foregroundBackoffMs: 300_000,
  pauseOnBattery: true,
  maxAttempts: 5,
  staleClaimTtlMs: 900_000,
  /** `0` = unlimited. */
  maxTokensPerDay: 2_000_000,
} as const;

export interface SkillDrainConfig {
  enabled: boolean;
  maxItemsPerRun: number;
  perWorkspaceBatch: number;
  foregroundBackoffMs: number;
  pauseOnBattery: boolean;
  maxAttempts: number;
  staleClaimTtlMs: number;
  maxTokensPerDay: number;
}

/**
 * The longest a single stage may currently run — `SYNTHESIS_TIMEOUT_MS`
 * (`skill-synthesizer.service.ts`), the largest of today's two module-level
 * timeouts. Phase 1 replaces every module constant with a per-lane `timeoutMs`,
 * at which point this becomes `max(lane.timeoutMs)` and the R5 assertion below
 * keeps its meaning unchanged.
 */
export const MAX_STAGE_TIMEOUT_MS = 30_000;

/** R5: a TTL below `3 ×` the longest stage reaps live work. */
export const STALE_CLAIM_TTL_SAFETY_FACTOR = 3;

/** Rows scanned per workspace before tier filtering + cheap-first ordering. */
const ELIGIBLE_SCAN_LIMIT = 20;

/** Fraction of the daily budget above which cheap stages are ordered first. */
const CHEAP_FIRST_BUDGET_FRACTION = 0.8;

/** Backoff for a stage that ran and produced nothing usable. */
const DEFAULT_UNSCORED_BACKOFF_MS = 30 * 60_000;

const MAX_RETRY_BACKOFF_MS = 6 * 60 * 60_000;

const FREQUENT_STAGES: readonly SkillQueueStage[] = [
  'prefilter',
  'synthesis',
  'embedding',
  'clustering',
  'cluster-synthesis',
  'judge',
];

const NIGHTLY_ONLY_STAGES: readonly SkillQueueStage[] = [
  'archaeology',
  'digest',
];

const WEEKLY_ONLY_STAGES: readonly SkillQueueStage[] = [
  'judge-panel',
  'replay',
  'trigger-eval',
];

/**
 * Tier → the stages it may run. Each tier is a SUPERSET of the cheaper one, so
 * an item enqueued for an expensive stage is never stranded: the nightly tick
 * picks up whatever the frequent tick could not, and the weekly tick picks up
 * everything.
 */
export const DRAIN_TIER_STAGES: Record<
  DrainTier,
  ReadonlySet<SkillQueueStage>
> = {
  frequent: new Set(FREQUENT_STAGES),
  nightly: new Set([...FREQUENT_STAGES, ...NIGHTLY_ONLY_STAGES]),
  weekly: new Set([
    ...FREQUENT_STAGES,
    ...NIGHTLY_ONLY_STAGES,
    ...WEEKLY_ONLY_STAGES,
  ]),
};

/**
 * Stages that consume the token budget. The complement — prefilter, embedding,
 * clustering, trigger-eval — is pure local computation (regex prefilter, the
 * local embedder, cosine math) and therefore keeps running after the budget is
 * gone.
 */
const TOKEN_SPENDING_STAGES: ReadonlySet<SkillQueueStage> =
  new Set<SkillQueueStage>([
    'synthesis',
    'cluster-synthesis',
    'judge',
    'judge-panel',
    'replay',
    'archaeology',
    'digest',
  ]);

/** Relative cost, cheapest first. Only the ORDER matters, not the values. */
const STAGE_COST_RANK: Record<SkillQueueStage, number> = {
  prefilter: 0,
  embedding: 1,
  clustering: 2,
  'trigger-eval': 3,
  judge: 4,
  digest: 5,
  synthesis: 6,
  'cluster-synthesis': 7,
  'judge-panel': 8,
  replay: 9,
  archaeology: 10,
};

@injectable()
export class SkillDrainService {
  /** Identifies this process's claims in `skill_synthesis_queue.claimed_by`. */
  private readonly workerId = `${process.pid}-${ulid()}`;
  private readonly handlers = new Map<SkillQueueStage, SkillStageHandler>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE)
    private readonly queue: SkillQueueStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE)
    private readonly budget: SkillBudgetStore,
    @inject(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER)
    private readonly foreground: ForegroundActivityTracker,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  /**
   * Wire a stage. Stages register themselves as their phase lands; an item
   * whose stage has no handler in this host is marked `skipped` with a reason
   * rather than left to be re-claimed forever.
   */
  registerStageHandler(
    stage: SkillQueueStage,
    handler: SkillStageHandler,
  ): void {
    this.handlers.set(stage, handler);
  }

  /**
   * R5. Returns `false` (and warns) when `staleClaimTtlMs` is too small for the
   * longest stage. Called at the head of every tick and from
   * `SkillSynthesisService.start()`.
   */
  assertStaleClaimTtl(
    maxStageTimeoutMs: number = MAX_STAGE_TIMEOUT_MS,
  ): boolean {
    const ttl = this.readConfig().staleClaimTtlMs;
    const required = STALE_CLAIM_TTL_SAFETY_FACTOR * maxStageTimeoutMs;
    if (ttl >= required) return true;
    this.logger.warn(
      '[skill-synthesis] staleClaimTtlMs is below the safe minimum; long stages may be reaped mid-run',
      { staleClaimTtlMs: ttl, required, maxStageTimeoutMs },
    );
    return false;
  }

  /** Reap orphaned claims without draining. Called at service start-up. */
  reapStaleClaims(now: number = Date.now()): number {
    return this.queue.reapStale(this.readConfig().staleClaimTtlMs, now);
  }

  async drain(opts: DrainOptions): Promise<DrainSummary> {
    const startedAt = Date.now();
    const now = opts.now ?? startedAt;
    const summary: DrainSummary = {
      tier: opts.tier,
      skipped: false,
      reaped: 0,
      workspacesVisited: 0,
      claimed: 0,
      lostClaims: 0,
      done: 0,
      failed: 0,
      unscored: 0,
      skippedItems: 0,
      budgetDeferred: 0,
      budgetExhausted: false,
      durationMs: 0,
    };

    try {
      const cfg = this.readConfig();

      // Gate 1 — the master switch, and the tray's pause. Nothing above it.
      if (!cfg.enabled) return this.skip(summary, 'disabled', startedAt);

      // Gate 2 — a tick that starts over budget does no work at all.
      if (this.isBudgetExhausted(cfg, now)) {
        summary.budgetExhausted = true;
        return this.skip(summary, 'daily-token-budget-exhausted', startedAt);
      }

      // Gate 3 — battery.
      if (cfg.pauseOnBattery && opts.onBattery) {
        return this.skip(summary, 'on-battery', startedAt);
      }

      // Gate 4 — the user is mid-conversation. `0` disables the gate.
      this.foreground.start();
      if (
        cfg.foregroundBackoffMs > 0 &&
        this.foreground.msSinceLastActivity(now) < cfg.foregroundBackoffMs
      ) {
        return this.skip(summary, 'foreground-active', startedAt);
      }

      // Gate 5 — the cron slot was cancelled before we started.
      if (opts.signal.aborted) return this.skip(summary, 'aborted', startedAt);

      this.assertStaleClaimTtl();
      summary.reaped = this.queue.reapStale(cfg.staleClaimTtlMs, now);

      for (const row of this.select(cfg, opts.tier, now, summary)) {
        if (opts.signal.aborted) break;
        if (
          TOKEN_SPENDING_STAGES.has(row.stage) &&
          this.isBudgetExhausted(cfg, Date.now())
        ) {
          // R3: leave it queued and keep going — the cheap stages behind it
          // still have work to do that costs nothing.
          summary.budgetExhausted = true;
          summary.budgetDeferred++;
          continue;
        }
        await this.runItem(row, cfg, opts, summary);
      }
    } catch (error: unknown) {
      // Invariant 11: a drain that throws would take the cron handler with it.
      summary.error = error instanceof Error ? error.message : String(error);
      this.logger.error(
        '[skill-synthesis] drain failed',
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    summary.durationMs = Date.now() - startedAt;
    this.logger.debug('[skill-synthesis] drain finished', { ...summary });
    return summary;
  }

  /**
   * R4. Round-robin over eligible workspaces, least-recently-drained first.
   * Every VISITED workspace has its cursor bumped, including one that yielded
   * nothing for this tier — otherwise it sits at the head of the order forever
   * and starves everyone behind it.
   */
  private select(
    cfg: SkillDrainConfig,
    tier: DrainTier,
    now: number,
    summary: DrainSummary,
  ): SkillQueueRow[] {
    const stages = DRAIN_TIER_STAGES[tier];
    const cheapFirst = this.shouldOrderCheapFirst(cfg, now);
    const picked: SkillQueueRow[] = [];

    for (const workspaceRoot of this.queue.listEligibleWorkspaces(now)) {
      if (picked.length >= cfg.maxItemsPerRun) break;

      const window = this.queue
        .listEligible(workspaceRoot, ELIGIBLE_SCAN_LIMIT, now)
        .filter((row) => stages.has(row.stage));
      if (cheapFirst) {
        window.sort(
          (a, b) => STAGE_COST_RANK[a.stage] - STAGE_COST_RANK[b.stage],
        );
      }

      const room = cfg.maxItemsPerRun - picked.length;
      picked.push(...window.slice(0, Math.min(cfg.perWorkspaceBatch, room)));

      this.queue.markWorkspaceDrained(workspaceRoot, now);
      summary.workspacesVisited++;
    }

    return picked;
  }

  private async runItem(
    row: SkillQueueRow,
    cfg: SkillDrainConfig,
    opts: DrainOptions,
    summary: DrainSummary,
  ): Promise<void> {
    const claimed = this.queue.tryClaim(row.id, this.workerId, Date.now());
    if (!claimed) {
      // Another worker won the CAS. Success by another worker, not an error.
      summary.lostClaims++;
      return;
    }
    summary.claimed++;

    const handler = this.handlers.get(claimed.stage);
    if (!handler) {
      this.queue.markSkipped(claimed.id, {
        reason: `no handler for stage ${claimed.stage}`,
      });
      summary.skippedItems++;
      return;
    }

    try {
      // The stage is known HERE and nowhere below: `LaneRunner` — which makes
      // the ledger write — sees only a lane id, a different taxonomy from the
      // eleven queue stages. The scope carries `claimed.stage` down the handler's
      // await chain so every token this dispatch spends is booked to it.
      const result = await this.budget.withStage(claimed.stage, () =>
        handler({
          row: claimed,
          tier: opts.tier,
          signal: opts.signal,
          touch: () => this.queue.touchClaim(claimed.id),
        }),
      );
      this.applyResult(claimed, result, summary);
    } catch (error: unknown) {
      this.applyThrow(claimed, cfg, error, summary);
    }
  }

  private applyResult(
    row: SkillQueueRow,
    result: SkillStageResult,
    summary: DrainSummary,
  ): void {
    switch (result.outcome) {
      case 'done':
        this.queue.markDone(row.id, {
          reason: result.reason,
          candidateId: result.candidateId,
        });
        summary.done++;
        return;
      case 'skipped':
        this.queue.markSkipped(row.id, { reason: result.reason });
        summary.skippedItems++;
        return;
      case 'unscored':
        this.queue.markUnscored(row.id, {
          reason: result.reason,
          notBefore:
            Date.now() + (result.retryInMs ?? DEFAULT_UNSCORED_BACKOFF_MS),
        });
        summary.unscored++;
        return;
      case 'failed':
        this.queue.markFailed(row.id, result.error, { reason: result.reason });
        summary.failed++;
        return;
    }
  }

  /**
   * A thrown stage is retried with exponential backoff until `maxAttempts`,
   * then fails terminally. `attemptCount` was already incremented by the CAS
   * claim, so the claimed row carries this attempt's number.
   */
  private applyThrow(
    row: SkillQueueRow,
    cfg: SkillDrainConfig,
    error: unknown,
    summary: DrainSummary,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn('[skill-synthesis] stage threw', {
      id: row.id,
      stage: row.stage,
      attempt: row.attemptCount,
      message,
    });

    if (row.attemptCount >= cfg.maxAttempts) {
      this.queue.markFailed(row.id, message, {
        reason: `${row.stage} failed after ${row.attemptCount} attempts`,
      });
      summary.failed++;
      return;
    }

    this.queue.markUnscored(row.id, {
      reason: `${row.stage} failed, will retry`,
      notBefore: Date.now() + backoffMs(row.attemptCount),
    });
    summary.unscored++;
  }

  private isBudgetExhausted(cfg: SkillDrainConfig, now: number): boolean {
    if (cfg.maxTokensPerDay <= 0) return false; // 0 = unlimited
    return this.budget.spentToday(now) >= cfg.maxTokensPerDay;
  }

  /** R3: spend the tail of the budget on the cheapest work available. */
  private shouldOrderCheapFirst(cfg: SkillDrainConfig, now: number): boolean {
    if (cfg.maxTokensPerDay <= 0) return false;
    return (
      this.budget.spentToday(now) >=
      cfg.maxTokensPerDay * CHEAP_FIRST_BUDGET_FRACTION
    );
  }

  private skip(
    summary: DrainSummary,
    reason: DrainSkipReason,
    startedAt: number,
  ): DrainSummary {
    summary.skipped = true;
    summary.reason = reason;
    summary.durationMs = Date.now() - startedAt;
    this.logger.debug('[skill-synthesis] drain skipped', {
      tier: summary.tier,
      reason,
    });
    return summary;
  }

  private readConfig(): SkillDrainConfig {
    const get = <T>(key: string, fallback: T): T => {
      try {
        const raw = this.workspace.getConfiguration<T>(
          SKILL_DRAIN_SECTION,
          key,
          fallback,
        );
        return raw === undefined || raw === null ? fallback : raw;
      } catch {
        return fallback;
      }
    };
    return {
      enabled: get(SKILL_DRAIN_KEYS.enabled, SKILL_DRAIN_DEFAULTS.enabled),
      maxItemsPerRun: get(
        SKILL_DRAIN_KEYS.maxItemsPerRun,
        SKILL_DRAIN_DEFAULTS.maxItemsPerRun,
      ),
      perWorkspaceBatch: get(
        SKILL_DRAIN_KEYS.perWorkspaceBatch,
        SKILL_DRAIN_DEFAULTS.perWorkspaceBatch,
      ),
      foregroundBackoffMs: get(
        SKILL_DRAIN_KEYS.foregroundBackoffMs,
        SKILL_DRAIN_DEFAULTS.foregroundBackoffMs,
      ),
      pauseOnBattery: get(
        SKILL_DRAIN_KEYS.pauseOnBattery,
        SKILL_DRAIN_DEFAULTS.pauseOnBattery,
      ),
      maxAttempts: get(
        SKILL_DRAIN_KEYS.maxAttempts,
        SKILL_DRAIN_DEFAULTS.maxAttempts,
      ),
      staleClaimTtlMs: get(
        SKILL_DRAIN_KEYS.staleClaimTtlMs,
        SKILL_DRAIN_DEFAULTS.staleClaimTtlMs,
      ),
      maxTokensPerDay: get(
        SKILL_DRAIN_KEYS.maxTokensPerDay,
        SKILL_DRAIN_DEFAULTS.maxTokensPerDay,
      ),
    };
  }
}

/** `2^attempt × 60s`, capped at 6 h. */
function backoffMs(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt, 30));
  return Math.min(2 ** exponent * 60_000, MAX_RETRY_BACKOFF_MS);
}
