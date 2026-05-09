/**
 * SkillClusterDedupService — cluster-centroid deduplication for promoted skills.
 *
 * Clusters promoted skill embeddings on first use (lazy), then checks whether
 * a new candidate embedding falls too close to any cluster centroid.
 *
 * Algorithm: single-linkage agglomerative clustering in O(n^2) over promoted
 * embeddings. Acceptable for the expected max of ~50 promoted skills.
 *
 * Guard: when sqlite-vec is not loaded there are no embeddings, so `isDuplicate`
 * always returns false (fail-open).
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from './skill-candidate.store';
import { cosineSimilarity } from './cosine-similarity';
import type { SkillSynthesisSettings } from './types';

@injectable()
export class SkillClusterDedupService {
  private clusters: Float32Array[] | null = null; // centroid per cluster

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
  ) {}

  /**
   * Check whether `embedding` is a duplicate of an existing cluster centroid.
   * Returns false if sqlite-vec is not loaded or no clusters have been built.
   *
   * Per spec: reject if cosine DISTANCE < dedupClusterThreshold, i.e.
   *   cosineSimilarity > (1 - dedupClusterThreshold).
   */
  isDuplicate(
    embedding: Float32Array,
    settings: SkillSynthesisSettings,
  ): boolean {
    if (!this.connection.vecExtensionLoaded) return false;
    if (this.clusters === null) {
      this.buildClusters();
    }
    if (!this.clusters || this.clusters.length === 0) return false;

    const similarityThreshold = 1 - settings.dedupClusterThreshold;
    for (const centroid of this.clusters) {
      const sim = cosineSimilarity(embedding, centroid);
      if (sim > similarityThreshold) {
        this.logger.debug(
          '[skill-synthesis] cluster dedup: duplicate detected',
          {
            similarity: sim,
            threshold: similarityThreshold,
          },
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Rebuild clusters from all current promoted skill embeddings.
   * Called lazily on first `isDuplicate` call and after each promotion.
   */
  buildClusters(): void {
    if (!this.connection.vecExtensionLoaded) return;

    const promoted = this.store.listByStatus('promoted');
    if (promoted.length === 0) {
      this.clusters = [];
      return;
    }

    // Collect embeddings for promoted skills.
    const embeddings: Float32Array[] = [];
    for (const row of promoted) {
      if (row.embeddingRowid === null) continue;
      const vec = this.store.getEmbedding(row.embeddingRowid);
      if (vec) embeddings.push(vec);
    }
    if (embeddings.length === 0) {
      this.clusters = [];
      return;
    }

    // Single-linkage agglomerative clustering.
    // Each embedding starts in its own cluster (represented by index).
    const clusterOf: number[] = embeddings.map((_, i) => i);
    const MERGE_THRESHOLD = 0.8; // cosine distance threshold for single-linkage merge

    // Merge clusters where min pairwise cosine distance < MERGE_THRESHOLD.
    let merged = true;
    while (merged) {
      merged = false;
      const clusterIds = [...new Set(clusterOf)];
      outer: for (let ci = 0; ci < clusterIds.length; ci++) {
        for (let cj = ci + 1; cj < clusterIds.length; cj++) {
          const membersI = clusterOf
            .map((c, idx) => (c === clusterIds[ci] ? idx : -1))
            .filter((idx) => idx >= 0);
          const membersJ = clusterOf
            .map((c, idx) => (c === clusterIds[cj] ? idx : -1))
            .filter((idx) => idx >= 0);

          // Single-linkage: find min distance between any pair across clusters.
          let minDist = Infinity;
          for (const i of membersI) {
            for (const j of membersJ) {
              const dist = 1 - cosineSimilarity(embeddings[i], embeddings[j]);
              if (dist < minDist) minDist = dist;
            }
          }

          if (minDist < MERGE_THRESHOLD) {
            // Merge cj into ci.
            const targetId = clusterIds[ci];
            const sourceId = clusterIds[cj];
            for (let k = 0; k < clusterOf.length; k++) {
              if (clusterOf[k] === sourceId) clusterOf[k] = targetId;
            }
            merged = true;
            break outer;
          }
        }
      }
    }

    // Compute centroid for each final cluster.
    const finalClusterIds = [...new Set(clusterOf)];
    this.clusters = [];
    for (const cid of finalClusterIds) {
      const members = clusterOf
        .map((c, idx) => (c === cid ? idx : -1))
        .filter((idx) => idx >= 0);
      const dim = embeddings[members[0]].length;
      const centroid = new Float32Array(dim);
      for (const idx of members) {
        const vec = embeddings[idx];
        for (let d = 0; d < dim; d++) {
          centroid[d] += vec[d];
        }
      }
      for (let d = 0; d < dim; d++) {
        centroid[d] /= members.length;
      }
      this.clusters.push(centroid);
    }

    this.logger.debug('[skill-synthesis] cluster dedup: clusters rebuilt', {
      embeddingCount: embeddings.length,
      clusterCount: this.clusters.length,
    });
  }

  /** Invalidate the cached clusters so they are rebuilt on next use. */
  invalidate(): void {
    this.clusters = null;
  }
}
