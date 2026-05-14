import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  MemoryForgetResult,
  MemoryGetResult,
  MemoryListResult,
  MemoryPinResult,
  MemoryPurgeBySubjectPatternResult,
  MemoryRebuildIndexResult,
  MemorySearchResult,
  MemoryStatsResult,
  MemoryTierWire,
} from '@ptah-extension/shared';

/**
 * Per-method timeout budget for memory.* RPC calls.
 *
 * - LIST_MS:    list / search / get / stats — bounded SQLite reads.
 * - SHORT_MS:   pin / unpin / forget — single-row writes.
 * - REBUILD_MS: rebuildIndex — full FTS5 + vec rebuild over the corpus.
 */
const MEMORY_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  REBUILD_MS: 120_000,
} as const;

/**
 * MemoryRpcService
 *
 * Thin facade for memory-curator RPC calls. Delegates to {@link ClaudeRpcService}
 * for the actual structured-clone wire boundary. Mirrors the wizard-rpc.service
 * pattern: each method returns the typed `result.data` on success and throws
 * with the RPC error string on failure.
 *
 * Supported RPC methods (9):
 * - memory:list
 * - memory:search
 * - memory:get
 * - memory:pin
 * - memory:unpin
 * - memory:forget
 * - memory:rebuildIndex
 * - memory:stats
 * - memory:purgeBySubjectPattern
 */
@Injectable({ providedIn: 'root' })
export class MemoryRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  public async list(params?: {
    workspaceRoot?: string | null;
    tier?: MemoryTierWire;
    limit?: number;
    offset?: number;
  }): Promise<MemoryListResult> {
    const result = await this.rpc.call(
      'memory:list',
      {
        workspaceRoot: params?.workspaceRoot ?? null,
        ...(params?.tier !== undefined ? { tier: params.tier } : {}),
        ...(params?.limit !== undefined ? { limit: params.limit } : {}),
        ...(params?.offset !== undefined ? { offset: params.offset } : {}),
      },
      { timeout: MEMORY_RPC_TIMEOUTS.LIST_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:list failed');
  }

  public async search(
    query: string,
    topK?: number,
  ): Promise<MemorySearchResult> {
    const result = await this.rpc.call(
      'memory:search',
      { query, ...(topK !== undefined ? { topK } : {}) },
      { timeout: MEMORY_RPC_TIMEOUTS.LIST_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:search failed');
  }

  public async get(id: string): Promise<MemoryGetResult> {
    const result = await this.rpc.call(
      'memory:get',
      { id },
      { timeout: MEMORY_RPC_TIMEOUTS.LIST_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:get failed');
  }

  public async pin(id: string): Promise<MemoryPinResult> {
    const result = await this.rpc.call(
      'memory:pin',
      { id },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:pin failed');
  }

  public async unpin(id: string): Promise<MemoryPinResult> {
    const result = await this.rpc.call(
      'memory:unpin',
      { id },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:unpin failed');
  }

  public async forget(id: string): Promise<MemoryForgetResult> {
    const result = await this.rpc.call(
      'memory:forget',
      { id },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:forget failed');
  }

  public async rebuildIndex(
    mode?: 'fts' | 'vec' | 'both',
  ): Promise<MemoryRebuildIndexResult> {
    const result = await this.rpc.call(
      'memory:rebuildIndex',
      mode !== undefined ? { mode } : {},
      { timeout: MEMORY_RPC_TIMEOUTS.REBUILD_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:rebuildIndex failed');
  }

  public async stats(
    workspaceRoot?: string | null,
  ): Promise<MemoryStatsResult> {
    const result = await this.rpc.call(
      'memory:stats',
      { workspaceRoot: workspaceRoot ?? null },
      { timeout: MEMORY_RPC_TIMEOUTS.LIST_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:stats failed');
  }

  /**
   * Purge memory entries whose subject matches a pattern.
   * - `mode: 'substring'` — escapes LIKE metacharacters then wraps in `%...%`.
   * - `mode: 'like'` — raw SQL LIKE pattern passed verbatim.
   */
  public async purgeBySubjectPattern(
    pattern: string,
    mode: 'substring' | 'like',
    workspaceRoot?: string | null,
  ): Promise<MemoryPurgeBySubjectPatternResult> {
    const result = await this.rpc.call(
      'memory:purgeBySubjectPattern',
      {
        pattern,
        mode,
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:purgeBySubjectPattern failed');
  }
}
