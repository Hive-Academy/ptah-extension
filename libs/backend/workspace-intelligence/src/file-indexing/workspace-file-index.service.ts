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
 *      suppressed — rebuilds the folder once instead.
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
import picomatch from 'picomatch';
import {
  FileType,
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
  IWorkspaceWatcher,
  IDisposable,
  WorkspaceChangeBatch,
} from '@ptah-extension/platform-core';
import { NESTED_WORKSPACE_PATH_RULES } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { WorkspaceIndexerService } from './workspace-indexer.service';
import {
  IgnorePatternResolverService,
  type ParsedIgnoreFile,
} from './ignore-pattern-resolver.service';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';

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
 * Most new paths one batch stats at once. A batch holds at most 500 paths; a
 * bounded fan-out keeps a mass create from queueing 500 stats on the thread
 * pool in one turn.
 */
const STAT_CONCURRENCY = 32;

/**
 * Largest folder index (files + directories) a directory delete is swept in
 * place for. Sweeping visits every entry once, synchronously, on the host's
 * main thread; above this a batch holding a directory delete is treated as
 * incomplete and the coalesced path-only rebuild runs instead, whose walk
 * yields between batches. 5,000 entries sweep in well under a millisecond; the
 * largest captured folder (15,249 files, 4,935 directories) rebuilds instead.
 */
const DIRECTORY_DELETE_SWEEP_LIMIT = 5_000;

/**
 * Shortest gap between two attempts to subscribe a folder whose `watch()`
 * threw (ms). The retry rides on `ensureReadyFor`, which autocomplete calls per
 * query, so without a floor a dead watch host would be re-tried per keystroke.
 */
const SUBSCRIBE_RETRY_INTERVAL_MS = 60_000;

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

/**
 * Everything one open workspace folder owns.
 *
 * One record per normalized root. Nothing here is shared between folders —
 * that is the whole point: the pre-TASK_2026_344 service kept `files`,
 * `directories`, `ignoreFiles` and `watcher` as SERVICE fields, which is why a
 * switch had to clear them and why every late-landing async write had to be
 * generation-gated against contaminating the other root.
 */
interface FolderIndex extends FolderSnapshot {
  /** `normalizeWorkspaceRoot(root)` — the cache key. */
  readonly key: string;
  /**
   * The host-native root string this snapshot was built from.
   *
   * Fixed at creation and never re-assigned: `path.relative` results depend on
   * it, so swapping in another spelling of the same normalized root (a trailing
   * separator, a different drive case) mid-life would silently change every
   * relative path the entry produces from then on.
   */
  readonly root: string;
  /** This folder's live `IWorkspaceWatcher` subscription, once armed. */
  subscription: IDisposable | undefined;
  /** In-flight or settled build. `undefined` after a FAILED build, so it retries. */
  buildPromise: Promise<void> | undefined;
  ready: boolean;
  /**
   * Bumped whenever this entry is torn down, so a build or batch handler
   * still in flight for it stops writing.
   */
  generation: number;
  /** Activation clock stamp, for LRU eviction under the overflow cap. */
  lastActiveAt: number;
  /**
   * The snapshot an overflow rebuild is filling, while one is in flight.
   * Queries keep reading the entry's own maps until the rebuild swaps it in.
   */
  rebuildStaging: FolderSnapshot | undefined;
  /** An overflow arrived while a rebuild was running; rebuild once more after it. */
  rebuildQueued: boolean;
  /**
   * `Date.now()` before which a folder whose `watch()` threw is not retried;
   * `undefined` while subscribed or never attempted.
   */
  subscribeRetryAt: number | undefined;
}

/**
 * The swappable part of a folder's index: what a build fills. An overflow
 * rebuild fills a fresh one and replaces the entry's in one step, so queries
 * never see a half-built index.
 *
 * Map keys come from {@link toIndexKey}, so the walk's spelling (fast-glob
 * reports `D:/…`) and the watcher's (`D:\…`) name one entry; each entry keeps
 * the spelling it was added with.
 */
interface FolderSnapshot {
  /** Normalized absolute file path → entry. */
  files: Map<string, IndexEntry>;
  /** Normalized absolute directory path → entry. */
  directories: Map<string, IndexEntry>;
  /** Parsed ignore files for this folder. */
  ignoreFiles: ParsedIgnoreFile[];
  /**
   * `ignoreFiles` compiled once per build (`compileMatcher`) — the one
   * synchronous predicate every batch's new paths pass through.
   */
  isIgnored: (relativePath: string) => boolean;
  /**
   * Nested repository and worktree roots the walk skipped. They seed the
   * subscription, because a repository that already exists produces no `.git`
   * event for the watch host to detect.
   */
  nestedRepoRoots: readonly string[];
}

/** An index with no ignore rules compiled yet ignores nothing. */
const IGNORE_NOTHING = (): boolean => false;

/**
 * THE key for a path in `files` and `directories` — every write and every
 * lookup goes through it, so the two maps share one key space.
 *
 * - `path.normalize`: separators and `.`/doubled segments (fast-glob reports
 *   `D:/…`, the watch host `D:\…`);
 * - no trailing separator (a watcher may report `dir/`);
 * - an upper-case drive letter (`d:\x` and `D:\x` are one path on Windows).
 */
export function toIndexKey(absPath: string): string {
  let key = path.normalize(absPath);
  while (
    key.length > 1 &&
    /[\\/]$/.test(key) &&
    !/^[A-Za-z]:[\\/]$/.test(key)
  ) {
    key = key.slice(0, -1);
  }
  return /^[a-z]:/.test(key) ? key[0].toUpperCase() + key.slice(1) : key;
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
    @inject(PLATFORM_TOKENS.WORKSPACE_WATCHER)
    private readonly workspaceWatcher: IWorkspaceWatcher,
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
        subscribeRetryAt: undefined,
      };
      this.entries.set(key, entry);
    }

    this.activeKey = key;
    entry.lastActiveAt = ++this.activationClock;
    this.evictOverflow();

    if (entry.buildPromise) {
      this.retrySubscribeIfDue(entry);
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
      this.subscribe(entry, generation);
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
        this.addFileEntry(entry, filePath, into);
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
    this.disposeSubscription(entry);
    entry.rebuildStaging = undefined;
    entry.rebuildQueued = false;
    entry.files.clear();
    entry.directories.clear();
    entry.ignoreFiles = [];
    entry.isIgnored = IGNORE_NOTHING;
    entry.nestedRepoRoots = [];
    entry.buildPromise = undefined;
    entry.ready = false;
  }

  /**
   * Dispose this entry's subscription, if any, and drop the reference.
   *
   * Clearing the field guarantees a given subscription is disposed exactly
   * once, and a throwing `dispose()` never blocks the caller.
   */
  private disposeSubscription(entry: FolderIndex): void {
    const subscription = entry.subscription;
    if (!subscription) return;
    entry.subscription = undefined;
    try {
      subscription.dispose();
    } catch (error: unknown) {
      this.logger.warn(
        '[WorkspaceFileIndex] failed to dispose previous watcher',
        error,
      );
    }
  }

  /**
   * Subscribe this folder to the batched workspace feed — ONCE per folder per
   * process.
   *
   * It is not disposed when the folder goes inactive: keeping it live keeps
   * the inactive folder's snapshot correct, which is what makes switching back
   * free rather than merely fast.
   *
   * Exclusion happens where the events are produced, not here:
   * `DEFAULT_WORKSPACE_EXCLUDES` as globs, the agent worktree segment rules
   * (case-insensitively, which the globs are not), the nested repositories the
   * walk skipped, and any `.git` entry the watcher sees appear below the root.
   */
  private subscribe(entry: FolderIndex, generation: number): void {
    // Defensive: teardown disposes, but never let a second subscription be
    // armed over a live one.
    this.disposeSubscription(entry);
    const retrying = entry.subscribeRetryAt !== undefined;
    try {
      entry.subscription = this.workspaceWatcher.watch(
        entry.root,
        {
          excludeGlobs: DEFAULT_WORKSPACE_EXCLUDES,
          excludeDirNames: [],
          excludeSegmentRules: NESTED_WORKSPACE_PATH_RULES,
          nestedRepoDetection: true,
          nestedRepoRoots: entry.nestedRepoRoots,
        },
        // Generation-gated: a batch a disposed subscription already had in
        // flight must not patch an entry that has been torn down.
        (batch) => this.onBatch(entry, generation, batch),
      );
      entry.subscribeRetryAt = undefined;
      if (retrying) {
        this.logger.info(
          '[WorkspaceFileIndex] watcher subscribed on retry; the index is live again',
          { root: entry.root },
        );
      }
    } catch (error: unknown) {
      // A host without a real watcher degrades to a static snapshot — still
      // correct, just not live — and re-indexing must never start throwing
      // here. `retrySubscribeIfDue` tries again on a later `ensureReadyFor`.
      // Logged once per failure streak, not per retry.
      entry.subscribeRetryAt = Date.now() + SUBSCRIBE_RETRY_INTERVAL_MS;
      if (retrying) {
        this.logger.debug(
          '[WorkspaceFileIndex] watcher still unavailable on retry',
          error,
        );
      } else {
        this.logger.warn(
          '[WorkspaceFileIndex] watcher unavailable (index will not stay live until a retry succeeds)',
          error,
        );
      }
    }
  }

  /**
   * A built folder whose `watch()` threw is subscribed again, at most once per
   * {@link SUBSCRIBE_RETRY_INTERVAL_MS}, when a caller next asks for it. No
   * timer: a folder nobody queries stays static until it is queried. The
   * snapshot the failure left may be stale by then, so a successful retry also
   * rebuilds it once.
   */
  private retrySubscribeIfDue(entry: FolderIndex): void {
    if (!entry.ready || entry.subscription) return;
    if (entry.subscribeRetryAt === undefined) return;
    if (Date.now() < entry.subscribeRetryAt) return;
    const generation = entry.generation;
    this.subscribe(entry, generation);
    if (entry.subscription) {
      this.requestRebuild(entry, generation, {
        reason: 'watcher subscribed after a failure',
      });
    }
  }

  /**
   * One coalesced batch for one folder.
   *
   * `overflow` (events lost or suppressed: a storm, a host restart, a degraded
   * rescan tick) and `truncated` (more distinct paths than one batch holds)
   * both leave the batch incomplete, so the folder rebuilds once instead of
   * patching from a partial list.
   *
   * Otherwise ONE synchronous pass: deletes drop their entry (a deleted
   * directory drops everything under it, in one sweep for the whole batch);
   * a path not yet indexed is matched against the default excludes and the
   * folder's compiled ignore rules, and the survivors are statted — a batch
   * does not say whether a created path is a file or a directory. A path
   * already indexed needs nothing: the index tracks no content.
   *
   * Runs for INACTIVE folders too, and must: keeping a background folder's
   * snapshot fresh is exactly what lets a switch back to it skip the rebuild.
   */
  private onBatch(
    entry: FolderIndex,
    generation: number,
    batch: WorkspaceChangeBatch,
  ): void {
    if (entry.generation !== generation) return;
    if (batch.overflow || batch.truncated) {
      this.requestRebuild(entry, generation, {
        reason: 'watcher reported lost events',
        overflow: batch.overflow,
        truncated: batch.truncated,
        droppedCount: batch.droppedCount,
      });
      return;
    }

    const deletedDirectories = new Set<string>();
    const created: string[] = [];
    for (const change of batch.changes) {
      const key = toIndexKey(change.path);
      if (change.kind === 'delete') {
        if (entry.directories.has(key)) deletedDirectories.add(key);
        this.deleteLivePath(entry, key);
        continue;
      }
      if (entry.files.has(key) || entry.directories.has(key)) continue;
      if (this.isExcluded(entry, change.path)) continue;
      created.push(change.path);
    }
    if (deletedDirectories.size > 0) {
      if (
        entry.files.size + entry.directories.size >
        DIRECTORY_DELETE_SWEEP_LIMIT
      ) {
        // Too large to sweep synchronously: the batch is as good as
        // truncated. The rebuild covers this batch's creates too.
        this.requestRebuild(entry, generation, {
          reason: 'directory deleted in a large index',
          deletedDirectories: deletedDirectories.size,
          entries: entry.files.size + entry.directories.size,
        });
        return;
      }
      this.deleteLiveDescendants(entry, deletedDirectories);
    }
    if (created.length > 0) {
      void this.addCreatedPaths(entry, generation, created);
    }
  }

  /**
   * Stat the batch's new paths and index them as files or directories.
   *
   * Rule for this file: a generation check upstream does not protect a write
   * that sits behind an `await` — a teardown can land while the stats run, and
   * this would then resurrect maps the service has already released. Re-check
   * immediately before the write.
   */
  private async addCreatedPaths(
    entry: FolderIndex,
    generation: number,
    paths: readonly string[],
  ): Promise<void> {
    for (let start = 0; start < paths.length; start += STAT_CONCURRENCY) {
      const slice = paths.slice(start, start + STAT_CONCURRENCY);
      const types = await Promise.all(
        slice.map((absPath) => this.statType(absPath)),
      );
      if (entry.generation !== generation) return;
      slice.forEach((absPath, index) => {
        const type = types[index];
        if (type === undefined) return;
        if ((type & FileType.Directory) !== 0) {
          this.addLiveDirectoryEntry(entry, absPath);
        } else if ((type & FileType.File) !== 0) {
          this.addLiveFileEntry(entry, absPath);
        }
      });
    }
  }

  /** The path's type, or `undefined` when it is already gone or unreadable. */
  private async statType(absPath: string): Promise<FileType | undefined> {
    try {
      return (await this.fsProvider.stat(absPath)).type;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a path created and removed
      // inside one batch window, or locked, is simply not indexed; its own
      // delete or the next create brings the index back in line.
      this.logger.debug(
        '[WorkspaceFileIndex] could not stat a created path (not indexed)',
        error,
      );
      return undefined;
    }
  }

  /**
   * The folder's view is stale — an incomplete batch, a directory delete too
   * large to sweep, or a subscription that missed events — so it rebuilds once
   * from a path-only walk.
   *
   * The subscription stays armed, so this reuses `build` under the SAME
   * generation rather than `doStart`. The walk fills a staging snapshot while
   * queries keep serving the previous one; batches that land meanwhile patch
   * both, and success swaps the staging snapshot in synchronously. A failed
   * rebuild keeps the previous snapshot. An overflow that arrives while a
   * rebuild is running queues exactly one more, which runs whether the current
   * one succeeds or fails — so a degraded adapter's overflow every 60 s never
   * stacks rebuilds.
   */
  private requestRebuild(
    entry: FolderIndex,
    generation: number,
    detail: { readonly reason: string } & Readonly<Record<string, unknown>>,
  ): void {
    if (entry.rebuildStaging) {
      entry.rebuildQueued = true;
      return;
    }
    const { reason, ...rest } = detail;
    this.logger.warn(
      `[WorkspaceFileIndex] ${reason}; rebuilding the index once`,
      { root: entry.root, ...rest },
    );
    this.runOverflowRebuild(entry, generation);
  }

  private runOverflowRebuild(entry: FolderIndex, generation: number): void {
    const staging = emptySnapshot();
    entry.rebuildStaging = staging;
    const startedAt = Date.now();
    void this.build(entry, generation, staging)
      .then(
        () => {
          if (entry.generation !== generation) return;
          entry.files = staging.files;
          entry.directories = staging.directories;
          entry.ignoreFiles = staging.ignoreFiles;
          entry.isIgnored = staging.isIgnored;
          entry.nestedRepoRoots = staging.nestedRepoRoots;
          this.logger.info(
            `[WorkspaceFileIndex] Rebuilt after lost watcher events: ${entry.files.size} files, ${entry.directories.size} directories`,
            { root: entry.root, durationMs: Date.now() - startedAt },
          );
        },
        (error: unknown) => {
          if (entry.generation !== generation) return;
          this.logger.error(
            '[WorkspaceFileIndex] Rebuild after lost watcher events failed (keeping the previous snapshot)',
            error,
          );
        },
      )
      .finally(() => {
        if (entry.generation !== generation) return;
        entry.rebuildStaging = undefined;
        if (!entry.rebuildQueued) return;
        entry.rebuildQueued = false;
        this.runOverflowRebuild(entry, generation);
      });
  }

  /** A batch delete: the live snapshot, plus a rebuild's staging one if any. */
  private deleteLivePath(entry: FolderIndex, key: string): void {
    for (const snapshot of liveSnapshots(entry)) {
      snapshot.files.delete(key);
      snapshot.directories.delete(key);
    }
  }

  /**
   * Drop every entry below a deleted directory, in one sweep per batch. Some
   * watchers report only the directory's own delete (VS Code's does), others
   * each child too (`@parcel/watcher`); both end up with nothing stale.
   */
  private deleteLiveDescendants(
    entry: FolderIndex,
    deletedDirectories: ReadonlySet<string>,
  ): void {
    const underDeleted = (key: string): boolean => {
      let parent = path.dirname(key);
      while (parent.length >= entry.root.length) {
        if (deletedDirectories.has(toIndexKey(parent))) return true;
        const next = path.dirname(parent);
        if (next === parent) return false;
        parent = next;
      }
      return false;
    };
    for (const snapshot of liveSnapshots(entry)) {
      for (const key of [...snapshot.files.keys()]) {
        if (underDeleted(key)) snapshot.files.delete(key);
      }
      for (const key of [...snapshot.directories.keys()]) {
        if (underDeleted(key)) snapshot.directories.delete(key);
      }
    }
  }

  /**
   * Add a file entry plus its ancestor directory entries (derived from the
   * path, so they inherit the file's not-ignored status for free).
   */
  private addFileEntry(
    entry: FolderIndex,
    absPath: string,
    into: FolderSnapshot = entry,
  ): void {
    const relativePath = path.relative(entry.root, absPath);
    const fileName = path.basename(absPath);
    const directory = path.dirname(absPath);
    into.files.set(toIndexKey(absPath), {
      path: absPath,
      relativePath,
      fileName,
      directory,
      fileType: detectFileType(fileName),
      isDirectory: false,
    });
    this.addAncestorDirectories(entry, absPath, into);
  }

  /** A batch add: the live snapshot, plus a rebuild's staging one if any. */
  private addLiveFileEntry(entry: FolderIndex, absPath: string): void {
    for (const snapshot of liveSnapshots(entry)) {
      this.addFileEntry(entry, absPath, snapshot);
    }
  }

  /** A created directory, with its ancestors, in every live snapshot. */
  private addLiveDirectoryEntry(entry: FolderIndex, absPath: string): void {
    const relativePath = path.relative(entry.root, absPath);
    if (!relativePath || relativePath.startsWith('..')) return;
    for (const snapshot of liveSnapshots(entry)) {
      // `addAncestorDirectories` indexes every directory ABOVE its path, so a
      // child segment makes the created directory itself the last of them.
      this.addAncestorDirectories(entry, path.join(absPath, '_'), snapshot);
    }
  }

  private addAncestorDirectories(
    entry: FolderIndex,
    absPath: string,
    into: FolderSnapshot,
  ): void {
    // Derive ancestor dirs from the RELATIVE path so we never mix the
    // workspace root's native separators/drive with the POSIX separators
    // fast-glob emits. Each ancestor inherits the file's not-ignored status.
    const relative = path.relative(entry.root, absPath);
    if (!relative || relative.startsWith('..')) return;
    const segments = relative.split(/[\\/]/).filter(Boolean);
    segments.pop(); // drop the file name
    const soFar: string[] = [];
    for (const segment of segments) {
      soFar.push(segment);
      const absDir = path.join(entry.root, ...soFar);
      const key = toIndexKey(absDir);
      if (into.directories.has(key)) continue;
      into.directories.set(key, {
        path: absDir,
        relativePath: path.relative(entry.root, absDir),
        fileName: segment,
        directory: path.dirname(absDir),
        fileType: 'unknown',
        isDirectory: true,
      });
    }
  }

  /**
   * Synchronous: the default excludes, then the folder's compiled ignore
   * rules, read into a local so one decision never mixes two rule sets.
   */
  private isExcluded(entry: FolderIndex, absPath: string): boolean {
    const relative = path.relative(entry.root, absPath).replace(/\\/g, '/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return true;
    }
    if (this.defaultExcludeMatcher(relative)) return true;
    const isIgnored = entry.isIgnored;
    return isIgnored(relative);
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

/** A snapshot with nothing in it and no rules: a new folder, or a rebuild's staging area. */
function emptySnapshot(): FolderSnapshot {
  return {
    files: new Map(),
    directories: new Map(),
    ignoreFiles: [],
    isIgnored: IGNORE_NOTHING,
    nestedRepoRoots: [],
  };
}

/** The snapshot queries read, plus the one an overflow rebuild is filling. */
function liveSnapshots(entry: FolderIndex): FolderSnapshot[] {
  return entry.rebuildStaging ? [entry, entry.rebuildStaging] : [entry];
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
