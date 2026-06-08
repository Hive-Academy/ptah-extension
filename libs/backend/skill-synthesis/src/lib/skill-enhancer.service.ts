import * as os from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  UserLayerMirrorService,
  WriteEnhancedResult,
} from '@ptah-extension/agent-generation';
import type { IInternalQuery } from './internal-query.interface';
import type {
  SkillCandidateRow,
  SkillSynthesisSettings,
  CandidateId,
} from './types';
import {
  INTERNAL_QUERY_SERVICE_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
} from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillRegistryStore } from './skill-registry.store';
import { SkillJudgeService } from './skill-judge.service';
import { TrajectoryExtractor } from './trajectory-extractor';
import { resolveJudgeModel } from './model-resolver';
import {
  SKILL_REPROPAGATION_TOKEN,
  type SkillRepropagationPort,
} from './skill-repropagation.port';

const ENHANCE_TIMEOUT_MS = 30_000;
const ENHANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MIN_INVOCATIONS_TO_ENHANCE = 5;
const MAX_TRAJECTORY_SESSIONS = 3;
const TRAJECTORY_MIN_TURNS = 5;

export interface EnhanceOptions {
  readonly manual?: boolean;
}

export type EnhanceSkipReason =
  | 'missing-clone'
  | 'cooldown'
  | 'below-threshold'
  | 'no-internal-query'
  | 'empty-candidate'
  | 'no-change'
  | 'invalid-candidate'
  | 'judge-rejected'
  | 'error';

export interface EnhanceResult {
  changed: boolean;
  slug: string;
  kind: 'skill';
  judgeScore: number | null;
  judgeReason: string | null;
  historyTs: string | null;
  skipReason?: EnhanceSkipReason;
}

export interface RevertEnhancementResult {
  reverted: boolean;
  slug: string;
  revertedFrom: string;
  newHistoryTs: string | null;
}

@injectable()
export class SkillEnhancerService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN)
    private readonly mirror: UserLayerMirrorService,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE)
    private readonly candidates: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE)
    private readonly registry: SkillRegistryStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE)
    private readonly judge: SkillJudgeService,
    @inject(TrajectoryExtractor)
    private readonly trajectories: TrajectoryExtractor,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
    @inject(SKILL_REPROPAGATION_TOKEN, { isOptional: true })
    private readonly repropagation: SkillRepropagationPort | null,
  ) {}

  isEligible(slug: string, settings: SkillSynthesisSettings): boolean {
    const stats = this.candidates.getInvocationStats(slug);
    if (stats.total < MIN_INVOCATIONS_TO_ENHANCE) return false;
    return !this.isWithinCooldown(slug, settings);
  }

  async enhance(
    slug: string,
    settings: SkillSynthesisSettings,
    options: EnhanceOptions = {},
  ): Promise<EnhanceResult> {
    const base: EnhanceResult = {
      changed: false,
      slug,
      kind: 'skill',
      judgeScore: null,
      judgeReason: null,
      historyTs: null,
    };

    try {
      if (!this.internalQuery) {
        return { ...base, skipReason: 'no-internal-query' };
      }

      const roots = this.mirror.getUserLayerRoots();
      const skillFile = join(roots.skills, slug, 'SKILL.md');
      const currentBody = await this.readBody(skillFile);
      if (currentBody === null) {
        return { ...base, skipReason: 'missing-clone' };
      }

      const stats = this.candidates.getInvocationStats(slug);
      if (!options.manual && stats.total < MIN_INVOCATIONS_TO_ENHANCE) {
        return { ...base, skipReason: 'below-threshold' };
      }
      if (!options.manual && this.isWithinCooldown(slug, settings)) {
        return { ...base, skipReason: 'cooldown' };
      }

      const cwd = this.resolveCwd();
      const candidateBody = await this.generateCandidate(
        slug,
        currentBody,
        settings,
        cwd,
      );
      if (!candidateBody) {
        return { ...base, skipReason: 'empty-candidate' };
      }

      if (candidateBody.trim() === currentBody.trim()) {
        this.logger.info(
          '[skill-enhancer] candidate identical to clone; skip',
          {
            slug,
          },
        );
        return { ...base, skipReason: 'no-change' };
      }

      const decision = await this.judge.judge(
        this.synthRow(slug, currentBody),
        candidateBody,
        settings,
      );

      const autoRequiresVerdict = !options.manual;
      const passedForWrite =
        decision.passed &&
        (!autoRequiresVerdict || decision.reason === 'judge-verdict');

      if (!passedForWrite) {
        this.logger.info('[skill-enhancer] candidate not written', {
          slug,
          judgePassed: decision.passed,
          judgeReason: decision.reason,
          judgeScore: decision.score,
          manual: options.manual ?? false,
        });
        return {
          ...base,
          judgeScore: decision.score,
          judgeReason: decision.reason,
          skipReason: 'judge-rejected',
        };
      }

      if (!this.hasValidFrontmatter(candidateBody)) {
        this.logger.warn(
          '[skill-enhancer] candidate missing valid frontmatter; skip write',
          {
            slug,
            judgeScore: decision.score,
            judgeReason: decision.reason,
          },
        );
        return {
          ...base,
          judgeScore: decision.score,
          judgeReason: decision.reason,
          skipReason: 'invalid-candidate',
        };
      }

      const written: WriteEnhancedResult = await this.mirror.writeEnhancedSkill(
        {
          slug,
          newBody: candidateBody,
        },
      );

      this.registry.markEnhanced(
        'skill',
        slug,
        Date.now(),
        written.currentContentHash,
      );

      await this.repropagate(slug);

      this.logger.info('[skill-enhancer] skill enhanced', {
        slug,
        judgeScore: decision.score,
        judgeReason: decision.reason,
        historyTs: written.historyTs,
      });

      return {
        changed: true,
        slug,
        kind: 'skill',
        judgeScore: decision.score,
        judgeReason: decision.reason,
        historyTs: written.historyTs,
      };
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] enhance failed; fail-soft', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...base, skipReason: 'error' };
    }
  }

  async revert(
    slug: string,
    historyTs: string,
  ): Promise<RevertEnhancementResult> {
    try {
      const result = await this.mirror.revert({
        kind: 'skill',
        slug,
        historyTs,
      });
      if (result.restored) {
        this.registry.markEnhanced('skill', slug, Date.now());
        await this.repropagate(slug);
      }
      return {
        reverted: result.restored,
        slug,
        revertedFrom: result.revertedFrom,
        newHistoryTs: result.newHistoryTs,
      };
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] revert failed', {
        slug,
        historyTs,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        reverted: false,
        slug,
        revertedFrom: historyTs,
        newHistoryTs: null,
      };
    }
  }

  private async repropagate(slug: string): Promise<void> {
    if (!this.repropagation) return;
    try {
      await this.repropagation.repropagate('skill', slug, this.resolveCwd());
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] re-propagation failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async generateCandidate(
    slug: string,
    currentBody: string,
    settings: SkillSynthesisSettings,
    cwd: string,
  ): Promise<string | null> {
    if (!this.internalQuery) return null;
    const stats = this.candidates.getInvocationStats(slug);
    const trajectorySignal = await this.collectTrajectorySignal(slug, cwd);
    const model = resolveJudgeModel(
      settings.judgeModel,
      this.workspaceProvider,
    );

    const prompt = [
      `You are improving an existing AI agent SKILL.md based on real usage signal.`,
      `Rewrite the skill to be clearer, more actionable, and more robust against the observed failures.`,
      `Preserve the YAML frontmatter (name, description) unless it is clearly wrong.`,
      `Reply with ONLY the full improved SKILL.md content — no commentary, no code fences.`,
      ``,
      `Usage stats: total=${stats.total}, succeeded=${stats.succeeded}, failed=${stats.failed}, distinctContexts=${stats.distinctContexts}.`,
      ``,
      `Recent trajectory signal:`,
      trajectorySignal || '(none available)',
      ``,
      `Current SKILL.md:`,
      `---`,
      currentBody.slice(0, 8000),
      `---`,
    ].join('\n');

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      ENHANCE_TIMEOUT_MS,
    );
    try {
      const handle = await this.internalQuery.execute({
        cwd,
        model,
        prompt,
        isPremium: false,
        mcpServerRunning: false,
        maxTurns: 1,
        abortController,
      });
      let collected = '';
      for await (const msg of handle.stream) {
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }
      const cleaned = this.stripCodeFence(collected.trim());
      return cleaned.length > 0 ? cleaned : null;
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] candidate generation failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async collectTrajectorySignal(
    slug: string,
    workspaceRoot: string,
  ): Promise<string> {
    const sessionIds = this.candidates.getRecentSessionsForSlug(
      slug,
      MAX_TRAJECTORY_SESSIONS,
    );
    const parts: string[] = [];
    for (const sessionId of sessionIds) {
      try {
        const extracted = await this.trajectories.extract(
          sessionId,
          workspaceRoot,
          TRAJECTORY_MIN_TURNS,
        );
        if (extracted) {
          parts.push(extracted.canonicalText.slice(0, 1500));
        }
      } catch (error: unknown) {
        this.logger.debug('[skill-enhancer] trajectory extract failed', {
          slug,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return parts.join('\n\n---\n\n');
  }

  private synthRow(slug: string, body: string): SkillCandidateRow {
    return {
      id: slug as unknown as CandidateId,
      name: slug,
      description: this.extractDescription(body) || slug,
      bodyPath: '',
      sourceSessionIds: [],
      trajectoryHash: '',
      embeddingRowid: null,
      status: 'promoted',
      successCount: 0,
      failureCount: 0,
      createdAt: Date.now(),
      promotedAt: null,
      rejectedAt: null,
      rejectedReason: null,
      pinned: false,
    };
  }

  private hasValidFrontmatter(body: string): boolean {
    const match = /^---\s*\n([\s\S]*?)\n---/.exec(body.trimStart());
    if (!match) return false;
    const frontmatter = match[1];
    const hasName = /^name:\s*\S+/m.test(frontmatter);
    const hasDescription = /^description:\s*\S+/m.test(frontmatter);
    return hasName && hasDescription;
  }

  private extractDescription(body: string): string {
    const match = /^description:\s*(.+)$/m.exec(body);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
  }

  private isWithinCooldown(
    slug: string,
    _settings: SkillSynthesisSettings,
  ): boolean {
    const row = this.registry.getBySlug('skill', slug);
    if (!row || row.lastEnhancedAt === null) return false;
    return Date.now() - row.lastEnhancedAt < ENHANCE_COOLDOWN_MS;
  }

  private resolveCwd(): string {
    try {
      const root = this.workspaceProvider.getWorkspaceRoot();
      if (root && root.length > 0) return root;
    } catch {
      // fall through to homedir
    }
    return os.homedir();
  }

  private async readBody(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private stripCodeFence(text: string): string {
    const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(text.trim());
    return fence ? fence[1] : text;
  }
}
