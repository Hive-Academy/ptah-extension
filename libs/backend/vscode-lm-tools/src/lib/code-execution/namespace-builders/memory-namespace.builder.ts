/**
 * Memory namespace builder — exposes `ptah.memory.search` and `ptah.memory.list`
 * as MCP tools so the agent can retrieve memories on demand during a session.
 *
 * Services are resolved lazily (via getter functions) to avoid DI timing issues
 * and to degrade gracefully when memory-curator is not registered (e.g. VS Code
 * without SQLite support). Following the established pattern from
 * `agent-namespace.builder.ts` and `git-namespace.builder.ts`.
 *
 * TASK_2026_THOTH_MEMORY_READ
 */

import type {
  IMemoryReader,
  IMemoryLister,
  MemoryHit,
  MemoryRecord,
} from '@ptah-extension/memory-contracts';

export interface MemoryNamespaceDependencies {
  getMemorySearch: () => IMemoryReader | undefined;
  getMemoryStore: () => IMemoryLister | undefined;
  getWorkspaceRoot: () => string;
}

export interface MemoryNamespace {
  search(
    query: string,
    maxResults?: number,
  ): Promise<
    | { hits: readonly MemoryHit[]; bm25Only: boolean }
    | { hits: []; bm25Only: true; error: string }
  >;
  list(options?: {
    tier?: string;
    limit?: number;
    offset?: number;
  }): Promise<
    | { memories: readonly MemoryRecord[]; total: number }
    | { memories: []; total: 0; error: string }
  >;
}

export function buildMemoryNamespace(
  deps: MemoryNamespaceDependencies,
): MemoryNamespace {
  const { getMemorySearch, getMemoryStore, getWorkspaceRoot } = deps;

  return {
    search: async (query: string, maxResults = 10) => {
      const reader = getMemorySearch();
      if (!reader) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: 'Memory search service not available',
        };
      }
      try {
        return await reader.search(query, maxResults, getWorkspaceRoot());
      } catch (err) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    list: async (options?: {
      tier?: string;
      limit?: number;
      offset?: number;
    }) => {
      const lister = getMemoryStore();
      if (!lister) {
        return {
          memories: [] as [],
          total: 0 as const,
          error: 'Memory store not available',
        };
      }
      try {
        return lister.listAll(
          getWorkspaceRoot(),
          options?.tier,
          options?.limit ?? 50,
          options?.offset ?? 0,
        );
      } catch (err) {
        return {
          memories: [] as [],
          total: 0 as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
