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
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillMdGenerator } from './skill-md-generator';
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
    | 'not-found';
  candidate: SkillCandidateRow | null;
  /** Filled when promotion evicted another skill via LRU. */
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
  ) {}

  /**
   * Evaluate a candidate and promote it if all rules pass. Idempotent:
   * already-promoted candidates short-circuit with reason='already-promoted'.
   */
  evaluate(
    candidateId: CandidateId,
    settings: SkillSynthesisSettings,
    nowFn: () => number = () => Date.now(),
  ): PromotionDecision {
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
    if (candidate.successCount < settings.successesToPromote) {
      return { promoted: false, reason: 'below-threshold', candidate };
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

    let evictedSkillId: CandidateId | undefined;
    const active = this.store.listActiveOrderedByActivity(nowFn());
    if (active.length >= settings.maxActiveSkills) {
      // The activity-ordered list is most-active-first; the tail is LRU.
      const lru = active[active.length - 1];
      this.store.updateStatus(lru.id, 'rejected', {
        reason: 'lru-cap-eviction',
      });
      evictedSkillId = lru.id;
      this.logger.info('[skill-synthesis] LRU cap eviction', {
        evicted: lru.id,
        evictedName: lru.name,
        activeCount: active.length,
        cap: settings.maxActiveSkills,
      });
    }

    // Re-materialize SKILL.md at the active root and capture the new body_path.
    let bodyPath = candidate.bodyPath;
    try {
      const md = this.mdGenerator.promoteToActive(
        {
          slug: candidate.name,
          description: candidate.description,
          body: this.readCandidateBody(candidate),
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

  private readCandidateBody(candidate: SkillCandidateRow): string {
    try {
      // Lazy require to avoid pulling fs into test seams unnecessarily.
      const fs = require('node:fs') as typeof import('node:fs');
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
