/**
 * Workspace File Index Service
 *
 * A thin, live, in-memory index of workspace files (and their directories)
 * purpose-built for the `@`-mention file autocomplete. Unlike
 * `WorkspaceIndexerService` (stateless / one-shot, stats + classifies every
 * file per call), this service:
 *
 *   1. Builds the file list ONCE by reusing
 *      `WorkspaceIndexerService.indexWorkspaceStream({})` for discovery, so the
 *      glob + ignore logic stays DRY (no re-implemented globbing here). It does
 *      NOT stat or read files — autocomplete needs only path metadata.
 *   2. Stays live via a single `IFileSystemProvider` watcher: create/delete/
 *      change events patch the in-memory maps. node_modules and the other
 *      default-excluded trees are excluded at the OS level (the watcher is
 *      created with `{ exclude: DEFAULT_WORKSPACE_EXCLUDES }`), and created
 *      paths are re-checked against the ignore rules so a file created under an
 *      ignored directory never enters the index.
 *   3. Exposes SYNCHRONOUS query methods (`search`, `getAll`,
 *      `searchDirectories`) returning the same `FileSearchResult` shape the
 *      autocomplete pipeline already consumes. `ensureReady()` performs the
 *      lazy first build; queries operate on the current in-memory snapshot.
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import picomatch from 'picomatch';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  IFileWatcher,
} from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from './workspace-indexer.service';
import {
  IgnorePatternResolverService,
  type ParsedIgnoreFile,
} from './ignore-pattern-resolver.service';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';

const LOGGER = Symbol.for('Logger');

/**
 * Logger interface (avoids a hard dependency on vscode-core's concrete Logger).
 */
interface ILogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, error?: unknown): void;
  debug(message: string, ...args: unknown[]): void;
}

/**
 * File search result with metadata for `@` syntax autocomplete.
 *
 * Kept structurally identical to what `ContextService` used to return so the
 * RPC contract (and the frontend file-picker) is unchanged. `size` and
 * `lastModified` are always 0 here — the index intentionally avoids stat calls;
 * the frontend Number()-coerces both with `?? 0`.
 */
export interface FileSearchResult {
  readonly path: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly fileType: 'text' | 'image' | 'binary' | 'unknown';
  readonly size: number;
  readonly lastModified: number;
  readonly isDirectory: boolean;
  readonly relevanceScore?: number;
}

/**
 * Lightweight in-memory entry. Deliberately excludes size/mtime.
 */
interface IndexEntry {
  readonly path: string;
  readonly relativePath: string;
  readonly fileName: string;
  readonly directory: string;
  readonly fileType: FileSearchResult['fileType'];
  readonly isDirectory: boolean;
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.svg',
  '.webp',
  '.ico',
]);
const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.yaml',
  '.yml',
]);
const BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.zip',
  '.tar',
  '.gz',
]);

@injectable()
export class WorkspaceFileIndexService {
  /** Absolute file path → entry. */
  private readonly files = new Map<string, IndexEntry>();
  /** Absolute directory path → entry. */
  private readonly directories = new Map<string, IndexEntry>();

  private workspaceRoot: string | undefined;
  private watcher: IFileWatcher | undefined;
  private startPromise: Promise<void> | undefined;
  private started = false;

  /** Parsed ignore files for the active workspace (for create re-checks). */
  private ignoreFiles: ParsedIgnoreFile[] = [];
  /** Matcher over DEFAULT_WORKSPACE_EXCLUDES for created-path re-checks. */
  private readonly defaultExcludeMatcher = picomatch(
    [...DEFAULT_WORKSPACE_EXCLUDES],
    { dot: true },
  );

  constructor(
    @inject(LOGGER) private readonly logger: ILogger,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fsProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)
    private readonly ignoreResolver: IgnorePatternResolverService,
  ) {}

  /**
   * Explicitly start the index for a workspace. Idempotent per root; concurrent
   * callers share one build. Safe to fire-and-forget from activation.
   */
  start(workspaceRoot: string): Promise<void> {
    if (this.startPromise && this.workspaceRoot === workspaceRoot) {
      return this.startPromise;
    }
    this.workspaceRoot = workspaceRoot;
    this.startPromise = this.doStart(workspaceRoot);
    return this.startPromise;
  }

  /**
   * Lazily build the index on first query if it was never started. Resolves the
   * workspace root from the workspace provider. No-op when there is no root.
   */
  async ensureReady(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) return;
    await this.start(root);
  }

  private async doStart(workspaceRoot: string): Promise<void> {
    try {
      await this.build(workspaceRoot);
      this.setupWatcher(workspaceRoot);
      this.started = true;
      this.logger.info(
        `[WorkspaceFileIndex] Ready: ${this.files.size} files, ${this.directories.size} directories`,
      );
    } catch (error) {
      this.logger.error('[WorkspaceFileIndex] Failed to start', error);
      // Reset so a later query can retry the build.
      this.startPromise = undefined;
      throw error;
    }
  }

  private async build(workspaceRoot: string): Promise<void> {
    this.files.clear();
    this.directories.clear();
    try {
      this.ignoreFiles =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceRoot);
    } catch (error) {
      this.logger.warn(
        '[WorkspaceFileIndex] Failed to parse ignore files (continuing)',
        error,
      );
      this.ignoreFiles = [];
    }

    for await (const file of this.indexer.indexWorkspaceStream({
      workspaceFolder: workspaceRoot,
    })) {
      this.addFileEntry(file.path, workspaceRoot);
    }
  }

  private setupWatcher(workspaceRoot: string): void {
    try {
      this.watcher = this.fsProvider.createFileWatcher('**/*', {
        exclude: [...DEFAULT_WORKSPACE_EXCLUDES],
        cwd: workspaceRoot,
      });
      this.watcher.onDidCreate((p) => {
        void this.onCreate(p);
      });
      this.watcher.onDidChange((p) => {
        void this.onChange(p);
      });
      this.watcher.onDidDelete((p) => {
        this.onDelete(p);
      });
    } catch (error) {
      // A host without a real watcher degrades to a static snapshot — still
      // correct, just not live.
      this.logger.warn(
        '[WorkspaceFileIndex] watcher unavailable (index will not stay live)',
        error,
      );
    }
  }

  private async onCreate(absPath: string): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) return;
    if (this.files.has(absPath)) return;
    if (await this.isExcluded(absPath, root)) return;
    this.addFileEntry(absPath, root);
  }

  private async onChange(absPath: string): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) return;
    // Content changes carry no metadata we track. Re-add only if a prior create
    // event was missed and the path is not ignored.
    if (this.files.has(absPath)) return;
    if (await this.isExcluded(absPath, root)) return;
    this.addFileEntry(absPath, root);
  }

  private onDelete(absPath: string): void {
    this.files.delete(absPath);
    // Directory entries are derived from surviving files; a stale directory
    // entry is harmless for autocomplete and cheaper than pruning on every
    // unlink. Directory deletes surface as file unlinks per child.
  }

  /**
   * Add a file entry plus its ancestor directory entries (derived from the
   * path, so they inherit the file's not-ignored status for free).
   */
  private addFileEntry(absPath: string, workspaceRoot: string): void {
    const relativePath = path.relative(workspaceRoot, absPath);
    const fileName = path.basename(absPath);
    const directory = path.dirname(absPath);
    this.files.set(absPath, {
      path: absPath,
      relativePath,
      fileName,
      directory,
      fileType: detectFileType(fileName),
      isDirectory: false,
    });
    this.addAncestorDirectories(absPath, workspaceRoot);
  }

  private addAncestorDirectories(absPath: string, workspaceRoot: string): void {
    // Derive ancestor dirs from the RELATIVE path so we never mix the
    // workspace root's native separators/drive with the POSIX separators
    // fast-glob emits. Each ancestor inherits the file's not-ignored status.
    const relative = path.relative(workspaceRoot, absPath);
    if (!relative || relative.startsWith('..')) return;
    const segments = relative.split(/[\\/]/).filter(Boolean);
    segments.pop(); // drop the file name
    const soFar: string[] = [];
    for (const segment of segments) {
      soFar.push(segment);
      const absDir = path.join(workspaceRoot, ...soFar);
      if (this.directories.has(absDir)) continue;
      this.directories.set(absDir, {
        path: absDir,
        relativePath: path.relative(workspaceRoot, absDir),
        fileName: segment,
        directory: path.dirname(absDir),
        fileType: 'unknown',
        isDirectory: true,
      });
    }
  }

  private async isExcluded(
    absPath: string,
    workspaceRoot: string,
  ): Promise<boolean> {
    const relative = path.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..')) return true;
    if (this.defaultExcludeMatcher(relative)) return true;
    if (this.ignoreFiles.length > 0) {
      try {
        const result = await this.ignoreResolver.isIgnored(
          relative,
          this.ignoreFiles,
          workspaceRoot,
        );
        if (result.ignored) return true;
      } catch (error) {
        this.logger.debug(
          '[WorkspaceFileIndex] ignore check failed (treating as not ignored)',
          error,
        );
      }
    }
    return false;
  }

  /**
   * Score + filter the in-memory file list against a query. Directories are not
   * included here (use {@link searchDirectories}); this mirrors the
   * files-only search path autocomplete relied on.
   */
  search(query: string, limit: number): FileSearchResult[] {
    if (!query) return this.getAll(limit);
    const queryLower = query.toLowerCase();
    const matches: Array<IndexEntry & { score: number }> = [];
    for (const entry of this.files.values()) {
      const score = scoreEntry(entry, queryLower);
      if (score <= 0) continue;
      matches.push({ ...entry, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map((entry) => toResult(entry, entry.score));
  }

  /**
   * Return every indexed file, then directories, up to `limit`. Used for the
   * "no query yet" suggestion list.
   */
  getAll(limit: number): FileSearchResult[] {
    const results: FileSearchResult[] = [];
    for (const entry of this.files.values()) {
      results.push(toResult(entry));
      if (results.length >= limit) return results;
    }
    for (const entry of this.directories.values()) {
      results.push(toResult(entry));
      if (results.length >= limit) return results;
    }
    return results;
  }

  /**
   * Filter directory entries by query (name or relative path substring).
   */
  searchDirectories(query: string, limit: number): FileSearchResult[] {
    const queryLower = query.toLowerCase();
    const matches: FileSearchResult[] = [];
    for (const entry of this.directories.values()) {
      if (
        entry.fileName.toLowerCase().includes(queryLower) ||
        entry.relativePath.toLowerCase().includes(queryLower)
      ) {
        matches.push(toResult(entry));
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /** Whether the first build has completed. */
  isReady(): boolean {
    return this.started;
  }

  /** Current file count (excludes directories). Primarily for diagnostics. */
  get fileCount(): number {
    return this.files.size;
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.files.clear();
    this.directories.clear();
    this.started = false;
    this.startPromise = undefined;
  }
}

/**
 * Classify a file by extension into the coarse autocomplete buckets. Kept
 * intentionally identical to the previous `ContextService.detectFileType` so
 * downstream consumers see the same `fileType` values.
 */
function detectFileType(fileName: string): FileSearchResult['fileType'] {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return 'unknown';
}

/**
 * Relevance score matching the previous `ContextService.calculateRelevanceScore`
 * so ranking behaviour is preserved. Returns 0 when the query matches nothing.
 */
function scoreEntry(entry: IndexEntry, queryLower: string): number {
  const fileNameLower = entry.fileName.toLowerCase();
  const pathLower = entry.relativePath.toLowerCase();
  let score = 0;
  if (fileNameLower === queryLower) score += 100;
  if (fileNameLower.startsWith(queryLower)) score += 50;
  if (fileNameLower.includes(queryLower)) score += 20;
  if (pathLower.includes(queryLower)) score += 10;
  if (score === 0) return 0;
  const pathDepth = entry.relativePath.split(path.sep).length;
  score += Math.max(0, 10 - pathDepth);
  return score;
}

function toResult(
  entry: IndexEntry,
  relevanceScore?: number,
): FileSearchResult {
  return {
    path: entry.path,
    relativePath: entry.relativePath,
    fileName: entry.fileName,
    fileType: entry.fileType,
    size: 0,
    lastModified: 0,
    isDirectory: entry.isDirectory,
    ...(relevanceScore !== undefined ? { relevanceScore } : {}),
  };
}
