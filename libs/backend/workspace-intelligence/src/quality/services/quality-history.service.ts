/**
 * Quality History Service
 *
 * Stores quality assessment snapshots in VS Code globalState for
 * historical trend analysis. Maintains a rolling window of entries
 * with oldest-first eviction when the maximum limit is reached.
 *
 * Storage key: `ptah.quality.history`
 * Maximum entries: 100
 * Entry ordering: Newest first
 *
 * TASK_2025_144: Phase G - Reporting and Visualization
 *
 * @packageDocumentation
 */

import { injectable, inject } from 'tsyringe';
import type {
  QualityAssessment,
  QualityHistoryEntry,
} from '@ptah-extension/shared';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type { IQualityHistoryService } from '../interfaces';

// ============================================
// Constants
// ============================================

/**
 * GlobalState key for quality history storage.
 * Stores an array of QualityHistoryEntry objects.
 */
const STORAGE_KEY = 'ptah.quality.history';

/**
 * Maximum number of history entries to retain.
 * When exceeded, oldest entries are evicted first.
 */
const MAX_ENTRIES = 100;

/**
 * Default number of history entries to return when no limit is specified.
 */
const DEFAULT_LIMIT = 30;

// ============================================
// Service Implementation
// ============================================

/**
 * QualityHistoryService
 *
 * Persists quality assessment snapshots for trend analysis using
 * VS Code ExtensionContext.globalState (Memento) for cross-session
 * persistence.
 *
 * Each entry is compact (~200 bytes) containing only aggregated data:
 * - Timestamp, score, pattern count, files analyzed
 * - Category counts (grouped by anti-pattern type prefix)
 *
 * Maximum storage: 100 entries * ~200 bytes = ~20KB (well within globalState limits)
 *
 * Design Pattern: Repository Pattern (persistence abstraction)
 * SOLID: Single Responsibility (history persistence only)
 */
@injectable()
export class QualityHistoryService implements IQualityHistoryService {
  /**
   * Creates a new QualityHistoryService.
   *
   * @param logger - Logger for diagnostic output
   * @param globalState - VS Code Memento for persistent storage
   */
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.STATE_STORAGE)
    private readonly globalState: IStateStorage
  ) {
    this.logger.debug('QualityHistoryService initialized');
  }

  /**
   * Record a new assessment snapshot in history.
   *
   * Creates a compact QualityHistoryEntry from the full assessment,
   * prepends it (newest first), and enforces the MAX_ENTRIES limit
   * by evicting the oldest entries.
   *
   * @param assessment - Quality assessment to record
   */
  async recordAssessment(assessment: QualityAssessment): Promise<void> {
    try {
      const entry = this.createHistoryEntry(assessment);
      const entries = this.readEntries();

      // Prepend new entry (newest first)
      entries.unshift(entry);

      // Evict oldest entries if over limit
      if (entries.length > MAX_ENTRIES) {
        const evicted = entries.length - MAX_ENTRIES;
        entries.length = MAX_ENTRIES;
        this.logger.debug('Quality history entries evicted', {
          evicted,
          remaining: MAX_ENTRIES,
        });
      }

      await this.writeEntries(entries);

      this.logger.debug('Quality assessment recorded in history', {
        score: entry.score,
        patternCount: entry.patternCount,
        filesAnalyzed: entry.filesAnalyzed,
        totalEntries: entries.length,
      });
    } catch (error) {
      this.logger.error('Failed to record assessment in history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get history entries ordered newest first.
   *
   * @param limit - Maximum number of entries to return (default: 30)
   * @returns Array of history entries, newest first
   */
  getHistory(limit: number = DEFAULT_LIMIT): QualityHistoryEntry[] {
    try {
      const entries = this.readEntries();
      const effectiveLimit = Math.max(1, Math.min(limit, MAX_ENTRIES));
      return entries.slice(0, effectiveLimit);
    } catch (error) {
      this.logger.error('Failed to read quality history', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Clear all history entries.
   *
   * Removes all stored history from globalState.
   */
  async clearHistory(): Promise<void> {
    try {
      await this.writeEntries([]);
      this.logger.debug('Quality history cleared');
    } catch (error) {
      this.logger.error('Failed to clear quality history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Creates a compact history entry from a full assessment.
   *
   * Extracts only aggregated data to keep storage compact.
   * Category counts are derived by extracting the category prefix
   * from each anti-pattern type (e.g., 'typescript' from 'typescript-explicit-any').
   *
   * @param assessment - Full quality assessment
   * @returns Compact history entry
   */
  private createHistoryEntry(
    assessment: QualityAssessment
  ): QualityHistoryEntry {
    // Build category counts from anti-patterns
    const categoryCounts: Record<string, number> = {};

    for (const pattern of assessment.antiPatterns) {
      // Extract category prefix (e.g., 'typescript' from 'typescript-explicit-any')
      const category = pattern.type.split('-')[0];
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
    }

    return {
      timestamp: assessment.analysisTimestamp || Date.now(),
      score: assessment.score,
      patternCount: assessment.antiPatterns.length,
      filesAnalyzed: assessment.sampledFiles.length,
      categoryCounts,
    };
  }

  /**
   * Read entries from globalState.
   *
   * Returns an empty array if no entries exist or if stored data
   * is not a valid array.
   *
   * @returns Array of history entries
   */
  private readEntries(): QualityHistoryEntry[] {
    const stored = this.globalState.get<QualityHistoryEntry[]>(STORAGE_KEY, []);

    // Validate stored data is an array
    if (!Array.isArray(stored)) {
      this.logger.warn('Quality history storage corrupted, resetting', {
        storedType: typeof stored,
      });
      return [];
    }

    return stored;
  }

  /**
   * Write entries to globalState.
   *
   * @param entries - Array of history entries to persist
   */
  private async writeEntries(entries: QualityHistoryEntry[]): Promise<void> {
    await this.globalState.update(STORAGE_KEY, entries);
  }
}
