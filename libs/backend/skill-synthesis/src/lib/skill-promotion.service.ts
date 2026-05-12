/**
 * SkillPromotionService — applies the promotion contract:
 *
 *  1. Threshold:  success_count >= settings.successesToPromote (default 3)
 *  2. Dedup:      cosine similarity to any active skill < dedup threshold
 *                 (default 0.85). If sqlite-vec is unavailable / no embedding
 *                 was stored at registration time, dedup degrades to a no-op
 *                 (architecture §11 Q-fallback).
 *  3. Cap:        active skills <= settings.maxActiveSkills (default 50);
 *                 over-cap → LRU eviction by activity score (least active
 *                 promoted skill is rejected with reason='lru-cap-eviction').
 *
 * Materializes SKILL.md at the active root and updates `body_path` on the row.
 */
import * as fs from 'node:fs';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillMdGenerator } from './skill-md-generator';
import { SkillClusterDedupService } from './skill-cluster-dedup.service';
import { SkillJudgeService } from './skill-judge.service';
import {
  SKILL_SYNTHESIS_TOKENS,
  INTERNAL_QUERY_SERVICE_TOKEN,
} from './di/tokens';
import type { IInternalQuery } from './internal-query.interface';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';
import { JUDGE_DEFAULT_MODEL_ID } from './types';

/**
 * Default model for the SKILL.md polish LLM call — single source of truth
 * from types.ts; mirrors `TIER_TO_MODEL_ID.haiku` in agent-sdk.
 */
const POLISH_MODEL_ID = JUDGE_DEFAULT_MODEL_ID;

/** Hard cap on a single polish LLM call — protects the synchronous promote RPC from a hung provider. */
const POLISH_TIMEOUT_MS = 30_000;

/** Lower bound on accepted polish output length — under this we discard and keep the raw body. */
const POLISH_MIN_LENGTH = 50;

export interface PromotionDecision {
  promoted: boolean;
  reason:
    | 'promoted'
    | 'below-threshold'
    | 'duplicate'
    | 'cap-rejected'
    | 'already-promoted'
    | 'already-rejected'
    | 'not-found'
    | 'below-judge-score';
  candidate: SkillCandidateRow | null;
  /** Filled when promotion evicted another skill via decay-cap. */
  evictedSkillId?: CandidateId;
  /** Cosine similarity of the closest active match (if dedup ran). */
  closestMatchSimilarity?: number;
  /** Absolute path to the materialized SKILL.md (set on success). */
  filePath?: string;
}

@injectable()
export class SkillPromotionService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SkillMdGenerator)
    private readonly mdGenerator: SkillMdGenerator,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTER_DEDUP_SERVICE, {
      isOptional: true,
    })
    private readonly clusterDedup: SkillClusterDedupService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, { isOptional: true })
    private readonly judge: SkillJudgeService | null,
  ) {}

  /**
   * Evaluate a candidate and promote it if all rules pass. Idempotent:
   * already-promoted candidates short-circuit with reason='already-promoted'.
   *
   * When InternalQueryService is available, the candidate body is polished via
   * a one-shot LLM query before materialization (R5: skipped silently when
   * InternalQueryService is not registered in the container).
   */
  async evaluate(
    candidateId: CandidateId,
    settings: SkillSynthesisSettings,
    nowFn: () => number = () => Date.now(),
  ): Promise<PromotionDecision> {
    const candidate = this.store.findById(candidateId);
    if (!candidate) {
      return { promoted: false, reason: 'not-found', candidate: null };
    }
    if (candidate.status === 'promoted') {
      return { promoted: false, reason: 'already-promoted', candidate };
    }
    if (candidate.status === 'rejected') {
      return { promoted: false, reason: 'already-rejected', candidate };
    }

    const dedupResult = this.checkDuplicate(
      candidate,
      settings.dedupCosineThreshold,
    );
    if (dedupResult.isDuplicate) {
      const updated = this.store.updateStatus(candidate.id, 'rejected', {
        reason: 'duplicate-of-active-skill',
      });
      return {
        promoted: false,
        reason: 'duplicate',
        candidate: updated,
        closestMatchSimilarity: dedupResult.similarity,
      };
    }

    // Check cross-context generalization — if candidate has been seen in enough
    // distinct contexts, use a halved promotion threshold (it's already proven
    // useful across different workspaces).
    const distinctContexts = this.store.countDistinctContexts(candidate.id);
    const effectiveSuccessThreshold =
      distinctContexts >= settings.generalizationContextThreshold
        ? Math.ceil(settings.successesToPromote / 2)
        : settings.successesToPromote;
    if (candidate.successCount < effectiveSuccessThreshold) {
      return { promoted: false, reason: 'below-threshold', candidate };
    }

    // Signal 4: Cluster-centroid dedup (after pairwise dedup check).
    if (this.clusterDedup && candidate.embeddingRowid !== null) {
      const probe = this.store.getEmbedding(candidate.embeddingRowid);
      if (probe && this.clusterDedup.isDuplicate(probe, settings)) {
        const updated = this.store.updateStatus(candidate.id, 'rejected', {
          reason: 'cluster-duplicate',
        });
        return { promoted: false, reason: 'duplicate', candidate: updated };
      }
    }

    // Signal 5: LLM-as-judge gate (runs before materialization).
    if (this.judge) {
      const body = this.readCandidateBody(candidate);
      const judgeDecision = await this.judge.judge(candidate, body, settings);
      if (!judgeDecision.passed) {
        this.logger.info('[skill-synthesis] judge rejected candidate', {
          candidateId: candidate.id,
          score: judgeDecision.score,
          minScore: settings.minJudgeScore,
        });
        // Persist the rejection so the status is durable (mirrors cluster-duplicate path).
        const rejected = this.store.updateStatus(candidate.id, 'rejected', {
          reason: 'below-judge-score',
        });
        return {
          promoted: false,
          reason: 'below-judge-score',
          candidate: rejected,
        };
      }
    }

    let evictedSkillId: CandidateId | undefined;
    // Decay-based eviction: only count unpinned promoted skills against the cap.
    // Pinned skills are exempt from both eviction and the cap count.
    const activeUnpinned = this.store.listActiveOrderedByDecayScore(
      nowFn(),
      settings.evictionDecayRate,
    );
    if (activeUnpinned.length >= settings.maxActiveSkills) {
      // Ascending decay score — first element has lowest score (least valuable).
      const weakest = activeUnpinned[0];
      this.store.updateStatus(weakest.id, 'rejected', {
        reason: 'decay-cap-eviction',
      });
      evictedSkillId = weakest.id;
      this.logger.info('[skill-synthesis] decay cap eviction', {
        evicted: weakest.id,
        evictedName: weakest.name,
        activeCount: activeUnpinned.length,
        cap: settings.maxActiveSkills,
      });
    }

    // Optionally polish the candidate body with a one-shot LLM query before
    // materializing — R5: silently skipped when InternalQueryService is absent.
    let body = this.readCandidateBody(candidate);
    if (this.internalQuery) {
      body = await this.polishBody(body, candidate.name, candidate.description);
    }

    // Re-materialize SKILL.md at the active root and capture the new body_path.
    let bodyPath = candidate.bodyPath;
    try {
      const md = this.mdGenerator.promoteToActive(
        {
          slug: candidate.name,
          description: candidate.description,
          body,
        },
        settings.candidatesDir,
      );
      bodyPath = md.filePath;
    } catch (err) {
      this.logger.warn(
        '[skill-synthesis] failed to materialize promoted SKILL.md (continuing with candidate body_path)',
        {
          candidate: candidate.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    const promoted = this.store.updateStatus(candidate.id, 'promoted', {
      promotedAt: nowFn(),
      bodyPath,
    });

    // Invalidate cluster cache so next promotion sees fresh clusters.
    this.clusterDedup?.invalidate();

    return {
      promoted: true,
      reason: 'promoted',
      candidate: promoted,
      evictedSkillId,
      closestMatchSimilarity: dedupResult.similarity,
      filePath: bodyPath,
    };
  }

  // ──────────────────────────────────────────────────────────────────

  private checkDuplicate(
    candidate: SkillCandidateRow,
    threshold: number,
  ): { isDuplicate: boolean; similarity: number } {
    if (candidate.embeddingRowid === null) {
      return { isDuplicate: false, similarity: 0 };
    }
    const probe = this.store.getEmbedding(candidate.embeddingRowid);
    if (!probe) return { isDuplicate: false, similarity: 0 };
    const matches = this.store.searchActiveByEmbedding(probe, 1);
    if (matches.length === 0) return { isDuplicate: false, similarity: 0 };
    const top = matches[0];
    return {
      isDuplicate: top.similarity >= threshold,
      similarity: top.similarity,
    };
  }

  /**
   * Use InternalQueryService to produce a polished SKILL.md body from a raw
   * draft. Non-fatal: on LLM failure, timeout, or output that fails the
   * structural sanity check, returns the input body unchanged.
   *
   * TASK_2026_THOTH_SKILL_LIFECYCLE — called at promotion time only.
   */
  private async polishBody(
    body: string,
    slug: string,
    description: string,
  ): Promise<string> {
    if (!this.internalQuery) return body;

    const systemPromptAppend = `You are a technical writer. Rewrite the SKILL.md body below as a clean, concise markdown document (no YAML frontmatter). Include exactly three sections:

## Description
(One paragraph describing what the skill does.)

## When to use
(2–4 bullet points listing situations where this skill applies.)

## Steps
(Numbered list of steps to apply the skill.)

Keep the total under 400 words. Preserve technical accuracy. Output only the body markdown — no frontmatter, no preamble.

Skill slug: ${slug}
Skill description: ${description}`;

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      POLISH_TIMEOUT_MS,
    );

    try {
      const handle = await this.internalQuery.execute({
        cwd: process.cwd(),
        model: POLISH_MODEL_ID,
        prompt: body,
        systemPromptAppend,
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

      const polished = collected.trim();
      if (!this.isValidPolishedBody(polished)) {
        this.logger.warn(
          '[skill-synthesis] polishBody: output failed structural check; using raw body',
          { slug, length: polished.length },
        );
        return body;
      }
      this.logger.debug('[skill-synthesis] polishBody succeeded', { slug });
      return polished;
    } catch (err: unknown) {
      this.logger.warn(
        '[skill-synthesis] polishBody: LLM call failed; using raw body',
        {
          slug,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return body;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Sanity-check the LLM polish output before accepting it. Rejects too-short
   * content, leaked YAML frontmatter, and outputs that don't include at least
   * one of the three required section headings.
   */
  private isValidPolishedBody(content: string): boolean {
    if (content.length <= POLISH_MIN_LENGTH) return false;
    if (content.startsWith('---')) return false; // leaked frontmatter
    return (
      content.includes('## Description') ||
      content.includes('## When to use') ||
      content.includes('## Steps')
    );
  }

  private readCandidateBody(candidate: SkillCandidateRow): string {
    try {
      if (fs.existsSync(candidate.bodyPath)) {
        const raw = fs.readFileSync(candidate.bodyPath, 'utf8');
        // Strip frontmatter — we re-emit it from candidate.name/description.
        const stripped = raw.replace(/^---[\s\S]*?---\s*/, '');
        return stripped.trim();
      }
    } catch (err) {
      this.logger.debug('[skill-synthesis] could not read candidate body', {
        bodyPath: candidate.bodyPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return `# ${candidate.name}\n\n${candidate.description}\n`;
  }
}
