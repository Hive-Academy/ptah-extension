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
import { IgnorePatternResolverService } from './ignore-pattern-resolver.service';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';
import { FileTypeClassifierService } from '../context-analysis/file-type-classifier.service';
import { FileIndex, IndexedFile } from '../types/workspace.types';

/**
 * Error codes that mean "this path does not resolve to a file right now".
 *
 * TASK_2026_306 defect D. `discoverFiles()` and the per-entry `stat()` are two
 * separate trips to disk, so anything that vanishes, or never resolved in the
 * first place, lands here:
 *
 *  - `ENOENT`  — a broken symlink, or a file deleted between the two trips.
 *  - `ENOTDIR` — an ancestor directory was replaced by a file mid-scan, so a
 *                path component no longer resolves.
 *  - `ELOOP`   — a symlink cycle; the entry can never be statted.
 *
 * All three are ordinary conditions in a live workspace, not defects, and all
 * three are per-entry. Codes NOT listed here (`EACCES`, `EMFILE`, `EIO`, …)
 * describe the environment rather than the entry and are still propagated —
 * "the whole index aborted" is the honest outcome for those.
 */
const MISSING_ENTRY_CODES: ReadonlySet<string> = new Set([
  'ENOENT',
  'ENOTDIR',
  'ELOOP',
]);

/**
 * Whether `error` (or anything in its `cause` chain) is a per-entry
 * "path does not resolve" failure.
 *
 * Walks the chain because `FileSystemService.stat()` re-throws every driver
 * failure as a `FileSystemError` whose message is a fixed
 * `Failed to stat: <path>` string — the errno lives only on the wrapped cause
 * (`services/file-system.service.ts:69-78`). Matching on `code` rather than on
 * that message keeps the check working if the wrapper's wording ever changes,
 * and keeps it from matching a genuine error that merely mentions "ENOENT".
 */
function isMissingEntryError(error: unknown): boolean {
  let current: unknown = error;
  // Bounded so a self-referential `cause` cannot spin here.
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && MISSING_ENTRY_CODES.has(code)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
   * `stat` one discovered entry, yielding `null` instead of throwing when the
   * entry simply is not there.
   *
   * TASK_2026_306 defect D: an unguarded `stat` made one missing file abort the
   * index for the ENTIRE workspace — the caller
   * (`WorkspaceFileIndexService.doStart`) logged it non-fatally, so the app then
   * ran with no file index at all and no further signal. A single broken
   * symlink under `.claude/skills/` did exactly that in the captured boot.
   *
   * Only the per-entry codes in {@link MISSING_ENTRY_CODES} are absorbed;
   * everything else still propagates, because a failure that is not about this
   * one entry will not be about the next one either.
   */
  private async statOrNull(filePath: string): Promise<FileStat | null> {
    try {
      return await this.fileSystemService.stat(filePath);
    } catch (error: unknown) {
      if (isMissingEntryError(error)) {
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
    let skippedMissing = 0;

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
        if (excluded && excluded.length > 0) {
          continue; // Skip excluded files
        }
      }
      const stat = await this.statOrNull(filePath);
      if (!stat) {
        skippedMissing++;
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
      skippedMissing,
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

    let skippedMissing = 0;
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
          if (excluded && excluded.length > 0) {
            continue;
          }
        }
        const stat = await this.statOrNull(filePath);
        if (!stat) {
          skippedMissing++;
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
        skippedMissing,
        allFiles.length,
      );
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
