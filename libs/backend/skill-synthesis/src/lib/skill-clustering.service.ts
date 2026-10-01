/**
 * SkillClusteringService — groups the skill pool by embedding similarity.
 *
 * Distinct from SkillClusterDedupService (which dedups a NEW embedding against
 * PROMOTED skills). This service clusters the pool itself so a group of
 * similar entries can be consolidated into one umbrella skill.
 *
 * Two entry points while the lifecycle rewrite lands:
 * - `partitionPool` — the lifecycle pool (candidates, pending-suggestion
 *   centroids, non-exempt promoted skills) split into clusters and orphans.
 * - `clusterCandidates` — the legacy candidate-only clustering, kept until its
 *   last caller (the curator's suggestion pass) is rewritten.
 *
 * Fail-open: when sqlite-vec is unavailable nothing is clustered — exactly like
 * the dedup guard — and `partitionPool` says so via `vecAvailable: false`.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { SKILL_SYNTHESIS_TOKENS } from './di/tokens';
import { SkillCandidateStore } from './skill-candidate.store';
import type { SkillSuggestionStore } from './skill-suggestion.store';
import { agglomerate } from './cosine-similarity';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSuggestionRow,
  SkillSynthesisSettings,
} from './types';

export interface SkillCandidateCluster {
  members: SkillCandidateRow[];
}

/**
 * One entry of the lifecycle pool, with the embedding it was clustered by.
 *
 * A `suggestion` is a pending suggestion; its embedding is the centroid of its
 * member candidates' embeddings and `memberIds` are those members' ids.
 */
export type PoolMember =
  | { kind: 'candidate'; row: SkillCandidateRow; embedding: Float32Array }
  | { kind: 'promoted'; row: SkillCandidateRow; embedding: Float32Array }
  | {
      kind: 'suggestion';
      row: SkillSuggestionRow;
      memberIds: string[];
      embedding: Float32Array;
    };

/** What the caller already knows must stay out of the pool. */
export interface PoolExclusions {
  /** Candidate ids that already belong to a suggestion (any status). */
  suggestionMemberIds: ReadonlySet<string>;
  /** Promoted skill slugs the user owns (authored / diverged) — never merged. */
  exemptSlugs: ReadonlySet<string>;
}

export interface PoolPartition {
  /** False when sqlite-vec is not loaded; every list is then empty. */
  vecAvailable: boolean;
  /** True when eligible candidates exceeded `suggestionMaxCandidates`. */
  truncated: boolean;
  /** Components of size >= `suggestionMinClusterSize`, in discovery order. */
  clusters: PoolMember[][];
  /** Embedded pool members that fell in no cluster. */
  orphans: PoolMember[];
  /** Pool entries skipped because no embedding could be read for them. */
  unembedded: number;
}

@injectable()
export class SkillClusteringService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE)
    private readonly suggestionStore: SkillSuggestionStore,
  ) {}

  /**
   * Partition the lifecycle pool into clusters and orphans.
   *
   * Pool, in discovery order (which fixes the component labels — see
   * `agglomerate`):
   * 1. `candidate` rows newest first, minus `exclusions.suggestionMemberIds`,
   *    capped at `suggestionMaxCandidates` (`truncated` when the cap bit);
   * 2. `pending` suggestions, embedded as the centroid of their members'
   *    embeddings (skipped when no member has one);
   * 3. `promoted` rows that are not pinned and not in `exclusions.exemptSlugs`.
   *
   * Similarity is single linkage at `> dedupClusterThreshold`.
   */
  partitionPool(
    settings: SkillSynthesisSettings,
    exclusions: PoolExclusions,
  ): PoolPartition {
    if (!this.vecStatus.available) {
      return {
        vecAvailable: false,
        truncated: false,
        clusters: [],
        orphans: [],
        unembedded: 0,
      };
    }

    const pool: PoolMember[] = [];
    let unembedded = 0;

    const eligible = this.store
      .listByStatus('candidate')
      .filter((row) => !exclusions.suggestionMemberIds.has(row.id));
    const cap = Math.max(1, settings.suggestionMaxCandidates);
    const truncated = eligible.length > cap;
    for (const row of eligible.slice(0, cap)) {
      const embedding = this.embeddingOf(row);
      if (embedding) pool.push({ kind: 'candidate', row, embedding });
      else unembedded++;
    }

    for (const row of this.suggestionStore.listByStatus('pending')) {
      const embedding = this.centroidOf(row);
      if (embedding) {
        pool.push({
          kind: 'suggestion',
          row,
          memberIds: [...row.memberCandidateIds],
          embedding,
        });
      } else {
        unembedded++;
      }
    }

    for (const row of this.store.listByStatus('promoted')) {
      if (row.pinned || exclusions.exemptSlugs.has(row.name)) continue;
      const embedding = this.embeddingOf(row);
      if (embedding) pool.push({ kind: 'promoted', row, embedding });
      else unembedded++;
    }

    const labels = agglomerate(
      pool.map((member) => member.embedding),
      settings.dedupClusterThreshold,
    );
    const components = new Map<number, PoolMember[]>();
    labels.forEach((label, i) => {
      const bucket = components.get(label);
      if (bucket) bucket.push(pool[i]);
      else components.set(label, [pool[i]]);
    });

    const clusters: PoolMember[][] = [];
    const orphans: PoolMember[] = [];
    for (const members of components.values()) {
      if (members.length >= settings.suggestionMinClusterSize) {
        clusters.push(members);
      } else {
        orphans.push(...members);
      }
    }

    this.logger.debug('[skill-synthesis] pool partition complete', {
      pool: pool.length,
      clusters: clusters.length,
      orphans: orphans.length,
      unembedded,
      truncated,
      minClusterSize: settings.suggestionMinClusterSize,
    });
    return { vecAvailable: true, truncated, clusters, orphans, unembedded };
  }

  /**
   * Cluster the most-recent candidate rows that carry an embedding and return
   * only clusters whose size is >= `suggestionMinClusterSize`. Threshold reuses
   * `dedupClusterThreshold` so "similar" means the same thing everywhere.
   */
  clusterCandidates(settings: SkillSynthesisSettings): SkillCandidateCluster[] {
    if (!this.vecStatus.available) return [];

    const recent = this.store
      .listByStatus('candidate')
      .slice(0, Math.max(1, settings.suggestionMaxCandidates));

    const rows: SkillCandidateRow[] = [];
    const embeddings: Float32Array[] = [];
    for (const row of recent) {
      if (row.embeddingRowid === null) continue;
      const vec = this.store.getEmbedding(row.embeddingRowid);
      if (!vec) continue;
      rows.push(row);
      embeddings.push(vec);
    }
    if (embeddings.length < settings.suggestionMinClusterSize) return [];

    const clusterOf = agglomerate(embeddings, settings.dedupClusterThreshold);
    const byCluster = new Map<number, SkillCandidateRow[]>();
    for (let i = 0; i < clusterOf.length; i++) {
      const cid = clusterOf[i];
      const bucket = byCluster.get(cid);
      if (bucket) bucket.push(rows[i]);
      else byCluster.set(cid, [rows[i]]);
    }

    const clusters: SkillCandidateCluster[] = [];
    for (const members of byCluster.values()) {
      if (members.length >= settings.suggestionMinClusterSize) {
        clusters.push({ members });
      }
    }

    this.logger.debug('[skill-synthesis] candidate clustering complete', {
      candidates: rows.length,
      clusters: clusters.length,
      minClusterSize: settings.suggestionMinClusterSize,
    });
    return clusters;
  }

  private embeddingOf(row: SkillCandidateRow): Float32Array | null {
    if (row.embeddingRowid === null) return null;
    return this.store.getEmbedding(row.embeddingRowid);
  }

  /**
   * Mean of the member candidates' embeddings. Members that are gone, carry no
   * embedding, or disagree with the first embedding's dimension are skipped;
   * `null` when none remains. Cosine similarity is scale-invariant, so the
   * mean needs no normalization. A dimension mismatch means the embedder
   * changed under stored rows, so it is warned once per suggestion.
   */
  private centroidOf(suggestion: SkillSuggestionRow): Float32Array | null {
    let sum: Float32Array | null = null;
    let count = 0;
    let mismatched = 0;
    for (const id of suggestion.memberCandidateIds) {
      const member = this.store.findById(id as CandidateId);
      if (!member) continue;
      const vec = this.embeddingOf(member);
      if (!vec) continue;
      if (sum === null) {
        sum = new Float32Array(vec.length);
      } else if (vec.length !== sum.length) {
        mismatched++;
        continue;
      }
      for (let d = 0; d < vec.length; d++) sum[d] += vec[d];
      count++;
    }
    if (mismatched > 0 && sum !== null) {
      this.logger.warn(
        '[skill-synthesis] suggestion centroid skipped members with a different embedding dimension',
        {
          suggestionId: suggestion.id,
          expectedDimension: sum.length,
          skipped: mismatched,
        },
      );
    }
    if (sum === null || count === 0) return null;
    for (let d = 0; d < sum.length; d++) sum[d] /= count;
    return sum;
  }
}
