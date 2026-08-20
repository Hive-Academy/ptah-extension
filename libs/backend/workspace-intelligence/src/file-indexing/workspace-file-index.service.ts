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
 *
 * ---------------------------------------------------------------------------
 * ROOT MODEL — read this before threading a workspace root through (TASK_2026_200)
 * ---------------------------------------------------------------------------
 *
 * **This service holds SINGLE-ACTIVE-ROOT state with rebuild-on-change.** It is
 * NOT a root-keyed map, and that is a deliberate decision (context.md §7.2 of
 * TASK_2026_200): the frontend model is one active workspace at a time
 * (`TabManagerService` swaps between per-workspace tab partitions), so a
 * concurrent multi-root index is explicitly out of scope. At any instant there
 * is exactly one indexed root; asking for a different one TEARS DOWN and
 * REBUILDS.
 *
 * The public contract:
 *
 *   - `ensureReadyFor(root)` — **the entry point for a caller that knows which
 *     root it wants.** Guarantees that, when it resolves, the in-memory index
 *     holds `root` and nothing else. If a different root is currently indexed
 *     it is superseded (watcher disposed, maps cleared, rebuild started); if
 *     the same root is already built or building, it is a no-op that shares the
 *     existing build. Roots are compared by `normalizeWorkspaceRoot`, so
 *     `D:\proj`, `D:\proj\` and `d:\proj` are ONE root and never force a
 *     redundant rebuild.
 *   - `ensureReady()` — for callers with no opinion. Re-resolves
 *     `IWorkspaceProvider.getWorkspaceRoot()` on EVERY call and delegates to
 *     `ensureReadyFor`. It deliberately does not short-circuit on "already
 *     started": that short-circuit was the TASK_2026_200 defect (the picker
 *     served the boot workspace's files for the whole process lifetime).
 *   - `start(root)` — the activation-time alias for `ensureReadyFor(root)`,
 *     kept for the existing fire-and-forget boot call sites.
 *   - `indexedRoot` — the normalized root the current snapshot represents, or
 *     `undefined` before the first build. A caller that must not serve another
 *     root's files (the R5 "loud mismatch" rule) can compare against this.
 *
 * Consequences a caller must respect:
 *   - Because there is one root, a request for root B invalidates root A. Do
 *     not interleave per-request roots on a hot path without deciding what
 *     "wrong root" should mean for the caller (rebuild vs. explicit error) —
 *     silently returning the other root's files is the bug this all exists to
 *     kill.
 *   - Rebuilds SUPERSEDE rather than interleave. Every build carries a
 *     generation token; a superseded build stops feeding the maps immediately,
 *     so a slow build for A can never contaminate B's snapshot.
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import picomatch from 'picomatch';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
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

  /** Raw root string the current snapshot was built from (host-native form). */
  private workspaceRoot: string | undefined;
  /**
   * `normalizeWorkspaceRoot(workspaceRoot)` — the identity key. All root
   * comparisons go through this so separator/drive-case variants of one
   * workspace never force a redundant rebuild.
   */
  private rootKey: string | undefined;
  private watcher: IFileWatcher | undefined;
  private startPromise: Promise<void> | undefined;
  private started = false;

  /**
   * Monotonic build generation. Bumped synchronously by every
   * {@link ensureReadyFor} that decides to rebuild, BEFORE any await, so a
   * build already in flight can detect that it has been superseded and stop
   * writing into the maps. Without this the `files.clear()` at the head of
   * `build()` is racy: a slow stream for root A would keep calling
   * `addFileEntry` into the freshly-cleared maps that now belong to root B.
   */
  private generation = 0;

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
   * Explicitly start the index for a workspace. Activation-time alias for
   * {@link ensureReadyFor} — kept so the existing fire-and-forget boot call
   * sites (`boot-thoth-runtime.ts`, `wire-runtime.ts`) read naturally.
   * Idempotent per NORMALIZED root; concurrent callers share one build.
   */
  start(workspaceRoot: string): Promise<void> {
    return this.ensureReadyFor(workspaceRoot);
  }

  /**
   * Ensure the in-memory index holds exactly `root` when this resolves.
   *
   * This is the entry point for any caller that knows which workspace it wants
   * (an RPC carrying an explicit `workspaceRoot`, the `workspace:switch`
   * handler, activation). See the ROOT MODEL block in this file's header: the
   * service is single-active-root, so requesting a different root supersedes
   * the current one rather than adding to it.
   *
   * - Same normalized root, build in flight or complete → shares that build,
   *   no rebuild (`D:\proj`, `D:\proj\` and `d:\proj` are one root).
   * - Different normalized root → dispose the watcher, drop the snapshot,
   *   rebuild. Any in-flight build for the old root is superseded via the
   *   generation token and stops writing immediately.
   * - Same root but a previous build FAILED (`startPromise` was reset) →
   *   retries, preserving the existing retry-on-next-query behaviour.
   */
  ensureReadyFor(root: string): Promise<void> {
    const key = normalizeWorkspaceRoot(root);
    if (this.rootKey === key && this.startPromise) {
      return this.startPromise;
    }

    // Supersede synchronously — before any await — so an in-flight build for
    // the previous root can never write into the new root's maps.
    const generation = ++this.generation;
    this.disposeWatcher();
    this.started = false;
    this.workspaceRoot = root;
    this.rootKey = key;
    this.startPromise = this.doStart(root, generation);
    return this.startPromise;
  }

  /**
   * Ensure the index is ready for whatever root the platform currently reports.
   *
   * Re-resolves `IWorkspaceProvider.getWorkspaceRoot()` on EVERY call. It used
   * to short-circuit on a `started` flag that was set once and never cleared,
   * which pinned the index to the boot workspace for the whole process lifetime
   * — the TASK_2026_200 defect. When the reported root has not changed this is
   * still a cheap no-op (normalized key compare, no rebuild).
   */
  async ensureReady(): Promise<void> {
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) {
      // The provider reports no root (no folder open / all folders closed).
      // Do NOT tear down a good snapshot — a query is better served by the
      // last known index than by nothing. Just settle any in-flight build.
      if (this.startPromise) await this.startPromise;
      return;
    }
    await this.ensureReadyFor(root);
  }

  private async doStart(
    workspaceRoot: string,
    generation: number,
  ): Promise<void> {
    try {
      await this.build(workspaceRoot, generation);
      // A newer root was requested while this build ran: its rebuild owns the
      // maps and the watcher now. Exit without arming a watcher for a root
      // nobody is looking at.
      if (generation !== this.generation) return;
      this.setupWatcher(workspaceRoot, generation);
      this.started = true;
      this.logger.info(
        `[WorkspaceFileIndex] Ready: ${this.files.size} files, ${this.directories.size} directories`,
      );
    } catch (error: unknown) {
      // A superseded build's failure is not the current build's problem, and
      // must not reset the live `startPromise` that now belongs to a newer
      // root. Swallow it.
      if (generation !== this.generation) return;
      this.logger.error('[WorkspaceFileIndex] Failed to start', error);
      // Reset so a later query can retry the build.
      this.startPromise = undefined;
      throw error;
    }
  }

  private async build(
    workspaceRoot: string,
    generation: number,
  ): Promise<void> {
    this.files.clear();
    this.directories.clear();

    // Parse into a LOCAL first, then publish behind the generation check.
    // `ignoreFiles` is shared mutable state read by `isExcluded()` on every
    // watcher create/change event, so a late-landing build for a superseded
    // root must never publish its rules: root B's index would keep filtering
    // its incremental updates through root A's .gitignore for the rest of its
    // lifetime. Assigning before the check (either branch — the `catch`
    // fallback contaminates just as effectively as the success value) is the
    // same cross-root contamination this service exists to prevent, relocated
    // from the bulk path to the incremental one.
    let parsed: ParsedIgnoreFile[];
    try {
      parsed =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceRoot);
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] Failed to parse ignore files (continuing)',
        error,
      );
      parsed = [];
    }
    if (generation !== this.generation) return;
    this.ignoreFiles = parsed;

    for await (const file of this.indexer.indexWorkspaceStream({
      workspaceFolder: workspaceRoot,
    })) {
      // Checked per entry, not once up front: the stream is long-lived and a
      // switch can land at any point inside it. Without this, entries for the
      // superseded root keep landing in the new root's maps and the picker
      // serves a mixed index.
      if (generation !== this.generation) return;
      this.addFileEntry(file.path, workspaceRoot);
    }
  }

  /**
   * Dispose the current watcher, if any, and drop the reference.
   *
   * Called before every re-arm. `setupWatcher` used to overwrite `this.watcher`
   * outright, which leaked one OS file-watch handle per workspace switch once
   * rebuilds became possible. Clearing the field guarantees a given watcher is
   * disposed exactly once, and a throwing `dispose()` never blocks the rebuild.
   */
  private disposeWatcher(): void {
    const watcher = this.watcher;
    if (!watcher) return;
    this.watcher = undefined;
    try {
      watcher.dispose();
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] failed to dispose previous watcher',
        error,
      );
    }
  }

  private setupWatcher(workspaceRoot: string, generation: number): void {
    // Defensive: rebuilds dispose in `ensureReadyFor`, but never let a second
    // watcher be armed over a live one.
    this.disposeWatcher();
    try {
      const watcher = this.fsProvider.createFileWatcher('**/*', {
        exclude: [...DEFAULT_WORKSPACE_EXCLUDES],
        cwd: workspaceRoot,
      });
      this.watcher = watcher;
      // Every handler is generation-gated: an event that a disposed watcher
      // already had in flight must not patch a newer root's snapshot. The gate
      // here is necessary but NOT sufficient for the async handlers — they
      // await inside, so they re-check at their write. See `onCreate`.
      watcher.onDidCreate((p) => {
        if (generation !== this.generation) return;
        void this.onCreate(p, generation);
      });
      watcher.onDidChange((p) => {
        if (generation !== this.generation) return;
        void this.onChange(p, generation);
      });
      watcher.onDidDelete((p) => {
        if (generation !== this.generation) return;
        this.onDelete(p);
      });
    } catch (error: unknown) {
      // A host without a real watcher degrades to a static snapshot — still
      // correct, just not live. Re-indexing must never start throwing here.
      this.logger.warn(
        '[WorkspaceFileIndex] watcher unavailable (index will not stay live)',
        error,
      );
    }
  }

  /**
   * The caller's gate in `setupWatcher` is NOT enough on its own: `isExcluded`
   * awaits `isIgnored` whenever the workspace has any ignore file — the normal
   * case — so a workspace switch can land in that window. Without the re-check
   * below, a create event for root A resuming after a switch writes an
   * A-rooted path into root B's live maps, and the `@` picker lists a file
   * from the wrong workspace. `root` is captured pre-await too, so the
   * re-check also guards against writing with a stale root.
   *
   * Rule for this file: a generation check upstream does not protect a write
   * that sits behind an `await`. Re-check immediately before the write.
   */
  private async onCreate(absPath: string, generation: number): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) return;
    if (this.files.has(absPath)) return;
    if (await this.isExcluded(absPath, root)) return;
    if (generation !== this.generation) return;
    this.addFileEntry(absPath, root);
  }

  private async onChange(absPath: string, generation: number): Promise<void> {
    const root = this.workspaceRoot;
    if (!root) return;
    // Content changes carry no metadata we track. Re-add only if a prior create
    // event was missed and the path is not ignored.
    if (this.files.has(absPath)) return;
    if (await this.isExcluded(absPath, root)) return;
    if (generation !== this.generation) return;
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

  /** Whether a build has completed for the currently requested root. */
  isReady(): boolean {
    return this.started;
  }

  /**
   * The `normalizeWorkspaceRoot`-canonical root the current snapshot
   * represents, or `undefined` before the first build. A caller that must not
   * serve another workspace's files can compare its requested root's
   * normalized form against this before querying.
   */
  get indexedRoot(): string | undefined {
    return this.rootKey;
  }

  /** Current file count (excludes directories). Primarily for diagnostics. */
  get fileCount(): number {
    return this.files.size;
  }

  dispose(): void {
    // Bump the generation so any build still in flight stops writing into the
    // maps we are about to clear.
    this.generation++;
    this.disposeWatcher();
    this.files.clear();
    this.directories.clear();
    this.started = false;
    this.startPromise = undefined;
    this.workspaceRoot = undefined;
    this.rootKey = undefined;
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
