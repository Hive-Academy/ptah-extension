/**
 * SkillStageHandlersService — the queue's stage-dispatch layer.
 *
 * ## Why this is its own file
 *
 * `SkillSynthesisService.start()` is THE REGISTRATION SEAM: without it an
 * enqueued row is marked `skipped` ("no handler for stage …") and the queue is
 * one nobody reads. TASK_2026_180 wired that seam inline, and by the end of the
 * task the six stage protocols it dispatches — each with its own outcome
 * mapping, its own reason tokens and its own producers — had buried the seam
 * inside a class whose other subjects are lifecycle, settings and the
 * RPC-backing promote/reject methods. Every other concern that task introduced
 * got a directory (`queue/`, `lanes/`, `gates/`, `archaeology/`, `digest/`,
 * `naming/`); this is the one that did not, and TASK_2026_256 is that move.
 *
 * The split is STRUCTURAL. Every mapping below is byte-for-byte the contract
 * documented in the lib's `CLAUDE.md`, and it is expressed once per gate rather
 * than folded together on purpose: the four outcomes agree, but WHICH FACT
 * selects them differs in kind per gate (a verdict status, a permanent property
 * of a cluster, a retryable-reason set), and a shared mapper would have to
 * re-derive that from the outside.
 *
 * ## The workers it does not own
 *
 * `analyzeSession`, `backfillEmbeddings` and `readSettings` stay on
 * `SkillSynthesisService`. They are handed over as `SkillStageWorkers` at
 * registration time rather than injected, because injecting the synthesis
 * service here would be a tsyringe resolution CYCLE — that service injects this
 * one. A narrow port passed to `registerStageHandlers` is the seam that has no
 * cycle in it, and it is the whole surface the handlers need.
 *
 * ## Optional collaborators are optional on purpose
 *
 * `archaeologist`, `judgePanel`, `replayValidator` and `triggerEval` are all
 * `{isOptional: true}` and each is registered CONDITIONALLY. Each needs an LLM
 * lane and a CLI or e2e host legitimately has none; registering a handler that
 * could only ever answer "I am not here" spends a claim and an attempt to say
 * what "no handler for stage X" says for free.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { readCandidateBodyFile } from '../candidate-body';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SessionArchaeologistService } from '../archaeology/session-archaeologist.service';
import type { JudgePanelService } from '../gates/judge-panel.service';
import {
  REPLAY_REASONS,
  type ReplayValidatorService,
} from '../gates/replay-validator.service';
import {
  RETRYABLE_TRIGGER_EVAL_SKIP_REASONS,
  type TriggerEvalService,
} from '../gates/trigger-eval.service';
import type {
  CandidateId,
  RegisterCandidateResult,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from '../types';
import type { SkillQueueStore } from './skill-queue.store';
import {
  SKILL_QUEUE_PAYLOAD_KEYS,
  type SkillQueueRow,
  type SkillQueueSource,
  type SkillQueueStage,
} from './skill-queue.types';
import type {
  SkillDrainService,
  SkillStageContext,
  SkillStageResult,
} from './skill-drain.service';

/**
 * How often a running stage handler heartbeats its queue claim.
 *
 * `reapStale` returns any claim older than `staleClaimTtlMs` (default 15 min)
 * to `queued`, so a stage that legitimately runs longer than that would be
 * re-claimed and re-run at full cost while it is still working. One minute is
 * comfortably under the smallest TTL `assertStaleClaimTtl` will accept —
 * `3 × max(lane.timeoutMs)`, which is `3 × 120 s` on the shipped lane defaults
 * and larger on any install that lengthens a lane — and costs one UPDATE per
 * minute per in-flight row.
 *
 * The interval is deliberately NOT derived from that floor. It is bounded above
 * by the smallest TTL a user may configure, not by the longest stage, and a
 * minute sits under every value the guard accepts.
 */
const CLAIM_HEARTBEAT_MS = 60_000;

/**
 * The reason token a measured `trigger-eval` row finishes with.
 *
 * It lives here rather than beside `TRIGGER_EVAL_SKIP_REASONS` only because
 * that map is in a file this batch does not own. `REPLAY_REASONS.measured`
 * is the shape it should match — the success token belongs with the gate's own
 * reason tokens, and moving it there is a one-line follow-up.
 */
const TRIGGER_EVAL_MEASURED_REASON = 'trigger-eval-measured';

/**
 * The three workers the handlers dispatch INTO that live on
 * `SkillSynthesisService`.
 *
 * Deliberately narrow — this is the whole surface the six stages need, and
 * naming it as a port is what keeps the dependency one-way. `analyzeSession`
 * and `backfillEmbeddings` were left public by TASK_2026_180 phase 0 precisely
 * so a stage handler could be their one background caller; `readSettings` is
 * here because two gates take the effective settings and there must remain
 * exactly ONE reader of them.
 */
export interface SkillStageWorkers {
  analyzeSession(
    sessionId: string,
    workspaceRoot: string,
    options: {
      force?: boolean;
      signal?: AbortSignal;
      transcriptPath?: string;
      source?: SkillQueueSource;
    },
  ): Promise<RegisterCandidateResult | null>;
  backfillEmbeddings(): Promise<number>;
  readSettings(): SkillSynthesisSettings;
}

@injectable()
export class SkillStageHandlersService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    /**
     * The queue the producers below write into. Optional for the same reason it
     * is optional on `SkillSynthesisService`: a host without persistence, or a
     * spec that constructs this by hand, still resolves. A missing queue means
     * a chain link is skipped, never that anything runs inline.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, { isOptional: true })
    private readonly queue: SkillQueueStore | null = null,
    /**
     * The drain these handlers are registered on. Injected BY TOKEN and typed
     * with `import type`, so this file never takes a runtime dependency on
     * `queue/skill-drain.service` — that module's own type graph points back at
     * the synthesis service (`SkillQueueSource = AnalyzeSource`).
     *
     * When it is absent nothing drains in this host, which is exactly what a
     * host with no queue should do.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE, { isOptional: true })
    private readonly drain: SkillDrainService | null = null,
    /**
     * The phase-2 analyzer. Optional and injected BY TOKEN: a CLI or e2e host
     * that registers no analysis lane still resolves, and when it is absent the
     * `archaeology` stage is simply not registered — the drain then marks such a
     * row `skipped` with "no handler for stage archaeology", which is the honest
     * answer for a host that cannot run it. There is no inline fallback.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_ARCHAEOLOGIST_SERVICE, {
      isOptional: true,
    })
    private readonly archaeologist: SessionArchaeologistService | null = null,
    /**
     * The three phase-3 measuring gates, all optional and all injected BY TOKEN
     * for exactly the reason the archaeologist is: each one needs an LLM lane,
     * and a CLI or e2e host legitimately has none. When one is absent its stage
     * is simply not registered and no row is ever produced for it — see
     * `registerStageHandlers` and `enqueueCandidateGates`.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.JUDGE_PANEL_SERVICE, { isOptional: true })
    private readonly judgePanel: JudgePanelService | null = null,
    @inject(SKILL_SYNTHESIS_TOKENS.REPLAY_VALIDATOR_SERVICE, {
      isOptional: true,
    })
    private readonly replayValidator: ReplayValidatorService | null = null,
    @inject(SKILL_SYNTHESIS_TOKENS.TRIGGER_EVAL_SERVICE, { isOptional: true })
    private readonly triggerEval: TriggerEvalService | null = null,
  ) {}

  /**
   * Wire the stages this host can run onto the drain. Idempotent — `Map.set`.
   *
   * `SkillDrainService` marks an item whose stage has no handler as `skipped`
   * rather than re-claiming it forever, which is the right behaviour for a
   * stage that does not exist in this host and completely the wrong outcome
   * for one that does. Before B0.9 nothing in production called
   * `registerStageHandler` at all, so every row B0.6 enqueued died `skipped`.
   *
   * The handlers dispatch to existing public workers. None reimplements
   * anything: `analyzeSession` and `backfillEmbeddings` were left public by B0.6
   * precisely so a stage handler could be their one caller, and `archaeology`
   * dispatches straight into `SessionArchaeologistService.analyze`.
   *
   * `archaeology` is registered CONDITIONALLY, unlike the other two. The other
   * two always have a worker — the caller hands them over — whereas the analyzer
   * is an injected collaborator a CLI/e2e host legitimately does not have.
   * Registering a handler that could only ever answer "I am not here" would
   * spend a claim and an attempt to say what "no handler for stage archaeology"
   * already says for free.
   *
   * The three phase-3 gates — `judge-panel`, `replay`, `trigger-eval` — follow
   * the archaeologist's rule for the same reason: each is an injected
   * collaborator that needs an LLM lane. All three are WEEKLY-tier
   * (`WEEKLY_ONLY_STAGES`), so a frequent or nightly tick never claims one even
   * where the handler is present.
   *
   * `replay` gets a handler and DELIBERATELY NO PRODUCER — see
   * `enqueueCandidateGates`.
   *
   * Called from ABOVE both of `SkillSynthesisService.start()`'s early returns,
   * deliberately: registration is two Map writes, so it opens no database, reads
   * no transcript and spends nothing, and a host that booted while
   * `skillSynthesis.enabled` was false must still drain once the tray re-enables
   * background learning.
   */
  registerStageHandlers(workers: SkillStageWorkers): void {
    if (!this.drain) return;
    this.drain.registerStageHandler('prefilter', (ctx) =>
      this.runPrefilterStage(ctx, workers),
    );
    this.drain.registerStageHandler('embedding', (ctx) =>
      this.runEmbeddingStage(ctx, workers),
    );
    if (this.archaeologist) {
      this.drain.registerStageHandler('archaeology', (ctx) =>
        this.runArchaeologyStage(ctx),
      );
    }
    if (this.judgePanel) {
      this.drain.registerStageHandler('judge-panel', (ctx) =>
        this.runJudgePanelStage(ctx, workers),
      );
    }
    if (this.replayValidator) {
      this.drain.registerStageHandler('replay', (ctx) =>
        this.runReplayStage(ctx),
      );
    }
    if (this.triggerEval) {
      this.drain.registerStageHandler('trigger-eval', (ctx) =>
        this.runTriggerEvalStage(ctx, workers),
      );
    }
  }

  /**
   * The `prefilter` stage — the ONE background path into `analyzeSession`.
   *
   * ## Why `force: true` is mandatory here, and is not a bypass
   *
   * `enqueueAnalyze` records the session's turn count in `analyzedSessions`
   * the moment it queues the row. The drain then claims that row LATER IN THE
   * SAME PROCESS and calls back in with the same transcript, so
   * `analyzeSession`'s own `analyzedSessions` comparison would see
   * `turnCount <= lastTurnCount`, return `null`, and the row would finish
   * `skipped` having done nothing — the queue would drain into a void.
   *
   * `force` deletes the cache entry and lets the run proceed. That is correct
   * rather than merely convenient: `analyzedSessions` is documented as a
   * same-process FAST PATH, not the correctness boundary. Deduplication for
   * this row already happened, durably, at enqueue time —
   * `UNIQUE(session_id, stage)` plus the re-open guarded on `turn_count <`.
   * Applying the in-memory guard a second time to a row that has already
   * passed the durable one is double-counting, not safety.
   */
  private async runPrefilterStage(
    ctx: SkillStageContext,
    workers: SkillStageWorkers,
  ): Promise<SkillStageResult> {
    const { row } = ctx;
    const result = await this.withClaimHeartbeat(ctx, (signal) =>
      workers.analyzeSession(row.sessionId, row.workspaceRoot, {
        force: true,
        signal,
        transcriptPath: row.transcriptPath ?? undefined,
        source: row.source,
      }),
    );
    if (!result) {
      // Ineligible, prefiltered out, or dominated by an authored skill. All
      // three are "we looked and there is nothing to promote", which is a
      // finished row, not a failure and not a retry.
      return { outcome: 'skipped', reason: 'no candidate from this session' };
    }
    this.enqueueArchaeology(row);
    this.enqueueCandidateGates(row, result.candidate.id);
    return {
      outcome: 'done',
      candidateId: result.candidate.id as unknown as string,
      reason: result.reused ? 'reused existing candidate' : undefined,
    };
  }

  /**
   * The `prefilter → archaeology` link of the canonical chain.
   *
   * ## Why the row is written HERE and not at enqueue time
   *
   * The regex prefilter is what gates ELIGIBILITY TO SPEND (R3): the analyzer is
   * the only stage that runs once per session and it dominates the token budget
   * at any real session rate. Enqueuing `archaeology` beside `prefilter` in
   * `enqueueAnalyze` would pay for every session the prefilter was about to
   * reject, which is precisely the cost R3 exists to bound. Writing it from the
   * successful end of the prefilter handler means a session buys an analysis
   * only once cheap local computation says there is something there.
   *
   * ## The turn-count trap, again
   *
   * `SkillQueueStore.enqueue`'s guarded re-open fires on `turn_count < ?`, so a
   * row enqueued with `0` is a row that can never re-open — it compiles, it
   * satisfies any call-counting test, and it wedges the session permanently.
   * `row.turnCount` is the count `enqueueAnalyze` observed from the extractor for
   * THIS row (and that `enqueue` re-wrote on every re-open), so it is a real
   * observation rather than a placeholder. Re-extracting here to get a fresher
   * number would re-read the JSONL on the drain path to move the count at most a
   * few turns, and the analyzer re-reads the transcript itself anyway.
   *
   * ## `dependsOn` is deliberately null
   *
   * The ordering is already enforced by construction — this row does not exist
   * until the prefilter row succeeded. Pointing `depends_on` at the prefilter row
   * would ADD a failure mode rather than a guarantee: `listEligible` requires the
   * ancestor to be `done`, so the first time that session re-opens and the
   * prefilter ends `skipped` instead, the archaeology row becomes permanently
   * ineligible while still being scanned on every tick.
   */
  private enqueueArchaeology(row: SkillQueueRow): void {
    if (!this.queue || !this.archaeologist) return;
    try {
      const result = this.queue.enqueue({
        sessionId: row.sessionId,
        stage: 'archaeology',
        source: row.source,
        workspaceRoot: row.workspaceRoot,
        transcriptPath: row.transcriptPath,
        turnCount: row.turnCount,
      });
      this.logger.debug('[skill-synthesis] archaeology enqueued', {
        sessionId: row.sessionId,
        outcome: result.outcome,
        turnCount: row.turnCount,
      });
    } catch (error: unknown) {
      // The prefilter row itself succeeded and must still land `done`. A
      // failure to chain is a lost analysis, not a lost candidate.
      this.logger.warn(
        '[skill-synthesis] could not enqueue the archaeology stage (non-fatal)',
        {
          sessionId: row.sessionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * The `prefilter → {judge-panel, trigger-eval}` links of the chain.
   *
   * ## Why only two of the three gates get a producer
   *
   * `replay` gets a HANDLER and no producer, deliberately. `ReplayValidator`
   * needs a graded `SkillCandidateRow` drafted from a CLUSTER, and the cluster
   * path (`SkillCuratorService.runSuggestionPass`) does not produce candidate
   * rows at all — it produces SUGGESTIONS, which the user accepts. Registering a
   * cluster draft as a candidate to give replay something to grade would send it
   * back through clustering, dedup and AUTO-PROMOTION, bypassing the accept step
   * entirely. That is a product change with its own batch. Wiring the producer
   * anyway would ship a gate that can only ever answer "no hold-out", which is
   * the same mistake the hold-out commit avoided.
   *
   * ## Why HERE and not at enqueue time
   *
   * Identical to `enqueueArchaeology`: the regex prefilter is what gates
   * eligibility to spend. Both of these stages grade a CANDIDATE, and there is
   * no candidate until the prefilter succeeded — enqueuing them beside
   * `prefilter` would pay for every session the prefilter was about to reject.
   *
   * ## The candidate id travels in `payload`, not in `candidate_id`
   *
   * The `candidate_id` COLUMN is written by the DRAIN when a stage completes, so
   * it records what a row produced. These rows need to know what to grade BEFORE
   * they run, which is what the payload key is for.
   *
   * `REOPEN_SQL` does not touch `payload`, so a re-opened row would still carry
   * the FIRST pass's candidate id. A grown session yields a new trajectory hash
   * and therefore possibly a new candidate, so the re-opened row would grade the
   * wrong one. That is not belt-and-braces: without the refresh the gates
   * silently re-measure a stale candidate every time a session grows.
   *
   * The refresh is `enqueue`'s own job, not a follow-up call from here. It was
   * a follow-up `mergePayload` once, and the gap between the two transactions
   * was a window in which the row was `queued` with the previous pass's
   * candidate id — long enough for a second host on the shared database to
   * claim it and grade a superseded candidate, silently. Passing `payload` and
   * letting the store re-point the row inside the re-open transaction is what
   * closes it; do not re-add a second call here.
   *
   * ## `workspaceRoot`, not `''`
   *
   * `''` is the round-robin key reserved for work with no owning workspace —
   * clustering, the embedding backfill. Both of these grade a candidate this
   * workspace produced, so they take part in per-workspace fairness like every
   * other candidate-scoped row. `trigger-eval` READS the cross-project active
   * library to find description collisions, but reading across projects is a
   * property of the measurement, not a statement about who owns the row.
   *
   * ## `dependsOn` stays NULL
   *
   * Same reason as `enqueueArchaeology`: `ELIGIBLE_SQL` requires the ancestor to
   * be `done`, so pointing at a prefilter row that can legitimately end
   * `skipped` would strand the dependent forever. The ordering is already
   * guaranteed by construction — these rows do not exist until prefilter
   * succeeded.
   */
  private enqueueCandidateGates(
    row: SkillQueueRow,
    candidateId: CandidateId,
  ): void {
    if (!this.queue) return;
    // `JudgePanelService.evaluate` calls `judge.judge()` for panellist A
    // itself, so it is a superset of the single-judge step and needs nothing
    // the `judge` stage would have produced first.
    if (this.judgePanel) this.enqueueGate(row, 'judge-panel', candidateId);
    // A dependency-free weekly root: it needs only the candidate's id and
    // description, both of which exist the moment the candidate does.
    if (this.triggerEval) this.enqueueGate(row, 'trigger-eval', candidateId);
  }

  private enqueueGate(
    row: SkillQueueRow,
    stage: SkillQueueStage,
    candidateId: CandidateId,
  ): void {
    if (!this.queue) return;
    try {
      const result = this.queue.enqueue({
        sessionId: row.sessionId,
        stage,
        source: row.source,
        workspaceRoot: row.workspaceRoot,
        transcriptPath: row.transcriptPath,
        // Never `0`: `REOPEN_SQL` is gated on `turn_count < ?`, so a zero here
        // compiles, satisfies any call-counting test, and wedges the row
        // permanently.
        turnCount: row.turnCount,
        // ONE call, and that is the point. `enqueue` writes this payload on the
        // INSERT path and MERGES it on the re-open path, both inside the same
        // transaction, so the row is never visible to another host carrying the
        // previous pass's candidate id.
        payload: { [SKILL_QUEUE_PAYLOAD_KEYS.candidateId]: candidateId },
      });
      this.logger.debug('[skill-synthesis] gate stage enqueued', {
        sessionId: row.sessionId,
        stage,
        outcome: result.outcome,
        candidateId,
      });
    } catch (error: unknown) {
      // The prefilter row itself succeeded and must still land `done`. A
      // failure to chain costs a measurement, not a candidate.
      this.logger.warn(
        '[skill-synthesis] could not enqueue a gate stage (non-fatal)',
        {
          sessionId: row.sessionId,
          stage,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * The candidate a gate row was dispatched to grade, or `null`.
   *
   * A row whose payload names no candidate, or names one that has since been
   * deleted, is not a failure and not a retry — there is nothing to measure and
   * nothing that will make one appear.
   */
  private gateTarget(row: SkillQueueRow): SkillCandidateRow | null {
    const id = row.payload[SKILL_QUEUE_PAYLOAD_KEYS.candidateId];
    if (typeof id !== 'string' || id.length === 0) return null;
    return this.store.findById(id as CandidateId);
  }

  /**
   * The `judge-panel` stage — a second opinion on an already-drafted candidate.
   *
   * ## The mapping, and the one place it cannot follow the house rule
   *
   *  - `verdict.status === 'scored'` → `done`. The panel decided; the reason is
   *    the panel's own stable token (`judge-panel-agreed` / `-escalated`).
   *  - `verdict.status === 'disabled'` → `skipped`. No judge lane in this host.
   *    It ran, there is nothing to do, and it is not a retry — the same answer
   *    the judge itself gives, and the reason a host with no LLM must not carry
   *    a backoff for a stage it can never run.
   *  - `verdict.status === 'unscored'` → `unscored`. "We ran and we do not
   *    know", re-eligible under `not_before`. Transient by construction: an
   *    unparseable reply or a lane that stalled may well answer next week.
   *
   * There is NO `lane-failed` branch here, and that is a gap rather than a
   * choice. `JudgePanelService` never surfaces a `SkillLaneFailure`: both
   * `SkillJudgeService.judge` and the escalation collapse one into a
   * `JudgeDecision` carrying only the failure's user-facing REASON STRING. So
   * the transport/capability split the drain owns is not reachable from here,
   * and a timed-out judge lane lands as `unscored` with a 30-minute backoff
   * instead of the lane's own `retryAfterMs`. Fabricating a `SkillLaneFailure`
   * to fill the gap would mean inventing a `kind` and a `retryAfterMs` nobody
   * measured, and the drain would then choose a retry ceiling from a guess.
   * Widening `JudgePanelResult` to carry the failure is the real fix and it
   * belongs in the file that owns the gate.
   */
  private async runJudgePanelStage(
    ctx: SkillStageContext,
    workers: SkillStageWorkers,
  ): Promise<SkillStageResult> {
    const panel = this.judgePanel;
    if (!panel)
      return { outcome: 'skipped', reason: 'no judge panel in this host' };
    const candidate = this.gateTarget(ctx.row);
    if (!candidate) {
      return { outcome: 'skipped', reason: 'judge-panel-no-candidate' };
    }

    const settings = workers.readSettings();
    const result = await this.withClaimHeartbeat(ctx, (signal) =>
      panel.evaluate({
        candidate,
        body: this.candidateBody(candidate),
        settings,
        signal,
        attempt: ctx.row.attemptCount,
      }),
    );

    switch (result.verdict.status) {
      case 'scored':
        return {
          outcome: 'done',
          reason: result.reason,
          candidateId: candidate.id as unknown as string,
        };
      case 'disabled':
        return { outcome: 'skipped', reason: result.reason };
      default:
        return { outcome: 'unscored', reason: result.reason };
    }
  }

  /**
   * The `replay` stage — the empirical hold-out gate.
   *
   * ## It has no producer in this library, on purpose
   *
   * Nothing enqueues a `replay` row today; see `enqueueCandidateGates`. The
   * handler is registered anyway so that the stage is live the moment a producer
   * lands, and so a row enqueued by hand (or by a later batch) is measured
   * rather than marked "no handler for stage replay".
   *
   * ## `verdictFallback` is written on EVERY path
   *
   * `replay-validator.service.ts` documents that the drain writes this to
   * `payload.verdictFallback` so the Activity tab can say the gate ran on weaker
   * evidence. It is written before the outcome is mapped — including on a lane
   * failure — for two reasons: the flag is a fact about the EVIDENCE, which the
   * gate knew before the lane was ever called; and `REOPEN_SQL` deliberately
   * preserves `payload`, so a path that skipped the write would leave a finished
   * row showing a PREVIOUS pass's flag. Writing unconditionally is what makes
   * "each writer refreshes its own keys" true rather than aspirational.
   *
   * ## The reason split
   *
   *  - lane failure → handed over VERBATIM. Only the drain reads `maxAttempts`,
   *    so only the drain may choose between a backoff requeue and the terminal
   *    mark.
   *  - `disabled` → `skipped`. The gate switch is off, or there is no replay
   *    lane in this host.
   *  - `replay-no-holdout` → `skipped`, NOT `unscored`. This is the one
   *    unmeasured reason that is a PERMANENT FACT about the cluster: every
   *    session in it fed the draft, so there is nothing to hold out and no
   *    amount of waiting changes that. An `unscored` row would come back every
   *    week forever to re-derive the same `null`.
   *  - every other unmeasured reason → `unscored`. A hold-out with no readable
   *    evidence may acquire a verdict on the next nightly archaeology pass; an
   *    empty plan or an unparseable comparison is a bad sample, not a fact.
   */
  private async runReplayStage(
    ctx: SkillStageContext,
  ): Promise<SkillStageResult> {
    const validator = this.replayValidator;
    if (!validator) {
      return { outcome: 'skipped', reason: 'no replay validator in this host' };
    }
    const { row } = ctx;
    const candidate = this.gateTarget(row);
    if (!candidate) {
      return { outcome: 'skipped', reason: 'replay-no-candidate' };
    }

    const result = await this.withClaimHeartbeat(ctx, (signal) =>
      validator.validate({
        candidate,
        body: this.candidateBody(candidate),
        clusterSessionIds: this.gateClusterSessionIds(row, candidate),
        workspaceRoot: row.workspaceRoot,
        signal,
        attempt: row.attemptCount,
      }),
    );

    this.recordVerdictFallback(row, result.verdictFallback);

    if (result.failure !== null) {
      return { outcome: 'lane-failed', failure: result.failure };
    }
    if (result.status === 'measured') {
      return {
        outcome: 'done',
        reason: result.reason,
        candidateId: candidate.id as unknown as string,
      };
    }
    if (
      result.status === 'disabled' ||
      result.reason === REPLAY_REASONS.noHoldout
    ) {
      return { outcome: 'skipped', reason: result.reason };
    }
    return { outcome: 'unscored', reason: result.reason };
  }

  /**
   * The cluster a replay hold-out is drawn from.
   *
   * The producer is expected to carry the cluster on the row, because only the
   * clustering pass knows it. Falling back to the candidate's OWN source
   * sessions is deliberate and is not a stand-in for the real thing: the gate
   * subtracts `sourceSessionIds` from this list, so a candidate with no cluster
   * on its row yields an empty difference and an honest `replay-no-holdout`.
   * Inventing a cluster here would make the gate measure recall and report it as
   * transfer.
   */
  private gateClusterSessionIds(
    row: SkillQueueRow,
    candidate: SkillCandidateRow,
  ): string[] {
    const raw = row.payload[SKILL_QUEUE_PAYLOAD_KEYS.clusterSessionIds];
    if (Array.isArray(raw)) {
      return raw.filter((id): id is string => typeof id === 'string');
    }
    return [...candidate.sourceSessionIds];
  }

  /** Write the replay gate's evidence flag onto the row. Never fatal. */
  private recordVerdictFallback(row: SkillQueueRow, fallback: boolean): void {
    if (!this.queue) return;
    try {
      this.queue.mergePayload(row.id, {
        [SKILL_QUEUE_PAYLOAD_KEYS.verdictFallback]: fallback,
      });
    } catch (error: unknown) {
      // The measurement itself already landed on the candidate. Losing the
      // Activity annotation must not turn a good run into a retry.
      this.logger.warn(
        '[skill-synthesis] could not record the replay evidence flag (non-fatal)',
        {
          id: row.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  /**
   * The `trigger-eval` stage — the measured description-retrieval gate.
   *
   * Cheap, not free: exactly one lane call generates the prompt set and
   * everything after it is local embedder arithmetic. That one call is why the
   * drain DOES book this stage against the token budget
   * (`TOKEN_SPENDING_STAGES`), which it did not until TASK_2026_253.
   *
   * ## The mapping
   *
   * The split is PERMANENT versus RETRYABLE, and it is read off
   * `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` rather than re-derived here, so the
   * gate that knows why it stopped is the thing that classifies it.
   *
   *  - `disabled` / `no-embedder` / `no-description` / `no-prompt-lane` →
   *    `skipped`. Three are host capabilities and one is a property of the
   *    candidate; no amount of waiting changes any of them, and an `unscored`
   *    row would come back every week to re-derive the same answer.
   *  - `prompt-lane-failed` / `unusable-prompt-reply` → `unscored`, re-eligible
   *    under `not_before`. The host CAN run this gate; it just did not this
   *    time, and `skipped` would permanently drop a measurable candidate over a
   *    transient outage.
   *
   *    These four tokens were one (`prompt-generation-unavailable`) until
   *    TASK_2026_253, and with one token there was no correct mapping — only a
   *    choice of which half to be wrong about. It picked `unscored` for all of
   *    them because that failure mode is bounded (one skipped `listEligible`
   *    match a week, zero tokens) while the other is not. Both halves are now
   *    right. Still unavailable from here: `lane-failed`, which would need the
   *    gate to hand over the `SkillLaneFailure` itself rather than a reason
   *    token — a lane failure therefore still lands on the default `unscored`
   *    backoff instead of the lane's own `retryAfterMs`.
   *  - `evaluated` with an `unmeasuredReason` → `unscored`. The retrieval ran
   *    and all three numbers came back `null`; all three causes (a one-sided
   *    prompt set, an embedder that returned the wrong vector count) are bad
   *    samples that a re-run can fix.
   *  - `evaluated` with no `unmeasuredReason` → `done`. A number was measured
   *    and persisted.
   */
  private async runTriggerEvalStage(
    ctx: SkillStageContext,
    workers: SkillStageWorkers,
  ): Promise<SkillStageResult> {
    const gate = this.triggerEval;
    if (!gate) {
      return { outcome: 'skipped', reason: 'no trigger eval in this host' };
    }
    const candidate = this.gateTarget(ctx.row);
    if (!candidate) {
      return { outcome: 'skipped', reason: 'trigger-eval-no-candidate' };
    }

    const settings = workers.readSettings();
    const outcome = await this.withClaimHeartbeat(ctx, (signal) =>
      gate.evaluate(candidate, settings, signal),
    );

    if (outcome.status === 'skipped') {
      return RETRYABLE_TRIGGER_EVAL_SKIP_REASONS.has(outcome.reason)
        ? { outcome: 'unscored', reason: outcome.reason }
        : { outcome: 'skipped', reason: outcome.reason };
    }
    const { unmeasuredReason } = outcome.report;
    if (unmeasuredReason !== null) {
      return { outcome: 'unscored', reason: unmeasuredReason };
    }
    return {
      outcome: 'done',
      reason: TRIGGER_EVAL_MEASURED_REASON,
      candidateId: candidate.id as unknown as string,
    };
  }

  /**
   * The drafted skill body a gate is shown, with its frontmatter stripped.
   *
   * Falls back to a minimal document built from the row when the file is gone:
   * a gate handed an empty body would score the ABSENCE of a document, and a
   * zero that means "the file was missing" is indistinguishable downstream from
   * one that means "this skill is bad".
   */
  private candidateBody(candidate: SkillCandidateRow): string {
    return (
      readCandidateBodyFile(candidate, this.logger) ??
      `# ${candidate.name}\n\n${candidate.description}\n`
    );
  }

  /**
   * The `archaeology` stage — the ONE background path into the analyzer.
   *
   * It is a NIGHTLY-tier stage (R3): `DRAIN_TIER_STAGES` already places it there
   * and `TOKEN_SPENDING_STAGES` already books it against the budget, so a
   * `frequent` tick never claims one.
   *
   * ## The failure is HANDED OVER, not flattened
   *
   * A lane failure comes back as `{outcome: 'lane-failed', failure}` verbatim.
   * Deciding here between a backoff requeue and a terminal mark would be
   * deciding the attempt ceiling in the one place that cannot read
   * `maxAttempts` — the drain reads it, the drain owns the row, and that
   * single-owner seam is pinned mechanically. A `failed` result may still carry
   * a verdict persisted from an earlier good pass; that is the analyzer's own
   * "do not throw away tokens we already spent" behaviour and it changes nothing
   * about the row transition.
   *
   * A DEGRADED verdict is `done`, not a failure. "Analyzed, no verdict, here is
   * why" is a written row, and a written row is what stops the drain paying for
   * the same session every night.
   */
  private async runArchaeologyStage(
    ctx: SkillStageContext,
  ): Promise<SkillStageResult> {
    if (!this.archaeologist) {
      return { outcome: 'skipped', reason: 'no analyzer in this host' };
    }
    const { row } = ctx;
    const result = await this.archaeologist.analyze({
      sessionId: row.sessionId,
      workspaceRoot: row.workspaceRoot,
      transcriptPath: row.transcriptPath ?? undefined,
      // The analyzer heartbeats BETWEEN passes itself, so it takes the drain's
      // own `touch` rather than being wrapped in `withClaimHeartbeat` — two
      // heartbeat owners on one claim is two things that can decide to stop.
      touch: () => ctx.touch(),
      signal: ctx.signal,
      attempt: row.attemptCount,
    });

    switch (result.status) {
      case 'ok':
        return {
          outcome: 'done',
          reason: result.verdict.degradedReason
            ? `analyzed, degraded: ${result.verdict.degradedReason}`
            : undefined,
        };
      case 'failed':
        return { outcome: 'lane-failed', failure: result.failure };
      case 'lost-claim':
        // The analyzer stopped writing the moment the heartbeat said the row
        // was reclaimed. `skipped` is the same answer the `prefilter` handler
        // gives on claim loss (`withClaimHeartbeat` aborts and `analyzeSession`
        // returns null), so the two stages behave identically here. There is no
        // "report nothing" outcome, and inventing one would need the drain to
        // stop marking rows it dispatched — a change to the single-owner seam,
        // not to this handler.
        return { outcome: 'skipped', reason: 'claim lost mid-analysis' };
    }
  }

  /**
   * The `embedding` stage. Runs the backfill that used to be a 5-second
   * `setTimeout` racing host activation; the row is enqueued once per calendar
   * day by `SkillSynthesisService.start()`.
   */
  private async runEmbeddingStage(
    ctx: SkillStageContext,
    workers: SkillStageWorkers,
  ): Promise<SkillStageResult> {
    const count = await this.withClaimHeartbeat(ctx, () =>
      workers.backfillEmbeddings(),
    );
    return {
      outcome: 'done',
      reason: `backfilled ${count} candidate embedding(s)`,
    };
  }

  /**
   * Run `work` while heartbeating the queue claim, and give it a signal that
   * aborts when the claim is lost.
   *
   * `ctx.touch()` returns `false` once this worker no longer owns the row
   * (reaped after the stale-claim TTL, or finished elsewhere). B0.3's contract
   * is that such a worker MUST stop, so the derived signal is aborted and the
   * interval torn down; the worker is not left writing on someone else's row
   * for the rest of its run.
   */
  private async withClaimHeartbeat<T>(
    ctx: SkillStageContext,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    if (ctx.signal.aborted) controller.abort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    const beat = setInterval(() => {
      if (ctx.touch()) return;
      this.logger.warn('[skill-synthesis] queue claim lost mid-stage', {
        id: ctx.row.id,
        stage: ctx.row.stage,
      });
      controller.abort();
    }, CLAIM_HEARTBEAT_MS);
    // Never hold the event loop open for a heartbeat.
    beat.unref?.();

    try {
      return await work(controller.signal);
    } finally {
      clearInterval(beat);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  }
}
