/**
 * Code namespace builder — exposes ptah.code.searchSymbols and ptah.code.reindex
 * as execute_code namespace tools so agents can search indexed code symbols and
 * trigger re-indexing on demand.
 *
 * Services resolved lazily via getter functions for graceful degradation when
 * SQLite / CodeSymbolIndexer is not registered.
 *
 * TASK_2026_THOTH_CODE_INDEX
 */

import type {
  IMemoryReader,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import type {
  CodeSymbolIndexer,
  IndexingStats,
} from '@ptah-extension/workspace-intelligence';

export interface CodeNamespaceDependencies {
  getMemorySearch: () => IMemoryReader | undefined;
  getSymbolIndexer: () => CodeSymbolIndexer | undefined;
  getWorkspaceRoot: () => string;
}

export interface SymbolSearchResult {
  hits: readonly MemoryHit[];
  bm25Only: boolean;
}

export interface SymbolSearchError {
  hits: [];
  bm25Only: true;
  error: string;
}

export interface ReindexResult {
  filesScanned: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

export interface ReindexError {
  error: string;
}

export interface CodeNamespace {
  searchSymbols(
    query: string,
    options?: { maxResults?: number; filePath?: string },
  ): Promise<SymbolSearchResult | SymbolSearchError>;

  reindex(options?: {
    filePath?: string;
  }): Promise<ReindexResult | ReindexError>;
}

export function buildCodeNamespace(
  deps: CodeNamespaceDependencies,
): CodeNamespace {
  const { getMemorySearch, getSymbolIndexer, getWorkspaceRoot } = deps;

  return {
    async searchSymbols(query, options = {}) {
      const reader = getMemorySearch();
      if (!reader) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: 'Memory search service not available',
        };
      }
      try {
        const maxResults = options.maxResults ?? 20;
        const workspaceRoot = getWorkspaceRoot();
        const page = await reader.search(query, maxResults, workspaceRoot);
        // Post-filter to code symbols only: tier='archival' + subject starts with 'code:'
        // This removes conversational memory contamination from the results.
        const codeHits = page.hits.filter(
          (hit: MemoryHit) =>
            hit.tier === 'archival' &&
            typeof hit.subject === 'string' &&
            hit.subject.startsWith('code:'),
        );
        // Apply optional filePath filter
        const filtered =
          options.filePath != null
            ? codeHits.filter((h: MemoryHit) =>
                h.subject?.includes(options.filePath as string),
              )
            : codeHits;
        return { hits: filtered, bm25Only: page.bm25Only ?? false };
      } catch (err) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async reindex(options = {}) {
      const indexer = getSymbolIndexer();
      if (!indexer) {
        return {
          error: 'CodeSymbolIndexer not available (SQLite may be disabled)',
        };
      }
      try {
        const workspaceRoot = getWorkspaceRoot();
        if (options.filePath != null) {
          const stats = await indexer.reindexFile(
            options.filePath,
            workspaceRoot,
          );
          return {
            filesScanned: 1,
            symbolsIndexed: stats.symbolsIndexed,
            errors: stats.errors,
            durationMs: stats.durationMs,
          };
        } else {
          const stats: IndexingStats =
            await indexer.indexWorkspace(workspaceRoot);
          return stats;
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
