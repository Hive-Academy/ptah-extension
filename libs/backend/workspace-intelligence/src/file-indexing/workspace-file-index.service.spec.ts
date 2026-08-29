import 'reflect-metadata';

jest.mock('vscode', () => ({}), { virtual: true });

import * as path from 'path';
import { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
import { WorkspaceFileIndexService } from './workspace-file-index.service';

/**
 * Minimal file-watcher double: captures the create/change/delete listeners the
 * service registers and lets tests fire synthetic events, mirroring what a real
 * IFileWatcher does.
 */
class FakeWatcher {
  createListeners: Array<(p: string) => void> = [];
  changeListeners: Array<(p: string) => void> = [];
  deleteListeners: Array<(p: string) => void> = [];
  /** Total dispose() invocations — proves "disposed exactly once" (R2). */
  disposeCount = 0;

  constructor(readonly cwd: string | undefined) {}

  get disposed(): boolean {
    return this.disposeCount > 0;
  }

  readonly onDidCreate = (l: (p: string) => void) => {
    this.createListeners.push(l);
    return { dispose: () => undefined };
  };
  readonly onDidChange = (l: (p: string) => void) => {
    this.changeListeners.push(l);
    return { dispose: () => undefined };
  };
  readonly onDidDelete = (l: (p: string) => void) => {
    this.deleteListeners.push(l);
    return { dispose: () => undefined };
  };
  dispose = () => {
    this.disposeCount++;
  };

  fireCreate(p: string): void {
    this.createListeners.forEach((l) => l(p));
  }
  fireDelete(p: string): void {
    this.deleteListeners.forEach((l) => l(p));
  }
}

// Flush the microtask queue so the async onCreate/onChange handlers settle.
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
   * tell root A's rules apart from root B's — the service hands whatever is in
   * its `ignoreFiles` field to `isIgnored`, so the double can report which
   * root's rules are live.
   */
  ignoreFilesByRoot?: Record<string, IgnoreRule[]>;
  /**
   * Ignore predicate that inspects the rules the SERVICE passed in, rather than
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
   * Gate that must resolve before `isIgnored` returns — i.e. it parks a
   * watcher handler inside `isExcluded()`, between its generation gate and its
   * write. `ignoreGate` only covers the parse inside `build()` and never
   * reaches this path, which is how the second off-by-one-await escaped.
   */
  isIgnoredGate?: Promise<void>;
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
    }) {
      const root = options.workspaceFolder;
      const key = normalizeWorkspaceRoot(root);
      const gate = gateByKey.get(key);
      if (gate) await gate;
      const all = byKey.get(key) ?? defaultFiles;
      const size = Math.max(opts.discoveryBatchSize ?? all.length, 1);
      for (let i = 0; i < all.length; i += size) {
        yield all.slice(i, i + size);
      }
    }),
  };

  // A fresh watcher per createFileWatcher call, so a rebuild's dispose of the
  // PREVIOUS handle is observable (R2).
  const watchers: FakeWatcher[] = [];
  const fsProvider = {
    createFileWatcher: jest.fn(
      (_pattern: string, options?: { exclude?: string[]; cwd?: string }) => {
        const w = new FakeWatcher(options?.cwd);
        watchers.push(w);
        return w;
      },
    ),
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

  const ignoreResolver = {
    parseWorkspaceIgnoreFiles: jest.fn(async (root: string) => {
      const key = normalizeWorkspaceRoot(root);
      const gate = ignoreGateByKey.get(key);
      if (gate) await gate;
      return ignoreRulesByKey.get(key) ?? opts.parsedIgnoreFiles ?? [];
    }),
    isIgnored: jest.fn(async (relativePath: string, rules: IgnoreRule[]) => {
      if (opts.isIgnoredGate) await opts.isIgnoredGate;
      return {
        ignored: opts.isIgnoredWith
          ? opts.isIgnoredWith(relativePath, rules)
          : opts.isIgnored
            ? opts.isIgnored(relativePath)
            : false,
      };
    }),
  };

  const service = new WorkspaceFileIndexService(
    logger as never,
    indexer as never,
    fsProvider as never,
    workspaceProvider as never,
    ignoreResolver as never,
  );

  return {
    service,
    watchers,
    fsProvider,
    workspaceProvider,
    ignoreResolver,
    indexer,
    logger,
    setOpenFolders,
    folderSubscriptionDispose,
    files: defaultFiles,
  };
}

describe('WorkspaceFileIndexService', () => {
  it('builds the in-memory index once from discoverWorkspacePaths', async () => {
    const { service, fsProvider } = makeHarness();

    await service.start(ROOT);

    expect(service.isReady()).toBe(true);
    expect(service.fileCount).toBe(4);
    // Watcher wired with node_modules et al. excluded at the OS level.
    expect(fsProvider.createFileWatcher).toHaveBeenCalledWith(
      '**/*',
      expect.objectContaining({ exclude: expect.arrayContaining([]) }),
    );
    const excludeArg = fsProvider.createFileWatcher.mock.calls[0][1];
    expect(excludeArg?.exclude).toContain('**/node_modules/**');
  });

  it('start is idempotent for the same root (single build)', async () => {
    const { service, fsProvider } = makeHarness();
    await Promise.all([service.start(ROOT), service.start(ROOT)]);
    await service.start(ROOT);
    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
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

    watchers[0].fireCreate(abs('src/newfile.ts'));
    await flush();

    const results = service.search('newfile', 10);
    expect(results.map((r) => r.fileName)).toEqual(['newfile.ts']);
  });

  it('removes an entry from the index when a file is deleted', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);
    expect(service.search('format', 10)).toHaveLength(1);

    watchers[0].fireDelete(abs('src/util/format.ts'));
    await flush();

    expect(service.search('format', 10)).toHaveLength(0);
  });

  it('does NOT index a created file under a default-excluded directory', async () => {
    const { service, watchers } = makeHarness();
    await service.start(ROOT);

    watchers[0].fireCreate(abs('node_modules/pkg/index.ts'));
    await flush();

    // node_modules/** is a DEFAULT_WORKSPACE_EXCLUDE → never enters the index.
    expect(service.search('index', 10)).toHaveLength(0);
    expect(service.fileCount).toBe(4);
  });

  it('does NOT index a created file matched by workspace ignore rules', async () => {
    const { service, watchers, ignoreResolver } = makeHarness({
      parsedIgnoreFiles: [{ patterns: [] }],
      isIgnored: (rel) => rel.replace(/\\/g, '/').includes('generated/'),
    });
    await service.start(ROOT);

    watchers[0].fireCreate(abs('src/generated/schema.ts'));
    await flush();

    expect(ignoreResolver.isIgnored).toHaveBeenCalled();
    expect(service.search('schema', 10)).toHaveLength(0);
  });

  it('dispose tears down the watcher and clears state', async () => {
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
    const { service, watchers, fsProvider } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    await service.ensureReadyFor(ROOT_B);
    await service.ensureReadyFor(ROOT);
    await service.ensureReadyFor(ROOT_B);

    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(2);
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
    watchers[0].fireCreate(abs('src/added-while-away.ts'));
    watchers[0].fireDelete(abs('alpha-only.md'));
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

    const openWatchers = watchers.filter((w) => open.includes(w.cwd as string));
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
    const { service, fsProvider } = makeHarness();

    await service.start(ROOT);
    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);

    await service.ensureReadyFor(`${ROOT}${path.sep}`);
    await service.ensureReadyFor(ROOT);

    // One build, one watcher — the variants collapsed to a single key.
    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));
  });

  it('treats drive-letter-case variants as one key on Windows (no rebuild)', async () => {
    // Drive letters are a Windows path concept; mirrors the guard in
    // task-specs' normalize-workspace-root.spec.ts.
    if (path.sep !== '\\') return;

    const upper = 'D:\\projects\\ws';
    const { service, fsProvider } = makeHarness({
      filesByRoot: { [upper]: ['D:\\projects\\ws\\src\\only.ts'] },
    });

    await service.start(upper);
    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);

    await service.ensureReadyFor('d:\\projects\\ws');
    await service.ensureReadyFor('D:/projects/ws/');

    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
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
   * Note the watcher is looked up by `cwd`, not by "the last one created". Both
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
    const { service, watchers, ignoreResolver } = harness;

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

    const watcherB = watchers.find((w) => w.cwd === ROOT_B);
    const watcherA = watchers.find((w) => w.cwd === ROOT);
    expect(watcherB).toBeDefined();
    expect(watcherA).toBeDefined();

    // ...and so must its ignore rules. `secret-a.ts` is ignored under A's rules
    // and permitted under B's, so it MUST enter B's index. Pre-fix, A's rules
    // were live and this file was silently dropped from the `@` picker.
    ignoreResolver.isIgnored.mockClear();
    watcherB?.fireCreate(absB('secret-a.ts'));
    await flush();

    expect(service.search('secret-a', 10)).toHaveLength(1);

    // Direct evidence of which rules the service handed the resolver.
    const rulesUsed = ignoreResolver.isIgnored.mock.calls[0]?.[1] as
      | IgnoreRule[]
      | undefined;
    expect(rulesUsed).toEqual(rulesB);
    expect(rulesUsed?.[0].owner).toBe('B');

    // And B's own secret is still correctly excluded — the rules are B's, not
    // merely "not A's".
    watcherB?.fireCreate(absB('secret-b.ts'));
    await flush();
    expect(service.search('secret-b', 10)).toHaveLength(0);

    // A kept ITS rules: its own secret stays out of its own snapshot, and the
    // resolver was handed rulesA for it.
    ignoreResolver.isIgnored.mockClear();
    watcherA?.fireCreate(abs('secret-a.ts'));
    watcherA?.fireCreate(abs('welcome.ts'));
    await flush();
    const rulesUsedForA = ignoreResolver.isIgnored.mock.calls[0]?.[1] as
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
   * `setupWatcher` gates each callback on the generation, but `onCreate` /
   * `onChange` then `await isExcluded()` before writing, and `isExcluded`
   * awaits `isIgnored` whenever the workspace has any ignore file (the normal
   * case). A switch landing in that window used to let a create event for root
   * A write an A-rooted path into root B's live maps — the `@` picker listing
   * a file from the wrong workspace.
   *
   * A generation check upstream does not protect a write that sits behind an
   * `await`; the handlers re-check immediately before `addFileEntry`. This test
   * gates the EXCLUSION CHECK, which neither `streamGate` nor `ignoreGate`
   * reaches.
   */
  it('drops a watcher event that resolves after a switch instead of writing it into the new root', async () => {
    let releaseExclusion!: () => void;
    const exclusionGate = new Promise<void>((resolve) => {
      releaseExclusion = resolve;
    });

    const harness = makeHarness({
      filesByRoot: {
        [ROOT]: [abs('base-a.ts')],
        [ROOT_B]: [absB('base-b.ts')],
      },
      // Non-empty rules are required for `isExcluded` to reach its await at all.
      ignoreFilesByRoot: {
        [ROOT]: [{ owner: 'A', ignores: 'nothing-matches' }],
        [ROOT_B]: [{ owner: 'B', ignores: 'nothing-matches' }],
      },
      isIgnoredGate: exclusionGate,
      // Nothing is ignored: the ONLY thing that may stop this write is the
      // post-await generation re-check.
      isIgnoredWith: () => false,
    });
    const { service, watchers } = harness;

    await service.start(ROOT);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT));

    // A create event for A parks inside isExcluded, mid-handler.
    watchers[0].fireCreate(abs('late-from-a.ts'));
    await flush();
    expect(service.search('late-from-a', 10)).toHaveLength(0);

    // Switch to B and let B build fully while A's handler is still parked.
    await service.ensureReadyFor(ROOT_B);
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));

    // Release the parked handler — it now resumes against B's live maps.
    releaseExclusion();
    await flush();

    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));
    // The load-bearing assertion: A's late event must NOT appear in B's index.
    expect(service.search('late-from-a', 10)).toHaveLength(0);
    expect(service.getAll(100).map((r) => r.fileName)).toEqual(['base-b.ts']);
    expect(service.fileCount).toBe(1);
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
    const { service, fsProvider } = makeHarness({ providerRoot: ROOT });

    await service.ensureReady();
    await service.ensureReady();
    await service.ensureReady();

    expect(fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
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
    const { service, fsProvider, logger } = makeHarness({ filesByRoot });
    fsProvider.createFileWatcher.mockImplementation(() => {
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
      '[WorkspaceFileIndex] watcher unavailable (index will not stay live)',
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
