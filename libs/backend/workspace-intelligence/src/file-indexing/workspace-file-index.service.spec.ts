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
   * Gate that must be resolved before `indexWorkspaceStream` yields anything
   * for the given raw root. Lets a test hold a build open across a switch.
   */
  streamGate?: Record<string, Promise<void>>;
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

  const indexer = {
    indexWorkspaceStream: async function* (options: {
      workspaceFolder: string;
    }) {
      const root = options.workspaceFolder;
      const key = normalizeWorkspaceRoot(root);
      const gate = gateByKey.get(key);
      if (gate) await gate;
      for (const p of byKey.get(key) ?? defaultFiles) {
        yield { path: p, relativePath: path.relative(root, p) };
      }
    },
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

  const workspaceProvider = {
    getWorkspaceRoot: jest.fn(() => opts.providerRoot ?? ROOT),
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
    logger,
    files: defaultFiles,
  };
}

describe('WorkspaceFileIndexService', () => {
  it('builds the in-memory index once from indexWorkspaceStream', async () => {
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
   * R2: `setupWatcher()` used to overwrite `this.watcher` without disposing it,
   * leaking one OS watch handle per switch once rebuilds became possible.
   */
  it('disposes the previous watcher exactly once when it rebuilds', async () => {
    const { service, watchers } = makeHarness({ filesByRoot });

    await service.start(ROOT);
    expect(watchers).toHaveLength(1);

    await service.ensureReadyFor(ROOT_B);

    expect(watchers).toHaveLength(2);
    expect(watchers[0].disposeCount).toBe(1);
    // The freshly-armed watcher for B is still live.
    expect(watchers[1].disposeCount).toBe(0);

    // A second switch disposes B's watcher once, and never re-disposes A's.
    await service.ensureReadyFor(ROOT);
    expect(watchers).toHaveLength(3);
    expect(watchers[0].disposeCount).toBe(1);
    expect(watchers[1].disposeCount).toBe(1);
    expect(watchers[2].disposeCount).toBe(0);
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
   * Supersede, part two — the SHARED IGNORE RULES, not just the maps.
   *
   * `ignoreFiles` is the other piece of shared mutable state `build()` writes
   * after an await, and `isExcluded()` reads it on every watcher create/change.
   * A late-landing build for superseded root A used to publish A's rules over
   * B's, so for the rest of B's index lifetime every incremental update was
   * filtered through the WRONG workspace's .gitignore — the same cross-root
   * contamination as the bulk path, relocated to the live path.
   *
   * This gates the IGNORE PARSE rather than the stream: `streamGate` resolves
   * the parse immediately and so never exercises this window, which is why the
   * first round of supersede tests missed the defect entirely.
   */
  it('does not let a superseded build publish its ignore rules over the new root', async () => {
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

    // The index still belongs to B...
    expect(service.indexedRoot).toBe(normalizeWorkspaceRoot(ROOT_B));

    // ...and so must its ignore rules. `secret-a.ts` is ignored under A's rules
    // and permitted under B's, so it MUST enter B's index. Pre-fix, A's rules
    // were live and this file was silently dropped from the `@` picker.
    ignoreResolver.isIgnored.mockClear();
    watchers[watchers.length - 1].fireCreate(absB('secret-a.ts'));
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
    watchers[watchers.length - 1].fireCreate(absB('secret-b.ts'));
    await flush();
    expect(service.search('secret-b', 10)).toHaveLength(0);
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
      indexWorkspaceStream: unknown;
    };
    indexer.indexWorkspaceStream = async function* () {
      attempt++;
      if (attempt === 1) throw new Error('scan failed');
      yield { path: abs('recovered.ts'), relativePath: 'recovered.ts' };
    };

    await expect(service.start(ROOT)).rejects.toThrow('scan failed');
    expect(service.isReady()).toBe(false);

    await service.ensureReadyFor(ROOT);

    expect(service.isReady()).toBe(true);
    expect(service.search('recovered', 10)).toHaveLength(1);
  });
});
