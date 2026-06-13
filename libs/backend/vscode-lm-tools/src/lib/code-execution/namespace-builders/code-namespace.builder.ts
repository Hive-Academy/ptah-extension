/**
 * Code namespace builder — exposes ptah.code.searchSymbols and ptah.code.reindex
 * as execute_code namespace tools so agents can search indexed code symbols and
 * trigger re-indexing on demand.
 *
 * Services resolved lazily via getter functions for graceful degradation when
 * SQLite / CodeSymbolIndexer is not registered.
 */

import type {
  IMemoryReader,
  ICodeSymbolReader,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import type {
  CodeSymbolIndexer,
  IndexingStats,
} from '@ptah-extension/workspace-intelligence';

export interface CodeNamespaceDependencies {
  /**
   * Dedicated hybrid (BM25 + vector) search over the code_symbols index.
   * Present in SQLite-backed runtimes (Electron); preferred when available.
   */
  getCodeSymbolSearch?: () => ICodeSymbolReader | undefined;
  getMemorySearch: () => IMemoryReader | undefined;
  getSymbolIndexer: () => CodeSymbolIndexer | undefined;
  getWorkspaceRoot: () => string;
}

export interface SymbolHit {
  readonly subject: string | null;
  readonly filePath: string;
  readonly symbolName: string;
  readonly kind: string;
  readonly text: string;
  readonly score: number;
}

export interface SymbolSearchResult {
  hits: readonly SymbolHit[];
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
  const {
    getCodeSymbolSearch,
    getMemorySearch,
    getSymbolIndexer,
    getWorkspaceRoot,
  } = deps;

  return {
    async searchSymbols(query, options = {}) {
      const maxResults = options.maxResults ?? 20;
      const workspaceRoot = getWorkspaceRoot();

      // Preferred path: dedicated hybrid search over the code_symbols index.
      const codeReader = getCodeSymbolSearch?.();
      if (codeReader) {
        try {
          const page = await codeReader.searchSymbols(
            query,
            maxResults,
            workspaceRoot,
          );
          const hits: SymbolHit[] = page.hits
            .filter((h) =>
              options.filePath != null
                ? h.filePath.includes(options.filePath)
                : true,
            )
            .map((h) => ({
              subject: h.subject,
              filePath: h.filePath,
              symbolName: h.symbolName,
              kind: h.kind,
              text: h.text,
              score: h.score,
            }));
          return { hits, bm25Only: page.bm25Only ?? false };
        } catch (err) {
          return {
            hits: [] as [],
            bm25Only: true as const,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      // Fallback: filter generic memory hits for legacy `code:` subjects.
      // Retained for runtimes where the dedicated reader is not registered.
      const reader = getMemorySearch();
      if (!reader) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: 'Code symbol search service not available',
        };
      }
      try {
        const page = await reader.search(query, maxResults, workspaceRoot);
        const codeHits = page.hits.filter(
          (hit: MemoryHit) =>
            hit.tier === 'archival' &&
            typeof hit.subject === 'string' &&
            hit.subject.startsWith('code:'),
        );
        const hits: SymbolHit[] = codeHits
          .filter((h) =>
            options.filePath != null
              ? (h.subject ?? '').includes(options.filePath)
              : true,
          )
          .map((h) => ({
            subject: h.subject,
            filePath: subjectToFilePath(h.subject),
            symbolName: subjectToSymbolName(h.subject),
            kind: '',
            text: h.chunkText,
            score: h.score,
          }));
        return { hits, bm25Only: page.bm25Only ?? false };
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

/** Parse the file path from a legacy `code:<path>#<name>` memory subject. */
function subjectToFilePath(subject: string | null): string {
  if (!subject) return '';
  const withoutPrefix = subject.startsWith('code:')
    ? subject.slice('code:'.length)
    : subject;
  const hashIdx = withoutPrefix.lastIndexOf('#');
  return hashIdx >= 0 ? withoutPrefix.slice(0, hashIdx) : withoutPrefix;
}

/** Parse the symbol name from a legacy `code:<path>#<name>` memory subject. */
function subjectToSymbolName(subject: string | null): string {
  if (!subject) return '';
  const hashIdx = subject.lastIndexOf('#');
  return hashIdx >= 0 ? subject.slice(hashIdx + 1) : '';
}
