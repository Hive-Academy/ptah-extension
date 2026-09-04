/**
 * Workspace Indexer Service
 *
 * Indexes all workspace files with intelligent filtering via ignore patterns
 * and file type classification. Provides async generators for large workspaces.
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  FileStat,
  IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { FileSystemService } from '../services/file-system.service';
import { TokenCounterService } from '../services/token-counter.service';
import { PatternMatcherService } from './pattern-matcher.service';
import {
  IgnorePatternResolverService,
  type ParsedIgnoreFile,
} from './ignore-pattern-resolver.service';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileIndex, IndexedFile } from '../types/workspace.types';

/**
 * Error codes that mean "THIS entry cannot be read right now" — as opposed to
 * "this machine cannot be read at all".
 *
 * The rule is about SCOPE, not about absence. A code belongs here when the
 * condition it reports is a property of one directory entry at one moment, so
 * that the very next entry, and this same entry on the next pass, may well
 * succeed. A code stays out when the condition is a property of the process or
 * the machine, because then the next entry will fail the same way and grinding
 * through thousands of them to build an empty index is worse than aborting.
 *
 * Absence (TASK_2026_306 defect D). `discoverFiles()` and the per-entry `stat()`
 * are two separate trips to disk, so anything that vanishes between them, or
 * never resolved in the first place, lands here:
 *
 *  - `ENOENT`  — a broken symlink, or a file deleted between the two trips.
 *  - `ENOTDIR` — an ancestor directory was replaced by a file mid-scan, so a
 *                path component no longer resolves.
 *  - `ELOOP`   — a symlink cycle; the entry can never be statted.
 *
 * Windows file LOCKING (TASK_2026_307). This is the half the original set got
 * wrong, so do not re-remove these two:
 *
 *  - `EPERM`   — Windows reports a sharing violation as a permission error. A
 *                file held open by an editor, an antivirus scanner, the running
 *                Electron host, or the Claude CLI writing a session file is
 *                `EPERM`, NOT `ENOENT`.
 *  - `EBUSY`   — the same class of lock, reported while the file is actively
 *                being written.
 *
 * `ENOENT` was the Unix-shaped assumption, and it made the guard nearly useless
 * on the platform Ptah primarily ships to: the workspace being indexed is by
 * definition the one the user has open in an editor, so a locked entry is the
 * expected case rather than an exotic one. Both codes are per-entry and
 * TRANSIENT — the lock is released moments later — so one of them escaping the
 * absorb emptied the entire index, and the next pass then succeeded with
 * nothing correlating the two. The in-repo precedent for this hazard is
 * `harness-sync`'s `fs/windows-retry.ts` `RETRYABLE_ERROR_CODES`, written for
 * exactly these Windows semantics.
 *
 * `EACCES` is DELIBERATELY EXCLUDED, and that is a real divergence from the
 * `harness-sync` set rather than an oversight. On Windows a transient lock is
 * `EPERM`/`EBUSY`; `EACCES` is a durable ACL decision about a path this process
 * has no right to read, and it will be just as true for the next entry and on
 * the next pass. Absorbing it would convert a permanent, actionable "you cannot
 * read this tree" into a permanently and silently partial index, which is the
 * exact failure this whole guard exists to prevent, one level down. The
 * divergence is also smaller than it looks: `harness-sync` RETRIES `EACCES` on a
 * WRITE and then still fails that path — it never decides the failure did not
 * matter. Absorbing is the stronger claim and `EACCES` does not earn it.
 * `EMFILE`, `EIO` and everything else unlisted stay out for the same
 * scope reason, and still abort the pass.
 *
 * There is deliberately no per-entry RETRY here, unlike `withWindowsRetry`. That
 * function guards a one-shot destructive move where a failure loses the user's
 * only undo, so three attempts with backoff over a handful of paths is cheap
 * insurance. This is a read-only pass over every file in a workspace: the cost
 * of a backoff is multiplied by the entry count, and the recovery is already
 * free, because the index is derived and is rebuilt on the next activation or
 * session preflight. Skipping the entry and reporting the count via
 * {@link WorkspaceIndexerService.reportSkipped} gets the same durable outcome
 * without turning a bounded walk into an unbounded one during a scanner sweep.
 */
const UNREADABLE_ENTRY_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
  'EPERM',
  'EBUSY',
]);

/**
 * Whether `error` (or anything in its `cause` chain) is a per-entry
 * "cannot read this entry right now" failure.
 *
 * Walks the chain because `FileSystemService.stat()` re-throws every driver
 * failure as a `FileSystemError` whose message is a fixed
 * `Failed to stat: <path>` string — the errno lives only on the wrapped cause
 * (`services/file-system.service.ts:69-78`). Matching on `code` rather than on
 * that message keeps the check working if the wrapper's wording ever changes,
 * and keeps it from matching a genuine error that merely mentions "ENOENT".
 */
function isUnreadableEntryError(error: unknown): boolean {
  let current: unknown = error;
  // Bounded so a self-referential `cause` cannot spin here.
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && UNREADABLE_ENTRY_CODES.has(code)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Paths per batch yielded by
 * {@link WorkspaceIndexerService.discoverWorkspacePaths}.
 *
 * Large enough that a 15k-file workspace costs ~30 yields rather than 15k, and
 * small enough that the synchronous run between two yields stays far under the
 * 250 ms the event-loop monitor warns at.
 */
export const DISCOVERY_BATCH_SIZE = 500;

/**
 * Hand the event loop a turn.
 *
 * `setImmediate` rather than `Promise.resolve()`: a resolved promise is a
 * MICROtask, so awaiting it drains back into the same loop turn and starves
 * timers, I/O callbacks and IPC exactly as the uninterrupted loop did. Same
 * reasoning, same idiom as `CodeSymbolIndexer`.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Workspace indexing options
 */
export interface WorkspaceIndexOptions {
  /** Include patterns (glob) - if empty, includes all files */
  includePatterns?: string[];
  /** Exclude patterns (glob) - takes precedence over include */
  excludePatterns?: string[];
  /** Whether to respect .gitignore and other ignore files */
  respectIgnoreFiles?: boolean;
  /** Maximum file size to index (in bytes) - default 1MB */
  maxFileSize?: number;
  /** Whether to estimate token counts for files */
  estimateTokens?: boolean;
  /**
   * Workspace folder to index.
   *
   * TASK_2026_200 task 3.5 — there is deliberately NO fallback to the
   * process-global `IWorkspaceProvider` any more. The private
   * `getDefaultWorkspaceFolder()` helper that used to supply one was reachable
   * from `ptah_context_optimize`, `ptah_relevance_score_file` and
   * `ptah_relevance_rank_files`, all of which had a session-aware provider in
   * hand and still silently indexed the IDE's folder instead of the calling
   * session's root. Callers must state the root; omitting it now yields an
   * explicit "No workspace folder available for indexing" error rather than a
   * quietly wrong workspace.
   */
  workspaceFolder?: string;
}

/**
 * Workspace indexing progress callback
 */
export interface IndexingProgress {
  /** Current file being indexed */
  currentFile: string;
  /** Number of files indexed so far */
  filesIndexed: number;
  /** Total files discovered (may increase during indexing) */
  totalFiles: number;
  /** Percentage complete (0-100) */
  percentComplete: number;
}

/**
 * Service for indexing workspace files with filtering and classification
 *
 * This service ties together:
 * - FileSystemService: Reading directories and files
 * - PatternMatcherService: Glob pattern matching
 * - IgnorePatternResolverService: Ignore file parsing
 * - FileTypeClassifierService: File type detection
 * - TokenCounterService: Token count estimation
 */
@injectable()
export class WorkspaceIndexerService {
  private readonly defaultMaxFileSize = 1024 * 1024; // 1MB

  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystemService: FileSystemService,
    @inject(TOKENS.PATTERN_MATCHER_SERVICE)
    private readonly patternMatcher: PatternMatcherService,
    @inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)
    private readonly ignoreResolver: IgnorePatternResolverService,
    @inject(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE)
    private readonly fileClassifier: FileTypeClassifierService,
    @inject(TOKENS.TOKEN_COUNTER_SERVICE)
    private readonly tokenCounter: TokenCounterService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
  ) {}

  /**
   * `stat` one discovered entry, yielding `null` instead of throwing when that
   * one entry cannot be read right now.
   *
   * TASK_2026_306 defect D: an unguarded `stat` made one missing file abort the
   * index for the ENTIRE workspace — the caller
   * (`WorkspaceFileIndexService.doStart`) logged it non-fatally, so the app then
   * ran with no file index at all and no further signal. A single broken
   * symlink under `.claude/skills/` did exactly that in the captured boot.
   * TASK_2026_307: a single Windows-locked file did the same thing, because the
   * lock codes were not in the set.
   *
   * Only the per-entry codes in {@link UNREADABLE_ENTRY_CODES} are absorbed;
   * everything else still propagates, because a failure that is not about this
   * one entry will not be about the next one either.
   */
  private async statOrNull(filePath: string): Promise<FileStat | null> {
    try {
      return await this.fileSystemService.stat(filePath);
    } catch (error: unknown) {
      if (isUnreadableEntryError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Emit the per-run summary of entries skipped by {@link statOrNull}.
   *
   * Silence here would reproduce the defect this fix exists to remove, one
   * level down: an index quietly missing 40% of a workspace is as useless as no
   * index, and just as invisible. Logged once per run rather than per entry —
   * a workspace with thousands of stale entries must not flood the output.
   */
  private reportSkipped(
    operation: string,
    workspaceFolder: string,
    skipped: number,
    discovered: number,
  ): void {
    if (skipped === 0) return;
    this.logger.warn(
      `[WorkspaceIndexer] ${operation}: skipped entries that could not be statted`,
      { workspaceFolder, skipped, discovered },
    );
  }

  /**
   * Index all files in a workspace folder
   *
   * @param options - Indexing options
   * @param onProgress - Optional progress callback
   * @returns File index with all indexed files
   */
  public async indexWorkspace(
    options: WorkspaceIndexOptions = {},
    onProgress?: (progress: IndexingProgress) => void,
  ): Promise<FileIndex> {
    const workspaceFolder = options.workspaceFolder;

    if (!workspaceFolder) {
      throw new Error('No workspace folder available for indexing');
    }

    const maxFileSize = options.maxFileSize ?? this.defaultMaxFileSize;
    const respectIgnoreFiles = options.respectIgnoreFiles ?? true;
    const ignoredPatterns: string[] = [];
    let parsedIgnoreFiles: Awaited<
      ReturnType<typeof this.ignoreResolver.parseWorkspaceIgnoreFiles>
    > = [];

    if (respectIgnoreFiles) {
      parsedIgnoreFiles =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceFolder);
      for (const ignoreFile of parsedIgnoreFiles) {
        ignoredPatterns.push(...ignoreFile.patterns.map((p) => p.pattern));
      }
    }
    if (options.excludePatterns) {
      ignoredPatterns.push(...options.excludePatterns);
    }
    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns,
    );
    const indexedFiles: IndexedFile[] = [];
    let filesIndexed = 0;
    let skippedEntries = 0;

    for (const filePath of allFiles) {
      const relativePath = path.relative(workspaceFolder, filePath);
      if (respectIgnoreFiles && parsedIgnoreFiles.length > 0) {
        const ignoreResult = await this.ignoreResolver.isIgnored(
          relativePath,
          parsedIgnoreFiles,
        );
        if (ignoreResult.ignored) {
          continue; // Skip ignored files
        }
      }
      if (options.excludePatterns && options.excludePatterns.length > 0) {
        const excluded = this.patternMatcher.matchFiles(
          [relativePath],
          options.excludePatterns,
        );
        // `matchFiles` returns one result per INPUT path, so its length is 1
        // for this single-path call whether or not the path matched. Read the
        // per-file `matched` flag; the length says only that we asked.
        if (excluded && excluded[0]?.matched) {
          continue; // Skip excluded files
        }
      }
      const stat = await this.statOrNull(filePath);
      if (!stat) {
        skippedEntries++;
        continue;
      }
      if (stat.size > maxFileSize) {
        continue;
      }
      const classification = this.fileClassifier.classifyFile(relativePath);
      let estimatedTokens = 0;
      if (options.estimateTokens) {
        try {
          const content = await this.fileSystemService.readFile(filePath);
          estimatedTokens = await this.tokenCounter.countTokens(content);
        } catch {
          continue;
        }
      }
      const indexedFile: IndexedFile = {
        path: filePath,
        relativePath,
        type: classification.type,
        size: stat.size,
        language: classification.language,
        estimatedTokens,
      };

      indexedFiles.push(indexedFile);
      filesIndexed++;
      if (onProgress) {
        onProgress({
          currentFile: relativePath,
          filesIndexed,
          totalFiles: allFiles.length,
          percentComplete: Math.round((filesIndexed / allFiles.length) * 100),
        });
      }
    }
    this.reportSkipped(
      'indexWorkspace',
      workspaceFolder,
      skippedEntries,
      allFiles.length,
    );
    const totalSize = indexedFiles.reduce((sum, file) => sum + file.size, 0);

    return {
      files: indexedFiles,
      ignoredPatterns,
      totalFiles: indexedFiles.length,
      totalSize,
    };
  }

  /**
   * Index workspace files as an async generator for memory efficiency
   *
   * Useful for very large workspaces where loading all files at once
   * would consume too much memory.
   *
   * @param options - Indexing options
   * @yields Indexed files one at a time
   */
  public async *indexWorkspaceStream(
    options: WorkspaceIndexOptions = {},
  ): AsyncGenerator<IndexedFile, void, undefined> {
    const workspaceFolder = options.workspaceFolder;

    if (!workspaceFolder) {
      throw new Error('No workspace folder available for indexing');
    }

    const maxFileSize = options.maxFileSize ?? this.defaultMaxFileSize;
    const respectIgnoreFiles = options.respectIgnoreFiles ?? true;
    let parsedIgnoreFiles: Awaited<
      ReturnType<typeof this.ignoreResolver.parseWorkspaceIgnoreFiles>
    > = [];

    if (respectIgnoreFiles) {
      parsedIgnoreFiles =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceFolder);
    }
    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns,
    );

    let skippedEntries = 0;
    // `finally` rather than a trailing statement: the consumer
    // (`WorkspaceFileIndexService.build`) `return`s out of its `for await` when
    // the workspace root changes mid-stream, which closes the generator without
    // running the loop to completion. The summary must still be emitted for the
    // work that did happen.
    try {
      for (const filePath of allFiles) {
        const relativePath = path.relative(workspaceFolder, filePath);
        if (respectIgnoreFiles && parsedIgnoreFiles.length > 0) {
          const ignoreResult = await this.ignoreResolver.isIgnored(
            relativePath,
            parsedIgnoreFiles,
          );
          if (ignoreResult.ignored) {
            continue;
          }
        }
        if (options.excludePatterns && options.excludePatterns.length > 0) {
          const excluded = this.patternMatcher.matchFiles(
            [relativePath],
            options.excludePatterns,
          );
          // One result per INPUT path — see `indexWorkspace` above.
          if (excluded && excluded[0]?.matched) {
            continue;
          }
        }
        const stat = await this.statOrNull(filePath);
        if (!stat) {
          skippedEntries++;
          continue;
        }
        if (stat.size > maxFileSize) {
          continue;
        }
        const classification = this.fileClassifier.classifyFile(relativePath);
        let estimatedTokens = 0;
        if (options.estimateTokens) {
          try {
            const content = await this.fileSystemService.readFile(filePath);
            estimatedTokens = await this.tokenCounter.countTokens(content);
          } catch {
            continue;
          }
        }
        yield {
          path: filePath,
          relativePath,
          type: classification.type,
          size: stat.size,
          language: classification.language,
          estimatedTokens,
        };
      }
    } finally {
      this.reportSkipped(
        'indexWorkspaceStream',
        workspaceFolder,
        skippedEntries,
        allFiles.length,
      );
    }
  }

  /**
   * Discover workspace file PATHS, in batches, doing nothing else.
   *
   * The `@`-mention file index needs paths and nothing more — no size, no
   * mtime, no language classification — but it used to consume
   * {@link indexWorkspaceStream}, which per file awaits
   * `IgnorePatternResolverService.isIgnored` (every pattern of every ignore file
   * through the shared `PatternMatcherService`, building a string cache key per
   * call), awaits a `stat`, and runs the classifier. On a 15k-file workspace
   * that is 15k serialized stat round-trips on the Electron MAIN loop, measured
   * at 8-15 s per workspace switch (TASK_2026_344). This generator drops all
   * three:
   *
   *  - ignore rules are compiled ONCE into a synchronous predicate
   *    (`compileMatcher`), so filtering is a tight in-memory loop;
   *  - nothing is statted, read or classified;
   *  - control returns to the event loop between batches, so a long walk cannot
   *    monopolise the loop the way one uninterrupted `for` over 15k paths does.
   *    Same idiom as `CodeSymbolIndexer`'s `yieldToEventLoop`.
   *
   * {@link indexWorkspaceStream} is deliberately left alone: its other consumers
   * want the stat + classification it pays for.
   *
   * Pass `ignoreFiles` when the caller has already parsed them (the file index
   * has — it keeps them for its watcher re-checks) to avoid a second read of
   * every ignore file in the workspace.
   *
   * @yields Batches of absolute file paths
   */
  public async *discoverWorkspacePaths(options: {
    workspaceFolder: string;
    /** Paths per yielded batch. Default {@link DISCOVERY_BATCH_SIZE}. */
    batchSize?: number;
    /** Already-parsed ignore files; parsed here when omitted. */
    ignoreFiles?: ParsedIgnoreFile[];
  }): AsyncGenerator<readonly string[], void, undefined> {
    const workspaceFolder = options.workspaceFolder;
    if (!workspaceFolder) {
      throw new Error('No workspace folder available for indexing');
    }
    const batchSize =
      options.batchSize && options.batchSize > 0
        ? options.batchSize
        : DISCOVERY_BATCH_SIZE;

    const ignoreFiles =
      options.ignoreFiles ??
      (await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceFolder));
    const isIgnored = this.ignoreResolver.compileMatcher(
      ignoreFiles,
      workspaceFolder,
    );

    const allFiles = await this.discoverFiles(workspaceFolder);

    let batch: string[] = [];
    for (const filePath of allFiles) {
      const relativePath = path.relative(workspaceFolder, filePath);
      if (isIgnored(relativePath)) {
        continue;
      }
      batch.push(filePath);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
        // AFTER the yield, so the consumer has already absorbed the batch: the
        // pause is what keeps the walk off the critical path, not a delay in
        // delivering it.
        await yieldToEventLoop();
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Get total file count in workspace (without full indexing)
   *
   * Useful for progress estimation before indexing starts.
   *
   * @param options - Indexing options
   * @returns Estimated file count
   */
  public async getFileCount(
    options: WorkspaceIndexOptions = {},
  ): Promise<number> {
    const workspaceFolder = options.workspaceFolder;

    if (!workspaceFolder) {
      return 0;
    }

    const allFiles = await this.discoverFiles(
      workspaceFolder,
      options.includePatterns,
    );

    return allFiles.length;
  }

  /**
   * Discover all files in workspace folder matching include patterns
   *
   * @param workspaceFolder - Workspace folder path
   * @param includePatterns - Optional glob patterns to include
   * @returns Array of absolute file paths
   */
  private async discoverFiles(
    workspaceFolder: string,
    includePatterns?: string[],
  ): Promise<string[]> {
    const pattern = includePatterns?.length
      ? `{${includePatterns.join(',')}}`
      : '**/*';

    const files = await this.fsProvider.findFiles(
      pattern,
      [...DEFAULT_WORKSPACE_EXCLUDES],
      undefined,
      workspaceFolder,
    );

    return files;
  }
}
