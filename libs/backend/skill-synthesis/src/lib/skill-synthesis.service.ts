/**
 * SkillSynthesisService — top-level orchestrator.
 *
 * Lifecycle:
 *   - `start()` is invoked by Electron `wire-runtime.ts`. It
 *     ensures the underlying SQLite connection is open and migrations are
 *     applied. It subscribes to the session-end registry so that every
 *     completed session is automatically analyzed for skill candidates.
 *   - `stop()` unsubscribes from the session-end registry and resets state.
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
  TrajectoryExtractor,
  type ExtractedTrajectory,
} from './trajectory-extractor';
import { SkillSynthesizerService } from './skill-synthesizer.service';
import { SkillRegistryStore } from './skill-registry.store';
import { migrateSkillMdFiles } from './skill-md-migration';
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

@injectable()
export class SkillSynthesisService {
  private static readonly RING_CAPACITY = 200;
  private started = false;
  /**
   * Highest trajectory turn count analyzed per session in this process. A
   * session is re-analyzed only once it has grown beyond the previously
   * analyzed turn count, so a turn-complete trigger that fired while the
   * session was still ineligible (<5 turns) can succeed later. Duplicate
   * candidates are still prevented by the trajectory-hash dedup downstream.
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
  ) {}

  /**
   * Idempotent. Ensures DB is open + migrated. Caller wraps in
   * try/catch so a failure here NEVER blocks app activation.
   */
  async start(): Promise<void> {
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
        void this.analyzeSession(data.sessionId, data.workspaceRoot).catch(
          (err: unknown) => {
            this.logger.warn('[skill-synthesis] analyzeSession error', {
              sessionId: data.sessionId,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
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

    // Fire-and-forget backfill of embeddings onto pre-existing candidates so
    // the clustering / suggestion pass has vectors to work with. Delayed and
    // never awaited so it cannot block activation; self-limiting across runs.
    setTimeout(() => {
      void this.backfillEmbeddings()
        .then((n) => {
          if (n > 0) {
            this.logger.info(
              '[skill-synthesis] backfilled candidate embeddings',
              { count: n },
            );
          }
        })
        .catch((err: unknown) =>
          this.logger.warn('[skill-synthesis] backfill failed (non-fatal)', {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
    }, 5000);

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

    const trajectory = await this.extractor.extract(
      sessionId,
      workspaceRoot,
      settings.eligibilityMinTurns,
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

  private passesPrefilter(
    trajectory: ExtractedTrajectory,
    settings: SkillSynthesisSettings,
  ): { ok: boolean; reason?: 'tooThin' | 'noWork' } {
    if (trajectory.turnCount < 2) {
      return { ok: false, reason: 'tooThin' };
    }
    const editOk = trajectory.editCount >= settings.prefilterMinEdits;
    const toolOk =
      trajectory.toolUseCount >= settings.prefilterMinToolUses &&
      trajectory.charLength >= settings.prefilterMinChars;
    const testOk = trajectory.bashTestPassed === true;
    if (editOk || toolOk || testOk) {
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
