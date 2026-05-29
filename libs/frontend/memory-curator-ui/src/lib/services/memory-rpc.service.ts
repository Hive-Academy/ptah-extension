import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  CorpusBuildParams,
  CorpusBuildResult,
  CorpusDeleteResult,
  CorpusListResult,
  CorpusPrimeResult,
  CorpusQueryResult,
  CorpusRebuildResult,
  CorpusReprimeResult,
  MemGetObservationsParams,
  MemGetObservationsResult,
  MemSearchIndexParams,
  MemSearchIndexResult,
  MemTimelineParams,
  MemTimelineResult,
  MemoryForgetResult,
  MemoryGetResult,
  MemoryListResult,
  MemoryPinResult,
  MemoryPurgeBySubjectPatternResult,
  MemoryPurgeJunkResult,
  MemoryRebuildIndexResult,
  MemorySearchResult,
  MemorySearchSymbolsParams,
  MemorySearchSymbolsResult,
  MemoryStatsResult,
  MemoryTierWire,
} from '@ptah-extension/shared';

/**
 * Per-method timeout budget for memory.* / mem.* / corpus.* RPC calls.
 *
 * - LIST_MS:    list / search / get / stats / mem:* reads — bounded SQLite.
 * - SHORT_MS:   pin / unpin / forget / corpus:delete — single-row writes.
 * - REBUILD_MS: rebuildIndex / corpus:build / corpus:rebuild — full index rewrite.
 * - PRIME_MS:   corpus:prime / corpus:reprime — session lifecycle round-trip.
 * - QUERY_MS:   corpus:query — LLM-bound answer round-trip.
 */
const MEMORY_RPC_TIMEOUTS = {
  LIST_MS: 10_000,
  SHORT_MS: 8_000,
  REBUILD_MS: 120_000,
  PRIME_MS: 60_000,
  QUERY_MS: 90_000,
} as const;

/**
 * MemoryRpcService
 *
 * Thin facade for memory-curator RPC calls. Delegates to {@link ClaudeRpcService}
 * for the actual structured-clone wire boundary. Mirrors the wizard-rpc.service
 * pattern: each method returns the typed `result.data` on success and throws
 * with the RPC error string on failure.
 *
 * Three namespaces covered:
 *   - `memory:*` — legacy tier-CRUD surface (list/search/get/pin/unpin/forget/
 *     rebuildIndex/stats/purgeBySubjectPattern/purgeJunk/searchSymbols).
 *   - `mem:*`    — progressive-disclosure search (searchIndex/timeline/
 *     getObservations).
 *   - `corpus:*` — knowledge-corpus lifecycle (listCorpora/buildCorpus/
 *     primeCorpus/queryCorpus/reprimeCorpus/rebuildCorpus/deleteCorpus).
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
    workspaceRoot?: string,
  ): Promise<MemorySearchResult> {
    const result = await this.rpc.call(
      'memory:search',
      {
        query,
        ...(topK !== undefined ? { topK } : {}),
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
      },
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

  public async searchSymbols(
    params: MemorySearchSymbolsParams,
  ): Promise<MemorySearchSymbolsResult> {
    const result = await this.rpc.call('memory:searchSymbols', params, {
      timeout: MEMORY_RPC_TIMEOUTS.LIST_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:searchSymbols failed');
  }

  public async purgeJunk(
    workspaceRoot?: string | null,
  ): Promise<MemoryPurgeJunkResult> {
    const result = await this.rpc.call(
      'memory:purgeJunk',
      { workspaceRoot: workspaceRoot ?? null },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'memory:purgeJunk failed');
  }

  public async searchIndex(
    params: MemSearchIndexParams,
  ): Promise<MemSearchIndexResult> {
    const result = await this.rpc.call('mem:searchIndex', params, {
      timeout: MEMORY_RPC_TIMEOUTS.LIST_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'mem:searchIndex failed');
  }

  public async timeline(params: MemTimelineParams): Promise<MemTimelineResult> {
    const result = await this.rpc.call('mem:timeline', params, {
      timeout: MEMORY_RPC_TIMEOUTS.LIST_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'mem:timeline failed');
  }

  public async getObservations(
    params: MemGetObservationsParams,
  ): Promise<MemGetObservationsResult> {
    const result = await this.rpc.call('mem:getObservations', params, {
      timeout: MEMORY_RPC_TIMEOUTS.LIST_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'mem:getObservations failed');
  }

  public async listCorpora(workspaceRoot?: string): Promise<CorpusListResult> {
    const result = await this.rpc.call(
      'corpus:list',
      workspaceRoot !== undefined ? { workspaceRoot } : {},
      { timeout: MEMORY_RPC_TIMEOUTS.LIST_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:list failed');
  }

  public async buildCorpus(
    params: CorpusBuildParams,
  ): Promise<CorpusBuildResult> {
    const result = await this.rpc.call('corpus:build', params, {
      timeout: MEMORY_RPC_TIMEOUTS.REBUILD_MS,
    });

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:build failed');
  }

  public async primeCorpus(name: string): Promise<CorpusPrimeResult> {
    const result = await this.rpc.call(
      'corpus:prime',
      { name },
      { timeout: MEMORY_RPC_TIMEOUTS.PRIME_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:prime failed');
  }

  public async queryCorpus(
    name: string,
    question: string,
  ): Promise<CorpusQueryResult> {
    const result = await this.rpc.call(
      'corpus:query',
      { name, question },
      { timeout: MEMORY_RPC_TIMEOUTS.QUERY_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:query failed');
  }

  public async reprimeCorpus(name: string): Promise<CorpusReprimeResult> {
    const result = await this.rpc.call(
      'corpus:reprime',
      { name },
      { timeout: MEMORY_RPC_TIMEOUTS.PRIME_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:reprime failed');
  }

  public async rebuildCorpus(name: string): Promise<CorpusRebuildResult> {
    const result = await this.rpc.call(
      'corpus:rebuild',
      { name },
      { timeout: MEMORY_RPC_TIMEOUTS.REBUILD_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:rebuild failed');
  }

  public async deleteCorpus(name: string): Promise<CorpusDeleteResult> {
    const result = await this.rpc.call(
      'corpus:delete',
      { name },
      { timeout: MEMORY_RPC_TIMEOUTS.SHORT_MS },
    );

    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'corpus:delete failed');
  }
}
