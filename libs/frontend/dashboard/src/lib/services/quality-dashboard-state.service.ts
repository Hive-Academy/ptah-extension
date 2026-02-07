import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  ProjectIntelligence,
  QualityHistoryEntry,
  QualityGetAssessmentParams,
  QualityGetHistoryParams,
  QualityExportParams,
  QualityExportResult,
} from '@ptah-extension/shared';

/**
 * QualityDashboardStateService
 *
 * Signal-based state service for the quality dashboard.
 * Manages loading/error states and communicates with the backend
 * via RPC methods registered in Batch 3a (TASK_2025_144).
 *
 * Responsibilities:
 * - Load quality assessment data from backend
 * - Load quality history for trend visualization
 * - Export quality reports in multiple formats
 * - Expose all state as readonly Angular signals
 */
@Injectable({ providedIn: 'root' })
export class QualityDashboardStateService {
  private readonly rpc = inject(ClaudeRpcService);

  // Private writable signals
  private readonly _intelligence = signal<ProjectIntelligence | null>(null);
  private readonly _history = signal<QualityHistoryEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly intelligence = this._intelligence.asReadonly();
  readonly history = this._history.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /**
   * Load quality assessment from backend via RPC.
   * Sets loading/error states appropriately.
   *
   * @param forceRefresh - If true, bypasses backend cache and runs fresh analysis
   */
  async loadAssessment(forceRefresh = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      const result = await this.rpc.call('quality:getAssessment', {
        forceRefresh,
      } satisfies QualityGetAssessmentParams);

      if (result.isSuccess()) {
        this._intelligence.set(result.data.intelligence);
      } else {
        this._error.set(result.error ?? 'Failed to load quality assessment');
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unexpected error loading assessment';
      this._error.set(message);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Load quality assessment history from backend via RPC.
   * History entries are stored newest-first for trend chart display.
   *
   * @param limit - Maximum number of history entries to retrieve (default: 30)
   */
  async loadHistory(limit = 30): Promise<void> {
    try {
      const result = await this.rpc.call('quality:getHistory', {
        limit,
      } satisfies QualityGetHistoryParams);

      if (result.isSuccess()) {
        this._history.set(result.data.entries);
      }
    } catch (err) {
      console.error('[QualityDashboardState] Failed to load history:', err);
    }
  }

  /**
   * Export quality report in the specified format via RPC.
   * Returns the exported content string for download, or null on failure.
   *
   * @param format - Export format: 'markdown', 'json', or 'csv'
   * @returns The exported content string, or null if export failed
   */
  async exportReport(
    format: 'markdown' | 'json' | 'csv'
  ): Promise<QualityExportResult | null> {
    try {
      const result = await this.rpc.call('quality:export', {
        format,
      } satisfies QualityExportParams);

      if (result.isSuccess()) {
        return result.data;
      }
      return null;
    } catch (err) {
      console.error('[QualityDashboardState] Failed to export report:', err);
      return null;
    }
  }
}
