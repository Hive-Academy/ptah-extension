import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import * as path from 'path';
import {
  FileType,
  normalizeWorkspaceRoot,
} from '@ptah-extension/platform-core';
import { createMockWorkspaceWatcher } from '@ptah-extension/platform-core/testing';
import { NESTED_WORKSPACE_PATH_RULES } from '@ptah-extension/shared';
import { WorkspaceFileIndexService } from './workspace-file-index.service';
import { toIndexKey } from './folder-index-snapshot';
import { DEFAULT_WORKSPACE_EXCLUDES } from './workspace-default-excludes';

// Flush the macrotask + microtask queues so the async stat step settles.
const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
};

const ROOT = path.join('/', 'workspace');
const abs = (rel: string): string => path.join(ROOT, rel);

/** Second workspace, used by the switch/rebuild suites. */
const ROOT_B = path.join('/', 'workspace-b');
const absB = (rel: string): string => path.join(ROOT_B, rel);

interface HarnessOptions {
  files?: string[];
  /**
   * Per-root file lists, keyed by the RAW root string (normalized internally).
   * Takes precedence over `files` for any root present in the map; a root that
   * is absent falls back to `files`.
   */
  filesByRoot?: Record<string, string[]>;
  isIgnored?: (relativePath: string) => boolean;
  parsedIgnoreFiles?: unknown[];
  /**
   * Per-root parsed ignore files, keyed by the RAW root string. Lets a test
   * tell root A's rules apart from root B's — the service compiles whatever is
   * in its `ignoreFiles` field, so the double can report which root's rules
   * are live.
   */
  ignoreFilesByRoot?: Record<string, IgnoreRule[]>;
  /**
   * Ignore predicate that inspects the rules the SERVICE compiled, rather than
   * just the path. This is what makes cross-root ignore contamination visible.
   */
  isIgnoredWith?: (relativePath: string, rules: IgnoreRule[]) => boolean;
  /** Initial value reported by the workspace provider. */
  providerRoot?: string;
  /**
   * Gate that must be resolved before `discoverWorkspacePaths` yields anything
   * for the given raw root. Lets a test hold a build open across a switch.
   */
  streamGate?: Record<string, Promise<void>>;
  /** Paths per yielded discovery batch (default: one batch for everything). */
  discoveryBatchSize?: number;
  /** Folders the workspace provider reports as OPEN. Defaults to [ROOT, ROOT_B]. */
  openFolders?: string[];
  /**
   * Gate that must be resolved before `parseWorkspaceIgnoreFiles` returns for
   * the given raw root. Holds a build open at the IGNORE-PARSE await —
   * `streamGate` never reaches this point, which is exactly how the
   * `ignoreFiles` contamination bug escaped the first round of tests.
   */
  ignoreGate?: Record<string, Promise<void>>;
  /**
   * Gate that must resolve before `stat` returns — i.e. it parks a batch
   * handler between its generation gate and its write. `ignoreGate` only
   * covers the parse inside `build()` and never reaches this path.
   */
  statGate?: Promise<void>;
  /** Absolute paths `stat` reports as directories; everything else is a file. */
  directories?: string[];
  /** Nested repository roots the walk reports for a raw root. */
  nestedRootsByRoot?: Record<string, string[]>;
  /** The injected background-work governor (TASK_2026_437 C14 d); none by default. */
  governor?: {
    isClear(): boolean;
    whenClear(options?: unknown): Promise<'clear' | 'timeout'>;
  };
}

/** Tagged ignore rule so a test can see WHICH root's rules are live. */
interface IgnoreRule {
  readonly owner: string;
  readonly ignores: string;
}

function makeHarness(opts: HarnessOptions = {}) {
  const defaultFiles = opts.files ?? [
    abs('src/auth.service.ts'),
    abs('src/util/format.ts'),
    abs('README.md'),
    abs('logo.png'),
  ];

  const byKey = new Map<string, string[]>();
  for (const [root, list] of Object.entries(opts.filesByRoot ?? {})) {
    byKey.set(normalizeWorkspaceRoot(root), list);
  }
  const gateByKey = new Map<string, Promise<void>>();
  for (const [root, gate] of Object.entries(opts.streamGate ?? {})) {
    gateByKey.set(normalizeWorkspaceRoot(root), gate);
  }
  const ignoreGateByKey = new Map<string, Promise<void>>();
  for (const [root, gate] of Object.entries(opts.ignoreGate ?? {})) {
    ignoreGateByKey.set(normalizeWorkspaceRoot(root), gate);
  }
  const ignoreRulesByKey = new Map<string, IgnoreRule[]>();
  for (const [root, rules] of Object.entries(opts.ignoreFilesByRoot ?? {})) {
    ignoreRulesByKey.set(normalizeWorkspaceRoot(root), rules);
  }
  const nestedRootsByKey = new Map<string, string[]>();
  for (const [root, roots] of Object.entries(opts.nestedRootsByRoot ?? {})) {
    nestedRootsByKey.set(normalizeWorkspaceRoot(root), roots);
  }

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  // The service consumes the PATH-ONLY batched generator (TASK_2026_344), not
  // the stat+classify stream. Wrapped in `jest.fn` so call counts are
  // assertable — "how many times did we walk a tree?" is the whole point of the
  // per-folder cache.
  const indexer = {
    discoverWorkspacePaths: jest.fn(async function* (options: {
      workspaceFolder: string;
      batchSize?: number;
      ignoreFiles?: unknown[];
      onNestedRepoRoots?: (roots: readonly string[]) => void;
    }) {
      const root = options.workspaceFolder;
      const key = normalizeWorkspaceRoot(root);
      const gate = gateByKey.get(key);
      if (gate) await gate;
      options.onNestedRepoRoots?.(nestedRootsByKey.get(key) ?? []);
      const all = byKey.get(key) ?? defaultFiles;
      const size = Math.max(opts.discoveryBatchSize ?? all.length, 1);
      for (let i = 0; i < all.length; i += size) {
        yield all.slice(i, i + size);
      }
    }),
  };

  // The shared port double records one subscription per watch call, so a
  // teardown's dispose of the PREVIOUS handle is observable (R2).
  const workspaceWatcher = createMockWorkspaceWatcher();
  const watchers = workspaceWatcher.__state.subscriptions;

  const directorySet = new Set(
    (opts.directories ?? []).map((p) => path.normalize(p)),
  );
  const fsProvider = {
    stat: jest.fn(async (p: string) => {
      if (opts.statGate) await opts.statGate;
      return {
        type: directorySet.has(path.normalize(p))
          ? FileType.Directory
          : FileType.File,
        ctime: 0,
        mtime: 0,
        size: 0,
      };
    }),
  };

  // The folder-change event double. `openFolders` is what the host reports as
  // OPEN; firing the listener is the ONLY signal the service accepts as "a
  // folder was closed" — deactivating one must never evict it.
  let openFolders: string[] = opts.openFolders ?? [ROOT, ROOT_B];
  const folderChangeListeners: Array<() => void> = [];
  const folderSubscriptionDispose = jest.fn();
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn(() => opts.providerRoot ?? ROOT),
    getWorkspaceFolders: jest.fn(() => [...openFolders]),
    onDidChangeWorkspaceFolders: jest.fn((listener: () => void) => {
      folderChangeListeners.push(listener);
      return { dispose: folderSubscriptionDispose };
    }),
  };
  const setOpenFolders = (folders: string[]): void => {
    openFolders = folders;
    folderChangeListeners.forEach((l) => l());
  };

  // `compiledCheck` is the body of every predicate `compileMatcher` returns,
  // called with the rules that predicate was compiled from.
  const compiledCheck = jest.fn(
    (relativePath: string, rules: IgnoreRule[]): boolean =>
      opts.isIgnoredWith
        ? opts.isIgnoredWith(relativePath, rules)
        : opts.isIgnored
          ? opts.isIgnored(relativePath)
          : false,
  );
  const ignoreResolver = {
    parseWorkspaceIgnoreFiles: jest.fn(async (root: string) => {
      const key = normalizeWorkspaceRoot(root);
      const gate = ignoreGateByKey.get(key);
      if (gate) await gate;
      return ignoreRulesByKey.get(key) ?? opts.parsedIgnoreFiles ?? [];
    }),
    compileMatcher: jest.fn(
      (rules: IgnoreRule[]) => (relativePath: string) =>
        compiledCheck(relativePath, rules),
    ),
    isIgnored: jest.fn(),
  };

  const service = new WorkspaceFileIndexService(
    logger as never,
    indexer as never,
    fsProvider as never,
    workspaceProvider as never,
    ignoreResolver as never,
    workspaceWatcher as never,
    (opts.governor ?? null) as never,
  );

  return {
    service,
    watchers,
    workspaceWatcher,
    fsProvider,
    workspaceProvider,
    ignoreResolver,
    compiledCheck,
    indexer,
    logger,
    setOpenFolders,
    folderSubscriptionDispose,
    files: defaultFiles,
  };
}

describe('WorkspaceFileIndexService', () => {
  it('builds the in-memory index once from discoverWorkspacePaths and subscribes with the shared exclusions', async () => {
    const { service, workspaceWatcher } = makeHarness();

    await service.start(ROOT);

    expect(service.isReady()).toBe(true);
    expect(service.fileCount).toBe(4);
    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);
    const [root, options] = workspaceWatcher.watch.mock.calls[0];
    expect(root).toBe(ROOT);
    expect(options.excludeGlobs).toBe(DEFAULT_WORKSPACE_EXCLUDES);
    expect(options.excludeGlobs).toContain('**/node_modules/**');
    expect(options.excludeSegmentRules).toBe(NESTED_WORKSPACE_PATH_RULES);
    expect(options.nestedRepoDetection).toBe(true);
    expect(options.nestedRepoRoots).toEqual([]);
  });

  it('seeds the subscription with the nested repository roots the walk skipped', async () => {
    const vendor = abs('pkg/vendor');
    const { service, workspaceWatcher } = makeHarness({
      nestedRootsByRoot: { [ROOT]: [vendor] },
    });

    await service.start(ROOT);

    expect(workspaceWatcher.watch.mock.calls[0][1].nestedRepoRoots).toEqual([
      vendor,
    ]);
  });

  it('start is idempotent for the same root (single build)', async () => {
    const { service, workspaceWatcher } = makeHarness();
    await Promise.all([service.start(ROOT), service.start(ROOT)]);
    await service.start(ROOT);
    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);
  });

  it('search scores exact/prefix/substring matches and orders by relevance', async () => {
    const { service } = makeHarness({
      files: [abs('auth.ts'), abs('src/auth.service.ts'), abs('src/other.ts')],
    });
    await service.start(ROOT);

    const results = service.search('auth', 10);
    expect(results.map((r) => r.fileName)).toEqual([
      'auth.ts', // exact-ish + prefix wins
      'auth.service.ts',
    ]);
    // Non-matching files are excluded entirely.
    expect(results.some((r) => r.fileName === 'other.ts')).toBe(false);
  });

  it('getAll returns files then directories with 0 size/mtime', async () => {
    const { service } = makeHarness();
    await service.start(ROOT);

    const all = service.getAll(1000);
    const names = all.map((r) => r.fileName);
    expect(names).toContain('auth.service.ts');
    // Ancestor directories are tracked too.
    expect(names).toContain('src');
    expect(names).toContain('util');
    for (const r of all) {
      expect(r.size).toBe(0);
      expect(r.lastModified).toBe(0);
    }
  });

  it('searchDirectories matches indexed ancestor directories', async () => {
    const { service } = makeHarness();
    await service.start(ROOT);

    const dirs = service.searchDirectories('util', 10);
    expect(dirs.map((d) => d.fileName)).toContain('util');
    expect(dirs.every((d) => d.isDirectory)).toBe(true);
  });

  it('patches the index when a file is created', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);
    expect(service.search('newfile', 10)).toHaveLength(0);

    watchers[0].fire('create', abs('src/newfile.ts'));
    await flush();

    const results = service.search('newfile', 10);
    expect(results.map((r) => r.fileName)).toEqual(['newfile.ts']);
  });

  it('indexes a created directory as a directory, never as a file', async () => {
    const { service, watchers } = makeHarness({
      directories: [abs('src/newdir')],
    });
    await service.start(ROOT);

    watchers[0].fire('create', abs('src/newdir'), abs('src/newdir/inner.ts'));
    await flush();

    expect(service.search('newdir', 10)).toHaveLength(1);
    expect(service.search('newdir', 10)[0].fileName).toBe('inner.ts');
    const dirs = service.searchDirectories('newdir', 10);
    expect(dirs.map((d) => d.fileName)).toEqual(['newdir']);
    expect(service.fileCount).toBe(5);
  });

  it('an update for a path not yet indexed adds it; for an indexed one it stats nothing', async () => {
    const { service, watchers, fsProvider } = makeHarness();
    await service.start(ROOT);

    watchers[0].fire('update', abs('README.md'), abs('src/missed.ts'));
    await flush();

    expect(fsProvider.stat).toHaveBeenCalledTimes(1);
    expect(service.search('missed', 10)).toHaveLength(1);
  });

  it('a created path that is already gone when statted is not indexed', async () => {
    const { service, watchers, fsProvider } = makeHarness();
    await service.start(ROOT);
    fsProvider.stat.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    watchers[0].fire('create', abs('src/flash.ts'));
    await flush();

    expect(service.search('flash', 10)).toHaveLength(0);
  });

  it('removes an entry from the index when a file is deleted', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);
    expect(service.search('format', 10)).toHaveLength(1);

    watchers[0].fire('delete', abs('src/util/format.ts'));
    await flush();

    expect(service.search('format', 10)).toHaveLength(0);
  });

  it('a deleted directory drops every file and directory below it in one batch', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);

    // VS Code reports only the directory's own delete.
    watchers[0].fire('delete', abs('src'));
    await flush();

    expect(service.search('auth', 10)).toHaveLength(0);
    expect(service.search('format', 10)).toHaveLength(0);
    expect(service.searchDirectories('util', 10)).toHaveLength(0);
    expect(service.searchDirectories('src', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(2);
  });

  it('matches a watcher path to the walk entry across separator spellings', async () => {
    // fast-glob reports `D:/…` on Windows; the watch host reports `D:\…`.
    if (path.sep !== '\\') return;
    const root = 'D:\\projects\\ws';
    const { service, watchers } = makeHarness({
      filesByRoot: { [root]: ['D:/projects/ws/src/only.ts'] },
    });
    await service.start(root);

    watchers[0].fire('delete', 'D:\\projects\\ws\\src\\only.ts');
    await flush();

    expect(service.fileCount).toBe(0);
  });

  it('does NOT index a created file under a default-excluded directory', async () => {
    const { service, watchers, fsProvider } = makeHarness();
    await service.start(ROOT);

    watchers[0].fire('create', abs('node_modules/pkg/index.ts'));
    await flush();

    // node_modules/** is a DEFAULT_WORKSPACE_EXCLUDE → never enters the index.
    expect(service.search('index', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(4);
    expect(fsProvider.stat).not.toHaveBeenCalled();
  });

  it('does NOT index a created file matched by workspace ignore rules, compiled once per build', async () => {
    const { service, watchers, ignoreResolver, compiledCheck, fsProvider } =
      makeHarness({
        parsedIgnoreFiles: [{ patterns: [] }],
        isIgnored: (rel) => rel.replace(/\\/g, '/').includes('generated/'),
      });
    await service.start(ROOT);

    watchers[0].fire(
      'create',
      abs('src/generated/schema.ts'),
      abs('src/generated/types.ts'),
      abs('src/kept.ts'),
    );
    await flush();

    expect(ignoreResolver.compileMatcher).toHaveBeenCalledTimes(1);
    expect(ignoreResolver.isIgnored).not.toHaveBeenCalled();
    expect(compiledCheck).toHaveBeenCalledTimes(3);
    expect(fsProvider.stat).toHaveBeenCalledTimes(1);
    expect(service.search('schema', 10)).toHaveLength(0);
    expect(service.search('kept', 10)).toHaveLength(1);
  });

  it('dispose tears down the subscription and clears state', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);

    service.dispose();

    expect(watchers[0].disposed).toBe(true);
    expect(service.isReady()).toBe(false);
    expect(service.fileCount).toBe(0);
    expect(service.indexedRoot).toBeUndefined();
  });
});

/**
 * TASK_2026_200 — the index must be re-buildable for a new root inside one
 * process. Pre-fix, `ensureReady()` short-circuited on a `started` flag that was
 * set once and never cleared, and `start()` compared roots as raw strings, so
 * after any `workspace:switch` the `@` picker served the boot workspace's files
 * for the rest of the process lifetime.
 *
 * See the ROOT MODEL block in `workspace-file-index.service.ts`: the service is
 * single-active-root with rebuild-on-change, NOT a root-keyed map.
 */
describe('WorkspaceFileIndexService — re-index on workspace switch', () => {
  const filesByRoot = {
    [ROOT]: [abs('src/alpha.service.ts'), abs('alpha-only.md')],
    [ROOT_B]: [absB('src/beta.service.ts'), absB('beta-only.md')],
  };

  /**
   * Acceptance criterion 12: started for root A, then asked for root B, serves
   * B's files with no process restart — and none of A's entries survive.
   */
  it('serves root B after being started for root A, with no A entries surviving', async () => {
    const { service } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    expect(service.search('alpha-only', 10)).toHaveLength(1);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));

    await service.ensureReadyFor(ROOT_B);

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    expect(service.search('beta-only', 10)).toHaveLength(1);
    expect(service.search('beta.service', 10)).toHaveLength(1);
    // The whole point: A must be gone, not merely outranked.
    expect(service.search('alpha-only', 10)).toHaveLength(0);
    expect(service.search('alpha.service', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(2);
    const names = service.getAll(1000).map((r) => r.fileName);
    expect(names).not.toContain('alpha-only.md');
  });

  /**
   * TASK_2026_344 criterion 1 — the reason this task exists.
   *
   * Pre-fix, `ensureReadyFor` compared one `rootKey` and tore the whole index
   * down whenever it differed, so A→B→A cost THREE full walks. On the captured
   * Electron session that was 14826 + 9969 + 8626 ms for one 15k-file folder
   * (log.log:1346,1835,2165) plus 7657 + 2686 + 2539 ms for the other, none of
   * which was ever closed.
   */
  it('walks each open folder exactly once across an A → B → A switch', async () => {
    const { service, indexer } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    await service.ensureReadyFor(ROOT);

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    // ...and the folder we came back to is intact, not half-rebuilt.
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
    expect(service.search('alpha-only', 10)).toHaveLength(1);
    expect(service.search('beta-only', 10)).toHaveLength(0);
  });

  /**
   * The same criterion stated as "no I/O", which is what the user feels: the
   * second activation of A must be answerable in the SAME synchronous block,
   * before any promise callback runs. If it awaited a walk, the index would
   * still be B's here.
   */
  it('re-activates an already-built folder without awaiting any work', async () => {
    const { service, ignoreResolver, indexer } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);

    ignoreResolver.parseWorkspaceIgnoreFiles.mockClear();
    (indexer.discoverWorkspacePaths as jest.Mock).mockClear();

    // No await: read the index in the same tick as the request.
    const pending = service.ensureReadyFor(ROOT);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
    expect(service.isReady()).toBe(true);
    expect(service.search('alpha-only', 10)).toHaveLength(1);

    await pending;
    expect(indexer.discoverWorkspacePaths).not.toHaveBeenCalled();
    expect(ignoreResolver.parseWorkspaceIgnoreFiles).not.toHaveBeenCalled();
  });

  /**
   * Criterion 4 — `ContextService.assertIndexServes` (context.service.ts:474-482)
   * reads `indexedRoot` SYNCHRONOUSLY after `ensureIndexFor` resolves and throws
   * on a mismatch. The flip must therefore happen before the first await on
   * every path, including the cold one.
   */
  it('flips indexedRoot synchronously, before the returned promise settles', async () => {
    const { service } = makeHarness({ filesByRoot });

    const cold = service.ensureReadyFor(ROOT);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
    await cold;

    const warm = service.ensureReadyFor(ROOT_B);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    await warm;
  });

  /**
   * Criterion 2 — one watcher per OPEN folder, armed once and kept.
   *
   * chokidar has no recursive mode: arming a watcher readdirp-walks every
   * directory and opens an `fs.watch` handle per directory (~4.9k for the
   * captured folder). That synchronous burst is the 260-554 ms `[event-loop]`
   * lag run that follows each "Ready" line (log.log:1347-1350,1836-1840,
   * 2166-2169), so re-arming it per switch is not a leak question — it is the
   * stall itself.
   */
  it('arms one watcher per open folder and keeps it across switches', async () => {
    const { service, watchers, workspaceWatcher } = makeHarness({
      filesByRoot,
    });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    await service.ensureReadyFor(ROOT);
    await service.ensureReadyFor(ROOT_B);

    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(2);
    expect(watchers).toHaveLength(2);
    // A is inactive right now and its watcher is STILL LIVE — that is what
    // keeps its snapshot fresh enough to reuse.
    expect(watchers[0].disposeCount).toBe(0);
    expect(watchers[1].disposeCount).toBe(0);
  });

  /**
   * Criterion 2, second half — eviction is by folder CLOSED, and closed is a
   * statement only `onDidChangeWorkspaceFolders` + `getWorkspaceFolders()` can
   * make. Deactivating A above disposed nothing; closing it disposes exactly
   * once.
   */
  it('disposes a folder watcher exactly once when that folder is closed', async () => {
    const { service, watchers, setOpenFolders } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    expect(watchers[0].disposeCount).toBe(0);

    // The host closes A while B is active.
    setOpenFolders([ROOT_B]);

    expect(watchers[0].disposeCount).toBe(1);
    expect(watchers[1].disposeCount).toBe(0);

    // A second folder-change event must not re-dispose it.
    setOpenFolders([ROOT_B]);
    expect(watchers[0].disposeCount).toBe(1);
  });

  it('re-walks a closed folder if it is opened again', async () => {
    const { service, indexer, setOpenFolders } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    setOpenFolders([ROOT_B]);

    await service.ensureReadyFor(ROOT);

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(3);
    expect(service.search('alpha-only', 10)).toHaveLength(1);
  });

  it('never evicts the ACTIVE folder, even when the host stops listing it', async () => {
    const { service, watchers, setOpenFolders } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    setOpenFolders([ROOT_B]);

    expect(watchers[0].disposeCount).toBe(0);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
    expect(service.search('alpha-only', 10)).toHaveLength(1);
  });

  /**
   * A host that reports no folders at all (the CLI) reports that permanently,
   * and the last folder closing in Electron is exactly the case `ensureReady`
   * already resolves in favour of keeping the snapshot. So an empty list is
   * "no information", never "everything closed".
   */
  it('keeps every cached folder when the host reports no open folders', async () => {
    const { service, watchers, setOpenFolders } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    setOpenFolders([]);

    expect(watchers[0].disposeCount).toBe(0);
    expect(watchers[1].disposeCount).toBe(0);
  });

  /**
   * Criterion 3 — an inactive folder's watcher must keep patching ITS OWN
   * snapshot. Without this the cache would serve a stale list on switch-back,
   * which is worse than the rebuild it replaced.
   */
  it('patches an INACTIVE folder from its own watcher, with no rebuild on switch-back', async () => {
    const { service, watchers, indexer } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);

    // A is inactive; a file appears in it and one disappears from it.
    watchers[0].fire('create', abs('src/added-while-away.ts'));
    watchers[0].fire('delete', abs('alpha-only.md'));
    await flush();

    // B's view is untouched by A's events.
    expect(service.search('added-while-away', 10)).toHaveLength(0);
    expect(service.search('beta-only', 10)).toHaveLength(1);

    (indexer.discoverWorkspacePaths as jest.Mock).mockClear();
    await service.ensureReadyFor(ROOT);

    expect(indexer.discoverWorkspacePaths).not.toHaveBeenCalled();
    expect(service.search('added-while-away', 10)).toHaveLength(1);
    expect(service.search('alpha-only', 10)).toHaveLength(0);
  });

  /**
   * The cache is bounded. Hosts that hand us ad-hoc roots the provider never
   * lists (the CLI, tests) would otherwise hold every folder's maps and watch
   * handles for the life of the process.
   */
  it('caps the cache and evicts the least-recently-active folder', async () => {
    const roots = Array.from({ length: 10 }, (_, i) =>
      path.join('/', `ws-${i}`),
    );
    const { service, watchers, indexer } = makeHarness({
      filesByRoot: Object.fromEntries(
        roots.map((r) => [r, [path.join(r, 'only.ts')]]),
      ),
      openFolders: [],
    });

    for (const root of roots) {
      await service.ensureReadyFor(root);
    }

    // 10 folders walked, but only the cap's worth still held.
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(10);
    expect(watchers.filter((w) => w.disposeCount === 0)).toHaveLength(8);

    // The two oldest went; the newest is intact and free to re-activate.
    (indexer.discoverWorkspacePaths as jest.Mock).mockClear();
    await service.ensureReadyFor(roots[9]);
    expect(indexer.discoverWorkspacePaths).not.toHaveBeenCalled();

    await service.ensureReadyFor(roots[0]);
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);
  });

  /**
   * The cap is subordinate to the CLOSED rule, not a second eviction reason
   * beside it.
   *
   * A real multi-root workspace with more folders open than `MAX_CACHED_FOLDERS`
   * used to trip the LRU on the 9th activation and dispose the 1st folder's LIVE
   * watcher while the host still listed it as open — so switching back re-walked
   * the tree and re-armed chokidar, which is the exact regression TASK_2026_344
   * removes, reintroduced at N=9. It is also the alternating-eviction thrash the
   * sibling autocomplete cache fixed once already (this lib's CLAUDE.md,
   * "Autocomplete discovery"), one order of magnitude up.
   *
   * The previous overflow test could not see this: it passed `openFolders: []`,
   * i.e. only ad-hoc roots, which is the one case where the cap SHOULD bite.
   */
  it('never evicts a folder the host still lists as open, even past the cap', async () => {
    const roots = Array.from({ length: 9 }, (_, i) =>
      path.join('/', `open-ws-${i}`),
    );
    const { service, watchers, indexer, workspaceProvider } = makeHarness({
      filesByRoot: Object.fromEntries(
        roots.map((r) => [r, [path.join(r, 'only.ts')]]),
      ),
      // Every one of the nine is genuinely OPEN in the host.
      openFolders: roots,
    });

    for (const root of roots) {
      await service.ensureReadyFor(root);
    }

    // Nine folders, nine walks, nine watchers — and not one of them disposed.
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(9);
    expect(watchers).toHaveLength(9);
    expect(watchers.every((w) => w.disposeCount === 0)).toBe(true);
    // The eviction decision has to consult the host, not just `lastActiveAt`.
    expect(workspaceProvider.getWorkspaceFolders).toHaveBeenCalled();

    // The least-recently-active folder is the one an LRU would have taken.
    expect(service.hasIndexFor(roots[0])).toBe(true);

    // Cycling across all nine costs nothing: no walk, no watcher churn.
    (indexer.discoverWorkspacePaths as jest.Mock).mockClear();
    for (const root of [...roots, ...roots]) {
      await service.ensureReadyFor(root);
    }
    expect(indexer.discoverWorkspacePaths).not.toHaveBeenCalled();
    expect(watchers.every((w) => w.disposeCount === 0)).toBe(true);
  });

  /**
   * The other half of the same rule: with the cap's worth of REAL folders open,
   * an ad-hoc root the provider never lists is still evictable — so the bound on
   * CLI/test roots survives, it just cannot reach an open folder.
   */
  it('still evicts ad-hoc roots the host never lists, while open folders stay', async () => {
    const open = Array.from({ length: 8 }, (_, i) =>
      path.join('/', `open-ws-${i}`),
    );
    const adHoc = Array.from({ length: 3 }, (_, i) =>
      path.join('/', `adhoc-ws-${i}`),
    );
    const all = [...open, ...adHoc];
    const { service, watchers, indexer } = makeHarness({
      filesByRoot: Object.fromEntries(
        all.map((r) => [r, [path.join(r, 'only.ts')]]),
      ),
      openFolders: open,
    });

    for (const root of all) {
      await service.ensureReadyFor(root);
    }

    // Every open folder survived...
    for (const root of open) {
      expect(service.hasIndexFor(root)).toBe(true);
    }
    // ...and the ad-hoc roots absorbed the whole overflow: the two older ones
    // are gone, the active one is never evicted.
    expect(service.hasIndexFor(adHoc[0])).toBe(false);
    expect(service.hasIndexFor(adHoc[1])).toBe(false);
    expect(service.hasIndexFor(adHoc[2])).toBe(true);

    const openWatchers = watchers.filter((w) =>
      open.includes(w.root as string),
    );
    expect(openWatchers).toHaveLength(8);
    expect(openWatchers.every((w) => w.disposeCount === 0)).toBe(true);

    // Re-activating an evicted ad-hoc root re-walks; an open one does not.
    (indexer.discoverWorkspacePaths as jest.Mock).mockClear();
    await service.ensureReadyFor(open[0]);
    expect(indexer.discoverWorkspacePaths).not.toHaveBeenCalled();
    await service.ensureReadyFor(adHoc[0]);
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);
  });

  it('hasIndexFor reports the cache, not the active folder', async () => {
    const { service } = makeHarness({ filesByRoot });

    expect(service.hasIndexFor(ROOT)).toBe(false);
    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);

    expect(service.hasIndexFor(ROOT)).toBe(true);
    expect(service.hasIndexFor(`${ROOT}${path.sep}`)).toBe(true);
    expect(service.hasIndexFor(path.join('/', 'never-opened'))).toBe(false);
  });

  /**
   * Criterion 13: separator/drive-case variants of one root are ONE key and
   * must not force a redundant rebuild.
   */
  it('treats a trailing-separator variant of the same root as one key (no rebuild)', async () => {
    const { service, workspaceWatcher } = makeHarness();

    await service.start(ROOT);
    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);

    await service.ensureReadyFor(`${ROOT}${path.sep}`);
    await service.ensureReadyFor(ROOT);

    // One build, one watcher — the variants collapsed to a single key.
    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
  });

  it('treats drive-letter-case variants as one key on Windows (no rebuild)', async () => {
    // Drive letters are a Windows path concept; mirrors the guard in
    // task-specs' normalize-workspace-root.spec.ts.
    if (path.sep !== '\\') return;

    const upper = 'D:\\projects\\ws';
    const { service, workspaceWatcher } = makeHarness({
      filesByRoot: { [upper]: ['D:\\projects\\ws\\src\\only.ts'] },
    });

    await service.start(upper);
    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);

    await service.ensureReadyFor('d:\\projects\\ws');
    await service.ensureReadyFor('D:/projects/ws/');

    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);
    expect(service.search('only', 10)).toHaveLength(1);
  });

  /**
   * Supersede, don't interleave: a rebuild for B started while A's build is
   * still streaming must not let A's entries land in B's maps.
   */
  it('supersedes an in-flight build instead of interleaving it', async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const { service } = makeHarness({
      filesByRoot,
      streamGate: { [ROOT]: gateA },
    });

    // A's build is held open before it yields a single entry.
    const buildA = service.start(ROOT);
    await flush();
    expect(service.fileCount).toBe(0);

    // Switch to B while A is still streaming, and let B finish first.
    const buildB = service.ensureReadyFor(ROOT_B);
    await buildB;

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    expect(service.fileCount).toBe(2);

    // Now let A's stream drain. Its entries must be discarded, not merged.
    releaseA();
    await buildA;
    await flush();

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    expect(service.fileCount).toBe(2);
    expect(service.search('alpha-only', 10)).toHaveLength(0);
    expect(service.search('alpha.service', 10)).toHaveLength(0);
    expect(service.search('beta-only', 10)).toHaveLength(1);
  });

  /**
   * Supersede, part two — the IGNORE RULES, not just the maps.
   *
   * `ignoreFiles` used to be a SERVICE field that `build()` wrote after an
   * await and `isExcluded()` read on every watcher create/change. A late-landing
   * build for superseded root A published A's rules over B's, so for the rest of
   * B's index lifetime every incremental update was filtered through the WRONG
   * workspace's .gitignore — the bulk path's cross-root contamination, relocated
   * to the live path.
   *
   * Per-folder entries (TASK_2026_344) make that structurally impossible: A's
   * rules land in A's record. This test still gates the IGNORE PARSE — the
   * window the defect lived in — and now asserts BOTH folders end up with their
   * own rules, which is the stronger statement.
   *
   * Note the watcher is looked up by `root`, not by "the last one created". Both
   * folders now arm their own watcher and keep it, so ordinal indexing would
   * silently pick A's here.
   */
  it('gives each folder its own ignore rules when a build lands late', async () => {
    let releaseA!: () => void;
    const ignoreGateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const rulesA: IgnoreRule[] = [{ owner: 'A', ignores: 'secret-a' }];
    const rulesB: IgnoreRule[] = [{ owner: 'B', ignores: 'secret-b' }];

    const harness = makeHarness({
      filesByRoot,
      ignoreFilesByRoot: { [ROOT]: rulesA, [ROOT_B]: rulesB },
      ignoreGate: { [ROOT]: ignoreGateA },
      // Each root's rules ignore only its OWN secret file.
      isIgnoredWith: (rel, rules) =>
        rules.some((r) => rel.replace(/\\/g, '/').includes(r.ignores)),
    });
    const { service, watchers, compiledCheck } = harness;

    // A's build is parked inside parseWorkspaceIgnoreFiles.
    const buildA = service.start(ROOT);
    await flush();

    // B supersedes and completes, publishing B's rules.
    await service.ensureReadyFor(ROOT_B);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));

    // Now let A's ignore parse land late.
    releaseA();
    await buildA;
    await flush();

    // The active index still belongs to B...
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));

    const watcherB = watchers.find((w) => w.root === ROOT_B);
    const watcherA = watchers.find((w) => w.root === ROOT);
    expect(watcherB).toBeDefined();
    expect(watcherA).toBeDefined();

    // ...and so must its ignore rules. `secret-a.ts` is ignored under A's rules
    // and permitted under B's, so it MUST enter B's index. Pre-fix, A's rules
    // were live and this file was silently dropped from the `@` picker.
    compiledCheck.mockClear();
    watcherB?.fire('create', absB('secret-a.ts'));
    await flush();

    expect(service.search('secret-a', 10)).toHaveLength(1);

    // Direct evidence of which rules the service's compiled matcher holds.
    const rulesUsed = compiledCheck.mock.calls[0]?.[1] as
      | IgnoreRule[]
      | undefined;
    expect(rulesUsed).toEqual(rulesB);
    expect(rulesUsed?.[0].owner).toBe('B');

    // And B's own secret is still correctly excluded — the rules are B's, not
    // merely "not A's".
    watcherB?.fire('create', absB('secret-b.ts'));
    await flush();
    expect(service.search('secret-b', 10)).toHaveLength(0);

    // A kept ITS rules: its own secret stays out of its own snapshot, and the
    // resolver was handed rulesA for it.
    compiledCheck.mockClear();
    watcherA?.fire('create', abs('secret-a.ts'));
    watcherA?.fire('create', abs('welcome.ts'));
    await flush();
    const rulesUsedForA = compiledCheck.mock.calls[0]?.[1] as
      | IgnoreRule[]
      | undefined;
    expect(rulesUsedForA).toEqual(rulesA);

    await service.ensureReadyFor(ROOT);
    expect(service.search('secret-a', 10)).toHaveLength(0);
    expect(service.search('welcome', 10)).toHaveLength(1);
  });

  /**
   * Supersede, part three — the WATCHER path.
   *
   * `onBatch` gates on the generation, but a new path is then statted — a
   * batch does not say whether a created path is a file or a directory — and
   * the write sits behind that await. A switch landing in that window used to
   * let a create event for root A write an A-rooted path into root B's live
   * maps — the `@` picker listing a file from the wrong workspace.
   *
   * A generation check upstream does not protect a write that sits behind an
   * `await`; the handler re-checks immediately before writing. This test gates
   * the STAT, which neither `streamGate` nor `ignoreGate` reaches.
   */
  it('drops a watcher event that resolves after a switch instead of writing it into the new root', async () => {
    let releaseStat!: () => void;
    const statGate = new Promise<void>((resolve) => {
      releaseStat = resolve;
    });

    const harness = makeHarness({
      filesByRoot: {
        [ROOT]: [abs('base-a.ts')],
        [ROOT_B]: [absB('base-b.ts')],
      },
      statGate,
    });
    const { service, watchers } = harness;

    await service.start(ROOT);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));

    // A create event for A parks inside its stat, mid-handler.
    watchers[0].fire('create', abs('late-from-a.ts'));
    await flush();
    expect(service.search('late-from-a', 10)).toHaveLength(0);

    // Switch to B, close A, and let B build fully while A's handler is parked.
    await service.ensureReadyFor(ROOT_B);
    harness.setOpenFolders([ROOT_B]);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));

    // Release the parked handler — it now resumes against a torn-down entry.
    releaseStat();
    await flush();

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    // The load-bearing assertion: A's late event must NOT appear anywhere.
    expect(service.search('late-from-a', 10)).toHaveLength(0);
    expect(service.getAll(100).map((r) => r.fileName)).toEqual(['base-b.ts']);
    expect(service.fileCount).toBe(1);
    await service.ensureReadyFor(ROOT);
    expect(service.search('late-from-a', 10)).toHaveLength(0);
  });

  /**
   * The `started` short-circuit is gone: `ensureReady()` re-resolves the
   * provider on every call, so a provider root change is picked up by the very
   * next query.
   */
  it('ensureReady picks up a provider root change after the first build', async () => {
    const harness = makeHarness({ filesByRoot, providerRoot: ROOT });
    const { service, workspaceProvider } = harness;

    await service.ensureReady();
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
    expect(service.search('alpha-only', 10)).toHaveLength(1);

    // The platform provider now reports B (Electron `setActiveFolder`).
    workspaceProvider.getWorkspaceRoot.mockReturnValue(ROOT_B);

    await service.ensureReady();

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    expect(service.search('beta-only', 10)).toHaveLength(1);
    expect(service.search('alpha-only', 10)).toHaveLength(0);
  });

  it('ensureReady does not rebuild while the provider root is unchanged', async () => {
    const { service, workspaceWatcher } = makeHarness({ providerRoot: ROOT });

    await service.ensureReady();
    await service.ensureReady();
    await service.ensureReady();

    expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing snapshot when the provider reports no root', async () => {
    const harness = makeHarness({ filesByRoot, providerRoot: ROOT });
    const { service, workspaceProvider } = harness;

    await service.ensureReady();
    expect(service.fileCount).toBe(2);

    workspaceProvider.getWorkspaceRoot.mockReturnValue(
      undefined as unknown as string,
    );
    await service.ensureReady();

    // A query is better served by the last good snapshot than by nothing.
    expect(service.fileCount).toBe(2);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
  });

  /**
   * Preserved degradation: a host with no real watcher still gets a correct
   * (static) snapshot. Re-indexing must not start throwing there.
   */
  it('still rebuilds on a host whose watcher cannot be created', async () => {
    const { service, workspaceWatcher, logger } = makeHarness({ filesByRoot });
    workspaceWatcher.watch.mockImplementation(() => {
      throw new Error('no watcher on this host');
    });

    await service.start(ROOT);
    expect(service.isReady()).toBe(true);
    expect(service.search('alpha-only', 10)).toHaveLength(1);

    await service.ensureReadyFor(ROOT_B);

    expect(service.isReady()).toBe(true);
    expect(service.search('beta-only', 10)).toHaveLength(1);
    expect(service.search('alpha-only', 10)).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] watcher unavailable (index will not stay live until a retry succeeds)',
      expect.any(Error),
    );
  });

  /**
   * Preserved degradation: a failed build resets `startPromise` so the next
   * query retries rather than being wedged on a rejected promise.
   */
  it('retries the same root after a failed build', async () => {
    let attempt = 0;
    const { service } = makeHarness();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const indexer = (service as any).indexer as {
      discoverWorkspacePaths: unknown;
    };
    indexer.discoverWorkspacePaths = async function* () {
      attempt++;
      if (attempt === 1) throw new Error('scan failed');
      yield [abs('recovered.ts')];
    };

    await expect(service.start(ROOT)).rejects.toThrow('scan failed');
    expect(service.isReady()).toBe(false);

    await service.ensureReadyFor(ROOT);

    expect(service.isReady()).toBe(true);
    expect(service.search('recovered', 10)).toHaveLength(1);
  });
});

/**
 * TASK_2026_437 C10 / INV-6 — lost events degrade to "one rebuild", never to
 * per-event work. The 2026-09-14 freeze delivered tens of thousands of delete
 * events from ten removed worktrees; each ran an awaited ignore check and a
 * map write on the Electron main thread. Storm breaking and coalescing now
 * happen in the watch host (`WorkspaceChangeCoalescer`, pinned in
 * platform-core); this side receives one `overflow` batch and rebuilds once.
 */
describe('WorkspaceFileIndexService — overflow rebuild (TASK_2026_437)', () => {
  it('an overflow batch triggers exactly one path-only rebuild with the subscription kept', async () => {
    const { service, watchers, indexer, fsProvider, logger, files } =
      makeHarness();
    await service.start(ROOT);
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);

    // The files now on disk, which the rebuild must pick up.
    for (let i = 0; i < 10_000; i++) files.push(abs(`gen/f-${i}.ts`));
    watchers[0].deliver({ overflow: true, droppedCount: 10_000 });
    await flush();
    await flush();

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    expect(fsProvider.stat).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] watcher reported lost events; rebuilding the index once',
      { root: ROOT, overflow: true, truncated: false, droppedCount: 10_000 },
    );
    expect(service.isReady()).toBe(true);
    expect(service.fileCount).toBe(4 + 10_000);
    // The subscription was kept: a rebuild does not resubscribe.
    expect(watchers).toHaveLength(1);
    expect(watchers[0].disposed).toBe(false);

    // Live updates continue after the rebuild.
    watchers[0].fire('create', abs('src/after-overflow.ts'));
    await flush();
    expect(service.search('after-overflow', 10)).toHaveLength(1);
  });

  it('a truncated batch rebuilds instead of patching from a partial path list', async () => {
    const { service, watchers, indexer, fsProvider, files } = makeHarness();
    await service.start(ROOT);

    files.push(abs('gen/dropped-from-batch.ts'));
    watchers[0].deliver({
      changes: [{ path: abs('gen/in-batch.ts'), kind: 'create' }],
      truncated: true,
      droppedCount: 700,
    });
    await flush();
    await flush();

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    expect(fsProvider.stat).not.toHaveBeenCalled();
    expect(service.search('dropped-from-batch', 10)).toHaveLength(1);
  });

  it('dispose during a rebuild keeps the torn-down folder from being written', async () => {
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    const { service, watchers, indexer } = makeHarness();
    await service.start(ROOT);
    const original = indexer.discoverWorkspacePaths.getMockImplementation();
    indexer.discoverWorkspacePaths.mockImplementationOnce(
      async function* (options) {
        await rebuildGate;
        if (original) yield* original(options);
      },
    );

    watchers[0].deliver({ overflow: true });
    await flush();
    service.dispose();
    releaseRebuild();
    await flush();
    await flush();

    expect(service.fileCount).toBe(0);
    expect(service.isReady()).toBe(false);
  });

  it('keeps serving the previous snapshot during the rebuild and swaps the new one in at the end', async () => {
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => {
      releaseRebuild = resolve;
    });
    const { service, watchers, indexer, files } = makeHarness();
    await service.start(ROOT);

    files.push(abs('gen/rebuilt.ts'));
    const original = indexer.discoverWorkspacePaths.getMockImplementation();
    indexer.discoverWorkspacePaths.mockImplementationOnce(
      async function* (options) {
        await rebuildGate;
        if (original) yield* original(options);
      },
    );

    watchers[0].deliver({ overflow: true });
    await flush();
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);

    // Mid-rebuild: the previous snapshot is fully queryable, never empty.
    expect(service.isReady()).toBe(true);
    expect(service.search('auth', 10)).toHaveLength(1);
    expect(service.search('rebuilt', 10)).toHaveLength(0);

    // A live batch during the rebuild lands in both snapshots.
    watchers[0].fire('create', abs('src/during-rebuild.ts'));
    await flush();
    expect(service.search('during-rebuild', 10)).toHaveLength(1);

    releaseRebuild();
    await flush();
    await flush();
    expect(service.search('rebuilt', 10)).toHaveLength(1);
    expect(service.search('auth', 10)).toHaveLength(1);
    expect(service.search('during-rebuild', 10)).toHaveLength(1);
  });

  it('overflows during a rebuild queue exactly one more, which runs even when the first fails; a failure keeps the old snapshot', async () => {
    let failRebuild!: () => void;
    const failGate = new Promise<void>((resolve) => {
      failRebuild = resolve;
    });
    const { service, watchers, indexer, files, logger } = makeHarness();
    await service.start(ROOT);
    indexer.discoverWorkspacePaths.mockImplementationOnce(
      // eslint-disable-next-line require-yield
      async function* () {
        await failGate;
        throw new Error('walk failed');
      },
    );

    // Overflow 1 → rebuild 1 starts and parks.
    watchers[0].deliver({ overflow: true });
    await flush();
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);

    // Degraded rescan ticks while it runs: queued once, never stacked.
    watchers[0].deliver({ overflow: true });
    watchers[0].deliver({ overflow: true });
    watchers[0].deliver({ overflow: true });
    await flush();
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);

    files.push(abs('gen/after-failure.ts'));
    failRebuild();
    await flush();
    await flush();
    await flush();

    expect(logger.error).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] Rebuild after lost watcher events failed (keeping the previous snapshot)',
      expect.any(Error),
    );
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(3);
    expect(service.search('after-failure', 10)).toHaveLength(1);
    expect(service.search('auth', 10)).toHaveLength(1);

    await flush();
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(3);
  });

  it('holds an overflow rebuild on the injected governor and serves the previous snapshot until it clears (C14 d)', async () => {
    let release!: (outcome: 'clear') => void;
    const governor = {
      isClear: jest.fn(() => false),
      whenClear: jest.fn(
        () =>
          new Promise<'clear' | 'timeout'>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const { service, watchers, indexer, files } = makeHarness({ governor });
    await service.start(ROOT);

    files.push(abs('gen/after-wait.ts'));
    watchers[0].deliver({ overflow: true });
    watchers[0].deliver({ overflow: true });
    await flush();

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
    expect(service.search('auth', 10)).toHaveLength(1);
    expect(service.search('after-wait', 10)).toHaveLength(0);

    release('clear');
    await flush();
    await flush();
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    expect(service.search('after-wait', 10)).toHaveLength(1);
  });

  it('a query for the folder (ensureReadyFor) starts a held rebuild at once; without one it keeps waiting', async () => {
    const governor = {
      isClear: jest.fn(() => false),
      whenClear: jest.fn(
        (options?: unknown) =>
          new Promise<'clear' | 'timeout'>((_resolve, reject) => {
            const signal = (options as { signal?: AbortSignal } | undefined)
              ?.signal;
            signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      ),
    };
    const { service, watchers, indexer, files } = makeHarness({ governor });
    await service.start(ROOT);

    files.push(abs('gen/queried.ts'));
    watchers[0].deliver({ overflow: true });
    await flush();
    await flush();
    // Background overflow, nobody asking: still held.
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);

    await service.ensureReadyFor(ROOT);
    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    await flush();
    await flush();
    expect(service.search('queried', 10)).toHaveLength(1);
    expect(governor.whenClear).toHaveBeenCalledTimes(1);
  });
});

/**
 * TASK_2026_437 Batch 11 review fixes: the FU-4c readiness contract, the
 * bounded directory-delete sweep, the one key normalizer, and the watch()
 * failure retry.
 */
describe('WorkspaceFileIndexService — readiness, sweep bound, keys, subscribe retry', () => {
  /**
   * FU-4c. Every production caller (`ContextService.searchFiles`,
   * `getAllFiles`, `getFileSuggestions`) awaits `ensureReadyFor` first. A
   * caller that does not must see nothing — never a half-walked folder.
   */
  it('queries answer nothing while the first build is still walking, then everything once it is awaited', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const files = Array.from({ length: 6 }, (_, i) =>
      abs(`src/dir/file-${i}.ts`),
    );
    const { service, indexer } = makeHarness({ files, discoveryBatchSize: 2 });
    const original = indexer.discoverWorkspacePaths.getMockImplementation();
    indexer.discoverWorkspacePaths.mockImplementationOnce(
      async function* (options) {
        if (!original) return;
        let yielded = 0;
        for await (const batch of original(options)) {
          yield batch;
          if (++yielded === 1) await gate;
        }
      },
    );

    const ready = service.ensureReadyFor(ROOT);
    await flush();
    // Files are in the maps already; the query surface still says nothing.
    expect(service.fileCount).toBeGreaterThan(0);
    expect(service.isReady()).toBe(false);
    expect(service.search('file', 10)).toEqual([]);
    expect(service.getAll(10)).toEqual([]);
    expect(service.searchDirectories('dir', 10)).toEqual([]);

    release();
    await ready;
    expect(service.search('file', 10)).toHaveLength(6);
    expect(service.getAll(100).filter((r) => !r.isDirectory)).toHaveLength(6);
    expect(service.searchDirectories('dir', 10)).toHaveLength(1);
  });

  it('sweeps a deleted directory in place in a small index', async () => {
    const { service, watchers, indexer } = makeHarness();
    await service.start(ROOT);

    watchers[0].fire('delete', abs('src'));
    await flush();

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(1);
    expect(service.search('auth', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(2);
  });

  it('rebuilds instead of sweeping when a directory is deleted in an index over 5,000 entries', async () => {
    const files = Array.from({ length: 5_001 }, (_, i) => abs(`big/f-${i}.ts`));
    files.push(abs('src/keep.ts'));
    const { service, watchers, indexer, logger } = makeHarness({ files });
    await service.start(ROOT);
    expect(service.fileCount).toBe(5_002);

    // The directory is gone from disk by the time the walk runs.
    files.splice(0, 5_001);
    watchers[0].fire('delete', abs('big'));
    await flush();
    await flush();

    expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[WorkspaceFileIndex] directory deleted in a large index; rebuilding the index once',
      expect.objectContaining({ root: ROOT, deletedDirectories: 1 }),
    );
    expect(service.fileCount).toBe(1);
    expect(service.search('keep', 10)).toHaveLength(1);
  });

  it('one key normalizer: doubled, trailing and mixed separators name the same entry', async () => {
    expect(toIndexKey(abs('src//util/'))).toBe(toIndexKey(abs('src/util')));
    expect(toIndexKey(`${abs('src')}${path.sep}`)).toBe(
      toIndexKey(path.join(ROOT, 'src')),
    );

    const { service, watchers } = makeHarness();
    await service.start(ROOT);
    // A directory key built with path.join at walk time, deleted through a
    // watcher spelling with a doubled and a trailing separator.
    const sep = path.sep;
    watchers[0].fire('delete', `${ROOT}${sep}src${sep}${sep}util${sep}`);
    await flush();

    expect(service.searchDirectories('util', 10)).toHaveLength(0);
    expect(service.search('format', 10)).toHaveLength(0);
    expect(service.search('auth', 10)).toHaveLength(1);
  });

  it('one key normalizer: Windows forward/back slashes and drive-letter case', async () => {
    if (path.sep !== '\\') return;
    expect(toIndexKey('d:/projects/ws/src/')).toBe('D:\\projects\\ws\\src');
    expect(toIndexKey('D:\\')).toBe('D:\\');

    const root = 'D:\\projects\\ws';
    const { service, watchers } = makeHarness({
      filesByRoot: {
        [root]: ['D:/projects/ws/src/deep/a.ts', 'D:/projects/ws/b.ts'],
      },
    });
    await service.start(root);
    watchers[0].fire('delete', 'd:\\projects\\ws\\src\\');
    await flush();

    expect(service.fileCount).toBe(1);
    expect(service.searchDirectories('deep', 10)).toHaveLength(0);
  });

  it('a folder whose watch() threw is subscribed again on a later ensureReadyFor, at most once a minute, and rebuilt once', async () => {
    let clock = 1_000_000;
    const now = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const { service, workspaceWatcher, indexer, logger, files } =
        makeHarness();
      workspaceWatcher.watch.mockImplementationOnce(() => {
        throw new Error('host down');
      });
      await service.start(ROOT);
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(0);
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);

      // Inside the retry interval: no attempt, however often it is queried.
      clock += 30_000;
      await service.ensureReadyFor(ROOT);
      await service.ensureReadyFor(ROOT);
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(1);

      // Still failing after the interval: one attempt, not warned again.
      clock += 30_000;
      workspaceWatcher.watch.mockImplementationOnce(() => {
        throw new Error('host still down');
      });
      await service.ensureReadyFor(ROOT);
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(2);
      await service.ensureReadyFor(ROOT);
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(2);
      const warnings = (logger.warn as jest.Mock).mock.calls.filter(([m]) =>
        String(m).includes('watcher unavailable'),
      );
      expect(warnings).toHaveLength(1);

      // Recovered: subscribed, and the changes it missed are rebuilt once.
      clock += 60_000;
      files.push(abs('src/added-while-static.ts'));
      await service.ensureReadyFor(ROOT);
      await flush();
      await flush();
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(3);
      expect(workspaceWatcher.__state.live()).toHaveLength(1);
      expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
      expect(service.search('added-while-static', 10)).toHaveLength(1);

      // Live now: later queries neither retry nor rebuild.
      clock += 600_000;
      await service.ensureReadyFor(ROOT);
      expect(workspaceWatcher.watch).toHaveBeenCalledTimes(3);
      expect(indexer.discoverWorkspacePaths).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
});
