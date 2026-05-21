/**
 * MemoryDecayJob — periodic salience recompute + tier transitions.
 *
 * Tier rules (architecture §8.5):
 *   - core   → recall   when pinned=0 AND salience < 0.5
 *   - recall → archival when salience < 0.1 AND age(last_used) > halflife
 *   - never auto-promotes; that's the curator's job at write-time.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import { SalienceScorer } from './salience-scorer';
import type { MemoryTier } from './memory.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DecayJobOptions {
  readonly halflifeDays: number;
  readonly nowMs?: number;
}

export interface DecayRunStats {
  readonly scanned: number;
  readonly demoted: number;
  readonly archived: number;
  readonly expired: number;
}

@injectable()
export class MemoryDecayJob {
  private lastDecayAt: number | null = null;
  private lastDecayStats: DecayRunStats | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.MEMORY_SALIENCE_SCORER)
    private readonly scorer: SalienceScorer,
  ) {}

  lastDecayInfo(): {
    readonly at: number | null;
    readonly stats: DecayRunStats | null;
  } {
    return { at: this.lastDecayAt, stats: this.lastDecayStats };
  }

  async run(options: DecayJobOptions): Promise<DecayRunStats> {
    const now = options.nowMs ?? Date.now();
    const halflifeMs = Math.max(1, options.halflifeDays) * MS_PER_DAY;
    let demoted = 0;
    let archived = 0;
    let expired = 0;

    const memories = this.store.all();
    for (const m of memories) {
      if (m.expiresAt !== null && now > m.expiresAt) {
        this.store.forget(m.id);
        expired++;
        continue;
      }

      const newSalience = this.scorer.scoreMemory(m, now, options.halflifeDays);
      let nextTier: MemoryTier = m.tier;
      const ageMs = now - m.lastUsedAt;
      if (m.tier === 'core' && !m.pinned && newSalience < 0.5) {
        nextTier = 'recall';
        demoted++;
      } else if (
        m.tier === 'recall' &&
        newSalience < 0.1 &&
        ageMs > halflifeMs
      ) {
        nextTier = 'archival';
        archived++;
      }

      if (nextTier !== m.tier || newSalience !== m.salience) {
        this.store.updateSalience(
          m.id,
          newSalience,
          nextTier !== m.tier ? nextTier : undefined,
        );
      }
    }

    this.logger.info('[memory-curator] decay sweep complete', {
      scanned: memories.length,
      demoted,
      archived,
      expired,
    });
    const stats: DecayRunStats = {
      scanned: memories.length,
      demoted,
      archived,
      expired,
    };
    this.lastDecayAt = Date.now();
    this.lastDecayStats = stats;
    return stats;
  }
}
