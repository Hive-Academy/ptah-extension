import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import type {
  MemoryStatsResult,
  MemoryTierWire,
  MemoryWire,
} from '@ptah-extension/shared';

import { MemoryRpcService } from './memory-rpc.service';

/** UI-side filter for the tier selector (adds an "all" sentinel). */
export type MemoryTierFilter = 'all' | MemoryTierWire;

/** UI-side filter for memory workspace scope (workspace-local vs cross-workspace). */
export type MemoryScopeFilter = 'workspace' | 'all';

/**
 * Per-tier totals derived from the currently-loaded entries. Used by the
 * stats panel as a fallback when {@link MemoryStatsResult} has not yet
 * resolved (or when the user is filtering by tier locally).
 */
export interface MemoryTierTotals {
  readonly core: number;
  readonly recall: number;
  readonly archival: number;
  readonly total: number;
}

/**
 * MemoryStateService
 *
 * Signal-based state container for the Memory tab. All side effects route
 * through {@link MemoryRpcService}; the service itself is pure UI state.
 *
 * Public surface:
 * - `entries`           — readonly list of currently-loaded memories.
 * - `query`             — writable search query string.
 * - `tierFilter`        — writable tier filter (`'all' | 'core' | 'recall' | 'archival'`).
 * - `stats`             — last successful `memory:stats` payload.
 * - `loading`, `error`  — UI flags.
 * - `filteredEntries`   — entries filtered by current tier filter.
 * - `totalsByTier`      — derived per-tier totals.
 */
@Injectable({ providedIn: 'root' })
export class MemoryStateService {
  private readonly rpcService = inject(MemoryRpcService);
  private readonly appState = inject(AppStateManager);

  // -- Private writable signals --
  private readonly _entries = signal<readonly MemoryWire[]>([]);
  private readonly _query = signal<string>('');
  private readonly _tierFilter = signal<MemoryTierFilter>('all');
  private readonly _scopeFilter = signal<MemoryScopeFilter>('workspace');
  private readonly _stats = signal<MemoryStatsResult | null>(null);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  // -- Public readonly signals --
  public readonly entries = this._entries.asReadonly();
  public readonly query = this._query.asReadonly();
  public readonly tierFilter = this._tierFilter.asReadonly();
  public readonly scopeFilter = this._scopeFilter.asReadonly();
  public readonly stats = this._stats.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  /** Entries filtered by the active tier filter (search results bypass this). */
  public readonly filteredEntries = computed<readonly MemoryWire[]>(() => {
    const filter = this._tierFilter();
    const list = this._entries();
    if (filter === 'all') return list;
    return list.filter((e) => e.tier === filter);
  });

  /** Per-tier totals derived from the loaded entries. */
  public readonly totalsByTier = computed<MemoryTierTotals>(() => {
    const list = this._entries();
    let core = 0;
    let recall = 0;
    let archival = 0;
    for (const m of list) {
      if (m.tier === 'core') core++;
      else if (m.tier === 'recall') recall++;
      else if (m.tier === 'archival') archival++;
    }
    return { core, recall, archival, total: list.length };
  });

  // -- Mutators --

  public setQuery(value: string): void {
    this._query.set(value);
  }

  public setTierFilter(value: MemoryTierFilter): void {
    this._tierFilter.set(value);
  }

  public setScopeFilter(value: MemoryScopeFilter): void {
    this._scopeFilter.set(value);
  }

  /** Current workspace root (null when no workspace is open). */
  private getWorkspaceRoot(): string | null {
    return this.appState.workspaceInfo()?.path ?? null;
  }

  /**
   * Resolves the workspace root to scope an RPC call by, honoring the
   * current `_scopeFilter()`.
   *
   * - `'all'` scope → `{ ok: true, workspaceRoot: undefined }` (global RPC).
   * - `'workspace'` scope with a resolved workspace → `{ ok: true, workspaceRoot: path }`.
   * - `'workspace'` scope but `appState.workspaceInfo()` not yet resolved →
   *   `{ ok: false, error: ... }`. Callers must NOT fall through to a global
   *   RPC in this case (would silently leak cross-workspace results).
   */
  private resolveScopedWorkspaceRoot():
    | { ok: true; workspaceRoot: string | undefined }
    | { ok: false; error: string } {
    const scope = this._scopeFilter();
    if (scope === 'all') {
      return { ok: true, workspaceRoot: undefined };
    }
    const root = this.getWorkspaceRoot();
    if (root === null) {
      return { ok: false, error: NO_WORKSPACE_FOR_SCOPED_RPC };
    }
    return { ok: true, workspaceRoot: root };
  }

  // -- RPC-bound actions --

  /** Refresh the entry list from `memory:list`, optionally restricted to a tier. */
  public async refresh(): Promise<void> {
    const scoped = this.resolveScopedWorkspaceRoot();
    if (!scoped.ok) {
      this._entries.set([]);
      this._error.set(scoped.error);
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const tier = this._tierFilter();
      const { workspaceRoot } = scoped;
      const result = await this.rpcService.list({
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
        ...(tier !== 'all' ? { tier } : {}),
        limit: 200,
        offset: 0,
      });
      this._entries.set(result.memories);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Run a hybrid BM25+vector search. Replaces `entries` with the hit list so
   * the tab can render results inline; clears the query to fall back to the
   * full list when the field is emptied.
   */
  public async search(query: string): Promise<void> {
    const trimmed = query.trim();
    this._query.set(query);
    if (trimmed.length === 0) {
      await this.refresh();
      return;
    }
    const scoped = this.resolveScopedWorkspaceRoot();
    if (!scoped.ok) {
      this._entries.set([]);
      this._error.set(scoped.error);
      return;
    }
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await this.rpcService.search(
        trimmed,
        50,
        scoped.workspaceRoot,
      );
      this._entries.set(result.hits.map((hit) => hit.memory));
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async pin(id: string): Promise<void> {
    this._error.set(null);
    try {
      const res = await this.rpcService.pin(id);
      if (res.success) {
        this._entries.update((list) =>
          list.map((m) => (m.id === id ? { ...m, pinned: res.pinned } : m)),
        );
      }
    } catch (err) {
      this._error.set(toErrorMessage(err));
    }
  }

  public async unpin(id: string): Promise<void> {
    this._error.set(null);
    try {
      const res = await this.rpcService.unpin(id);
      if (res.success) {
        this._entries.update((list) =>
          list.map((m) => (m.id === id ? { ...m, pinned: res.pinned } : m)),
        );
      }
    } catch (err) {
      this._error.set(toErrorMessage(err));
    }
  }

  public async forget(id: string): Promise<void> {
    this._error.set(null);
    try {
      const res = await this.rpcService.forget(id);
      if (res.success) {
        this._entries.update((list) => list.filter((m) => m.id !== id));
      }
    } catch (err) {
      this._error.set(toErrorMessage(err));
    }
  }

  public async rebuildIndex(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      await this.rpcService.rebuildIndex('both');
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  public async loadStats(): Promise<void> {
    const scoped = this.resolveScopedWorkspaceRoot();
    if (!scoped.ok) {
      // Leave _stats unchanged: avoid showing zeros/stale numbers from a
      // different workspace; surface the error so the UI can prompt the user.
      this._error.set(scoped.error);
      return;
    }
    this._error.set(null);
    try {
      // `stats(null)` = global; `stats(path)` = scoped. The RPC contract
      // distinguishes null vs undefined; map our `workspaceRoot: undefined`
      // back to null for the "all" scope.
      const scopedRoot = scoped.workspaceRoot ?? null;
      const stats = await this.rpcService.stats(scopedRoot);
      this._stats.set(stats);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    }
  }
}

/**
 * User-facing error message used when the user has selected `'workspace'`
 * scope but `AppStateManager.workspaceInfo()` has not yet resolved (early-mount
 * race) or no workspace is open. Shared by `search`, `refresh`, `loadStats`
 * so the UI presents a single, consistent prompt.
 */
const NO_WORKSPACE_FOR_SCOPED_RPC =
  'No workspace is open — switch to "All workspaces" to see cross-workspace memories.';

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown memory error';
}
