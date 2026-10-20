/**
 * AnalyticsUsageStore
 *
 * Signal-based view state for the Usage tab of the analytics card
 * (TASK_2026_707 PR 2). Owns the 7/30/90-day range selection and exactly one
 * `analytics:spendSummary` request in flight.
 *
 * Staleness mirrors `SessionAnalyticsStateService`: every load increments a
 * generation and gets its own `AbortController`. A range change, a refresh or
 * `cancelLoad()` aborts the previous request, and a response is written only
 * while its generation is still current — a slow 30-day answer can never
 * overwrite a fresh 7-day one. The host call goes through `ClaudeRpcService`
 * only; the summary itself is folded by the pure usage view model.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AppStateManager,
  ClaudeRpcService,
} from '@ptah-extension/core';
import type { UsageRangeDays, UsageSummary } from '@ptah-extension/shared';

export const USAGE_RANGE_OPTIONS: ReadonlyArray<{
  readonly value: UsageRangeDays;
  readonly label: string;
}> = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

/** Default dashboard range (matches the T3 Code Usage page). */
export const DEFAULT_USAGE_RANGE: UsageRangeDays = 30;

/**
 * The only error text the UI ever shows for a failed usage load. Raw RPC or
 * transport messages can carry paths and internal details, so they never
 * reach a signal the template renders; they are discarded, not logged.
 */
export const USAGE_LOAD_FAILED_MESSAGE = 'Could not load usage data.';

/** The scope a loaded summary answers for. */
interface UsageSummaryScope {
  readonly range: UsageRangeDays;
  readonly workspace: string;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsUsageStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly appState = inject(AppStateManager);

  private readonly _range = signal<UsageRangeDays>(DEFAULT_USAGE_RANGE);
  private readonly _summary = signal<UsageSummary | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _loadError = signal<string | null>(null);

  private generation = 0;
  private controller: AbortController | null = null;
  /** The (range, workspace) the loaded summary belongs to. */
  private summaryScope: UsageSummaryScope | null = null;

  readonly range = this._range.asReadonly();
  readonly summary = this._summary.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  /**
   * True while a request is in flight and an older summary stays on screen.
   * Only a same-scope refresh can do that: a scope change clears the old
   * summary first, so a different range or workspace is never answered with
   * the previous one.
   */
  readonly isSummaryStale = computed(
    () => this._summary() !== null && this._isLoading(),
  );

  /** The workspace usage is read for (`''` when none is open). */
  readonly workspacePath = computed(
    () => this.appState.workspaceInfo()?.path || '',
  );

  /** Select a new range; the previous request is aborted and reloaded. */
  setRange(range: UsageRangeDays): void {
    if (this.range() === range) return;
    this._range.set(range);
    void this.load();
  }

  /** Re-run the request for the current range and workspace. */
  refresh(): void {
    void this.load();
  }

  /**
   * Request the summary for the current range. The response is applied only
   * when its generation is still current; an aborted or superseded request
   * leaves every signal untouched. The loaded summary belongs to one
   * (range, workspace) scope: a request for a different scope clears the old
   * summary up front so the previous answer is never shown under the new
   * selection, while a same-scope refresh keeps it (marked stale through
   * `isSummaryStale`) until the answer arrives.
   */
  async load(): Promise<void> {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;

    const range = this.range();
    const workspace = this.workspacePath();
    if (
      this.summaryScope !== null &&
      (this.summaryScope.range !== range ||
        this.summaryScope.workspace !== workspace)
    ) {
      this.summaryScope = null;
      this._summary.set(null);
    }
    this._isLoading.set(true);
    this._loadError.set(null);
    try {
      const result = await this.rpc.call(
        'analytics:spendSummary',
        { range, ...(workspace ? { workspace } : {}) },
        { signal: controller.signal },
      );
      if (generation !== this.generation) return;
      if (!result.isSuccess()) {
        throw new Error(result.error || 'Failed to load usage');
      }
      this.summaryScope = { range, workspace };
      this._summary.set(result.data);
    } catch {
      // degradation-audit: reported - the failure is surfaced through
      // `loadError` as a fixed user message with a retry. Raw error details
      // are discarded: the UI never renders them, and `console.*` calls are
      // not allowed in `libs`. The silent return guards only a superseded or
      // aborted request whose error belongs to a scope the user has left.
      if (generation !== this.generation) return;
      this._loadError.set(USAGE_LOAD_FAILED_MESSAGE);
    } finally {
      if (generation === this.generation) this._isLoading.set(false);
    }
  }

  /** Abort the request in flight, if any. Loaded data stays. */
  cancelLoad(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this._isLoading.set(false);
  }
}