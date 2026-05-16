/**
 * Pure salience scoring.
 *
 * `salience = base + 0.4*recency + 0.3*hits_decayed + 0.2*pinned + 0.1*tier_bias`
 *
 * Stateless. No DI. Used by the curator at write-time and the decay job
 * at sweep-time.
 */
import { injectable } from 'tsyringe';
import type { Memory, MemoryTier } from './memory.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Architecture §8.5 — `tier_bias = {core:1, recall:0.5, archival:0.1}`.
const TIER_BIAS: Record<MemoryTier, number> = {
  core: 1.0,
  recall: 0.5,
  archival: 0.1,
};

export interface ScoreInputs {
  readonly base: number;
  readonly tier: MemoryTier;
  readonly pinned: boolean;
  readonly hits: number;
  /** epoch ms */
  readonly lastUsedAt: number;
  /** epoch ms */
  readonly now: number;
  /** Decay halflife in days (default 7). */
  readonly halflifeDays?: number;
}

@injectable()
export class SalienceScorer {
  /**
   * Compute the composite salience score per architecture §8.5.
   */
  score(inputs: ScoreInputs): number {
    // Architecture §8.5:
    //   salience = base + 0.4*recency + 0.3*hits_decayed + 0.2*pinned + 0.1*tier_bias
    //   recency      = exp(-Δt / halflife)
    //   hits_decayed = log(1 + hits) * recency
    //   tier_bias    = {core:1, recall:0.5, archival:0.1}
    //   Pinned memories floor at salience = 1.0.
    const halflife = Math.max(0.5, inputs.halflifeDays ?? 7);
    const ageDays = Math.max(0, (inputs.now - inputs.lastUsedAt) / MS_PER_DAY);
    const recency = Math.exp(-ageDays / halflife);
    const hitsDecayed = Math.log(1 + Math.max(0, inputs.hits)) * recency;
    const pinned = inputs.pinned ? 1 : 0;
    const tierBias = TIER_BIAS[inputs.tier];
    const raw =
      Math.max(0, Math.min(1, inputs.base)) +
      0.4 * recency +
      0.3 * hitsDecayed +
      0.2 * pinned +
      0.1 * tierBias;
    // Pinned memories floor at 1.0 (spec §8.5).
    const floored = inputs.pinned ? Math.max(1.0, raw) : raw;
    return Number(floored.toFixed(6));
  }

  /** Convenience: score a Memory row in-place using its own fields. */
  scoreMemory(
    memory: Pick<
      Memory,
      'tier' | 'pinned' | 'hits' | 'lastUsedAt' | 'salience'
    >,
    now: number,
    halflifeDays?: number,
  ): number {
    return this.score({
      base: memory.salience,
      tier: memory.tier,
      pinned: memory.pinned,
      hits: memory.hits,
      lastUsedAt: memory.lastUsedAt,
      now,
      halflifeDays,
    });
  }
}
