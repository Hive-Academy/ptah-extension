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
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
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
import { TrajectoryExtractor } from './trajectory-extractor';
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

/**
 * Cross-library token for the session-end callback registry.
 * Uses Symbol.for() directly instead of importing from
 * @ptah-extension/agent-sdk to avoid circular dependency.
 */
const SESSION_END_CALLBACK_REGISTRY = Symbol.for(
  'SdkSessionEndCallbackRegistry',
);

const SETTINGS_DEFAULTS: SkillSynthesisSettings = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  minTrajectoryFidelityRatio: 0.4,
  dedupClusterThreshold: 0.78,
  minAbstractionEditDistance: 0.3,
  judgeEnabled: true,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
};

@injectable()
export class SkillSynthesisService {
  private static readonly RING_CAPACITY = 200;
  private started = false;
  /** Sessions already analyzed in this process (≤1 candidate per session). */
  private readonly analyzedSessions = new Set<string>();
  /** Disposer returned by the session-end registry — called in stop(). */
  private _sessionEndDisposer?: () => void;
  private readonly events: SkillSynthesisEvent[] = [];
  private eligibilityCounters: {
    tooFewTurns: number;
    lowFidelity: number;
    insufficientAbstraction: number;
    accepted: number;
  } = {
    tooFewTurns: 0,
    lowFidelity: 0,
    insufficientAbstraction: 0,
    accepted: 0,
  };
  private countersDate: string = SkillSynthesisService.todayKey();
  private lastAnalyzeRunAtMs: number | null = null;
  private lastCuratorPassAtMs: number | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
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
      this.curator?.start(settings);
    } catch (err: unknown) {
      this.logger.warn('[skill-synthesis] curator start failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.logger.info('[skill-synthesis] started', {
      vecExtensionLoaded: this.connection.vecExtensionLoaded,
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
      | { force?: boolean; embeddingProvider?: IEmbedder | null },
    maybeOptions?: { force?: boolean },
  ): Promise<RegisterCandidateResult | null> {
    let embeddingProvider: IEmbedder | null | undefined;
    let force = false;
    if (
      embeddingProviderOrOptions &&
      typeof embeddingProviderOrOptions === 'object' &&
      !('embed' in embeddingProviderOrOptions)
    ) {
      embeddingProvider = embeddingProviderOrOptions.embeddingProvider;
      force = embeddingProviderOrOptions.force === true;
    } else {
      embeddingProvider = embeddingProviderOrOptions as
        | IEmbedder
        | null
        | undefined;
      force = maybeOptions?.force === true;
    }

    if (!this.started) {
      this.logger.debug('[skill-synthesis] analyzeSession called before start');
      return null;
    }
    const settings = this.readSettings();
    if (!settings.enabled) return null;
    if (force) {
      this.analyzedSessions.delete(sessionId);
    }
    if (this.analyzedSessions.has(sessionId)) return null;
    this.analyzedSessions.add(sessionId);

    const trajectory = await this.extractor.extract(
      sessionId,
      workspaceRoot,
      settings.eligibilityMinTurns,
    );
    if (!trajectory) {
      this.logger.info(
        '[skill-synthesis] session ineligible (trajectory null — <5 turns or no success marker)',
        { sessionId },
      );
      this.incrementEligibility('tooFewTurns');
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: 'tooFewTurns',
      });
      return null;
    }
    const fidelityRatio =
      trajectory.sessionTurnCount > 0
        ? trajectory.turnCount / trajectory.sessionTurnCount
        : 1;
    if (fidelityRatio < settings.minTrajectoryFidelityRatio) {
      this.logger.info(
        '[skill-synthesis] candidate rejected: low trajectory fidelity ratio',
        {
          sessionId,
          fidelityRatio,
          threshold: settings.minTrajectoryFidelityRatio,
        },
      );
      this.incrementEligibility('lowFidelity');
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: 'lowFidelity',
      });
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
    const synthesizedBody = this.synthesizeBody(
      trajectory.canonicalText,
      trajectory.shortDescription,
    );
    const editDist = computeNormalizedLevenshtein(
      trajectory.canonicalText.slice(0, 2000),
      synthesizedBody.slice(0, 2000),
    );
    if (editDist < settings.minAbstractionEditDistance) {
      this.logger.info(
        '[skill-synthesis] candidate rejected: insufficient abstraction',
        { sessionId, editDist, threshold: settings.minAbstractionEditDistance },
      );
      this.incrementEligibility('insufficientAbstraction');
      this.pushEvent({
        kind: 'ineligible',
        timestamp: Date.now(),
        sessionId,
        reason: 'insufficientAbstraction',
      });
      return null;
    }

    const candidatesRoot = this.mdGenerator.candidatesRoot(
      settings.candidatesDir,
    );
    let bodyPath = path.join(candidatesRoot, trajectory.slug, 'SKILL.md');
    let chosenSlug = trajectory.slug;
    try {
      const md = this.mdGenerator.writeCandidate(
        {
          slug: trajectory.slug,
          description: trajectory.shortDescription,
          body: synthesizedBody,
        },
        settings.candidatesDir,
      );
      bodyPath = md.filePath;
      chosenSlug = md.slug;
    } catch (err) {
      this.logger.warn('[skill-synthesis] could not write candidate SKILL.md', {
        sessionId,
        slug: trajectory.slug,
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
      description: trajectory.shortDescription,
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

  pushEvent(ev: SkillSynthesisEvent): void {
    this.events.push(ev);
    if (this.events.length > SkillSynthesisService.RING_CAPACITY) {
      this.events.shift();
    }
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
    this.lastCuratorPassAtMs = timestamp;
    this.pushEvent({ kind: 'curator-pass', timestamp });
  }

  private incrementEligibility(
    bucket:
      | 'tooFewTurns'
      | 'lowFidelity'
      | 'insufficientAbstraction'
      | 'accepted',
  ): void {
    this.rolloverCountersIfNewDay();
    this.eligibilityCounters[bucket]++;
  }

  private rolloverCountersIfNewDay(): void {
    const today = SkillSynthesisService.todayKey();
    if (today !== this.countersDate) {
      this.countersDate = today;
      this.eligibilityCounters = {
        tooFewTurns: 0,
        lowFidelity: 0,
        insufficientAbstraction: 0,
        accepted: 0,
      };
    }
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
      minTrajectoryFidelityRatio: get(
        'skillSynthesis.minTrajectoryFidelityRatio',
        SETTINGS_DEFAULTS.minTrajectoryFidelityRatio,
      ),
      dedupClusterThreshold: get(
        'skillSynthesis.dedupClusterThreshold',
        SETTINGS_DEFAULTS.dedupClusterThreshold,
      ),
      minAbstractionEditDistance: get(
        'skillSynthesis.minAbstractionEditDistance',
        SETTINGS_DEFAULTS.minAbstractionEditDistance,
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
    };
  }

  /** Compose a starter SKILL.md body from the canonical trajectory. */
  private synthesizeBody(canonicalText: string, headline: string): string {
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

/**
 * Compute normalized Levenshtein edit distance between two strings.
 * Inputs are capped to 2000 chars to bound O(n^2) cost.
 * Returns 0.0 (identical) to 1.0 (completely different).
 */
export function computeNormalizedLevenshtein(a: string, b: string): number {
  const s1 = a.slice(0, 2000);
  const s2 = b.slice(0, 2000);
  const m = s1.length;
  const n = s2.length;
  if (m === 0 && n === 0) return 0;
  if (m === 0) return 1;
  if (n === 0) return 1;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  const editDistance = prev[n];
  return editDistance / Math.max(m, n);
}
