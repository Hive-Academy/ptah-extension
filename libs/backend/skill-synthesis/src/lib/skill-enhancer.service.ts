import * as os from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { unjudgedVerdictFields } from './types';
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

/**
 * How long a generated-but-unapplied proposal stays redeemable. Long enough to
 * read a full diff, short enough that the clone on disk cannot have drifted far
 * underneath it.
 */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;
/** Hard cap on cached proposals; oldest is evicted first (insertion order). */
export const MAX_CACHED_PROPOSALS = 20;

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

/**
 * A generated-and-judged improvement that has NOT been written to disk. Held
 * in memory only (never persisted) and redeemable exactly once via
 * {@link SkillEnhancerService.applyProposal}.
 */
export interface EnhancementProposal {
  readonly proposalId: string;
  readonly slug: string;
  readonly kind: SkillRegistryKind;
  readonly currentBody: string;
  readonly proposedBody: string;
  readonly judgeScore: number | null;
  readonly judgeReason: string | null;
  readonly createdAt: number;
}

/**
 * Outcome of the read-only half of enhancement. `proposed: true` guarantees
 * `proposalId` / `currentBody` / `proposedBody` are non-null. On a skip the
 * bodies and judge fields are still filled in wherever they are known, so the
 * caller can show *why* a candidate was rejected next to the rejected diff.
 */
export interface GenerateProposalResult {
  proposed: boolean;
  slug: string;
  kind: SkillRegistryKind;
  currentBody: string | null;
  proposedBody: string | null;
  judgeScore: number | null;
  judgeReason: string | null;
  proposalId: string | null;
  skipReason?: EnhanceSkipReason;
}

/** Outcome of the write half of enhancement. */
export interface ApplyProposalResult {
  applied: boolean;
  slug: string;
  kind: SkillRegistryKind;
  judgeScore: number | null;
  judgeReason: string | null;
  historyTs: string | null;
}

/** Why a `proposalId` could not be redeemed. */
export type ProposalRejectionCode = 'not-found' | 'expired' | 'mismatch';

/**
 * Thrown by {@link SkillEnhancerService.applyProposal} when the id does not
 * resolve to a live proposal for the requested `(kind, slug)`. Callers MUST
 * surface this rather than silently regenerating — re-running the LLM would
 * apply a body the user never previewed.
 */
export class ProposalNotFoundError extends Error {
  constructor(
    readonly code: ProposalRejectionCode,
    readonly proposalId: string,
  ) {
    super(`Enhancement proposal ${code}: ${proposalId}`);
    this.name = 'ProposalNotFoundError';
  }
}

@injectable()
export class SkillEnhancerService {
  /**
   * Generated-but-unapplied proposals, keyed by opaque `proposalId`. In-memory
   * only and process-local: a restart simply invalidates outstanding previews,
   * which is the safe failure mode (Apply re-previews instead of writing a
   * body nobody saw).
   */
  private readonly proposals = new Map<string, EnhancementProposal>();

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

  /**
   * Generate + judge an improvement WITHOUT touching disk.
   *
   * Runs every gate the write path runs (eligibility, cooldown, generation,
   * judge verdict, frontmatter validation) and stops immediately before the
   * snapshot/write. A proposal that clears all gates is parked in the
   * in-memory cache and its opaque `proposalId` returned; redeem it with
   * {@link applyProposal}. Fail-soft: never throws, mirroring `enhance`.
   */
  async generateProposal(
    slug: string,
    settings: SkillSynthesisSettings,
    options: EnhanceOptions = {},
  ): Promise<GenerateProposalResult> {
    const kind: SkillRegistryKind = options.kind ?? 'skill';
    const base: GenerateProposalResult = {
      proposed: false,
      slug,
      kind,
      currentBody: null,
      proposedBody: null,
      judgeScore: null,
      judgeReason: null,
      proposalId: null,
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
        return { ...base, currentBody, skipReason: 'empty-candidate' };
      }

      if (candidateBody.trim() === currentBody.trim()) {
        this.logger.info(
          '[skill-enhancer] candidate identical to clone; skip',
          {
            slug,
            kind,
          },
        );
        return { ...base, currentBody, skipReason: 'no-change' };
      }

      const decision = await this.judge.judge(
        this.synthRow(slug, currentBody),
        candidateBody,
        settings,
        scorecardBlock ?? undefined,
      );

      const judged: GenerateProposalResult = {
        ...base,
        currentBody,
        proposedBody: candidateBody,
        judgeScore: decision.score,
        judgeReason: decision.reason,
      };

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
        return { ...judged, skipReason: 'judge-rejected' };
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
        return { ...judged, skipReason: 'invalid-candidate' };
      }

      if (
        !this.requiresFrontmatter(kind) &&
        candidateBody.trim().length === 0
      ) {
        return { ...judged, skipReason: 'invalid-candidate' };
      }

      const proposal: EnhancementProposal = {
        proposalId: randomUUID(),
        slug,
        kind,
        currentBody,
        proposedBody: candidateBody,
        judgeScore: decision.score,
        judgeReason: decision.reason,
        createdAt: Date.now(),
      };
      this.cacheProposal(proposal);

      return { ...judged, proposed: true, proposalId: proposal.proposalId };
    } catch (error: unknown) {
      this.logger.warn('[skill-enhancer] proposal generation failed', {
        slug,
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...base, skipReason: 'error' };
    }
  }

  /**
   * Redeem a previously generated proposal: snapshot the clone to history,
   * write the exact previewed body, refresh the sidecar, and re-propagate.
   *
   * Consumes the cache entry, so a `proposalId` applies at most once. Throws
   * {@link ProposalNotFoundError} on an unknown / expired id or when
   * `(kind, slug)` do not match the cached proposal — never regenerates.
   */
  async applyProposal(
    kind: SkillRegistryKind,
    slug: string,
    proposalId: string,
  ): Promise<ApplyProposalResult> {
    const proposal = this.takeProposal(kind, slug, proposalId);

    const written: WriteEnhancedResult =
      proposal.kind === 'skill'
        ? await this.mirror.writeEnhancedSkill({
            slug: proposal.slug,
            newBody: proposal.proposedBody,
          })
        : await this.mirror.writeEnhancedFileClone({
            kind: proposal.kind,
            slug: proposal.slug,
            newBody: proposal.proposedBody,
          });

    this.registry.markEnhanced(
      proposal.kind,
      proposal.slug,
      Date.now(),
      written.currentContentHash,
    );

    await this.repropagate(proposal.slug, proposal.kind);

    this.logger.info('[skill-enhancer] clone enhanced', {
      slug: proposal.slug,
      kind: proposal.kind,
      judgeScore: proposal.judgeScore,
      judgeReason: proposal.judgeReason,
      historyTs: written.historyTs,
    });

    return {
      applied: true,
      slug: proposal.slug,
      kind: proposal.kind,
      judgeScore: proposal.judgeScore,
      judgeReason: proposal.judgeReason,
      historyTs: written.historyTs,
    };
  }

  /**
   * One-shot enhancement: generate, judge, and write in a single pass.
   *
   * Thin compose of {@link generateProposal} + {@link applyProposal} — the
   * auto-enhance path and `skillSynthesis:enhanceNow` keep their exact prior
   * behaviour, including fail-soft error handling.
   */
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
      const proposal = await this.generateProposal(slug, settings, options);
      if (!proposal.proposed || proposal.proposalId === null) {
        return {
          ...base,
          judgeScore: proposal.judgeScore,
          judgeReason: proposal.judgeReason,
          skipReason: proposal.skipReason ?? 'error',
        };
      }

      const applied = await this.applyProposal(kind, slug, proposal.proposalId);

      return {
        changed: true,
        slug,
        kind,
        judgeScore: applied.judgeScore,
        judgeReason: applied.judgeReason,
        historyTs: applied.historyTs,
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

  /** Park a proposal, pruning expired entries and capping total size. */
  private cacheProposal(proposal: EnhancementProposal): void {
    this.pruneProposals();
    while (this.proposals.size >= MAX_CACHED_PROPOSALS) {
      // Map iterates in insertion order → first key is the oldest proposal.
      const oldest = this.proposals.keys().next();
      if (oldest.done) break;
      this.proposals.delete(oldest.value);
    }
    this.proposals.set(proposal.proposalId, proposal);
  }

  /** Drop every proposal past {@link PROPOSAL_TTL_MS}. */
  private pruneProposals(): void {
    const cutoff = Date.now() - PROPOSAL_TTL_MS;
    for (const [id, proposal] of this.proposals) {
      if (proposal.createdAt <= cutoff) {
        this.proposals.delete(id);
      }
    }
  }

  /**
   * Resolve and consume a proposal, asserting it belongs to `(kind, slug)`.
   * Removal happens before the write so a failed apply cannot be retried
   * against a clone whose on-disk state is now unknown.
   */
  private takeProposal(
    kind: SkillRegistryKind,
    slug: string,
    proposalId: string,
  ): EnhancementProposal {
    this.pruneProposals();
    const proposal = this.proposals.get(proposalId);
    if (!proposal) {
      throw new ProposalNotFoundError('not-found', proposalId);
    }
    if (proposal.kind !== kind || proposal.slug !== slug) {
      throw new ProposalNotFoundError('mismatch', proposalId);
    }
    this.proposals.delete(proposalId);
    return proposal;
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
      ...unjudgedVerdictFields(),
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
