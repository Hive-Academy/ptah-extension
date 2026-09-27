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
 *
 * Coverage (TASK_2026_559 Batch 24b): a search carries the index's live
 * `coverage` (`updating` / `current` / `incomplete`, or `unknown` in a new
 * host session) before its hits, and a file in a language the index does not
 * hold is answered `unsupported-language` instead of an empty search or a
 * reindex that pretends to have scanned it.
 */

import * as path from 'path';
import type {
  CodeIndexFreshness,
  IMemoryReader,
  ICodeSymbolReader,
  MemoryHit,
} from '@ptah-extension/memory-contracts';
import {
  withCoverageVerdict,
  type LanguageCoverage,
  type UnsupportedLanguageAnswer,
} from '@ptah-extension/platform-core';
import {
  classifyFileForCoverage,
  languageForExtension,
  supportedLanguagesFor,
  type CodeSymbolIndexer,
} from '@ptah-extension/workspace-intelligence';

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

/**
 * Key order is the wire order: the freshness and coverage blocks come before
 * the unbounded `hits`, so a budget cut of a long answer never removes them.
 */
export interface SymbolSearchResult {
  index: IndexFreshnessStatus;
  /** What the index covers right now; `unknown` never reads as complete. */
  coverage: LanguageCoverage;
  bm25Only: boolean;
  hits: readonly SymbolHit[];
}

export interface SymbolSearchError {
  index: IndexFreshnessStatus;
  coverage: LanguageCoverage;
  bm25Only: true;
  error: string;
  hits: [];
}

/** A single-file reindex, awaited. */
export interface ReindexResult {
  /**
   * The file's own one-file coverage, first: a recovered parse reads
   * `failed`, an unknown parse quality `unchecked`, a skipped file
   * `excluded` — never a bare zero-error success.
   */
  coverage: LanguageCoverage;
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
  /**
   * A `filePath` whose language is recognised but not in the index is
   * answered `unsupported-language` without searching.
   */
  searchSymbols(
    query: string,
    options?: { maxResults?: number; filePath?: string },
  ): Promise<
    SymbolSearchResult | SymbolSearchError | UnsupportedLanguageAnswer
  >;

  /**
   * `filePath` reindexes one file and waits; no `filePath` starts a full run
   * in the background. A file the index cannot hold is answered
   * `unsupported-language`: nothing is deleted and nothing is counted.
   */
  reindex(options?: {
    filePath?: string;
  }): Promise<
    ReindexResult | ReindexStarted | ReindexError | UnsupportedLanguageAnswer
  >;

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
   *
   * `indexWorkspace` is called synchronously (inside the executor), because
   * it begins its run before its first `await`: coverage read right after
   * this returns already says `updating`. A synchronous throw still becomes
   * a rejection of the chain below.
   */
  function startBackgroundRun(
    indexer: CodeSymbolIndexer,
    root: string,
    userInitiated: boolean,
  ): void {
    inFlight.add(root);
    lastRunStartedAt.set(root, now());
    void new Promise<unknown>((resolve) =>
      resolve(indexer.indexWorkspace(root, { userInitiated })),
    )
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

  /**
   * The indexer's live coverage of `root`. No indexer on this host means
   * nothing can say what the rows cover: `unknown`, never clean.
   */
  function readCoverage(root: string): LanguageCoverage {
    const indexer = getSymbolIndexer();
    if (indexer === undefined) return unknownIndexCoverage();
    try {
      return indexer.getCoverage(root);
    } catch {
      // degradation-audit: reported — coverage is advisory beside the hits:
      // a failed read is logged at warn and reported as unknown coverage,
      // which never reads as complete. Fixed text: indexer errors can carry
      // paths.
      logger.warn(
        '[ptah.code] code index coverage read failed; coverage reported as unknown',
      );
      return unknownIndexCoverage();
    }
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
      if (options.filePath != null) {
        const unsupported = unsupportedFileAnswer(options.filePath, 'search');
        if (unsupported !== undefined) return unsupported;
      }
      const maxResults = options.maxResults ?? 20;
      const workspaceRoot = getWorkspaceRoot();
      const index = await ensureIndexFresh();
      // Read after the freshness check, so a run it started reads
      // `updating`, and again once the rows were read (see spanningRead).
      const coverageBefore = readCoverage(workspaceRoot);
      const coverageNow = (): LanguageCoverage =>
        spanningRead(coverageBefore, readCoverage(workspaceRoot));

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
          return {
            index,
            coverage: coverageNow(),
            bm25Only: page.bm25Only ?? false,
            hits,
          };
        } catch (err) {
          return {
            index,
            coverage: coverageNow(),
            bm25Only: true as const,
            error: err instanceof Error ? err.message : String(err),
            hits: [] as [],
          };
        }
      }

      // Fallback: filter generic memory hits for legacy `code:` subjects.
      // Retained for runtimes where the dedicated reader is not registered.
      const reader = getMemorySearch();
      if (!reader) {
        return {
          index,
          coverage: coverageNow(),
          bm25Only: true as const,
          error: 'Code symbol search service not available',
          hits: [] as [],
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
        return {
          index,
          coverage: coverageNow(),
          bm25Only: page.bm25Only ?? false,
          hits,
        };
      } catch (err) {
        return {
          index,
          coverage: coverageNow(),
          bm25Only: true as const,
          error: err instanceof Error ? err.message : String(err),
          hits: [] as [],
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
          const unsupported = unsupportedFileAnswer(
            options.filePath,
            'reindex',
          );
          if (unsupported !== undefined) return unsupported;
          const stats = await indexer.reindexFile(
            options.filePath,
            workspaceRoot,
          );
          return {
            coverage: stats.coverage,
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

/**
 * The coverage of a search that read rows between two coverage reads. A
 * write that was pending when the read began may have cleared rows the
 * search then missed, even if it has finished by now, so the answer stays
 * `updating` (or worse); otherwise the later read stands.
 */
function spanningRead(
  before: LanguageCoverage,
  after: LanguageCoverage,
): LanguageCoverage {
  if (before.state !== 'updating' || after.state !== 'current') return after;
  return withCoverageVerdict({ ...after, state: 'updating' });
}

/**
 * Coverage when no indexer can describe the rows (a host without one, or a
 * failed read): nothing was enumerated, so it is never clean.
 */
function unknownIndexCoverage(): LanguageCoverage {
  return withCoverageVerdict({
    supportedLanguages: supportedLanguagesFor('codeIndex'),
    census: 'unknown',
    analyzed: null,
    unchecked: null,
    failed: null,
    unsupported: null,
    unrecognised: null,
    nonSource: null,
    excluded: null,
    omittedByCap: null,
  });
}

/**
 * The `unsupported-language` answer for a file the code index cannot hold,
 * or `undefined` when it can. A search filter is answered only when its
 * extension names a recognised language without `codeIndex` (a filter
 * without one, such as a directory, is an ordinary substring filter); a
 * reindex target is answered whenever its extension is not indexable.
 */
function unsupportedFileAnswer(
  filePath: string,
  use: 'search' | 'reindex',
): UnsupportedLanguageAnswer | undefined {
  const fileClass = classifyFileForCoverage(filePath, 'codeIndex');
  if (fileClass === 'eligible') return undefined;
  if (use === 'search' && fileClass !== 'unsupported') return undefined;
  const extension = path.extname(filePath).toLowerCase();
  const language =
    languageForExtension(extension) ??
    (extension === '' ? 'unknown' : extension);
  const supportedLanguages = supportedLanguagesFor('codeIndex');
  const subject =
    language === extension || language === 'unknown'
      ? `Files with extension "${extension}"`
      : `${language} files (${extension})`;
  const outcome =
    use === 'search'
      ? 'have no symbols in the code symbol index on this host, so nothing was searched'
      : 'are not indexed by the code symbol index on this host, so nothing was reindexed';
  return {
    status: 'unsupported-language',
    language,
    supportedLanguages,
    message:
      `${subject} ${outcome}. Indexed languages: ${supportedLanguages.join(', ')}. ` +
      'Use ptah_search_files or Grep for this file.',
  };
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
