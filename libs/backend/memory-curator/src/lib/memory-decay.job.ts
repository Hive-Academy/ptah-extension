/**
 * MemoryDecayJob — periodic salience recompute + tier transitions.
 *
 * Tier rules (architecture §8.5):
 *   - recall → core     when hits >= 10 AND salience >= 0.9 (frequency-gated)
 *   - core   → recall   when pinned=0 AND salience < 0.5
 *   - recall → archival when salience < 0.1 AND age(last_used) > halflife
 *
 * The `recall → core` rule is the ONE exception to "never auto-promotes":
 * the decay job owns hit-based promotion for frequently-used memories, while
 * the curator still owns tier assignment at write-time.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryStore } from './memory.store';
import { SalienceScorer } from './salience-scorer';
import { MemoryCuratorService } from './memory-curator.service';
import type { MemoryTier } from './memory.types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Min hit count for a `recall` memory to be promoted back to `core`. */
const PROMOTE_HITS_THRESHOLD = 10;
/** Min recomputed salience for a `recall` memory to be promoted to `core`. */
const PROMOTE_SALIENCE_THRESHOLD = 0.9;

export interface DecayJobOptions {
  readonly halflifeDays: number;
  readonly nowMs?: number;
}

export interface DecayRunStats {
  readonly scanned: number;
  readonly promoted: number;
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
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
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
    let promoted = 0;
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
        m.hits >= PROMOTE_HITS_THRESHOLD &&
        newSalience >= PROMOTE_SALIENCE_THRESHOLD
      ) {
        nextTier = 'core';
        promoted++;
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
      promoted,
      demoted,
      archived,
      expired,
    });
    const stats: DecayRunStats = {
      scanned: memories.length,
      promoted,
      demoted,
      archived,
      expired,
    };
    this.lastDecayAt = Date.now();
    this.lastDecayStats = stats;
    try {
      this.curator.recordDecayEvent(
        {
          scanned: stats.scanned,
          promoted: stats.promoted,
          demoted: stats.demoted,
          archived: stats.archived,
          expired: stats.expired,
        },
        this.lastDecayAt,
      );
    } catch (err: unknown) {
      this.logger.warn('[memory-curator] failed to record decay event', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return stats;
  }
}
