/**
 * Code namespace builder — exposes ptah.code.searchSymbols, ptah.code.reindex
 * and ptah.code.ensureIndexFresh as execute_code namespace tools so agents can
 * search indexed code symbols and keep the index current.
 *
 * Services resolved lazily via getter functions for graceful degradation when
 * SQLite / CodeSymbolIndexer is not registered.
 *
 * Index freshness (TASK_2026_559 User Decision 1): the first symbol call that
 * finds the index empty or older than {@link CODE_INDEX_STALE_MS} starts a
 * governed background reindex and returns without waiting for it.
 */

import type {
  CodeIndexFreshness,
  IMemoryReader,
  ICodeSymbolReader,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import type { CodeSymbolIndexer } from '@ptah-extension/workspace-intelligence';

/**
 * An index whose newest symbol is older than this is stale. It is also the
 * shortest gap between two lazy background runs for one workspace root, so a
 * run that leaves the index empty (no source files, every file failed) is not
 * restarted by every symbol call.
 */
export const CODE_INDEX_STALE_MS = 24 * 60 * 60 * 1000;

export interface CodeNamespaceDependencies {
  /**
   * Dedicated hybrid (BM25 + vector) search over the code_symbols index.
   * Present in SQLite-backed runtimes (Electron); preferred when available.
   */
  getCodeSymbolSearch?: () => ICodeSymbolReader | undefined;
  getMemorySearch: () => IMemoryReader | undefined;
  getSymbolIndexer: () => CodeSymbolIndexer | undefined;
  /** The root symbol searches run against (may be the caller-declared root). */
  getWorkspaceRoot: () => string;
  /**
   * Workspace roots the host itself recorded (session and platform folders),
   * never a caller-declared value. A reindex writes to the index, so it runs
   * only when the searched root is exactly one of these.
   */
  getHostWorkspaceRoots: () => readonly string[];
  logger: {
    warn(message: string, metadata?: Record<string, unknown>): void;
  };
  /** Clock in epoch ms; injected by specs. Defaults to `Date.now`. */
  now?: () => number;
}

export interface SymbolHit {
  readonly subject: string | null;
  readonly filePath: string;
  readonly symbolName: string;
  readonly kind: string;
  readonly text: string;
  readonly score: number;
}

/**
 * How current the symbol index is, returned with every symbol search so a
 * caller can tell "0 hits, the index is stale" from "0 hits, not found".
 */
export interface IndexFreshnessStatus {
  /** Symbols indexed under the searched root; `null` when freshness is unknown. */
  readonly symbolCount: number | null;
  /** Ms since the newest symbol was written; `null` when unknown or empty. */
  readonly indexAgeMs: number | null;
  /** This call started a background reindex. */
  readonly reindexStarted: boolean;
  /** A background reindex of this root is running. */
  readonly reindexInFlight: boolean;
}

export interface SymbolSearchResult {
  hits: readonly SymbolHit[];
  bm25Only: boolean;
  index: IndexFreshnessStatus;
}

export interface SymbolSearchError {
  hits: [];
  bm25Only: true;
  error: string;
  index: IndexFreshnessStatus;
}

/** A single-file reindex, awaited. */
export interface ReindexResult {
  filesScanned: number;
  symbolsIndexed: number;
  errors: number;
  durationMs: number;
}

/**
 * A full reindex, started in the background (it can outlast a client's tool
 * timeout). `started` is false when a run for this root was already running.
 */
export interface ReindexStarted {
  started: boolean;
  symbolCount: number | null;
  indexAgeMs: number | null;
  reindexInFlight: boolean;
}

export interface ReindexError {
  error: string;
}

export interface CodeNamespace {
  searchSymbols(
    query: string,
    options?: { maxResults?: number; filePath?: string },
  ): Promise<SymbolSearchResult | SymbolSearchError>;

  /** `filePath` reindexes one file and waits; no `filePath` starts a full run in the background. */
  reindex(options?: {
    filePath?: string;
  }): Promise<ReindexResult | ReindexStarted | ReindexError>;

  /**
   * Reads the index freshness and, when the index is stale, starts a governed
   * background reindex without waiting for it. Never rejects.
   */
  ensureIndexFresh(): Promise<IndexFreshnessStatus>;
}

export function buildCodeNamespace(
  deps: CodeNamespaceDependencies,
): CodeNamespace {
  const {
    getCodeSymbolSearch,
    getMemorySearch,
    getSymbolIndexer,
    getWorkspaceRoot,
    getHostWorkspaceRoots,
    logger,
  } = deps;
  const now = deps.now ?? Date.now;

  /** Roots with a background reindex running; an entry clears when its run settles. */
  const inFlight = new Set<string>();
  /** When the last background run for a root started (epoch ms). */
  const lastRunStartedAt = new Map<string, number>();

  /**
   * `root` when the host itself recorded it, else `undefined`. Exact string
   * equality: the index is keyed by the root string, so a reindex under any
   * other spelling would not refresh the rows the search reads.
   */
  function hostOwned(root: string): string | undefined {
    if (root.trim() === '') return undefined;
    return getHostWorkspaceRoots().includes(root) ? root : undefined;
  }

  /** The reader's freshness for `root`; `undefined` when the reader cannot report it. */
  async function readFreshness(
    root: string,
  ): Promise<CodeIndexFreshness | undefined> {
    const reader = getCodeSymbolSearch?.();
    if (!reader?.getIndexFreshness) return undefined;
    return reader.getIndexFreshness(root);
  }

  /**
   * {@link readFreshness} for a result that reports a run already admitted:
   * a failed read yields unknown freshness instead of replacing the start
   * acknowledgment with an error.
   */
  async function readAdvisoryFreshness(
    root: string,
  ): Promise<CodeIndexFreshness | undefined> {
    try {
      return await readFreshness(root);
    } catch {
      // degradation-audit: reported — the reindex was already admitted, so a
      // failed advisory read is logged at warn and reported as unknown
      // freshness alongside the real start state. Fixed text: store errors can
      // carry paths.
      logger.warn(
        '[ptah.code] index freshness read failed after reindex admission; freshness reported as unknown',
      );
      return undefined;
    }
  }

  function ageOf(freshness: CodeIndexFreshness | undefined): number | null {
    if (freshness === undefined || freshness.newestUpdatedAt === null) {
      return null;
    }
    return Math.max(0, now() - freshness.newestUpdatedAt);
  }

  /** Empty, or older than the threshold. An unknown age is never stale. */
  function isStale(freshness: CodeIndexFreshness): boolean {
    if (freshness.symbolCount === 0) return true;
    const age = ageOf(freshness);
    return age !== null && age > CODE_INDEX_STALE_MS;
  }

  /**
   * Starts `indexWorkspace` without awaiting it. The latch is set before this
   * returns, so a concurrent caller sees it; it clears when the run settles.
   * A lazy run is `userInitiated: false` and so waits on the background-work
   * governor before each batch; it is never awaited from inside a tool call,
   * which would make the generating turn wait for itself (TASK_2026_437).
   */
  function startBackgroundRun(
    indexer: CodeSymbolIndexer,
    root: string,
    userInitiated: boolean,
  ): void {
    inFlight.add(root);
    lastRunStartedAt.set(root, now());
    void Promise.resolve()
      .then(() => indexer.indexWorkspace(root, { userInitiated }))
      .finally(() => inFlight.delete(root))
      .catch((error: unknown) => {
        // degradation-audit: reported — a background reindex failure is logged
        // at warn and never reaches the tool call that started it. Fixed text:
        // indexer errors can carry file paths, so only the error name is kept.
        if (isAbortError(error)) return;
        logger.warn('[ptah.code] background code-symbol reindex failed', {
          errorName: error instanceof Error ? error.name : typeof error,
          userInitiated,
        });
      });
  }

  async function checkFreshness(
    searchRoot: string,
  ): Promise<IndexFreshnessStatus> {
    const freshness = await readFreshness(searchRoot);
    const hostRoot = hostOwned(searchRoot);
    const indexer = getSymbolIndexer();
    let reindexStarted = false;
    if (
      freshness !== undefined &&
      indexer !== undefined &&
      hostRoot !== undefined &&
      !inFlight.has(hostRoot) &&
      isStale(freshness) &&
      !startedWithinThreshold(hostRoot)
    ) {
      startBackgroundRun(indexer, hostRoot, false);
      reindexStarted = true;
    }
    return {
      symbolCount: freshness?.symbolCount ?? null,
      indexAgeMs: ageOf(freshness),
      reindexStarted,
      reindexInFlight: inFlight.has(searchRoot),
    };
  }

  function startedWithinThreshold(root: string): boolean {
    const startedAt = lastRunStartedAt.get(root);
    return startedAt !== undefined && now() - startedAt < CODE_INDEX_STALE_MS;
  }

  async function ensureIndexFresh(): Promise<IndexFreshnessStatus> {
    // Captured before the read so a failure still reports this root's own
    // run state, which the namespace knows independently of the database.
    let searchRoot: string | undefined;
    try {
      searchRoot = getWorkspaceRoot();
      return await checkFreshness(searchRoot);
    } catch {
      // degradation-audit: reported — freshness is advisory: a failed read is
      // logged at warn and reported as unknown freshness, which never starts a
      // reindex; a run already in flight for the root is still reported.
      // Fixed text: store errors can carry paths.
      logger.warn(
        '[ptah.code] index freshness check failed; freshness reported as unknown',
      );
      return {
        symbolCount: null,
        indexAgeMs: null,
        reindexStarted: false,
        reindexInFlight: searchRoot !== undefined && inFlight.has(searchRoot),
      };
    }
  }

  return {
    async searchSymbols(query, options = {}) {
      const maxResults = options.maxResults ?? 20;
      const workspaceRoot = getWorkspaceRoot();
      const index = await ensureIndexFresh();

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
          return { hits, bm25Only: page.bm25Only ?? false, index };
        } catch (err) {
          return {
            hits: [] as [],
            bm25Only: true as const,
            error: err instanceof Error ? err.message : String(err),
            index,
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
          index,
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
        return { hits, bm25Only: page.bm25Only ?? false, index };
      } catch (err) {
        return {
          hits: [] as [],
          bm25Only: true as const,
          error: err instanceof Error ? err.message : String(err),
          index,
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
        const workspaceRoot = hostOwned(getWorkspaceRoot());
        if (workspaceRoot === undefined) {
          return {
            error:
              'Reindex runs only for a workspace folder this host opened; the current workspace root is not one of them',
          };
        }
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
        }
        // A full run can take minutes, past a client's tool timeout, so it
        // starts in the background and this returns at once. It is
        // user-initiated: the agent asked for it, and a governed run would wait
        // for the very turn that requested it to end (TASK_2026_437).
        const started = !inFlight.has(workspaceRoot);
        if (started) {
          startBackgroundRun(indexer, workspaceRoot, true);
        }
        const freshness = await readAdvisoryFreshness(workspaceRoot);
        return {
          started,
          symbolCount: freshness?.symbolCount ?? null,
          indexAgeMs: ageOf(freshness),
          reindexInFlight: inFlight.has(workspaceRoot),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },

    ensureIndexFresh,
  };
}

/**
 * Starts `code.ensureIndexFresh()` without waiting for it, for lookups the
 * symbol index answers outside `searchSymbols` (definitions). The namespace
 * layer wires it, so the direct MCP tool and `execute_code` share it.
 * `ensureIndexFresh` never rejects, but a namespace that failed to build is a
 * proxy whose methods throw synchronously, so the call runs inside a promise
 * chain and can never fail or delay the lookup.
 */
export function startIndexFreshnessCheck(
  code: Pick<CodeNamespace, 'ensureIndexFresh'>,
  logger: { debug(message: string, ...args: unknown[]): void },
): void {
  void Promise.resolve()
    .then(() => code.ensureIndexFresh())
    .catch(() => {
      // degradation-audit: reported — freshness is advisory and must never
      // fail the lookup that triggered it; the failure is logged at debug with
      // fixed text (namespace errors can carry paths).
      logger.debug('[ptah.code] index freshness check could not start');
    });
}

/** The indexer's clean stop (governor abort on shutdown, or a signal). */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
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
