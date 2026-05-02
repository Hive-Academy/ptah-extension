/**
 * Pure salience scoring (TASK_2026_HERMES Track 1, §8.5).
 *
 * `salience = base + 0.4*recency + 0.3*hits_decayed + 0.2*pinned + 0.1*tier_bias`
 *
 * Stateless. No DI. Used by the curator at write-time and the decay job
 * at sweep-time.
 */
import { injectable } from 'tsyringe';
import type { Memory, MemoryTier } from './memory.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TIER_BIAS: Record<MemoryTier, number> = {
  core: 1.0,
  recall: 0.5,
  archival: 0.0,
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
    const halflife = Math.max(0.5, inputs.halflifeDays ?? 7);
    const ageDays = Math.max(0, (inputs.now - inputs.lastUsedAt) / MS_PER_DAY);
    // exp(-ln(2) * age / halflife) — value in (0, 1]
    const recency = Math.exp((-Math.LN2 * ageDays) / halflife);
    // saturating: 1 - exp(-hits/5) keeps it in [0, 1)
    const hitsDecayed = 1 - Math.exp(-inputs.hits / 5);
    const pinned = inputs.pinned ? 1 : 0;
    const tierBias = TIER_BIAS[inputs.tier];
    const score =
      Math.max(0, Math.min(1, inputs.base)) +
      0.4 * recency +
      0.3 * hitsDecayed +
      0.2 * pinned +
      0.1 * tierBias;
    return Number(score.toFixed(6));
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
