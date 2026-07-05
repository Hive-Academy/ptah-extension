/**
 * SkillClusteringService — groups recent skill CANDIDATES by embedding
 * similarity for cluster-based suggestion synthesis.
 *
 * Distinct from SkillClusterDedupService (which dedups a NEW embedding against
 * PROMOTED skills). This service clusters the candidate pool itself so a group
 * of similar recent sessions can PROPOSE one reusable skill.
 *
 * Fail-open: when sqlite-vec is unavailable or no candidates carry embeddings,
 * returns an empty list — exactly like the dedup guard.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from './skill-candidate.store';
import { agglomerate } from './cosine-similarity';
import type { SkillCandidateRow, SkillSynthesisSettings } from './types';

export interface SkillCandidateCluster {
  members: SkillCandidateRow[];
}

@injectable()
export class SkillClusteringService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
    @inject(SkillCandidateStore)
    private readonly store: SkillCandidateStore,
  ) {}

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
}
