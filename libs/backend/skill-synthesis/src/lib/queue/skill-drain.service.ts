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
 * stages — prefilter, embedding, clustering — keep draining. Those three are the
 * WHOLE free list; `trigger-eval` used to be read as a fourth and is not (see
 * `TOKEN_SPENDING_STAGES`). From 80 % of the budget onward the eligible window
 * is ordered cheap-stages-first, so the last of the budget buys the most work.
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
 * most `perWorkspaceBatch` (default 1) from each PER ROUND, stops at the tier's
 * item cap, and bumps the cursor of every workspace it VISITED — including one
 * whose rows all belong to another tier, or the cursor would never advance past
 * it.
 *
 * ## The item cap is PER TIER, and so is the number of rounds
 *
 * `DRAIN_TIER_LIMITS` is the throughput half of `DRAIN_TIER_STAGES`. The
 * frequent tier takes `maxItemsPerRun` in ONE round; the nightly and weekly
 * tiers take `nightlyMaxItemsPerRun` / `weeklyMaxItemsPerRun` dealt out over as
 * many rounds as they need. The reason is cadence, not preference: the frequent
 * tier fires 96 times a day, so its round-robin fairness is delivered across
 * ticks, while the once-a-day and once-a-week tiers have to be fair inside the
 * single tick each of them gets. Full rationale, and the measurements that
 * forced it, sit on `DRAIN_TIER_LIMITS` below.
 *
 * The cap is a THROUGHPUT throttle, never a cost control. The daily token
 * budget is the only cost ceiling and it is unchanged — a bigger cap simply
 * stops the queue growing while the budget sits unused.
 *
 * ## R5 — stale-claim TTL
 *
 * `staleClaimTtlMs` must exceed the longest a stage can legitimately run, or a
 * live run is reaped mid-flight and re-run at full cost. `assertStaleClaimTtl`
 * checks `ttl >= 3 × max(lane.timeoutMs)` at the head of every tick and warns
 * loudly; it does not throw, because a misconfigured TTL degrades throughput
 * rather than corrupting data.
 *
 * The maximum is read from the CONFIGURED lanes, not from a constant. Since
 * phase 1 no stage owns a timeout — every one of them runs on a lane — so a
 * fixed number here answers a question about a world that no longer exists, and
 * an install that lengthens its archaeologist lane would get a floor computed
 * for a lane it does not run.
 *
 * ## Q2 — the drain, not the runner, writes the row for a lane failure
 *
 * `LaneRunnerService` can write `SkillQueueStore.requeue` itself, but only when
 * a caller hands it `LaneRunRequest`'s optional queue-row id. **No caller in
 * this library does, and none may start** — pinned mechanically by a source scan
 * in `skill-drain.failures.spec.ts`, which is also why that field is not named
 * literally anywhere in this file. The drain is the single owner of the row
 * transition for a `SkillLaneFailure`, via the `lane-failed` stage outcome.
 *
 * That is not a coin flip between two equivalent seams. Only the drain reads
 * `maxAttempts`, so only the drain can decide `requeue` versus the TERMINAL
 * `markFailed` — and those two are alternatives for the same row, not a
 * sequence. A runner that requeued first would put the row back at `queued`
 * (claim released, another worker free to take it) and the drain's terminal
 * mark would then land on a row it no longer holds. Supplying that field AND
 * mapping here would double-write; `requeue` is idempotent so it would not
 * corrupt anything, but the attempt ladder would have two owners and they would
 * disagree the first time either changed.
 *
 * The mapping itself (`applyLaneFailure`):
 *
 *  - `timeout` / `auth-unresolvable` are TRANSPORT — nothing ran, so there is no
 *    verdict. The row goes back to `queued` behind `failure.retryAfterMs`
 *    (30 min for auth, exponential for a timeout) carrying the lane's own
 *    user-facing reason.
 *  - `structured-output-unsupported` / `tool-use-unsupported` are CAPABILITY —
 *    the endpoint answered, we just cannot use the answer. That is `unscored`,
 *    which is what the judge half of the same transition writes onto the
 *    candidate.
 *
 * ## The attempt ceiling applies to `timeout` ONLY — the asymmetry is deliberate
 *
 * A timed-out lane is marked terminally failed once `attempt_count >=
 * maxAttempts`. An `auth-unresolvable` lane is NOT: it requeues on its 30-minute
 * backoff forever, with no ceiling and no terminal path.
 *
 * The two failures differ in WHO CAN FIX THEM, and that is what decides it. A
 * timeout is a transport fault nobody may ever clear — an endpoint that is gone,
 * a model that cannot answer inside the lane's budget — so retrying it without
 * end is work that never lands. Unresolvable auth is a CONFIGURATION fault the
 * user can fix, and will, the moment they notice the stalled rows.
 *
 * Killing those rows means the fix arrives too late to recover them.
 * `markFailed` is terminal, and a failed row re-opens ONLY through `enqueue`
 * once the session grows past its `turn_count` — so a FINISHED session that
 * never grows again never re-enqueues, and there is no manual re-enqueue
 * affordance anywhere in the product today. Five attempts at a 30-minute backoff
 * is about two and a half hours of misconfiguration to lose that work
 * permanently. Retrying instead costs almost nothing: `not_before` gates
 * eligibility, so a stalled row is one skipped `listEligible` match every half
 * hour and no tokens at all. It is also what Q2 says literally — unresolvable
 * lane auth **stalls**.
 *
 * **A lane whose auth is unresolvable NEVER falls back to the foreground
 * provider** (Q2). It stalls, visibly, and that is the entire reason this phase
 * exists — a fallback would put background work straight back onto the user's
 * foreground quota. There is no fallback branch below and there must never be
 * one.
 */
import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import type { SkillLaneFailure } from '../lanes/lane.types';
import {
  maxLaneTimeoutMs,
  readSkillLanes,
  SKILL_LANE_DEFAULTS,
} from '../lanes/skill-lane-config';
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
  /**
   * Rows put back to `queued` by a TRANSPORT lane failure (`timeout` /
   * `auth-unresolvable`). Counted apart from `unscored` because they are the
   * Q2 stall: nothing ran, no quota was borrowed from the foreground, and the
   * row is eligible again after its backoff.
   */
  stalled: number;
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

/**
 * What a stage handler reports back. Mirrors the store's terminal states, plus
 * `lane-failed`.
 *
 * `lane-failed` is the channel a stage uses to hand the drain a
 * `SkillLaneFailure` VERBATIM instead of pre-deciding the row transition for
 * it. A handler that flattened a lane failure into `unscored` or `failed` would
 * be choosing the backoff and the terminal ceiling on its own, in a place that
 * cannot read `maxAttempts` — which is exactly the split ownership this outcome
 * exists to prevent.
 */
export type SkillStageResult =
  | { outcome: 'done'; reason?: string; candidateId?: string }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'unscored'; reason: string; retryInMs?: number }
  | { outcome: 'failed'; error: string; reason?: string }
  | { outcome: 'lane-failed'; failure: SkillLaneFailure };

export type SkillStageHandler = (
  ctx: SkillStageContext,
) => Promise<SkillStageResult>;

export const SKILL_DRAIN_SECTION = 'ptah';

export const SKILL_DRAIN_KEYS = {
  enabled: 'skillSynthesis.enabled',
  maxItemsPerRun: 'skillSynthesis.drain.maxItemsPerRun',
  nightlyMaxItemsPerRun: 'skillSynthesis.drain.nightlyMaxItemsPerRun',
  weeklyMaxItemsPerRun: 'skillSynthesis.drain.weeklyMaxItemsPerRun',
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
  nightlyMaxItemsPerRun: 40,
  weeklyMaxItemsPerRun: 400,
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
  nightlyMaxItemsPerRun: number;
  weeklyMaxItemsPerRun: number;
  perWorkspaceBatch: number;
  foregroundBackoffMs: number;
  pauseOnBattery: boolean;
  maxAttempts: number;
  staleClaimTtlMs: number;
  maxTokensPerDay: number;
}

/**
 * The longest a single stage may run on an install that has configured no lane
 * timeouts: `max(SKILL_LANE_DEFAULTS[*].timeoutMs)`, today the archaeologist's
 * 120 s.
 *
 * DERIVED, never a literal. It used to be the hard-coded `30_000` of the
 * deleted `SYNTHESIS_TIMEOUT_MS`, and phase 1 — which moved every stage onto a
 * per-lane `timeoutMs` — left it behind: the guard below went on asserting a
 * 90 s floor while the archaeologist lane could legitimately run for 120 s. A
 * literal here silently rots every time a lane default moves, so it is computed
 * from the lane table instead.
 *
 * {@link SkillDrainService.assertStaleClaimTtl} prefers the CONFIGURED lanes
 * and only lands on this figure when the settings file names no timeout — which
 * `readSkillLanes` expresses by returning these same defaults, so the two agree
 * by construction. It stays exported because the specs and the RPC schema need
 * the default-install number without a settings read.
 */
export const MAX_STAGE_TIMEOUT_MS = maxLaneTimeoutMs(SKILL_LANE_DEFAULTS);

/** R5: a TTL below `3 ×` the longest stage reaps live work. */
export const STALE_CLAIM_TTL_SAFETY_FACTOR = 3;

/**
 * Floor for the rows scanned per workspace before tier filtering + cheap-first
 * ordering. The effective limit is `max(this, tier item cap)`: a workspace can
 * never contribute more rows to one tick than the cap, and scanning fewer than
 * the cap would throttle the tick below its own configured ceiling. The floor
 * survives so that a small cap still gives the cheap-first sort something to
 * reorder.
 */
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
 * Tier → how much work one tick of it may take, and how it is dealt out.
 *
 * `DRAIN_TIER_STAGES` above says WHAT a tier may run; this says HOW MUCH. The
 * two numbers differ per tier because the tiers are throttled by different
 * things, and reading one number for all three is what starved `archaeology`.
 *
 * ## Why the nightly tier has its own cap
 *
 * `maxItemsPerRun` (4) is a per-TICK slice. The frequent tier gets 96 ticks a
 * day (every 15 minutes), so 4 is 384 dispatches of head-room. The nightly tier
 * gets ONE (`0 3 * * *`), so the same 4 is the entire day's supply for every
 * nightly-only stage — and because the nightly tier is a SUPERSET of the
 * frequent one and `ELIGIBLE_SQL` orders `enqueued_at ASC`, those four slots
 * usually go to older frequent-stage rows before a nightly-only row is even
 * reached. Measured against a real 849-session corpus that is ≤ 4 rows a day of
 * supply against ~30 a day of demand: the queue grows without bound and the
 * stage ships inert.
 *
 * Raising the SHARED key instead would apply the same multiplier to the
 * frequent tier 96 times a day, which nothing measured asks for. So the nightly
 * tier reads its own key and the frequent tier is untouched.
 *
 * ## Why the weekly tier now has its own cap too
 *
 * It used to share `maxItemsPerRun` on the stated ground that its own three
 * stages had no producers. Phase 3 ended that: `judge-panel` and `trigger-eval`
 * are both chained off the successful end of every `prefilter` handler run,
 * beside `enqueueArchaeology`. So the weekly tier carries roughly TWO rows per
 * eligible session — the same producer point as `archaeology`, at one seventh
 * the drain cadence.
 *
 * Re-measured on the same harness B0.10 used (`prefilter-corpus-measurement`,
 * 828 sessions over 31 days): ~163 prefilter-eligible sessions a WEEK, hence
 * ~325 weekly rows a week of demand against a supply of FOUR. That is the
 * nightly defect again, an order of magnitude worse, because the tick that has
 * to absorb it comes 7× less often. `replay` is weekly-only as well but has no
 * producer on purpose (TASK_2026_245), so it contributes nothing to the demand
 * and its absence is not what makes the cap safe.
 *
 * The stages the weekly tier SHARES with the cheaper tiers still cost it almost
 * nothing: that night's 03:00 nightly tick drains 40 against ~33 rows/day of
 * demand, so it keeps up and leaves no residue for 04:00 to inherit. The cap is
 * therefore spent on the weekly-only stages, which is what it is for.
 *
 * 400 is ~1.2× measured demand — the same "cover the mean, let peaks smooth
 * across ticks" rule B0.10 applied (its 40 does not cover the busiest measured
 * day either). And as there, the cap is a THROUGHPUT throttle and never a cost
 * control: `maxTokensPerDay` is the only cost ceiling, it is unchanged, and it
 * is a hard stop checked once per tick and again per item. A cap larger than
 * the budget can pay for does not overspend — it stops, having stopped the
 * queue from growing.
 *
 * `multiRound` comes with it and is not optional. Raising the number alone
 * reproduces B0.10's exact near-miss: with `perWorkspaceBatch` at 1 and one
 * workspace holding 88 % of the measured corpus, a single-pass deal returns ONE
 * row a week whatever the cap says.
 *
 * ## Why `multiRound` is not simply `true` everywhere
 *
 * `multiRound` deals the cap out in round-robin ROUNDS of `perWorkspaceBatch`
 * rather than in one pass — so a lone workspace can reach the whole cap while
 * two busy workspaces split it evenly, instead of the first one in cursor order
 * taking everything.
 *
 * The frequent tier does not need it and must not have it. Its round-robin
 * fairness is delivered ACROSS its 96 ticks: one row per workspace per tick,
 * cursor bumped, next tick starts elsewhere. The nightly tier has exactly one
 * tick, so all of its fairness has to happen INSIDE that tick — there is no
 * "next tick" for a day. Turning rounds on for the frequent tier would quadruple
 * its dispatch rate (a lone workspace goes from 1 to 4 per tick) to fix a
 * problem it does not have, and its stages include the token-spending
 * `synthesis` and `judge`.
 */
export const DRAIN_TIER_LIMITS: Record<
  DrainTier,
  {
    readonly itemCap: (cfg: SkillDrainConfig) => number;
    readonly multiRound: boolean;
  }
> = {
  frequent: { itemCap: (cfg) => cfg.maxItemsPerRun, multiRound: false },
  nightly: { itemCap: (cfg) => cfg.nightlyMaxItemsPerRun, multiRound: true },
  weekly: { itemCap: (cfg) => cfg.weeklyMaxItemsPerRun, multiRound: true },
};

/**
 * Stages that consume the token budget, and therefore stop when it is gone.
 *
 * ## The complement is exactly THREE stages, and the list is the reason
 *
 * `prefilter` is a regex pass, `embedding` runs the local `IEmbedder`, and
 * `clustering` is cosine arithmetic over vectors those two already produced.
 * None of the three can reach an endpoint, so none of them can be gated by a
 * token budget and all three keep draining after the budget is gone.
 *
 * ## `trigger-eval` is NOT a fourth, and reading it as one was the defect
 *
 * The gate's SCORING path is genuinely local — that is its defining property and
 * its header says so at length. But scoring needs a probe set, and the probe set
 * is generated per evaluation by a model: `TriggerEvalService.generatePrompts`
 * calls `laneRunner.run(...)` (`gates/trigger-eval.service.ts`, the single
 * `this.laneRunner.run(` call site its own spec pins). One LLM call per row is
 * not zero, so the stage belongs here.
 *
 * Leaving it out did not merely miscount a report. `LaneRunnerService` records
 * the spend into `SkillBudgetStore` either way, so the tokens always landed in
 * the ledger — they were counted AFTER the fact and never gated BEFORE it. The
 * per-item check below kept dispatching `trigger-eval` rows past
 * `maxTokensPerDay`, which made the daily ceiling not a ceiling, and
 * {@link STAGE_COST_RANK} ranked the stage below `judge` so the tail of the
 * budget actively PREFERRED a spending stage believed to be free. `trigger-eval`
 * is roughly half of all weekly rows (it and `judge-panel` are the only weekly
 * stages with producers), so the exposure was not marginal.
 *
 * The behaviour change is the point: a host that is over budget now stops
 * running `trigger-eval` rows entirely, exactly as it stops running `judge`.
 * They stay `queued` and are eligible again next tick.
 */
const TOKEN_SPENDING_STAGES: ReadonlySet<SkillQueueStage> =
  new Set<SkillQueueStage>([
    'synthesis',
    'cluster-synthesis',
    'judge',
    'judge-panel',
    'trigger-eval',
    'replay',
    'archaeology',
    'digest',
  ]);

/**
 * Relative cost, cheapest first. Only the ORDER matters, not the values.
 *
 * `trigger-eval` sits between `judge` and `digest`: one lane call plus local
 * embedder arithmetic is dearer than a single bare judge call, and cheaper than
 * `judge-panel`'s two calls plus a possible escalation.
 */
const STAGE_COST_RANK: Record<SkillQueueStage, number> = {
  prefilter: 0,
  embedding: 1,
  clustering: 2,
  judge: 3,
  'trigger-eval': 4,
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
   * longest stage. Called at the head of every tick.
   *
   * ## It reads the CONFIGURED lanes, and that is the whole point
   *
   * Every stage runs on a lane and no stage owns a timeout any more, so "the
   * longest a stage can run" is `max(lane.timeoutMs)` over the four lanes as the
   * USER has them — not a module constant. Omitting the argument reads them,
   * through the same `IWorkspaceProvider` {@link readConfig} already uses; there
   * is nothing to thread in from the host. `maxStageTimeoutMs` stays overridable
   * for a caller that already holds the number.
   *
   * The gap this closes is not theoretical arithmetic: with the archaeologist
   * lane at its 120 s default the true floor is 360 s, while the old hard-coded
   * 30 s made the guard report "safe" for any TTL from 90 s up. Every value in
   * that band reaps a live archaeology run mid-flight — exactly what R5 exists
   * to catch — and the guard would have said nothing.
   *
   * It WARNS AND CONTINUES, and must keep doing so. `drain()` may never throw,
   * and a mis-set TTL degrades throughput rather than corrupting data; it is the
   * user's to fix, and a warning is how they find out.
   */
  assertStaleClaimTtl(maxStageTimeoutMs?: number): boolean {
    const ttl = this.readConfig().staleClaimTtlMs;
    const longestStageMs =
      maxStageTimeoutMs ?? maxLaneTimeoutMs(readSkillLanes(this.workspace));
    const required = STALE_CLAIM_TTL_SAFETY_FACTOR * longestStageMs;
    if (ttl >= required) return true;
    this.logger.warn(
      '[skill-synthesis] staleClaimTtlMs is below the safe minimum; long stages may be reaped mid-run',
      { staleClaimTtlMs: ttl, required, maxStageTimeoutMs: longestStageMs },
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
      stalled: 0,
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
   *
   * Two passes, and the split is what lets the nightly tier be both fast and
   * fair:
   *
   *  1. **Visit** workspaces in cursor order, taking one eligible window from
   *     each, and stop once ROUND ONE alone would fill the tick. Visiting is
   *     also what bumps the cursor, so this stop condition decides which
   *     workspaces keep their earlier cursor and therefore sort first next
   *     tick. It is measured on round-one supply — `min(window, batch)` — and
   *     deliberately not on total supply: one workspace holding hundreds of
   *     rows must not end the walk before its neighbours have had a turn.
   *  2. **Deal** from those windows. A single-round tier takes at most
   *     `perWorkspaceBatch` from each and stops; a `multiRound` tier keeps
   *     going round until the cap is reached or a whole round yields nothing.
   *
   * `perWorkspaceBatch` therefore stays 1 for every tier. Under rounds it is a
   * fairness QUANTUM, not a throughput cap: a lone workspace still reaches the
   * whole cap because the rounds repeat, while two busy workspaces split the
   * cap evenly instead of the first in cursor order taking all of it. Raising
   * it to buy throughput would do the opposite — every workspace visited on one
   * tick is stamped with the SAME `last_drained_at`, so the order among them
   * falls back to `workspace_root ASC`, and a large batch would let the
   * alphabetically first busy project eat the tick. That is R4 exactly, which
   * is why the fix is rounds rather than a bigger slice.
   */
  private select(
    cfg: SkillDrainConfig,
    tier: DrainTier,
    now: number,
    summary: DrainSummary,
  ): SkillQueueRow[] {
    const stages = DRAIN_TIER_STAGES[tier];
    const limits = DRAIN_TIER_LIMITS[tier];
    const cap = limits.itemCap(cfg);
    const batch = cfg.perWorkspaceBatch;
    const cheapFirst = this.shouldOrderCheapFirst(cfg, now);
    const scanLimit = Math.max(ELIGIBLE_SCAN_LIMIT, cap);

    // Pass 1 — visit.
    const windows: Array<{ rows: SkillQueueRow[]; taken: number }> = [];
    let firstRoundSupply = 0;
    for (const workspaceRoot of this.queue.listEligibleWorkspaces(now)) {
      if (firstRoundSupply >= cap) break;

      const rows = this.queue
        .listEligible(workspaceRoot, scanLimit, now)
        .filter((row) => stages.has(row.stage));
      if (cheapFirst) {
        rows.sort(
          (a, b) => STAGE_COST_RANK[a.stage] - STAGE_COST_RANK[b.stage],
        );
      }

      windows.push({ rows, taken: 0 });
      firstRoundSupply += Math.min(rows.length, batch);

      this.queue.markWorkspaceDrained(workspaceRoot, now);
      summary.workspacesVisited++;
    }

    // Pass 2 — deal. `cap` bounds the round COUNT as well as the item count, so
    // the loop terminates even when `perWorkspaceBatch` is misconfigured to 0.
    const picked: SkillQueueRow[] = [];
    const maxRounds = limits.multiRound ? cap : 1;
    for (let round = 0; round < maxRounds && picked.length < cap; round++) {
      let dealt = 0;
      for (const window of windows) {
        if (picked.length >= cap) break;
        const take = Math.min(
          batch,
          cap - picked.length,
          window.rows.length - window.taken,
        );
        if (take <= 0) continue;
        picked.push(...window.rows.slice(window.taken, window.taken + take));
        window.taken += take;
        dealt += take;
      }
      if (dealt === 0) break;
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
      //
      // The mapping runs INSIDE the scope too. It spends nothing itself, but a
      // `lane-failed` outcome is precisely the case where the lane already
      // spent before it gave up, and keeping the whole dispatch under one scope
      // means no part of a failing stage's cost can leak into the unattributed
      // `''` bucket.
      await this.budget.withStage(claimed.stage, async () => {
        const result = await handler({
          row: claimed,
          tier: opts.tier,
          signal: opts.signal,
          touch: () => this.queue.touchClaim(claimed.id),
        });
        this.applyResult(claimed, cfg, result, summary);
      });
    } catch (error: unknown) {
      this.applyThrow(claimed, cfg, error, summary);
    }
  }

  private applyResult(
    row: SkillQueueRow,
    cfg: SkillDrainConfig,
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
      case 'lane-failed':
        this.applyLaneFailure(row, cfg, result.failure, summary);
        return;
    }
  }

  /**
   * `SkillLaneFailure` → row transition. The Q2 seam.
   *
   * Two families, and the split is "did the endpoint answer at all", not "how
   * bad was it":
   *
   *  - TRANSPORT (`timeout`, `auth-unresolvable`) — nothing ran. `requeue`, so
   *    the row is `queued` again behind the lane's own `retryAfterMs` with the
   *    lane's user-facing reason. Never `markUnscored`: `unscored` is the
   *    JUDGE's verdict ("we ran and we do not know"), and spending it on an
   *    endpoint that never answered would make one status mean two unrelated
   *    things on the Activity surface.
   *  - CAPABILITY (`structured-output-unsupported`, `tool-use-unsupported`) —
   *    the endpoint answered and the answer is unusable. That IS `unscored`,
   *    and it is the same transition the judge writes onto the candidate.
   *
   * Only `timeout` carries the attempt ceiling. `auth-unresolvable` requeues
   * unconditionally — see the asymmetry section in this file's header: the row
   * is waiting on a fix the USER makes, and a terminal mark would land before
   * the fix does, with no way to bring the work back.
   *
   * There is deliberately no third branch that retries the work somewhere else.
   * An unresolvable lane STALLS (Q2); falling back to the foreground provider
   * would move background cost onto the user's live quota, which is the defect
   * this phase exists to remove.
   */
  private applyLaneFailure(
    row: SkillQueueRow,
    cfg: SkillDrainConfig,
    failure: SkillLaneFailure,
    summary: DrainSummary,
  ): void {
    if (failure.kind !== 'timeout' && failure.kind !== 'auth-unresolvable') {
      this.queue.markUnscored(row.id, {
        reason: failure.reason,
        notBefore:
          Date.now() + (failure.retryAfterMs || DEFAULT_UNSCORED_BACKOFF_MS),
      });
      summary.unscored++;
      return;
    }

    // The attempt ladder, and it is `timeout`-only ON PURPOSE. `attemptCount`
    // was incremented by the CAS claim, so the claimed row already carries THIS
    // attempt's number.
    //
    // Do not widen this condition to `auth-unresolvable` without re-reading the
    // asymmetry section in this file's header — an auth stall is waiting on a
    // user's configuration fix, and `markFailed` is terminal for a session that
    // may never grow again. `skill-drain.failures.spec.ts` asserts the row
    // survives well past `maxAttempts`, so a re-widening breaks a test rather
    // than quietly discarding work.
    if (failure.kind === 'timeout' && row.attemptCount >= cfg.maxAttempts) {
      this.failTerminally(row, failure, summary);
      return;
    }

    const applied = this.queue.requeue(
      row.id,
      Date.now() + failure.retryAfterMs,
      failure.reason,
    );
    if (!applied) {
      // The row was reaped (or finished elsewhere) while the stage ran. Same
      // contract as `touchClaim` returning `false`: this worker has lost the
      // row and stops writing rather than stomping whoever holds it now.
      summary.lostClaims++;
      this.logger.debug(
        '[skill-synthesis] lane requeue skipped; the row is no longer claimed',
        { id: row.id, stage: row.stage, kind: failure.kind },
      );
      return;
    }
    summary.stalled++;
  }

  /**
   * The terminal mark and its ONE Activity event, landed together.
   *
   * `LaneRunnerService` deliberately does not do this: it cannot read
   * `maxAttempts`, and a terminal mark without a legible event is a row that
   * dies silently — a stage that simply stops appearing, with no way to tell it
   * from one that finished.
   *
   * The pairing is one `markFailed` statement writing BOTH halves the Activity
   * surface reads — `last_error` (the lane's own message, diagnostic) and the
   * user-facing `reason` naming the stage, the attempt count and why it gave up
   * — plus exactly one `warn`, emitted here and nowhere else on this path. The
   * per-attempt stalls above log at `debug` only, so a row produces one loud
   * line in its whole lifetime: the one where it died.
   *
   * `markFailed` is TERMINAL and takes no backoff. The row re-opens only through
   * `enqueue`, once the session grows past its `turn_count`.
   */
  private failTerminally(
    row: SkillQueueRow,
    failure: SkillLaneFailure,
    summary: DrainSummary,
  ): void {
    const reason = `${row.stage} gave up after ${row.attemptCount} attempts — ${failure.reason}`;
    this.queue.markFailed(row.id, failure.reason, { reason });
    summary.failed++;
    this.logger.warn(
      '[skill-synthesis] lane failure exhausted its attempts; the row is now terminal',
      {
        id: row.id,
        stage: row.stage,
        kind: failure.kind,
        attempt: row.attemptCount,
        reason: failure.reason,
      },
    );
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
      nightlyMaxItemsPerRun: get(
        SKILL_DRAIN_KEYS.nightlyMaxItemsPerRun,
        SKILL_DRAIN_DEFAULTS.nightlyMaxItemsPerRun,
      ),
      weeklyMaxItemsPerRun: get(
        SKILL_DRAIN_KEYS.weeklyMaxItemsPerRun,
        SKILL_DRAIN_DEFAULTS.weeklyMaxItemsPerRun,
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
