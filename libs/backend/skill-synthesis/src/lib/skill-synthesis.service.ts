/**
 * SkillSynthesisService — top-level orchestrator (architecture §1.3, §6.5).
 *
 * Lifecycle:
 *   - `start()` is invoked by Electron `wire-runtime.ts` Phase 4.53. It
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

/**
 * Cross-library token for the session-end callback registry.
 * R2 mitigation: use Symbol.for() directly instead of importing from
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
  private started = false;
  /** Sessions already analyzed in this process (≤1 candidate per session). */
  private readonly analyzedSessions = new Set<string>();
  /** Disposer returned by the session-end registry — called in stop(). */
  private _sessionEndDisposer?: () => void;

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
   * Idempotent. Ensures DB is open + migrated. Caller (Phase 4.53) wraps in
   * try/catch so a failure here NEVER blocks app activation.
   */
  async start(): Promise<void> {
    if (this.started) return;
    if (!this.readSettings().enabled) {
      // Do NOT latch `started` here — leave it false so a later start() call
      // (after the user toggles `skillSynthesis.enabled` to true at runtime)
      // re-evaluates the setting and wires up the subscription.
      this.logger.info(
        '[skill-synthesis] disabled via settings; skipping start',
      );
      return;
    }
    if (!this.connection.isOpen) {
      await this.connection.openAndMigrate();
    }

    // Run SKILL.md format migration (agentskills.io when_to_use field).
    // Non-fatal — wrapped in try/catch so startup proceeds regardless.
    try {
      const settingsForMigration = this.readSettings();
      const activeResult = migrateSkillMdFiles(
        this.mdGenerator.activeRoot(),
        this.logger,
      );
      this.logger.info(
        '[skill-synthesis] SKILL.md migration complete (active root)',
        {
          ...activeResult,
        },
      );
      const candidatesResult = migrateSkillMdFiles(
        this.mdGenerator.candidatesRoot(settingsForMigration.candidatesDir),
        this.logger,
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

    // Start Curator daemon if registered and enabled.
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
    // Reset the per-process dedup so a future start() re-analyzes sessions
    // that were skipped during a prior on/off/on cycle. The DB-level dedup
    // via findByTrajectoryHash keeps this safe across restarts.
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
    embeddingProvider?: IEmbedder | null,
  ): Promise<RegisterCandidateResult | null> {
    if (!this.started) {
      this.logger.debug('[skill-synthesis] analyzeSession called before start');
      return null;
    }
    const settings = this.readSettings();
    if (!settings.enabled) return null;
    if (this.analyzedSessions.has(sessionId)) return null;
    this.analyzedSessions.add(sessionId);

    const trajectory = await this.extractor.extract(sessionId, workspaceRoot);
    if (!trajectory) {
      this.logger.info(
        '[skill-synthesis] session ineligible (trajectory null — <5 turns or no success marker)',
        { sessionId },
      );
      return null;
    }

    // Signal 3: Trajectory fidelity ratio — how many session turns were useful.
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
      return null;
    }

    // Avoid duplicate work for trajectories we've already captured.
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

    // Signal 6: Abstraction edit-distance — ensure trajectory is different enough
    // from its synthesized body (guards against overly literal captures).
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

    // Derive a short context ID from the workspace root — used for
    // cross-context generalization tracking.
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

    // Record an initial invocation for the session that produced this candidate.
    if (!result.reused && contextId) {
      try {
        this.store.recordInvocation({
          skillId: result.candidate.id,
          sessionId,
          succeeded: true,
          invokedAt: Date.now(),
          contextId,
        });
      } catch {
        // Non-fatal — candidate was registered, invocation tracking is best-effort.
      }
    }
    this.logger.info('[skill-synthesis] candidate registered', {
      candidateId: result.candidate.id,
      slug: chosenSlug,
      reused: result.reused,
      sessionId,
    });
    return result;
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

  // Use two-row DP to bound memory at O(n).
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
