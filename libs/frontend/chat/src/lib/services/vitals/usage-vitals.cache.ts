import { Injectable, inject, type Signal } from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import {
  UsageSummarySchema,
  normalizeWorkspaceRoot,
  type UsageSummary,
} from '@ptah-extension/shared';
import {
  VitalsLoadCache,
  settleVitalsRpc,
  vitalsReady,
  type VitalsLoad,
  type VitalsRpcSource,
} from './vitals-load';

/**
 * Ranges the empty screens read: 7 days for the spend bars, 90 (the longest
 * the host serves) for the 91-cell grid; see `ACTIVITY_DAY_COUNT`.
 */
export type UsageVitalsRange = 7 | 90;

/**
 * The host's log scan has a 30-second budget; leave transport room for its
 * final partial summary (same budget as `analytics-usage.store.ts`).
 */
export const USAGE_VITALS_TIMEOUT_MS = 40_000;

/**
 * Most entries kept. The screens read at most four keys at once (all
 * workspaces and the open one, 7 and 90 days); the rest are workspaces left
 * behind, evicted oldest first. A screen still holding an evicted entry's
 * signal keeps a working copy; it is only no longer shared.
 */
export const USAGE_VITALS_MAX_ENTRIES = 8;

/**
 * Shared `analytics:spendSummary` reads for the empty screens. One cache entry
 * per `scope|range`, so every tile that asks for the same scope shares one
 * call. `scope` is a workspace path, or `null` for all workspaces; it is keyed
 * by `normalizeWorkspaceRoot`, so two spellings of one folder share an entry.
 * The answer is re-validated with `UsageSummarySchema`.
 */
@Injectable({ providedIn: 'root' })
export class UsageVitalsCache {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly source: VitalsRpcSource = {
    logger: inject(LoggingService),
    context: 'UsageVitalsCache',
    label: 'Usage summary',
  };
  private readonly entries = new Map<string, VitalsLoadCache<UsageSummary>>();

  /** See {@link VitalsLoadCache.read}: safe in an effect, not in `computed()`. */
  summary(
    scope: string | null,
    range: UsageVitalsRange,
  ): Signal<VitalsLoad<UsageSummary>> {
    const workspace = scope === null || scope === '' ? undefined : scope;
    const key = `${normalizeWorkspaceRoot(workspace)}|${range}`;
    let entry = this.entries.get(key);
    if (entry) {
      // Re-insert so eviction drops the least recently read entry.
      this.entries.delete(key);
    } else {
      entry = new VitalsLoadCache(() => this.fetch(workspace, range));
    }
    this.entries.set(key, entry);
    this.evictOverflow();
    return entry.read();
  }

  private evictOverflow(): void {
    while (this.entries.size > USAGE_VITALS_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  private fetch(
    workspace: string | undefined,
    range: UsageVitalsRange,
  ): Promise<VitalsLoad<UsageSummary>> {
    return settleVitalsRpc(
      this.source,
      () =>
        this.rpc.call(
          'analytics:spendSummary',
          { range, ...(workspace ? { workspace } : {}) },
          { timeout: USAGE_VITALS_TIMEOUT_MS },
        ),
      (data) => {
        const parsed = UsageSummarySchema.safeParse(data);
        return parsed.success ? vitalsReady(parsed.data) : null;
      },
    );
  }
}
