/**
 * SkillSynthesisService — top-level orchestrator.
 *
 * Lifecycle:
 *   - `start()` is invoked by Electron `wire-runtime.ts`. It
 *     ensures the underlying SQLite connection is open and migrations are
 *     applied. It subscribes to the session-end registry so that every
 *     completed session is ENQUEUED for later synthesis.
 *   - `stop()` unsubscribes from the session-end registry and resets state.
 *
 * ## Every trigger enqueues; nothing analyzes inline
 *
 * Phase 0 of TASK_2026_180 removed the inline pipeline that used to run off
 * the session-end callback (B0.6) and off every other trigger (B0.9). A
 * trigger now costs ZERO LLM tokens: it writes one `prefilter` row into
 * `skill_synthesis_queue` through `enqueueAnalyze` and returns.
 * `SkillDrainService`, driven by the three cron tiers registered in
 * `thoth-runtime`, is the only thing allowed to spend from that point on.
 * There is deliberately no feature flag for this — the queue REPLACES the
 * inline path rather than running beside it.
 *
 * ## …and this service is what makes the queue drain
 *
 * `registerStageHandler` is the drain's wiring seam. B0.9 wired the two Phase-0
 * stages — `prefilter` dispatches to `analyzeSession`, `embedding` to
 * `backfillEmbeddings` — and Phase 2 adds `archaeology`, which dispatches to
 * `SessionArchaeologistService.analyze`. Without that registration an enqueued
 * row is marked `skipped` ("no handler for stage …") and the queue is one
 * nobody reads. The Phase-0 workers stay PUBLIC for exactly this reason.
 *
 * `analyzeSession` therefore has ONE background caller — the `prefilter` stage
 * handler below. The only other caller in the codebase is the explicit,
 * user-initiated `skillSynthesis:analyzeNow` RPC. A new inline caller is a
 * dual path and must not be added. The analyzer has the same shape: the
 * `archaeology` stage handler is its one background caller, and a session
 * reaches that stage only through the chain `prefilter → archaeology`, written
 * from the successful end of the prefilter handler so the cheap gate still
 * decides whether the expensive stage runs at all.
 *
 * Settings are read on demand from the platform `IWorkspaceProvider`
 * (file-based settings) so changes apply without restart.
 */
import { inject, injectable } from 'tsyringe';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TOKENS,
  WebviewManager,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  VecStatusService,
  type IEmbedder,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillMdGenerator } from './skill-md-generator';
import { SkillPromotionService } from './skill-promotion.service';
import { SkillCuratorService } from './skill-curator.service';
import {
  MIN_ROLE_TURNS_FLOOR,
  TrajectoryExtractor,
  type ExtractedTrajectory,
} from './trajectory-extractor';
import { SkillSynthesizerService } from './skill-synthesizer.service';
import type { SessionArchaeologistService } from './archaeology/session-archaeologist.service';
import type { SessionVerdictStore } from './archaeology/session-verdict.store';
import type { SessionVerdict } from './archaeology/session-verdict.types';
import { SkillRegistryStore } from './skill-registry.store';
import { migrateSkillMdFiles } from './skill-md-migration';
import type { SkillQueueStore } from './queue/skill-queue.store';
import type { EnqueueOutcome, SkillQueueRow } from './queue/skill-queue.types';
import type {
  SkillDrainService,
  SkillStageContext,
  SkillStageResult,
} from './queue/skill-drain.service';
import type {
  CandidateId,
  RegisterCandidateResult,
  SkillSynthesisSettings,
} from './types';
import type {
  EligibilityHistogram,
  SkillSynthesisEvent,
} from './diagnostics.types';
import {
  MESSAGE_TYPES,
  type SkillSynthesisPromoteBulkDecision,
  type SkillSynthesisEventWire,
} from '@ptah-extension/shared';

/**
 * Cross-library token for the session-end callback registry.
 * Uses Symbol.for() directly instead of importing from
 * @ptah-extension/agent-sdk to avoid circular dependency.
 */
const SESSION_END_CALLBACK_REGISTRY = Symbol.for(
  'SdkSessionEndCallbackRegistry',
);

export type AnalyzeSource =
  | 'idle'
  | 'boot'
  | 'subagent-stop'
  | 'edit-then-test'
  | 'turn-complete'
  | 'session-end';

/** Everything `enqueueAnalyze` needs beyond the session identity. */
export interface EnqueueAnalyzeOptions {
  /** Which trigger fired. Travels onto the row and back out at drain time. */
  source: AnalyzeSource;
  /** Subagent transcripts do not live at the default path; carry it. */
  transcriptPath?: string;
  /** Boot scan's per-item signal. Enqueue is cheap, but it is not free. */
  signal?: AbortSignal;
}

const SETTINGS_DEFAULTS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 200,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
  judgeEnabled: true,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
  suggestionMinClusterSize: 2,
  suggestionMaxCandidates: 200,
};

/**
 * Sentinel `session_id` prefix for the embedding-backfill queue row.
 *
 * The backfill is not session-scoped, but `skill_synthesis_queue` is keyed
 * `UNIQUE(session_id, stage)`, so it needs a synthetic id. The calendar day is
 * appended for two reasons: `UNIQUE` then dedups the row across every window
 * that boots on the same day (the in-process `setTimeout` this replaces ran
 * once per window), and a fresh day yields a fresh INSERT rather than relying
 * on the `turn_count` re-open guard, which has no honest value to compare here.
 */
const EMBEDDING_BACKFILL_SESSION_PREFIX = 'backfill-embeddings:';

/**
 * How often a running stage handler heartbeats its queue claim.
 *
 * `reapStale` returns any claim older than `staleClaimTtlMs` (default 15 min)
 * to `queued`, so a stage that legitimately runs longer than that would be
 * re-claimed and re-run at full cost while it is still working. One minute is
 * comfortably under the smallest TTL `assertStaleClaimTtl` will accept
 * (`3 × 30 s`) and costs one UPDATE per minute per in-flight row.
 */
const CLAIM_HEARTBEAT_MS = 60_000;

@injectable()
export class SkillSynthesisService {
  private static readonly RING_CAPACITY = 200;
  private started = false;
  /**
   * Highest trajectory turn count handed to the pipeline per session IN THIS
   * PROCESS. A session is re-analyzed only once it has grown beyond that count,
   * so a turn-complete trigger that fired while the session was still
   * ineligible (<5 turns) can succeed later.
   *
   * SAME-PROCESS FAST PATH ONLY (TASK_2026_180 phase 0). It is a cache that
   * saves a redundant SQLite round trip, not the correctness boundary — it is
   * cleared by `stop()` and invisible to a second window. Correctness now lives
   * in `skill_synthesis_queue`: `UNIQUE(session_id, stage)` plus the re-open
   * guarded on `turn_count <`, which expresses the same "only once it grew"
   * rule durably and across windows. It is a `Map<sessionId, turn count>` and
   * NOT a seen-set for exactly that reason; do not flatten it into one.
   */
  private readonly analyzedSessions = new Map<string, number>();
  /** Disposer returned by the session-end registry — called in stop(). */
  private _sessionEndDisposer?: () => void;
  private readonly events: SkillSynthesisEvent[] = [];
  private eligibilityCounters: {
    prefilterTooThin: number;
    prefilterRejected: number;
    accepted: number;
  } = {
    prefilterTooThin: 0,
    prefilterRejected: 0,
    accepted: 0,
  };
  private countersDate: string = SkillSynthesisService.todayKey();
  private lastAnalyzeRunAtMs: number | null = null;
  private lastCuratorPassAtMs: number | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly store: SkillCandidateStore,
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_PROMOTION_SERVICE)
    private readonly promotion: SkillPromotionService,
    @inject(TrajectoryExtractor)
    private readonly extractor: TrajectoryExtractor,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE, { isOptional: true })
    private readonly curator: SkillCuratorService | null,
    @inject(SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEndRegistry: {
      register: (
        cb: (data: { sessionId: string; workspaceRoot: string }) => void,
      ) => () => void;
    },
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIZER_SERVICE, {
      isOptional: true,
    })
    private readonly synthesizer: SkillSynthesizerService | null = null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null = null,
    @inject(PERSISTENCE_TOKENS.EMBEDDER, { isOptional: true })
    private readonly embedder: IEmbedder | null = null,
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager: WebviewManager | null = null,
    /**
     * The durable synthesis queue. Optional so a host without persistence (or
     * a spec that constructs the service by hand) still resolves; when it is
     * absent, session end logs and does nothing rather than falling back to the
     * inline pipeline — a silent dual path is exactly what phase 0 removes.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, { isOptional: true })
    private readonly queue: SkillQueueStore | null = null,
    /**
     * The drain this service registers its stage handlers on. Injected by
     * TOKEN and typed with `import type`, so this file never takes a runtime
     * dependency on `queue/skill-drain.service` — that module's own type graph
     * points back here (`SkillQueueSource = AnalyzeSource`).
     *
     * Optional for the same reason the queue is: a host without persistence,
     * or a spec that constructs the service by hand, still resolves. When it
     * is absent nothing drains in this host, which is exactly what a host with
     * no queue should do — it is never a reason to analyze inline.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE, { isOptional: true })
    private readonly drain: SkillDrainService | null = null,
    /**
     * The phase-2 analyzer. Optional and injected BY TOKEN for the same reason
     * the drain is: a CLI or e2e host that registers no analysis lane still
     * resolves this service, and when it is absent the `archaeology` stage is
     * simply not registered — the drain then marks such a row `skipped` with
     * "no handler for stage archaeology", which is the honest answer for a host
     * that cannot run it. There is no inline fallback; a missing analyzer means
     * synthesis uses the trajectory prompt, exactly as it did before phase 2.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_ARCHAEOLOGIST_SERVICE, {
      isOptional: true,
    })
    private readonly archaeologist: SessionArchaeologistService | null = null,
    /**
     * Read-only here. `analyzeSession` looks the verdict up to hand it to the
     * synthesizer; the archaeologist owns every write.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE, { isOptional: true })
    private readonly verdicts: SessionVerdictStore | null = null,
  ) {}

  /**
   * Idempotent. Ensures DB is open + migrated. Caller wraps in
   * try/catch so a failure here NEVER blocks app activation.
   */
  async start(): Promise<void> {
    // ABOVE both early returns, deliberately. Registration is two Map writes:
    // it opens no database, reads no transcript and spends nothing, so the
    // "paused means touches nothing" rule the drain's gate 1 enforces is not
    // weakened by doing it here. Doing it BELOW the `enabled` check would mean
    // a host that booted while `skillSynthesis.enabled` was false has no
    // handlers, and the moment the tray re-enables background learning every
    // drained row would be marked `skipped` for want of one. Idempotent, so
    // the `started` re-entry guard below does not need to cover it.
    this.registerStageHandlers();
    if (this.started) return;
    if (!this.readSettings().enabled) {
      this.logger.info(
        '[skill-synthesis] disabled via settings; skipping start',
      );
      return;
    }
    if (!this.connection.isOpen) {
      await this.connection.openAndMigrate();
    }
    try {
      const settingsForMigration = this.readSettings();
      const activeRoot = this.mdGenerator.activeRoot();
      const candidatesRoot = this.mdGenerator.candidatesRoot(
        settingsForMigration.candidatesDir,
      );
      try {
        fs.mkdirSync(activeRoot, { recursive: true });
        fs.mkdirSync(candidatesRoot, { recursive: true });
      } catch (err: unknown) {
        this.logger.warn(
          '[skill-synthesis] failed to bootstrap skill directories (non-fatal)',
          {
            activeRoot,
            candidatesRoot,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
      const activeResult = migrateSkillMdFiles(activeRoot, this.logger);
      this.logger.info(
        '[skill-synthesis] SKILL.md migration complete (active root)',
        {
          ...activeResult,
        },
      );
      const candidatesResult = migrateSkillMdFiles(candidatesRoot, this.logger);
      this.logger.info(
        '[skill-synthesis] SKILL.md migration complete (candidates root)',
        {
          ...candidatesResult,
        },
      );
    } catch (err: unknown) {
      this.logger.warn(
        '[skill-synthesis] SKILL.md migration failed (non-fatal)',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    this.started = true;
    this._sessionEndDisposer = this.sessionEndRegistry.register(
      (data: { sessionId: string; workspaceRoot: string }) => {
        void this.enqueueAnalyze(data.sessionId, data.workspaceRoot, {
          source: 'session-end',
        }).catch((err: unknown) => {
          this.logger.warn('[skill-synthesis] session-end enqueue error', {
            sessionId: data.sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
    );
    const settings = this.readSettings();
    try {
      this.curator?.start(settings, {
        onPassComplete: (timestamp) => this.recordCuratorPass(timestamp),
        onEvent: (ev) => this.pushEvent(ev as SkillSynthesisEvent),
      });
    } catch (err: unknown) {
      this.logger.warn('[skill-synthesis] curator start failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Backfill of embeddings onto pre-existing candidates, so the clustering /
    // suggestion pass has vectors to work with. It used to be a
    // `setTimeout(…, 5000)` fire-and-forget that raced host activation and was
    // lost outright if the window closed inside the delay. It is now an
    // `embedding`-stage queue row: the drain runs it on its own schedule, under
    // the same gates (enabled / budget / battery / foreground) as every other
    // background stage, and it survives a restart.
    this.enqueueEmbeddingBackfill();

    this.logger.info('[skill-synthesis] started', {
      vecExtensionLoaded: this.vecStatus.available,
    });
  }

  /** Unsubscribes from the session-end registry and resets state. */
  stop(): void {
    this._sessionEndDisposer?.();
    this._sessionEndDisposer = undefined;
    this.curator?.stop();
    this.started = false;
    this.analyzedSessions.clear();
  }

  /**
   * THE way a trigger reaches synthesis. It ENQUEUES; it never analyzes.
   *
   * Every trigger funnels here — session end (B0.6), and from B0.9 the idle,
   * subagent-stop, edit-then-test, turn-complete and boot-scan triggers in
   * `SkillTriggerService`. One entry point rather than six copies of the
   * turn-count dance is the whole point: the trap below has to be got right
   * exactly once.
   *
   * The one acceptance criterion is that this method spends nothing: it makes
   * no LLM call, directly or transitively. It reads the transcript once —
   * local file I/O the trigger path already performs on every turn — purely to
   * learn how far the session got, then writes a single `prefilter` row.
   *
   * `turnCount` is the load-bearing argument, not decoration.
   * `SkillQueueStore.enqueue` is a plain INSERT whose `UNIQUE(session_id,
   * stage)` violation becomes a re-open guarded on `turn_count <`. Passing the
   * freshly observed count is therefore what preserves "re-analyze a session
   * only once it has grown" — the exact rule `analyzedSessions` enforced in
   * memory, now durable and shared across windows. Passing `0` would compile,
   * pass a naive test, and permanently wedge every finished row.
   *
   * A null trajectory means there is no readable transcript or fewer than two
   * role turns. That is not queue-able work, so it is counted and dropped here
   * exactly as the inline path counted and dropped it.
   *
   * Returns the enqueue outcome, or `null` when nothing was queued.
   */
  async enqueueAnalyze(
    sessionId: string,
    workspaceRoot: string,
    opts: EnqueueAnalyzeOptions,
  ): Promise<EnqueueOutcome | null> {
    if (opts.signal?.aborted) return null;
    if (!this.started) return null;
    const settings = this.readSettings();
    if (!settings.enabled) return null;
    if (sessionId === 'manual') {
      this.logger.warn(
        '[skill-synthesis] enqueueAnalyze called with reserved sessionId "manual" — rejecting',
        { source: opts.source },
      );
      return null;
    }
    if (!this.queue) {
      this.logger.warn(
        '[skill-synthesis] no queue store registered; enqueue skipped',
        { sessionId, source: opts.source },
      );
      return null;
    }

    // The extractor's own FLOOR, not the eligibility threshold. Enqueuing is
    // free and a short session may grow, so this path asks only "is there a
    // readable session here"; `settings.eligibilityMinTurns` is spent in
    // `passesPrefilter`, where the decision to spend tokens is actually made.
    const trajectory = await this.extractor.extract(
      sessionId,
      workspaceRoot,
      MIN_ROLE_TURNS_FLOOR,
      opts.transcriptPath,
    );
    if (!trajectory) {
      this.logger.info(
        '[skill-synthesis] session ineligible (trajectory null — fewer than 2 role turns)',
        { sessionId, source: opts.source },
      );
      this.incrementEligibility('prefilterTooThin');
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: 'prefilterTooThin',
      });
      return null;
    }

    // Same-process fast path: this window already queued the session at this
    // turn count or higher, so the guarded re-open would return `unchanged`.
    // Skipping the round trip is the ONLY thing this Map is still for.
    const lastTurnCount = this.analyzedSessions.get(sessionId);
    if (lastTurnCount !== undefined && trajectory.turnCount <= lastTurnCount) {
      return null;
    }

    const result = this.queue.enqueue({
      sessionId,
      stage: 'prefilter',
      source: opts.source,
      workspaceRoot,
      transcriptPath: opts.transcriptPath ?? null,
      turnCount: trajectory.turnCount,
    });
    this.analyzedSessions.set(sessionId, trajectory.turnCount);
    this.logger.info('[skill-synthesis] session enqueued for synthesis', {
      sessionId,
      stage: 'prefilter',
      source: opts.source,
      outcome: result.outcome,
      turnCount: trajectory.turnCount,
    });
    return result.outcome;
  }

  /**
   * Queue the embedding backfill instead of running it on a timer. Failures
   * are non-fatal by construction: a backfill that never queues degrades the
   * suggestion pass, it must never break activation.
   */
  private enqueueEmbeddingBackfill(): void {
    if (!this.queue) return;
    try {
      const result = this.queue.enqueue({
        sessionId: `${EMBEDDING_BACKFILL_SESSION_PREFIX}${SkillSynthesisService.todayKey()}`,
        stage: 'embedding',
        source: 'boot',
        // Cross-project work, like clustering: it has no owning workspace, and
        // `''` is the round-robin key the drain reserves for exactly that.
        workspaceRoot: '',
      });
      this.logger.info('[skill-synthesis] embedding backfill enqueued', {
        outcome: result.outcome,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[skill-synthesis] embedding backfill enqueue failed (non-fatal)',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

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
   * two always have a worker — they are this service's own methods — whereas the
   * analyzer is an injected collaborator a CLI/e2e host legitimately does not
   * have. Registering a handler that could only ever answer "I am not here"
   * would spend a claim and an attempt to say what "no handler for stage
   * archaeology" already says for free.
   */
  private registerStageHandlers(): void {
    if (!this.drain) return;
    this.drain.registerStageHandler('prefilter', (ctx) =>
      this.runPrefilterStage(ctx),
    );
    this.drain.registerStageHandler('embedding', (ctx) =>
      this.runEmbeddingStage(ctx),
    );
    if (this.archaeologist) {
      this.drain.registerStageHandler('archaeology', (ctx) =>
        this.runArchaeologyStage(ctx),
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
  ): Promise<SkillStageResult> {
    const { row } = ctx;
    const result = await this.withClaimHeartbeat(ctx, (signal) =>
      this.analyzeSession(row.sessionId, row.workspaceRoot, {
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
   * day by `start()`.
   */
  private async runEmbeddingStage(
    ctx: SkillStageContext,
  ): Promise<SkillStageResult> {
    const count = await this.withClaimHeartbeat(ctx, () =>
      this.backfillEmbeddings(),
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

  /**
   * Analyze a finished session. If eligibility rules pass and the trajectory
   * is novel, registers a new candidate (writes a candidate SKILL.md).
   *
   * Returns `null` when the session is ineligible, has already been analyzed
   * by this process, or when the synthesis flag is disabled.
   */
  async analyzeSession(
    sessionId: string,
    workspaceRoot: string,
    embeddingProviderOrOptions?:
      | IEmbedder
      | null
      | {
          force?: boolean;
          embeddingProvider?: IEmbedder | null;
          signal?: AbortSignal;
          transcriptPath?: string;
          source?: AnalyzeSource;
        },
    maybeOptions?: {
      force?: boolean;
      signal?: AbortSignal;
      transcriptPath?: string;
      source?: AnalyzeSource;
    },
  ): Promise<RegisterCandidateResult | null> {
    let embeddingProvider: IEmbedder | null | undefined;
    let force = false;
    let signal: AbortSignal | undefined;
    let transcriptPath: string | undefined;
    let source: AnalyzeSource | undefined;
    if (
      embeddingProviderOrOptions &&
      typeof embeddingProviderOrOptions === 'object' &&
      !('embed' in embeddingProviderOrOptions)
    ) {
      embeddingProvider = embeddingProviderOrOptions.embeddingProvider;
      force = embeddingProviderOrOptions.force === true;
      signal = embeddingProviderOrOptions.signal;
      transcriptPath = embeddingProviderOrOptions.transcriptPath;
      source = embeddingProviderOrOptions.source;
    } else {
      embeddingProvider = embeddingProviderOrOptions as
        | IEmbedder
        | null
        | undefined;
      force = maybeOptions?.force === true;
      signal = maybeOptions?.signal;
      transcriptPath = maybeOptions?.transcriptPath;
      source = maybeOptions?.source;
    }

    // Default to the injected embedder when the caller did not specify one.
    // Only fill an `undefined` provider — an explicit `null` is a deliberate
    // opt-out (used by tests) and must be preserved.
    if (embeddingProvider === undefined && this.embedder) {
      embeddingProvider = this.embedder;
    }

    if (signal?.aborted) return null;

    if (!this.started) {
      this.logger.debug('[skill-synthesis] analyzeSession called before start');
      return null;
    }
    const settings = this.readSettings();
    if (!settings.enabled) return null;
    if (sessionId === 'manual') {
      this.logger.warn(
        '[skill-synthesis] analyzeSession called with reserved sessionId "manual" — rejecting',
      );
      return null;
    }
    if (force) {
      this.analyzedSessions.delete(sessionId);
    }

    // Floor, not threshold — see `enqueueAnalyze`. `passesPrefilter` below is
    // the one place `eligibilityMinTurns` is applied.
    const trajectory = await this.extractor.extract(
      sessionId,
      workspaceRoot,
      MIN_ROLE_TURNS_FLOOR,
      transcriptPath,
    );
    if (trajectory) {
      const lastTurnCount = this.analyzedSessions.get(sessionId);
      if (
        lastTurnCount !== undefined &&
        trajectory.turnCount <= lastTurnCount
      ) {
        return null;
      }
      this.analyzedSessions.set(sessionId, trajectory.turnCount);
    }
    if (!trajectory) {
      this.logger.info(
        '[skill-synthesis] session ineligible (trajectory null — fewer than 2 role turns)',
        { sessionId },
      );
      this.incrementEligibility('prefilterTooThin');
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: 'prefilterTooThin',
      });
      return null;
    }

    const prefilter = this.passesPrefilter(trajectory, settings);
    if (!prefilter.ok) {
      this.logger.info('[skill-synthesis] candidate rejected by prefilter', {
        sessionId,
        reason: prefilter.reason,
        editCount: trajectory.editCount,
        toolUseCount: trajectory.toolUseCount,
        charLength: trajectory.charLength,
      });
      const bucket =
        prefilter.reason === 'tooThin'
          ? 'prefilterTooThin'
          : 'prefilterRejected';
      this.incrementEligibility(bucket);
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: bucket,
      });
      return null;
    }
    if (this.isDominatedByAuthoredSkill([sessionId])) {
      this.logger.info(
        '[skill-synthesis] skipping synthesis — session dominated by an authored skill',
        { sessionId },
      );
      return null;
    }

    const existing = this.store.findByTrajectoryHash(trajectory.hash);
    if (existing) {
      return { candidate: existing, reused: true };
    }

    let embedding: Float32Array | null = null;
    if (embeddingProvider) {
      try {
        const [vec] = await embeddingProvider.embed([trajectory.canonicalText]);
        embedding = vec ?? null;
      } catch (err) {
        this.logger.warn(
          '[skill-synthesis] embedding failed (continuing without)',
          {
            sessionId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    let synthesizedBody = this.templateBody(
      trajectory.canonicalText,
      trajectory.shortDescription,
    );
    let candidateName = trajectory.slug;
    let candidateDescription = trajectory.shortDescription;
    if (source === 'boot') {
      this.logger.info(
        '[skill-synthesis] boot-scan source — skipping LLM synthesis (template only)',
        { sessionId },
      );
    } else if (this.synthesizer) {
      const synthesized = await this.synthesizer.synthesize(
        trajectory,
        settings,
        this.readVerdict(sessionId),
      );
      if (synthesized) {
        synthesizedBody = synthesized.body;
        candidateName = synthesized.name || trajectory.slug;
        candidateDescription =
          synthesized.description || trajectory.shortDescription;
      }
    }

    const candidatesRoot = this.mdGenerator.candidatesRoot(
      settings.candidatesDir,
    );
    let bodyPath = path.join(candidatesRoot, candidateName, 'SKILL.md');
    let chosenSlug = candidateName;
    try {
      const md = this.mdGenerator.writeCandidate(
        {
          slug: candidateName,
          description: candidateDescription,
          body: synthesizedBody,
        },
        settings.candidatesDir,
      );
      bodyPath = md.filePath;
      chosenSlug = md.slug;
    } catch (err) {
      this.logger.warn('[skill-synthesis] could not write candidate SKILL.md', {
        sessionId,
        slug: candidateName,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    const contextId = workspaceRoot
      ? crypto
          .createHash('sha256')
          .update(workspaceRoot)
          .digest('hex')
          .slice(0, 16)
      : null;

    const result = this.store.registerCandidate({
      name: chosenSlug,
      description: candidateDescription,
      bodyPath,
      sourceSessionIds: [sessionId],
      trajectoryHash: trajectory.hash,
      embedding,
      createdAt: Date.now(),
    });
    if (!result.reused && contextId) {
      this.store.recordInvocation({
        skillId: result.candidate.id,
        sessionId,
        succeeded: true,
        invokedAt: Date.now(),
        contextId,
      });
    }
    this.logger.info('[skill-synthesis] candidate registered', {
      candidateId: result.candidate.id,
      slug: chosenSlug,
      reused: result.reused,
      sessionId,
    });
    this.incrementEligibility('accepted');
    this.lastAnalyzeRunAtMs = Date.now();
    this.pushEvent({
      kind: 'analyze-run',
      timestamp: this.lastAnalyzeRunAtMs,
      sessionId,
      candidateId: result.candidate.id,
    });
    return result;
  }

  /**
   * Backfill embeddings onto existing candidate rows that were stored without
   * one (the historical auto-analyze path never passed an embedder). This is
   * what unblocks the clustering / "Recommended" suggestion pass. Self-limiting:
   * backfilled rows acquire an `embedding_rowid` and are skipped on the next
   * run. No-ops when there is no embedder or sqlite-vec is unavailable.
   *
   * Returns the number of candidates that received an embedding.
   */
  async backfillEmbeddings(limit = 200): Promise<number> {
    if (!this.embedder || !this.vecStatus.available) return 0;
    const candidates = this.store
      .listByStatus('candidate')
      .filter((c) => c.embeddingRowid === null)
      .slice(0, limit);
    if (candidates.length >= 1) {
      this.pushEvent({
        kind: 'backfill-progress',
        timestamp: Date.now(),
        stats: { done: 0, total: candidates.length },
      });
    }
    let count = 0;
    let processed = 0;
    for (const c of candidates) {
      try {
        let text: string;
        try {
          if (c.bodyPath && fs.existsSync(c.bodyPath)) {
            const raw = fs.readFileSync(c.bodyPath, 'utf8');
            const body = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
            text = `${c.description}\n\n${body}`;
          } else {
            text = `${c.name}\n\n${c.description}`;
          }
        } catch {
          text = `${c.name}\n\n${c.description}`;
        }
        const [vec] = await this.embedder.embed([text]);
        if (vec) {
          this.store.setEmbedding(c.id, vec);
          count++;
        }
      } catch (error: unknown) {
        this.logger.warn(
          '[skill-synthesis] backfill: failed to embed candidate (continuing)',
          {
            candidateId: c.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
      processed++;
      if (processed % 25 === 0) {
        this.pushEvent({
          kind: 'backfill-progress',
          timestamp: Date.now(),
          stats: { done: processed, total: candidates.length },
        });
      }
    }
    this.pushEvent({
      kind: 'backfill-complete',
      timestamp: Date.now(),
      stats: { count },
    });
    return count;
  }

  pushEvent(ev: SkillSynthesisEvent): void {
    this.events.push(ev);
    if (this.events.length > SkillSynthesisService.RING_CAPACITY) {
      this.events.shift();
    }
    // Best-effort live push to the webview. A broadcast failure must NEVER
    // break the synthesis pipeline — CLI/test runtimes have no webview at all.
    if (this.webviewManager) {
      try {
        void this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT,
          { event: this.toEventWire(ev) },
        );
      } catch (error: unknown) {
        this.logger.debug(
          '[skill-synthesis] event broadcast failed (non-fatal)',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
  }

  /**
   * Map an internal event to the wire shape consumed by the webview. The wire
   * type omits candidateId/reason, so those are folded into `stats` when
   * present to keep them visible to the UI.
   */
  private toEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire {
    const stats =
      ev.candidateId || ev.reason
        ? {
            ...(ev.stats ?? {}),
            ...(ev.candidateId ? { candidateId: ev.candidateId } : {}),
            ...(ev.reason ? { reason: ev.reason } : {}),
          }
        : ev.stats;
    return {
      kind: ev.kind,
      timestamp: ev.timestamp,
      sessionId: ev.sessionId,
      stats,
      error: ev.error,
    };
  }

  recentEvents(limit = 10): readonly SkillSynthesisEvent[] {
    const safe = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    return this.events.slice(-safe);
  }

  getEligibilityHistogram(): EligibilityHistogram {
    this.rolloverCountersIfNewDay();
    return { ...this.eligibilityCounters };
  }

  lastRunSummary(): {
    readonly lastAnalyzeRunAt: number | null;
    readonly lastCuratorPassAt: number | null;
  } {
    return {
      lastAnalyzeRunAt: this.lastAnalyzeRunAtMs,
      lastCuratorPassAt: this.lastCuratorPassAtMs,
    };
  }

  recordCuratorPass(timestamp = Date.now()): void {
    // Only update the timestamp. The richer `curator-pass` event (with
    // suggestionsCreated/changesQueued/skippedPinned stats) is emitted by the
    // curator's `onEvent` sink to avoid a duplicate push.
    this.lastCuratorPassAtMs = timestamp;
  }

  private incrementEligibility(
    bucket: 'prefilterTooThin' | 'prefilterRejected' | 'accepted',
  ): void {
    this.rolloverCountersIfNewDay();
    this.eligibilityCounters[bucket]++;
  }

  private rolloverCountersIfNewDay(): void {
    const today = SkillSynthesisService.todayKey();
    if (today !== this.countersDate) {
      this.countersDate = today;
      this.eligibilityCounters = {
        prefilterTooThin: 0,
        prefilterRejected: 0,
        accepted: 0,
      };
    }
  }

  /**
   * Whether the dominant skill across the given sessions is an authored skill.
   * Authored skills are first-class and must never be re-synthesized. No-ops
   * (returns false) when the registry is unavailable (non-Electron runtimes).
   */
  private isDominatedByAuthoredSkill(sessionIds: readonly string[]): boolean {
    if (!this.registry) return false;
    try {
      const dominant = this.store.getDominantSkillSlugForSessions(sessionIds);
      if (!dominant) return false;
      return this.registry.listAuthoredSlugs().has(dominant);
    } catch (err: unknown) {
      this.logger.warn(
        '[skill-synthesis] authored-dominance check failed (continuing)',
        { error: err instanceof Error ? err.message : String(err) },
      );
      return false;
    }
  }

  /**
   * The session's verdict, when this host has a store and a row exists.
   *
   * `null` covers three genuinely different things — no store in this host, the
   * session was never analyzed, and a lookup that threw — and the caller treats
   * all three the same way, because the answer to every one of them is "build
   * the prompt from the trajectory instead". A degraded row is NOT filtered out
   * here: `SkillSynthesizerService` applies the usability predicate itself, so
   * this stays a plain read.
   */
  private readVerdict(sessionId: string): SessionVerdict | null {
    if (!this.verdicts) return null;
    try {
      return this.verdicts.findBySession(sessionId);
    } catch (error: unknown) {
      this.logger.warn('[skill-synthesis] verdict lookup failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * ELIGIBILITY TO SPEND TOKENS. Nothing more (phase 2).
   *
   * This used to double as a quality verdict, and the two AND-ed halves of the
   * tool branch are what made it one: a session was only worth keeping if it had
   * been tool-active AND had produced a lot of text, which selects for work that
   * went WELL. A session that fought its way to an answer — three failed
   * attempts, a correction, then a fix — is the most valuable material the
   * pipeline can get, and the whole point of the archaeologist's `frictionMap`
   * is to capture it. It is also frequently SHORT, because a debugging loop is
   * terse.
   *
   * So the branches are now independent signals of "there is something here",
   * and any one of them is enough:
   *
   *  - `editOk`  — code changed hands.
   *  - `toolOk`  — the assistant DID things. `prefilterMinChars` no longer
   *                conjoins this, which is the widening: retries are tool calls,
   *                and a friction-rich session is tool-dense before it is long.
   *  - `testOk`  — a test command ran. NOT "tests passed" — the extractor cannot
   *                know that, and pretending it does is the same regex-as-verdict
   *                mistake `SUCCESS_MARKERS` was demoted for.
   *  - `depthOk` — a sustained back-and-forth with real content in it. This is
   *                where a corrective session with no edits lands: the user and
   *                the assistant went round `eligibilityMinTurns` times, which is
   *                friction by definition. `prefilterMinChars` conjoins HERE,
   *                where "long conversation" needs to mean more than a dozen
   *                one-word turns.
   *
   * Deliberately still a REJECTION, not a pass-through: the analyzer is the only
   * stage that runs once per session and it dominates the token budget (R3). The
   * regex gate keeps gating spend; it just stops pretending to judge outcomes.
   *
   * No branch below reads the extractor's tail-regex success flag, and none may
   * start. `regex-demotion.spec.ts` proves that with a substring scan over
   * production file text, so the field is not named here either — a scan cannot
   * tell code from a comment about code.
   */
  private passesPrefilter(
    trajectory: ExtractedTrajectory,
    settings: SkillSynthesisSettings,
  ): { ok: boolean; reason?: 'tooThin' | 'noWork' } {
    if (trajectory.turnCount < MIN_ROLE_TURNS_FLOOR) {
      return { ok: false, reason: 'tooThin' };
    }
    const editOk = trajectory.editCount >= settings.prefilterMinEdits;
    const toolOk = trajectory.toolUseCount >= settings.prefilterMinToolUses;
    const testOk = trajectory.bashTestPassed === true;
    const depthOk =
      trajectory.turnCount >= settings.eligibilityMinTurns &&
      trajectory.charLength >= settings.prefilterMinChars;
    if (editOk || toolOk || testOk || depthOk) {
      return { ok: true };
    }
    return { ok: false, reason: 'noWork' };
  }

  private static todayKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Manual promote (RPC `skillSynthesis:promote`). */
  promote(
    candidateId: CandidateId,
  ): ReturnType<SkillPromotionService['evaluate']> {
    return this.promotion.evaluate(candidateId, this.readSettings());
  }

  /** Manual reject (RPC `skillSynthesis:reject`). */
  reject(candidateId: CandidateId, reason?: string) {
    return this.store.updateStatus(candidateId, 'rejected', { reason });
  }

  /**
   * Bulk reject (RPC `skillSynthesis:rejectBulk`). Only acts on rows that are
   * still in `candidate` status — promoted skills are never touched. Illegal
   * transitions and missing rows are skipped. Returns the count rejected.
   */
  rejectBulk(ids: CandidateId[], reason?: string): number {
    let count = 0;
    for (const id of ids) {
      try {
        const row = this.store.findById(id);
        if (!row || row.status !== 'candidate') continue;
        this.store.updateStatus(id, 'rejected', { reason });
        count++;
      } catch (error: unknown) {
        this.logger.warn('[skill-synthesis] rejectBulk: skipping candidate', {
          candidateId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return count;
  }

  /**
   * Bulk promote (RPC `skillSynthesis:promoteBulk`). Runs the promotion
   * evaluation for each id and returns one decision per id (preserving order).
   */
  async promoteBulk(
    ids: CandidateId[],
  ): Promise<SkillSynthesisPromoteBulkDecision[]> {
    const settings = this.readSettings();
    const decisions: SkillSynthesisPromoteBulkDecision[] = [];
    for (const id of ids) {
      const d = await this.promotion.evaluate(id, settings);
      decisions.push({
        id: id as string,
        promoted: d.promoted,
        reason: d.reason ?? null,
        filePath: d.filePath ?? null,
      });
    }
    return decisions;
  }

  /**
   * Reject every candidate whose name matches a pattern (RPC
   * `skillSynthesis:rejectByPattern`). A `*` in the pattern is treated as a
   * glob wildcard (anchored, case-insensitive); otherwise the pattern is a
   * case-insensitive substring. Only `candidate` rows are matched/rejected.
   */
  rejectByPattern(
    pattern: string,
    reason?: string,
  ): { rejected: number; matched: number } {
    const candidates = this.store.listByStatus('candidate');
    let matcher: (name: string) => boolean;
    if (pattern.includes('*')) {
      const escaped = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      const regex = new RegExp(`^${escaped}$`, 'i');
      matcher = (name) => regex.test(name);
    } else {
      const needle = pattern.toLowerCase();
      matcher = (name) => name.toLowerCase().includes(needle);
    }
    const matches = candidates.filter((c) => matcher(c.name));
    let rejected = 0;
    for (const c of matches) {
      try {
        this.store.updateStatus(c.id, 'rejected', { reason });
        rejected++;
      } catch (error: unknown) {
        this.logger.warn(
          '[skill-synthesis] rejectByPattern: skipping candidate',
          {
            candidateId: c.id,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    return { rejected, matched: matches.length };
  }

  /** Read effective settings, applying defaults for any missing keys. */
  readSettings(): SkillSynthesisSettings {
    const get = <T>(key: string, fallback: T): T => {
      try {
        const raw = this.workspaceProvider.getConfiguration<T>(
          'ptah',
          key,
          fallback,
        );
        return raw === undefined || raw === null ? fallback : raw;
      } catch {
        return fallback;
      }
    };
    return {
      enabled: get('skillSynthesis.enabled', SETTINGS_DEFAULTS.enabled),
      successesToPromote: get(
        'skillSynthesis.successesToPromote',
        SETTINGS_DEFAULTS.successesToPromote,
      ),
      dedupCosineThreshold: get(
        'skillSynthesis.dedupCosineThreshold',
        SETTINGS_DEFAULTS.dedupCosineThreshold,
      ),
      maxActiveSkills: get(
        'skillSynthesis.maxActiveSkills',
        SETTINGS_DEFAULTS.maxActiveSkills,
      ),
      candidatesDir: get(
        'skillSynthesis.candidatesDir',
        SETTINGS_DEFAULTS.candidatesDir,
      ),
      eligibilityMinTurns: get(
        'skillSynthesis.eligibilityMinTurns',
        SETTINGS_DEFAULTS.eligibilityMinTurns,
      ),
      evictionDecayRate: get(
        'skillSynthesis.evictionDecayRate',
        SETTINGS_DEFAULTS.evictionDecayRate,
      ),
      generalizationContextThreshold: get(
        'skillSynthesis.generalizationContextThreshold',
        SETTINGS_DEFAULTS.generalizationContextThreshold,
      ),
      dedupClusterThreshold: get(
        'skillSynthesis.dedupClusterThreshold',
        SETTINGS_DEFAULTS.dedupClusterThreshold,
      ),
      prefilterMinEdits: get(
        'skillSynthesis.prefilterMinEdits',
        SETTINGS_DEFAULTS.prefilterMinEdits,
      ),
      prefilterMinChars: get(
        'skillSynthesis.prefilterMinChars',
        SETTINGS_DEFAULTS.prefilterMinChars,
      ),
      prefilterMinToolUses: get(
        'skillSynthesis.prefilterMinToolUses',
        SETTINGS_DEFAULTS.prefilterMinToolUses,
      ),
      judgeEnabled: get(
        'skillSynthesis.judgeEnabled',
        SETTINGS_DEFAULTS.judgeEnabled,
      ),
      minJudgeScore: get(
        'skillSynthesis.minJudgeScore',
        SETTINGS_DEFAULTS.minJudgeScore,
      ),
      judgeModel: get(
        'skillSynthesis.judgeModel',
        SETTINGS_DEFAULTS.judgeModel,
      ),
      maxPinnedSkills: get(
        'skillSynthesis.maxPinnedSkills',
        SETTINGS_DEFAULTS.maxPinnedSkills,
      ),
      curatorEnabled: get(
        'skillSynthesis.curatorEnabled',
        SETTINGS_DEFAULTS.curatorEnabled,
      ),
      curatorIntervalHours: get(
        'skillSynthesis.curatorIntervalHours',
        SETTINGS_DEFAULTS.curatorIntervalHours,
      ),
      suggestionMinClusterSize: get(
        'skillSynthesis.suggestionMinClusterSize',
        SETTINGS_DEFAULTS.suggestionMinClusterSize,
      ),
      suggestionMaxCandidates: get(
        'skillSynthesis.suggestionMaxCandidates',
        SETTINGS_DEFAULTS.suggestionMaxCandidates,
      ),
    };
  }

  private templateBody(canonicalText: string, headline: string): string {
    return [
      `# ${headline}`,
      '',
      'This skill was synthesized automatically from a successful session trajectory.',
      'Edit the body below to make it reusable.',
      '',
      '## Trajectory (normalized)',
      '',
      '```',
      canonicalText.length > 4000
        ? `${canonicalText.slice(0, 4000)}\n…(truncated)…`
        : canonicalText,
      '```',
      '',
    ].join('\n');
  }
}
