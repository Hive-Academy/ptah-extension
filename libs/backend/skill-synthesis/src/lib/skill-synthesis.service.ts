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
 * `start()` is THE REGISTRATION SEAM. Without it an enqueued row is marked
 * `skipped` ("no handler for stage …") and the queue is one nobody reads. The
 * six stage protocols themselves live in `queue/stage-handlers.service.ts`
 * (TASK_2026_256) — this service hands itself over as the `SkillStageWorkers`
 * port and calls `registerStageHandlers`, ABOVE both of the early returns
 * below.
 *
 * `analyzeSession` therefore has ONE background caller — the `prefilter` stage
 * handler. The only other caller in the codebase is the explicit,
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
import type { SessionVerdictStore } from './archaeology/session-verdict.store';
import type { SessionVerdict } from './archaeology/session-verdict.types';
import { SkillRegistryStore } from './skill-registry.store';
import {
  migrateSkillMdFiles,
  type SkillMdMigrationMarkerStore,
} from './skill-md-migration';
import { readCandidateBodyFile } from './candidate-body';
import type { SkillQueueStore } from './queue/skill-queue.store';
import type { EnqueueOutcome } from './queue/skill-queue.types';
import type { SkillStageHandlersService } from './queue/stage-handlers.service';
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
  blankToUndefined,
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
     * Read-only here. `analyzeSession` looks the verdict up to hand it to the
     * synthesizer; the archaeologist owns every write.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE, { isOptional: true })
    private readonly verdicts: SessionVerdictStore | null = null,
    /**
     * The six queue stage protocols, extracted in TASK_2026_256. Injected by
     * TOKEN and typed with `import type`, so this file never takes a runtime
     * dependency on the queue side — `queue/skill-queue.types` already points
     * back here (`SkillQueueSource = AnalyzeSource`).
     *
     * Optional for the same reason the queue is: a host without persistence, or
     * a spec that constructs the service by hand, still resolves. When it is
     * absent nothing drains in this host, which is exactly what a host with no
     * queue should do — it is never a reason to analyze inline. It owns the
     * drain and every gate; this service owns only the three workers it hands
     * over at registration.
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_STAGE_HANDLERS_SERVICE, {
      isOptional: true,
    })
    private readonly stageHandlers: SkillStageHandlersService | null = null,
    /**
     * The per-root marker that lets the one-time SKILL.md content migration
     * below stop re-walking `~/.ptah/skills` on every launch (migration `0041`,
     * TASK_2026_331 B4).
     *
     * Optional for the same reason the queue is: a host without persistence, or
     * a spec that constructs the service by hand, resolves `null` and gets the
     * pre-marker behaviour — the full walk, every time. Absent is never allowed
     * to mean "skip".
     */
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_MD_MIGRATION_STATE_STORE, {
      isOptional: true,
    })
    private readonly mdMigrationState: SkillMdMigrationMarkerStore | null = null,
  ) {}

  /**
   * Idempotent. Ensures DB is open + migrated. Caller wraps in
   * try/catch so a failure here NEVER blocks app activation.
   */
  async start(): Promise<void> {
    // ABOVE both early returns, deliberately. Registration is a handful of Map
    // writes: it opens no database, reads no transcript and spends nothing, so
    // the "paused means touches nothing" rule the drain's gate 1 enforces is not
    // weakened by doing it here. Doing it BELOW the `enabled` check would mean
    // a host that booted while `skillSynthesis.enabled` was false has no
    // handlers, and the moment the tray re-enables background learning every
    // drained row would be marked `skipped` for want of one. Idempotent, so
    // the `started` re-entry guard below does not need to cover it.
    this.stageHandlers?.registerStageHandlers(this);
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
      // The marker is read INSIDE `migrateSkillMdFiles`, before it touches the
      // disk. `openAndMigrate()` above guarantees the `0041` table exists by
      // now, which is why this needs no sidecar file. Each root carries its own
      // marker row: the candidates root defaults to a subdirectory of the
      // active root but can be repointed by `skillSynthesis.candidatesDir`, and
      // a failure in the second walk must not be masked by the first one's
      // success.
      const activeResult = migrateSkillMdFiles(
        activeRoot,
        this.logger,
        this.mdMigrationState,
      );
      this.logger.info(
        '[skill-synthesis] SKILL.md migration complete (active root)',
        {
          ...activeResult,
        },
      );
      const candidatesResult = migrateSkillMdFiles(
        candidatesRoot,
        this.logger,
        this.mdMigrationState,
      );
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
   * Migrate this service's session-keyed state from `fromId` to `toId`, and
   * re-point the durable queue rows with it.
   *
   * Driven by `SkillTriggerService.rekeySession`, which is in turn driven by
   * the SDK's `SessionIdResolvedCallbackRegistry`. Before the canonical UUID
   * exists a residual hook path reports the **tabId**, so both
   * `analyzedSessions` and `skill_synthesis_queue` can end up keyed by it while
   * every later signal — and `SessionEnd` — arrives under the UUID. Split keys
   * mean the turn-count high-water mark is split too, so a session would be
   * re-analyzed from zero under its real id. TASK_2026_296 item 6, Part B.
   *
   * Synchronous by contract: no `await` here or in `SkillQueueStore`'s
   * backfill, so nothing interleaves between the read and the write.
   *
   * **Refuse-overwrite**: when `toId` already has a recorded turn count that
   * count is KEPT and the `fromId` entry discarded. Never clobber — the
   * surviving value was recorded under the canonical id, and a stale HIGHER
   * count would suppress legitimate re-analysis while a stale LOWER one only
   * costs one redundant round trip against `UNIQUE(session_id, stage)`'s
   * durable guard.
   */
  rekeySession(fromId: string, toId: string): void {
    const from = blankToUndefined(fromId);
    const to = blankToUndefined(toId);
    if (from === undefined || to === undefined || from === to) return;

    const turnCount = this.analyzedSessions.get(from);
    this.analyzedSessions.delete(from);
    if (turnCount !== undefined && !this.analyzedSessions.has(to)) {
      this.analyzedSessions.set(to, turnCount);
    }

    this.queue?.backfillSessionId(from, to);
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
    // An empty id is not a session, and the queue treats it as one: the table
    // is `UNIQUE(session_id, stage)`, so EVERY session arriving with `''`
    // collides on a single row per stage, and the re-open is gated on
    // `turn_count < ?` — so the first such session's turn count wedges every
    // later one out, permanently and silently. The rejection belongs here
    // because this is the one entry point every trigger and the boot scan share.
    if (blankToUndefined(sessionId) === undefined) {
      this.logger.warn(
        '[skill-synthesis] enqueueAnalyze called with an empty sessionId — rejecting',
        { source: opts.source, workspaceRoot },
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
      // The ORIGIN of this capture, and the reason the Skills tab can scope its
      // review queue to one project. `|| null` and never `|| ''`: a session
      // with no known root is UNKNOWN origin, which a scoped read includes,
      // whereas `''` would claim the capture is deliberately cross-project.
      // This is the same root the `contextId` above is hashed from — that hash
      // is a generality COUNT (`countDistinctContexts`) and cannot be reversed
      // to a path, which is why the path is stored as well as hashed.
      workspaceRoot: workspaceRoot || null,
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
        const body = readCandidateBodyFile(c, this.logger);
        // The fallback stays the ROW's own text rather than the shared
        // stand-in: this string is embedded, and folding `description` in
        // twice would move the vector for every candidate with no file.
        const text =
          body === null
            ? `${c.name}\n\n${c.description}`
            : `${c.description}\n\n${body}`;
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
