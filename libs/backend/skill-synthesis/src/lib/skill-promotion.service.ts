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
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';

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
    const distinctContexts = this.store.countDistinctContexts(candidate.id);
    const effectiveSuccessThreshold =
      distinctContexts >= settings.generalizationContextThreshold
        ? Math.ceil(settings.successesToPromote / 2)
        : settings.successesToPromote;
    if (candidate.successCount < effectiveSuccessThreshold) {
      return { promoted: false, reason: 'below-threshold', candidate };
    }
    if (this.clusterDedup && candidate.embeddingRowid !== null) {
      const probe = this.store.getEmbedding(candidate.embeddingRowid);
      if (probe && this.clusterDedup.isDuplicate(probe, settings)) {
        const updated = this.store.updateStatus(candidate.id, 'rejected', {
          reason: 'cluster-duplicate',
        });
        return { promoted: false, reason: 'duplicate', candidate: updated };
      }
    }
    if (this.judge) {
      const body = this.readCandidateBody(candidate);
      const judgeDecision = await this.judge.judge(candidate, body, settings);
      if (!judgeDecision.passed) {
        this.logger.info('[skill-synthesis] judge rejected candidate', {
          candidateId: candidate.id,
          score: judgeDecision.score,
          minScore: settings.minJudgeScore,
        });
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
    const activeUnpinned = this.store.listActiveOrderedByDecayScore(
      nowFn(),
      settings.evictionDecayRate,
    );
    if (activeUnpinned.length >= settings.maxActiveSkills) {
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
    const body = this.readCandidateBody(candidate);
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

  private readCandidateBody(candidate: SkillCandidateRow): string {
    try {
      if (fs.existsSync(candidate.bodyPath)) {
        const raw = fs.readFileSync(candidate.bodyPath, 'utf8');
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
