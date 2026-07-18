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
import {
  SkillRegistryStore,
  type SkillRegistryKind,
} from './skill-registry.store';
import { SkillJudgeService } from './skill-judge.service';
import { TrajectoryExtractor } from './trajectory-extractor';
import { resolveJudgeModel } from './model-resolver';
import {
  SKILL_REPROPAGATION_TOKEN,
  type SkillRepropagationPort,
} from './skill-repropagation.port';
import {
  SPEC_FINDINGS_TOKEN,
  type SpecFindingsPort,
} from './spec-findings.port';
import type { SkillScorecardService } from './skill-scorecard.service';
import type { AgentScorecard } from '@ptah-extension/shared';

const ENHANCE_TIMEOUT_MS = 30_000;
/**
 * Hard cap on the measured-scorecard block appended to the agent enhancement
 * prompt (R8.3). Well inside the 4,000-char findings discipline so prompt bloat
 * stays bounded.
 */
const MAX_SCORECARD_CHARS = 1200;
/** Auto-enhancement cooldown after a successful enhancement. */
export const ENHANCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Minimum recorded invocations before a clone is auto-enhance eligible. */
export const MIN_INVOCATIONS_TO_ENHANCE = 5;
const MAX_TRAJECTORY_SESSIONS = 3;
const TRAJECTORY_MIN_TURNS = 5;

export interface EnhanceOptions {
  readonly manual?: boolean;
  readonly kind?: SkillRegistryKind;
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
  kind: SkillRegistryKind;
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
    @inject(SPEC_FINDINGS_TOKEN, { isOptional: true })
    private readonly specFindings: SpecFindingsPort | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE, {
      isOptional: true,
    })
    private readonly scorecard: SkillScorecardService | null,
  ) {}

  isEligible(
    slug: string,
    settings: SkillSynthesisSettings,
    kind: SkillRegistryKind = 'skill',
  ): boolean {
    const stats = this.candidates.getInvocationStats(slug);
    if (stats.total < MIN_INVOCATIONS_TO_ENHANCE) return false;
    return !this.isWithinCooldown(slug, settings, kind);
  }

  async enhance(
    slug: string,
    settings: SkillSynthesisSettings,
    options: EnhanceOptions = {},
  ): Promise<EnhanceResult> {
    const kind: SkillRegistryKind = options.kind ?? 'skill';
    const base: EnhanceResult = {
      changed: false,
      slug,
      kind,
      judgeScore: null,
      judgeReason: null,
      historyTs: null,
    };

    try {
      if (!this.internalQuery) {
        return { ...base, skipReason: 'no-internal-query' };
      }

      const bodyPath = this.resolveBodyPath(kind, slug);
      const currentBody = await this.readBody(bodyPath);
      if (currentBody === null) {
        return { ...base, skipReason: 'missing-clone' };
      }

      const stats = this.candidates.getInvocationStats(slug);
      if (!options.manual && stats.total < MIN_INVOCATIONS_TO_ENHANCE) {
        return { ...base, skipReason: 'below-threshold' };
      }
      if (!options.manual && this.isWithinCooldown(slug, settings, kind)) {
        return { ...base, skipReason: 'cooldown' };
      }

      const cwd = this.resolveCwd();
      // Measured-usage signal for agent clones only; null (byte-identical
      // fallback) for skills/commands or when no graded/metric data exists.
      const scorecardBlock =
        kind === 'agent' ? this.buildAgentScorecardBlock(slug) : null;
      const candidateBody = await this.generateCandidate(
        slug,
        currentBody,
        settings,
        cwd,
        kind,
        scorecardBlock,
      );
      if (!candidateBody) {
        return { ...base, skipReason: 'empty-candidate' };
      }

      if (candidateBody.trim() === currentBody.trim()) {
        this.logger.info(
          '[skill-enhancer] candidate identical to clone; skip',
          {
            slug,
            kind,
          },
        );
        return { ...base, skipReason: 'no-change' };
      }

      const decision = await this.judge.judge(
        this.synthRow(slug, currentBody),
        candidateBody,
        settings,
        scorecardBlock ?? undefined,
      );

      const autoRequiresVerdict = !options.manual;
      const passedForWrite =
        decision.passed &&
        (!autoRequiresVerdict || decision.reason === 'judge-verdict');

      if (!passedForWrite) {
        this.logger.info('[skill-enhancer] candidate not written', {
          slug,
          kind,
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

      if (
        this.requiresFrontmatter(kind) &&
        !this.hasValidFrontmatter(candidateBody)
      ) {
        this.logger.warn(
          '[skill-enhancer] candidate missing valid frontmatter; skip write',
          {
            slug,
            kind,
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

      if (
        !this.requiresFrontmatter(kind) &&
        candidateBody.trim().length === 0
      ) {
        return {
          ...base,
          judgeScore: decision.score,
          judgeReason: decision.reason,
          skipReason: 'invalid-candidate',
        };
      }

      const written: WriteEnhancedResult =
        kind === 'skill'
          ? await this.mirror.writeEnhancedSkill({
              slug,
              newBody: candidateBody,
            })
          : await this.mirror.writeEnhancedFileClone({
              kind,
              slug,
              newBody: candidateBody,
            });

      this.registry.markEnhanced(
        kind,
        slug,
        Date.now(),
        written.currentContentHash,
      );

      await this.repropagate(slug, kind);

      this.logger.info('[skill-enhancer] clone enhanced', {
        slug,
        kind,
        judgeScore: decision.score,
        judgeReason: decision.reason,
        historyTs: written.historyTs,
      });

      return {
        changed: true,
        slug,
        kind,
        judgeScore: decision.score,
        judgeReason: decision.reason,
        historyTs: written.historyTs,
      };
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] enhance failed; fail-soft', {
        slug,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...base, skipReason: 'error' };
    }
  }

  async revert(
    slug: string,
    historyTs: string,
    kind: SkillRegistryKind = 'skill',
  ): Promise<RevertEnhancementResult> {
    try {
      const result = await this.mirror.revert({
        kind,
        slug,
        historyTs,
      });
      if (result.restored) {
        this.registry.markEnhanced(kind, slug, Date.now());
        await this.repropagate(slug, kind);
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
        kind,
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

  private async repropagate(
    slug: string,
    kind: SkillRegistryKind = 'skill',
  ): Promise<void> {
    if (!this.repropagation) return;
    try {
      await this.repropagation.repropagate(kind, slug, this.resolveCwd());
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] re-propagation failed', {
        slug,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveBodyPath(kind: SkillRegistryKind, slug: string): string {
    const roots = this.mirror.getUserLayerRoots();
    if (kind === 'skill') return join(roots.skills, slug, 'SKILL.md');
    if (kind === 'agent') return join(roots.agents, `${slug}.md`);
    return join(roots.commands, `${slug}.md`);
  }

  private requiresFrontmatter(kind: SkillRegistryKind): boolean {
    return kind === 'skill' || kind === 'agent';
  }

  private async generateCandidate(
    slug: string,
    currentBody: string,
    settings: SkillSynthesisSettings,
    cwd: string,
    kind: SkillRegistryKind = 'skill',
    scorecardBlock: string | null = null,
  ): Promise<string | null> {
    if (!this.internalQuery) return null;
    const stats = this.candidates.getInvocationStats(slug);
    const trajectorySignal = await this.collectTrajectorySignal(slug, cwd);
    const specFindings = await this.collectSpecFindings(slug);
    const model = resolveJudgeModel(
      settings.judgeModel,
      this.workspaceProvider,
    );

    const artifactLabel =
      kind === 'agent'
        ? 'agent definition'
        : kind === 'command'
          ? 'command prompt'
          : 'SKILL.md';
    const promptLines = [
      `You are improving an existing AI ${artifactLabel} based on real usage signal.`,
      `Rewrite it to be clearer, more actionable, and more robust against the observed failures.`,
      ...this.bestPracticeGuidance(kind),
    ];
    if (this.requiresFrontmatter(kind)) {
      promptLines.push(
        `Preserve the YAML frontmatter (name, description) unless it is clearly wrong — and if you touch the description, make sure it still states WHEN to use this ${artifactLabel}.`,
      );
    }
    promptLines.push(
      `Reply with ONLY the full improved ${artifactLabel} content — no commentary, no code fences.`,
      ``,
      `Usage stats: total=${stats.total}, succeeded=${stats.succeeded}, failed=${stats.failed}, distinctContexts=${stats.distinctContexts}.`,
      ``,
      `Recent trajectory signal:`,
      trajectorySignal || '(none available)',
      ``,
      `Graded review findings (from orchestration specs — how this ${artifactLabel} actually performed):`,
      specFindings || '(none available)',
      ``,
      `Current ${artifactLabel}:`,
      `---`,
      currentBody.slice(0, 8000),
      `---`,
    );
    // Agent clones only: append the bounded measured-scorecard block when
    // graded/metric data exists. Absent → prompt byte-identical to today (R8.2).
    if (scorecardBlock) {
      promptLines.push(``, scorecardBlock);
    }
    const prompt = promptLines.join('\n');

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

  /**
   * Kind-specific authoring best practices injected into the enhancement
   * prompt so rewrites converge on well-formed artifacts rather than just
   * "more text". Mirrors the synthesis-time skill-creator guidance.
   */
  private bestPracticeGuidance(kind: SkillRegistryKind): string[] {
    if (kind === 'agent') {
      return [
        `Best practices for an agent definition:`,
        `- Keep the role sharp: one clear specialty, explicit responsibilities, and what it should NOT do.`,
        `- The frontmatter description is the routing signal — it must say WHEN to delegate to this agent.`,
        `- Prefer concise, imperative instructions and concrete workflow steps over prose; assume the agent is already capable.`,
        `- Address the observed failures directly; remove guidance that is redundant with general competence.`,
      ];
    }
    if (kind === 'command') {
      return [
        `Best practices for a command prompt:`,
        `- Keep it single-purpose and deterministic; state the exact steps to follow.`,
        `- Handle arguments explicitly and note required vs optional inputs.`,
        `- Be concise — every line must earn its token cost.`,
      ];
    }
    return [
      `Best practices for a SKILL.md (skill-creator rules):`,
      `- Put ALL "when to use" / trigger information in the frontmatter description — never as a body section.`,
      `- Body is imperative procedural guidance only: concise steps, generalized (no workspace-specific paths or one-off details), no frontmatter duplication, no README/changelog prose.`,
      `- Match degrees of freedom to the task: exact steps where fragile, heuristics where multiple approaches are valid.`,
    ];
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

  private async collectSpecFindings(slug: string): Promise<string> {
    if (!this.specFindings) return '';
    try {
      const findings = await this.specFindings.getRecentFindings(slug);
      return findings ?? '';
    } catch (error: unknown) {
      this.logger.debug('[skill-enhancer] spec findings lookup failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }

  /**
   * Build the bounded (≤{@link MAX_SCORECARD_CHARS}) measured-scorecard block
   * for an agent clone, or `null` when the scorecard service is absent or the
   * slug has no graded/metric data (byte-identical fallback, R8.2). Never
   * throws — degrades to `null` so enhancement proceeds unchanged.
   */
  private buildAgentScorecardBlock(slug: string): string | null {
    if (!this.scorecard) return null;
    try {
      const card = this.scorecard.getScorecards([slug])[slug];
      if (!card || !this.hasScorecardData(card)) return null;
      return this.formatScorecardBlock(card).slice(0, MAX_SCORECARD_CHARS);
    } catch (error: unknown) {
      this.logger.debug('[skill-enhancer] scorecard block build failed', {
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Scorecard carries usable signal only if graded or any metric is non-null. */
  private hasScorecardData(card: AgentScorecard): boolean {
    if (card.gradedCount > 0) return true;
    return [
      card.avgInputTokens,
      card.avgOutputTokens,
      card.avgCacheReadTokens,
      card.totalInputTokens,
      card.totalOutputTokens,
      card.avgCostUsd,
      card.avgDurationMs,
      card.avgToolCount,
    ].some((v) => v !== null);
  }

  private formatScorecardBlock(card: AgentScorecard): string {
    const successRate =
      card.gradedSuccessRate !== null
        ? `${Math.round(card.gradedSuccessRate * 100)}% (${Math.round(
            card.gradedSuccessRate * card.gradedCount,
          )}/${card.gradedCount} graded runs; ${card.totalInvocations} total invocations)`
        : `n/a (0 graded runs; ${card.totalInvocations} total invocations)`;
    const verdicts =
      card.recentVerdicts.length > 0
        ? card.recentVerdicts
            .map(
              (v) =>
                `${v.succeeded ? 'COMPLETE' : 'FAILED'}${
                  v.taskId ? `(${v.taskId})` : ''
                }`,
            )
            .join(', ')
        : '(none graded yet)';
    return [
      `Measured scorecard for this agent (from graded orchestration runs):`,
      `- Reconciled success rate: ${successRate}`,
      `- Avg tokens/run: in=${fmtCount(card.avgInputTokens)} out=${fmtCount(
        card.avgOutputTokens,
      )} cacheRead=${fmtCount(
        card.avgCacheReadTokens,
      )} | total in=${fmtCount(card.totalInputTokens)} out=${fmtCount(
        card.totalOutputTokens,
      )} | avg cost ${fmtCost(card.avgCostUsd)} | avg duration ${fmtDuration(
        card.avgDurationMs,
      )} | avg tools ${fmtCount(card.avgToolCount)}`,
      `- Recent verdicts: ${verdicts}`,
      `Optimize explicitly to reduce token consumption and fix recurring failure patterns while preserving the agent's role, triggers, and frontmatter routing.`,
    ].join('\n');
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
      residency: 'resident',
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
    kind: SkillRegistryKind = 'skill',
  ): boolean {
    const row = this.registry.getBySlug(kind, slug);
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

/** Compact a nullable count/token average: `48.2k`, `210`, or `n/a`. */
function fmtCount(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/** Format a nullable USD cost: `$0.41` or `n/a`. */
function fmtCost(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  return `$${n.toFixed(2)}`;
}

/** Format a nullable duration in ms as `4m12s`, `9s`, or `n/a`. */
function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'n/a';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}
