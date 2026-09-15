/**
 * Workspace File Index Service
 *
 * A thin, live, in-memory index of workspace files (and their directories)
 * purpose-built for the `@`-mention file autocomplete. Unlike
 * `WorkspaceIndexerService.indexWorkspace*` (stats + classifies every file per
 * call), this service:
 *
 *   1. Builds each folder's file list ONCE from
 *      `WorkspaceIndexerService.discoverWorkspacePaths`, a PATH-ONLY walk that
 *      compiles the ignore rules once and yields to the event loop between
 *      batches. It does NOT stat, read or classify — autocomplete needs only
 *      path metadata, and the stat-per-file walk it used to share cost 8-15 s
 *      of Electron main-loop time per workspace switch (TASK_2026_344).
 *   2. Stays live via one `IWorkspaceWatcher` subscription PER OPEN FOLDER
 *      (TASK_2026_437 C10): each coalesced batch patches that folder's maps in
 *      one synchronous pass. node_modules, the other default-excluded trees,
 *      agent worktrees and nested repositories are excluded where the events
 *      are produced (the watch host), and new paths are re-checked against the
 *      folder's compiled ignore rules so a file created under an ignored
 *      directory never enters the index. An `overflow` batch — events lost or
 *      suppressed — rebuilds the folder once instead. That live half is the
 *      collaborator `FolderIndexLiveSync` (`folder-index-live-sync.ts`); the
 *      snapshot shape and its writers are `folder-index-snapshot.ts`.
 *   3. Exposes SYNCHRONOUS query methods (`search`, `getAll`,
 *      `searchDirectories`) returning the same `FileSearchResult` shape the
 *      autocomplete pipeline already consumes. `ensureReady()` performs the
 *      lazy first build; queries operate on the ACTIVE folder's snapshot.
 *
 * ---------------------------------------------------------------------------
 * ROOT MODEL — read this before threading a workspace root through
 * ---------------------------------------------------------------------------
 *
 * **The index is CACHED PER OPEN FOLDER and SERVED FROM ONE ACTIVE FOLDER.**
 * Those are two different statements and both are load-bearing:
 *
 *   - *Cached per folder*: each normalized root gets its own `FolderIndex`
 *     (maps, ignore rules, watcher, build promise). Switching A→B→A between two
 *     folders that are both still open re-walks NOTHING — the second activation
 *     of A is a pointer swap. Before TASK_2026_344 a switch tore the whole index
 *     down, so a 15k-file workspace paid a 9-15 s walk every time the user came
 *     back to it, plus the chokidar re-arm burst behind it.
 *   - *Served from one folder*: every query method reads the ACTIVE entry and
 *     only the active entry. The frontend model is one active workspace at a
 *     time (`TabManagerService` swaps per-workspace tab partitions), so a query
 *     answering from a union of folders would be the cross-workspace leak
 *     TASK_2026_200 exists to prevent. `indexedRoot` names the active folder.
 *
 * The public contract:
 *
 *   - `ensureReadyFor(root)` — **the entry point for a caller that knows which
 *     root it wants.** Makes `root` the active folder SYNCHRONOUSLY (before any
 *     await — `ContextService.assertIndexServes` depends on that) and resolves
 *     when its snapshot is built. Already built → resolves without touching
 *     disk. Building → shares that build. Never built → builds. Roots are
 *     compared by `normalizeWorkspaceRoot`, so `D:\proj`, `D:\proj\` and
 *     `d:\proj` are ONE folder.
 *   - `ensureReady()` — for callers with no opinion. Re-resolves
 *     `IWorkspaceProvider.getWorkspaceRoot()` on EVERY call and delegates to
 *     `ensureReadyFor`. It deliberately does not short-circuit on "already
 *     started": that short-circuit was the TASK_2026_200 defect (the picker
 *     served the boot workspace's files for the whole process lifetime).
 *   - `start(root)` — the activation-time alias for `ensureReadyFor(root)`,
 *     kept for the existing fire-and-forget boot call sites.
 *   - `indexedRoot` — the normalized root the CURRENT snapshot represents, or
 *     `undefined` before the first build. A caller that must not serve another
 *     root's files (the R5 "loud mismatch" rule) compares against this.
 *   - `hasIndexFor(root)` — diagnostic: is this folder already built? Lets a
 *     caller's log say "reused" instead of implying a rebuild.
 *
 * Consequences a caller must respect:
 *   - **Eviction is by folder CLOSED, never by folder deactivated.** The one
 *     signal for "this folder is gone" is `onDidChangeWorkspaceFolders` diffed
 *     against `getWorkspaceFolders()`; deactivating a folder must not drop its
 *     entry, or the cache buys nothing. An inactive folder KEEPS ITS WATCHER, so
 *     its snapshot stays fresh and switching back needs no rebuild. A cap
 *     (`MAX_CACHED_FOLDERS`) bounds hosts that hand us ad-hoc roots the provider
 *     never lists (CLI, tests). The cap is subordinate to the CLOSED rule, not a
 *     second eviction reason beside it: `evictOverflow` skips every entry the
 *     provider still lists as open, so a real multi-root workspace larger than
 *     the cap keeps all of its folders and simply exceeds the cap. The active
 *     folder is never evicted by either path.
 *   - Rebuilds of ONE folder supersede rather than interleave: every build
 *     carries a generation token compared against the entry's, so a torn-down
 *     folder's in-flight build stops writing immediately. Cross-folder
 *     contamination is now structurally impossible — each build writes into its
 *     own entry's maps — but the token still guards a build racing its own
 *     eviction.
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  IWorkspaceWatcher,
  IDisposable,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type BackgroundWorkAdmission,
} from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from './workspace-indexer.service';
import {
  IgnorePatternResolverService,
  type ParsedIgnoreFile,
} from './ignore-pattern-resolver.service';
import {
  FolderIndexLiveSync,
  type FileIndexLogger,
} from './folder-index-live-sync';
import {
  IGNORE_NOTHING,
  addFileEntry,
  emptySnapshot,
  type FolderIndex,
  type FolderSnapshot,
  type IndexEntry,
  type IndexedFileType,
} from './folder-index-snapshot';

const LOGGER = Symbol.for('Logger');

/**
 * Upper bound on cached folder indexes for roots the host does NOT report as
 * open.
 *
 * The provider-driven eviction below handles every host that reports its open
 * folders. This cap is for the ones that do not: the CLI and the tests pass
 * ad-hoc roots that never appear in `getWorkspaceFolders()`, and without a cap
 * a long-lived process walking many roots would hold every one of their maps
 * and watch handles forever. 8 matches the LRU cap the autocomplete caches in
 * this same lib already use.
 *
 * It is a SOFT cap, and deliberately so. `evictOverflow` never evicts a folder
 * the provider still lists as open, so a genuine 9-root workspace holds nine
 * entries. A hard cap would reintroduce the bug this task exists to remove, one
 * level up: activating the 9th folder would dispose the least-recently-used
 * folder's live watcher and drop its snapshot even though the host still has it
 * open, so cycling across the nine would re-walk on almost every switch — the
 * same alternating-eviction thrash the sibling autocomplete cache already fixed
 * once at N=2 (see this lib's CLAUDE.md, "Autocomplete discovery").
 *
 * The memory this admits is bounded and small: an entry holds path strings only
 * (no content, no stat), so the largest folder in the captured session — 15249
 * files, 4935 directories — is single-digit megabytes. Holding eight of those is
 * the cheaper side of the trade against re-walking one of them for 9-15 s, and
 * a user who opens more folders than that has asked for exactly that trade.
 */
const MAX_CACHED_FOLDERS = 8;

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
  readonly fileType: IndexedFileType;
  readonly size: number;
  readonly lastModified: number;
  readonly isDirectory: boolean;
  readonly relevanceScore?: number;
}

@injectable()
export class WorkspaceFileIndexService {
  /** Normalized root → that folder's index. */
  private readonly entries = new Map<string, FolderIndex>();
  /** The normalized root every query answers from; `undefined` before the first. */
  private activeKey: string | undefined;

  /** Monotonic build generation, unique across entries. */
  private generationClock = 0;
  /** Monotonic activation stamp source, for LRU eviction. */
  private activationClock = 0;

  /** `onDidChangeWorkspaceFolders` subscription; armed lazily, once. */
  private folderChangeSubscription: IDisposable | undefined;
  private folderChangeSubscribed = false;

  /** Latch so "held above the cap" is logged per crossing, not per query. */
  private overCapNoticeLogged = false;

  /**
   * The live half of every folder: its watcher subscription, batch patches and
   * lost-event rebuilds (FU-11b). Built here rather than registered, because it
   * is this service's collaborator and nothing else resolves it.
   */
  private readonly liveSync: FolderIndexLiveSync;

  constructor(
    @inject(LOGGER) private readonly logger: FileIndexLogger,
    @inject(TOKENS.WORKSPACE_INDEXER_SERVICE)
    private readonly indexer: WorkspaceIndexerService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    fsProvider: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)
    private readonly ignoreResolver: IgnorePatternResolverService,
    @inject(PLATFORM_TOKENS.WORKSPACE_WATCHER)
    workspaceWatcher: IWorkspaceWatcher,
    /**
     * Optional: without one (a bare container, a spec) a lost-event rebuild
     * starts at once, as it did before TASK_2026_437 C14.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    governor: BackgroundWorkAdmission | null = null,
  ) {
    this.liveSync = new FolderIndexLiveSync({
      logger,
      fsProvider,
      workspaceWatcher,
      governor,
      build: (entry, generation, into) => this.build(entry, generation, into),
    });
  }

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
   * Make `root` the folder every query answers from, and resolve when its
   * snapshot is built.
   *
   * This is the entry point for any caller that knows which workspace it wants
   * (an RPC carrying an explicit `workspaceRoot`, the `workspace:switch`
   * handler, activation).
   *
   * - Folder already built → SYNCHRONOUS activation, and the returned promise
   *   is the settled one from that build. No walk, no watcher churn.
   * - Folder building (this call or another) → shares that build.
   * - Folder unknown, or its last build FAILED (`buildPromise` was reset) →
   *   builds now.
   * - Folder built but holding a lost-event rebuild for the background-work
   *   governor → the rebuild starts now: a caller needs this folder, and
   *   user-initiated work is never governed (TASK_2026_437). The returned
   *   promise does not wait for it; queries keep the previous snapshot until
   *   the rebuild swaps in.
   *
   * `activeKey` is assigned before the first await on every path, because
   * `ContextService.assertIndexServes` reads `indexedRoot` synchronously right
   * after this resolves and must see the root it asked for.
   */
  ensureReadyFor(root: string): Promise<void> {
    const key = normalizeWorkspaceRoot(root);
    this.subscribeToFolderChanges();

    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        root,
        ...emptySnapshot(),
        subscription: undefined,
        buildPromise: undefined,
        ready: false,
        generation: 0,
        lastActiveAt: 0,
        rebuildStaging: undefined,
        rebuildQueued: false,
        rebuildDeferral: undefined,
        subscribeRetryAt: undefined,
      };
      this.entries.set(key, entry);
    }

    this.activeKey = key;
    entry.lastActiveAt = ++this.activationClock;
    this.evictOverflow();

    if (entry.buildPromise) {
      this.liveSync.retrySubscribeIfDue(entry);
      this.liveSync.expediteDeferredRebuild(entry);
      return entry.buildPromise;
    }
    const generation = ++this.generationClock;
    entry.generation = generation;
    entry.buildPromise = this.doStart(entry, generation);
    return entry.buildPromise;
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
      const active = this.active;
      if (active?.buildPromise) await active.buildPromise;
      return;
    }
    await this.ensureReadyFor(root);
  }

  /**
   * Whether this folder already has a completed snapshot — i.e. activating it
   * costs nothing. Diagnostic only; the answer is about the CACHE, not about
   * which folder is currently active.
   */
  hasIndexFor(root: string): boolean {
    return this.entries.get(normalizeWorkspaceRoot(root))?.ready === true;
  }

  /**
   * The folder the three query methods read: the active one, once its FIRST
   * build has completed (TASK_2026_437 FU-4c).
   *
   * Contract: callers await `ensureReadyFor` (or `ensureReady`) before
   * querying — every production caller does, through `ContextService`'s
   * `ensureIndexFor` + `assertIndexServes` blocks. This gate makes a caller
   * that does not see an EMPTY result rather than a partial one while the first
   * walk is still filling the maps. A later overflow rebuild never needs it: it
   * fills a staging snapshot and swaps it in whole.
   */
  private get queryable(): FolderIndex | undefined {
    const active = this.active;
    return active?.ready ? active : undefined;
  }

  /** The folder every query reads, or `undefined` before the first activation. */
  private get active(): FolderIndex | undefined {
    return this.activeKey ? this.entries.get(this.activeKey) : undefined;
  }

  private async doStart(entry: FolderIndex, generation: number): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.build(entry, generation);
      // The folder was closed (or the service disposed) while this ran. Its
      // maps are gone; do not subscribe for a folder nobody holds.
      if (entry.generation !== generation) return;
      this.liveSync.subscribe(entry, generation);
      entry.ready = true;
      this.logger.info(
        `[WorkspaceFileIndex] Ready: ${entry.files.size} files, ${entry.directories.size} directories`,
        { root: entry.root, durationMs: Date.now() - startedAt },
      );
    } catch (error: unknown) {
      // A torn-down folder's failure is nobody's problem, and must not reset a
      // `buildPromise` that a newer build for the same key now owns.
      if (entry.generation !== generation) return;
      this.logger.error('[WorkspaceFileIndex] Failed to start', error);
      // Reset so a later query can retry the build.
      entry.buildPromise = undefined;
      throw error;
    }
  }

  /**
   * Walk `entry`'s folder into `into` — the entry itself for a first build, a
   * staging snapshot for an overflow rebuild.
   */
  private async build(
    entry: FolderIndex,
    generation: number,
    into: FolderSnapshot = entry,
  ): Promise<void> {
    into.files.clear();
    into.directories.clear();

    // Parse into a LOCAL first, then publish behind the generation check.
    // The compiled rules are read by every batch, so a build for a torn-down
    // folder must never publish its rules over the rules of the entry that
    // replaced it under the same key.
    let parsed: ParsedIgnoreFile[];
    try {
      parsed = await this.ignoreResolver.parseWorkspaceIgnoreFiles(entry.root);
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] Failed to parse ignore files (continuing)',
        error,
      );
      parsed = [];
    }
    if (entry.generation !== generation) return;
    into.ignoreFiles = parsed;
    into.isIgnored = this.ignoreResolver.compileMatcher(parsed, entry.root);

    // Path-only, batched, yielding. The ignore files are handed over rather
    // than re-parsed: they are the same set, and re-reading every ignore file
    // in the workspace to build an identical matcher is duplicated I/O.
    for await (const batch of this.indexer.discoverWorkspacePaths({
      workspaceFolder: entry.root,
      ignoreFiles: parsed,
      onNestedRepoRoots: (roots) => {
        if (entry.generation === generation) into.nestedRepoRoots = roots;
      },
    })) {
      // Checked per batch, not once up front: the walk yields to the event loop
      // between batches, so an eviction can land at any point inside it.
      if (entry.generation !== generation) return;
      for (const filePath of batch) {
        addFileEntry(entry.root, filePath, into);
      }
    }
  }

  /**
   * Subscribe once to workspace-folder changes, so entries for CLOSED folders
   * are dropped.
   *
   * Lazy rather than constructor-time: the service is resolved on hosts that
   * never index anything, and an unused subscription there is a live listener
   * on a process-wide event for no reason. The `typeof` guard is for hosts and
   * test doubles whose provider predates this member.
   */
  private subscribeToFolderChanges(): void {
    if (this.folderChangeSubscribed) return;
    this.folderChangeSubscribed = true;
    const subscribe = this.workspaceProvider.onDidChangeWorkspaceFolders;
    if (typeof subscribe !== 'function') return;
    try {
      this.folderChangeSubscription = subscribe.call(
        this.workspaceProvider,
        () => this.evictClosedFolders(),
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] cannot observe workspace folder changes (closed folders will not be evicted)',
        error,
      );
    }
  }

  /**
   * Drop every cached folder the provider no longer lists as open.
   *
   * Deactivating a folder must NOT evict it — that is the whole cache. Only
   * closing it does, and this is the only signal that says so.
   *
   * `openFolderKeys()` returning `undefined` — an unreadable or empty folder
   * list — means "no information", so nothing is dropped. See its docblock.
   */
  private evictClosedFolders(): void {
    const openKeys = this.openFolderKeys();
    if (!openKeys) return;

    for (const entry of [...this.entries.values()]) {
      if (entry.key === this.activeKey) continue;
      if (openKeys.has(entry.key)) continue;
      this.teardownEntry(entry);
      this.entries.delete(entry.key);
      this.logger.debug(
        '[WorkspaceFileIndex] dropped the index for a closed workspace folder',
        { root: entry.root },
      );
    }
  }

  /**
   * The normalized roots the host currently reports as OPEN, or `undefined`
   * when it cannot say.
   *
   * `undefined` means "no information", and both callers treat it that way. An
   * EMPTY list is folded into it deliberately: hosts that do not track folders
   * (the CLI) report none permanently, and the last folder closing in Electron
   * is exactly the case `ensureReady` already resolves in favour of keeping the
   * snapshot. Reading an empty list as "everything is closed" would evict the
   * whole cache on both.
   */
  private openFolderKeys(): Set<string> | undefined {
    let open: string[];
    try {
      open = this.workspaceProvider.getWorkspaceFolders() ?? [];
    } catch (error: unknown) {
      // degradation-audit: optional-capability - cannot read the current
      // open-folder list; treated as "no information" so the cache is kept
      // rather than wrongly evicted, and the failure is logged below at warn.
      this.logger.warn(
        '[WorkspaceFileIndex] could not read workspace folders (keeping cached indexes)',
        error,
      );
      return undefined;
    }
    if (open.length === 0) return undefined;
    return new Set(open.map((folder) => normalizeWorkspaceRoot(folder)));
  }

  /**
   * Enforce {@link MAX_CACHED_FOLDERS} over the roots nobody has claimed —
   * least-recently-active first, never the active folder, and NEVER a folder
   * the provider still lists as open.
   *
   * That last exclusion is the whole rule, not a refinement of it. Without it
   * the cap becomes a second eviction reason standing beside "the folder was
   * closed", and it fires on exactly the workload this service exists to make
   * free: a real multi-root workspace with more folders open than the cap would
   * dispose the least-recently-used folder's live watcher and clear its
   * snapshot on every activation past the cap, so cycling across those folders
   * re-walks and re-subscribes almost every switch. That is the
   * pre-TASK_2026_344 behaviour, reintroduced at N=9 instead of N=1.
   *
   * So the cap is soft: when every remaining candidate is still open, the cache
   * simply exceeds it. The entries hold path strings only, and the alternative
   * costs seconds of main-thread walk per switch.
   */
  private evictOverflow(): void {
    if (this.entries.size <= MAX_CACHED_FOLDERS) {
      this.overCapNoticeLogged = false;
      return;
    }
    const openKeys = this.openFolderKeys();
    const evictable = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.key !== this.activeKey && !(openKeys?.has(entry.key) ?? false),
      )
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
    let excess = this.entries.size - MAX_CACHED_FOLDERS;
    for (const entry of evictable) {
      if (excess <= 0) break;
      this.teardownEntry(entry);
      this.entries.delete(entry.key);
      excess--;
    }
    if (excess <= 0) {
      this.overCapNoticeLogged = false;
      return;
    }
    // Logged once per crossing, not per activation: `ensureReadyFor` runs on
    // every autocomplete query, so an unguarded line here would be per
    // keystroke.
    if (this.overCapNoticeLogged) return;
    this.overCapNoticeLogged = true;
    this.logger.debug(
      '[WorkspaceFileIndex] more folders are open than the cache cap; keeping them all rather than re-walking an open folder',
      { cached: this.entries.size, cap: MAX_CACHED_FOLDERS },
    );
  }

  /**
   * Release everything one entry holds and mark it dead.
   *
   * Bumping the generation is what stops a build, or a batch handler parked
   * behind an await, from writing after the caller believes it is gone.
   */
  private teardownEntry(entry: FolderIndex): void {
    entry.generation++;
    this.liveSync.release(entry);
    entry.files.clear();
    entry.directories.clear();
    entry.ignoreFiles = [];
    entry.isIgnored = IGNORE_NOTHING;
    entry.nestedRepoRoots = [];
    entry.buildPromise = undefined;
    entry.ready = false;
  }

  /**
   * Score + filter the ACTIVE folder's file list against a query. Directories
   * are not included here (use {@link searchDirectories}); this mirrors the
   * files-only search path autocomplete relied on.
   *
   * Await `ensureReadyFor` first; before the folder's first build completes
   * this returns nothing (see `queryable`).
   */
  search(query: string, limit: number): FileSearchResult[] {
    if (!query) return this.getAll(limit);
    const active = this.queryable;
    if (!active) return [];
    const queryLower = query.toLowerCase();
    const matches: Array<IndexEntry & { score: number }> = [];
    for (const entry of active.files.values()) {
      const score = scoreEntry(entry, queryLower);
      if (score <= 0) continue;
      matches.push({ ...entry, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map((entry) => toResult(entry, entry.score));
  }

  /**
   * Return every indexed file in the ACTIVE folder, then its directories, up to
   * `limit`. Used for the "no query yet" suggestion list.
   *
   * Await `ensureReadyFor` first; before the folder's first build completes
   * this returns nothing (see `queryable`).
   */
  getAll(limit: number): FileSearchResult[] {
    const active = this.queryable;
    if (!active) return [];
    const results: FileSearchResult[] = [];
    for (const entry of active.files.values()) {
      results.push(toResult(entry));
      if (results.length >= limit) return results;
    }
    for (const entry of active.directories.values()) {
      results.push(toResult(entry));
      if (results.length >= limit) return results;
    }
    return results;
  }

  /**
   * Filter the ACTIVE folder's directory entries by query (name or relative
   * path substring).
   *
   * Await `ensureReadyFor` first; before the folder's first build completes
   * this returns nothing (see `queryable`).
   */
  searchDirectories(query: string, limit: number): FileSearchResult[] {
    const active = this.queryable;
    if (!active) return [];
    const queryLower = query.toLowerCase();
    const matches: FileSearchResult[] = [];
    for (const entry of active.directories.values()) {
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

  /** Whether a build has completed for the ACTIVE folder. */
  isReady(): boolean {
    return this.active?.ready ?? false;
  }

  /**
   * The `normalizeWorkspaceRoot`-canonical root the current snapshot
   * represents, or `undefined` before the first build. A caller that must not
   * serve another workspace's files can compare its requested root's
   * normalized form against this before querying.
   */
  get indexedRoot(): string | undefined {
    return this.activeKey;
  }

  /** ACTIVE folder's file count (excludes directories). For diagnostics. */
  get fileCount(): number {
    return this.active?.files.size ?? 0;
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      this.teardownEntry(entry);
    }
    this.entries.clear();
    this.activeKey = undefined;
    this.overCapNoticeLogged = false;
    try {
      this.folderChangeSubscription?.dispose();
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] failed to dispose the workspace folder subscription',
        error,
      );
    }
    this.folderChangeSubscription = undefined;
    this.folderChangeSubscribed = false;
  }
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
