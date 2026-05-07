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
import { TrajectoryExtractor } from './trajectory-extractor';
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
      this.logger.info(
        '[skill-synthesis] disabled via settings; skipping start',
      );
      this.started = true;
      return;
    }
    if (!this.connection.isOpen) {
      await this.connection.openAndMigrate();
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
    this.logger.info('[skill-synthesis] started', {
      vecExtensionLoaded: this.connection.vecExtensionLoaded,
    });
  }

  /** Unsubscribes from the session-end registry and resets state. */
  stop(): void {
    this._sessionEndDisposer?.();
    this._sessionEndDisposer = undefined;
    this.started = false;
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
          body: this.synthesizeBody(
            trajectory.canonicalText,
            trajectory.shortDescription,
          ),
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

    const result = this.store.registerCandidate({
      name: chosenSlug,
      description: trajectory.shortDescription,
      bodyPath,
      sourceSessionIds: [sessionId],
      trajectoryHash: trajectory.hash,
      embedding,
      createdAt: Date.now(),
    });
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
