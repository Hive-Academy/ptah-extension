/**
 * `go-vet-checker.spec.ts` — TASK_2026_559 Batch 37a Task 37a.2, O2 §7.1
 * cases 15-24.
 *
 * No Go install is needed: the binary resolver and the spawner are injected,
 * the runner is the real `runChecker` with a recorded tree kill, and the
 * consent store is the real `GoVetConsentStore` over an in-memory double of
 * the host's workspace-scoped storage. Fixture roots are `mkdtemp`
 * directories removed after each case. Go sources that need an import line
 * build it by concatenation (validate-deps bundle scanner rule).
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import type {
  IProcessSpawner,
  IStateStorage,
  IWorkspaceScopedStateStorage,
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { runChecker } from './checker-runner';
import type { ResolvedGoBinary } from './go-binary-resolver';
import { GoVetConsentStore } from './go-vet-consent-store';
import { hasFilenameConstraint, scanGoHeader } from './go-file-membership';
import {
  GO_VET_COVERAGE,
  GO_VET_FIXED_ENV,
  GO_VET_MAX_DIAGNOSTICS,
  GoVetChecker,
  buildGoVetEnv,
  packageDirForId,
  type GoVetCheckResult,
  packagePattern,
  splitVetOutput,
  type GoVetCheckerDependencies,
} from './go-vet-checker';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

class FakeHandle extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = null;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined = 777;
  killed = false;
  exitCode: number | null = null;
  readonly kills: string[] = [];
  readonly whenSpawned: Promise<number | null>;

  constructor(spawnDelayMs = 0) {
    super();
    this.whenSpawned = new Promise((resolve) =>
      setTimeout(() => resolve(777), spawnDelayMs),
    );
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.kills.push(signal ?? 'SIGTERM');
    return true;
  }
}

/** What the fake child does once spawned. */
type Behaviour =
  | {
      readonly exit: number;
      readonly stdout?: string;
      readonly stderr?: string;
    }
  | { readonly hang: true; readonly spawnDelayMs?: number }
  | { readonly flood: number };

class FakeSpawner implements IProcessSpawner {
  readonly requests: ProcessSpawnRequest[] = [];
  readonly handles: FakeHandle[] = [];
  constructor(
    public behaviour: Behaviour,
    private readonly onSpawn: () => void = () => undefined,
  ) {}

  spawnProcess(request: ProcessSpawnRequest): SpawnedProcessHandle {
    this.onSpawn();
    this.requests.push(request);
    const behaviour = this.behaviour;
    const handle = new FakeHandle(
      'hang' in behaviour ? (behaviour.spawnDelayMs ?? 0) : 0,
    );
    this.handles.push(handle);
    setImmediate(() => {
      if ('exit' in behaviour) {
        if (behaviour.stdout) {
          handle.stdout.emit('data', Buffer.from(behaviour.stdout));
        }
        if (behaviour.stderr) {
          handle.stderr.emit('data', Buffer.from(behaviour.stderr));
        }
        handle.emit('close', behaviour.exit, null);
      } else if ('flood' in behaviour) {
        handle.stderr.emit('data', Buffer.alloc(behaviour.flood, 0x61));
      }
    });
    return handle;
  }
}

class MemoryStorage implements IStateStorage {
  readonly values = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
  }
  keys(): readonly string[] {
    return [...this.values.keys()];
  }
}

class ScopedStorage implements IWorkspaceScopedStateStorage {
  readonly byRoot = new Map<string, MemoryStorage>();
  private readonly fallback = new MemoryStorage();
  register(root: string): void {
    this.byRoot.set(path.resolve(root), new MemoryStorage());
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.fallback.get(key, defaultValue);
  }
  update(key: string, value: unknown): Promise<void> {
    return this.fallback.update(key, value);
  }
  keys(): readonly string[] {
    return this.fallback.keys();
  }
  getStorageForWorkspace(workspacePath: string): IStateStorage | undefined {
    return this.byRoot.get(workspacePath);
  }
  getAllWorkspacePaths(): string[] {
    return [...this.byRoot.keys()];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function write(root: string, relative: string, content: string): string {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

/** A module root with `a/a.go` and `b/b.go`. */
function goModule(): { root: string; a: string; b: string } {
  const root = tempDir('ptah-govet-');
  write(root, 'go.mod', 'module example.com/m\n\ngo 1.22\n');
  const a = write(root, 'a/a.go', 'package a\n\nfunc A() {}\n');
  const b = write(root, 'b/b.go', 'package b\n\nfunc B() {}\n');
  return { root, a, b };
}

const BINARY: ResolvedGoBinary = {
  path: path.resolve('/opt/go/bin/go'),
  size: 123,
  mtimeMs: 456,
  pathDirs: [path.resolve('/opt/go/bin'), path.resolve('/usr/bin')],
};

interface Harness {
  checker: GoVetChecker;
  spawner: FakeSpawner;
  store: GoVetConsentStore;
  logger: { info: jest.Mock };
  killTree: jest.Mock;
  order: string[];
}

function harness(
  root: string,
  behaviour: Behaviour,
  overrides: Partial<GoVetCheckerDependencies> = {},
): Harness {
  const order: string[] = [];
  const scoped = new ScopedStorage();
  scoped.register(root);
  const store = new GoVetConsentStore(scoped, {
    userDataPath: tempDir('ptah-govet-userdata-'),
  });
  const spawner = new FakeSpawner(behaviour, () => order.push('spawn'));
  const logger = { info: jest.fn() };
  const killTree = jest.fn(async () => undefined);
  const realRead = store.read.bind(store);
  jest.spyOn(store, 'read').mockImplementation((...args) => {
    order.push('consent');
    return realRead(...args);
  });
  const checker = new GoVetChecker({
    consentStore: store,
    getSpawner: () => spawner,
    userDataPath: tempDir('ptah-govet-userdata-'),
    logger,
    env: () => ({ PATH: '/opt/go/bin', HOME: '/home/u' }),
    resolveGo: () => {
      order.push('resolve');
      return BINARY;
    },
    run: (request) => runChecker(request, { killTree }),
    ...overrides,
  });
  return { checker, spawner, store, logger, killTree, order };
}

const IMPORT = 'imp' + 'ort';

const EMPTY_VET = { exit: 0, stderr: '# example.com/m/a\n{}\n' };

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

describe('GoVetChecker — consent', () => {
  it('case 15: no consent → nothing spawned; unchecked/no-consent for every requested Go file', async () => {
    const { root, a, b } = goModule();
    const { checker, spawner } = harness(root, EMPTY_VET);

    const result = await checker.check({ workspaceRoot: root, files: [a, b] });

    expect(spawner.requests).toEqual([]);
    expect(result).toMatchObject({
      status: 'unchecked',
      outcome: 'not-run',
      reason: 'no-consent',
      diagnostics: [],
      checkedFiles: [],
    });
    expect(result.notChecked).toEqual([
      expect.objectContaining({ language: 'go', count: 2, files: [a, b] }),
    ]);
    expect(result.notChecked[0].reason).toContain('go vet is off');
  });

  it('case 15: stale consent (binary changed) → nothing spawned; unchecked/consent-stale with the reason', async () => {
    const { root, a } = goModule();
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, { ...BINARY, size: 1 });

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(spawner.requests).toEqual([]);
    expect(result).toMatchObject({
      status: 'unchecked',
      reason: 'consent-stale',
      staleReason: 'go-changed',
    });
    expect(result.notChecked[0].reason).toContain('(go-changed)');
  });

  it('case 16: grant → run spawns; revoke → next run spawns nothing; one consent read per run, after resolution, before spawn', async () => {
    const { root, a } = goModule();
    const { checker, spawner, store, order } = harness(root, EMPTY_VET);

    await store.grant(root, BINARY);
    const first = await checker.check({ workspaceRoot: root, files: [a] });
    expect(first.status).toBe('checked');
    expect(spawner.requests).toHaveLength(1);
    expect(order).toEqual(['resolve', 'consent', 'spawn']);

    await store.revoke(root);
    order.length = 0;
    const second = await checker.check({ workspaceRoot: root, files: [a] });

    expect(second).toMatchObject({ status: 'unchecked', reason: 'no-consent' });
    expect(spawner.requests).toHaveLength(1);
    expect(order).toEqual(['resolve', 'consent']);
  });

  it('no Go binary → unchecked/no-go-binary, consent never read', async () => {
    const { root, a } = goModule();
    const { checker, spawner, order } = harness(root, EMPTY_VET, {
      resolveGo: () => null,
    });

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result).toMatchObject({
      status: 'unchecked',
      reason: 'no-go-binary',
    });
    expect(order).toEqual([]);
    expect(spawner.requests).toEqual([]);
  });
});

describe('GoVetChecker — fixed invocation and environment', () => {
  it('spawns `<canonical go> vet -json ./a ./b` in the module directory, nothing else', async () => {
    const { root, a, b } = goModule();
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    await checker.check({ workspaceRoot: root, files: [b, a, b] });

    expect(spawner.requests).toHaveLength(1);
    expect(spawner.requests[0]).toMatchObject({
      command: BINARY.path,
      args: ['vet', '-json', './b', './a'],
      cwd: fs.realpathSync.native(root),
    });
  });

  it.each<NodeJS.Platform>(['win32', 'linux'])(
    'case 17 (%s): a hostile inherited env never reaches the child — the env equals the allowlist exactly',
    async (platform) => {
      const { root, a } = goModule();
      const hostile = {
        PATH: '/opt/go/bin',
        HOME: '/home/u',
        USERPROFILE: 'C:\\Users\\u',
        SystemRoot: 'C:\\Windows',
        TEMP: '/tmp/t',
        TMP: '/tmp/u',
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
        XDG_CACHE_HOME: '/home/u/.cache',
        LANG: 'en_US.UTF-8',
        GOFLAGS: '-toolexec=evil',
        GOENV: '/x',
        GOCACHEPROG: 'evil',
        GOTOOLCHAIN: 'auto',
        CGO_ENABLED: '1',
        GOPROXY: 'https://proxy.example',
        GOEXPERIMENT: 'x',
        GODEBUG: 'x=1',
        CC: 'evil-cc',
        CXX: 'evil-cxx',
        CGO_CFLAGS: '-evil',
        NODE_OPTIONS: '--require evil',
        PATHEXT: '.CMD;.BAT',
      };
      const { checker, spawner, store } = harness(root, EMPTY_VET, {
        env: () => hostile,
        platform,
      });
      await store.grant(root, BINARY);

      await checker.check({ workspaceRoot: root, files: [a] });

      const delimiter = platform === 'win32' ? ';' : ':';
      expect(spawner.requests[0].env).toEqual({
        PATH: BINARY.pathDirs.join(delimiter),
        HOME: '/home/u',
        USERPROFILE: 'C:\\Users\\u',
        SystemRoot: 'C:\\Windows',
        TEMP: '/tmp/t',
        TMP: '/tmp/u',
        ...(platform === 'win32'
          ? { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
          : {}),
        XDG_CACHE_HOME: '/home/u/.cache',
        LANG: 'en_US.UTF-8',
        GOFLAGS: '-mod=readonly -buildvcs=false',
        GOENV: 'off',
        GOTOOLCHAIN: 'local',
        GOPROXY: 'off',
        GOSUMDB: 'off',
        GONOPROXY: '',
        GONOSUMDB: '',
        GOPRIVATE: '',
        GOINSECURE: '',
        GOCACHEPROG: '',
        GOWORK: 'off',
        GO111MODULE: 'on',
        CGO_ENABLED: '0',
      });
    },
  );

  it('buildGoVetEnv always ends with the fixed Go variables', () => {
    const env = buildGoVetEnv({ GOFLAGS: '-vettool=x' }, ['/b'], 'linux');
    expect(env).toEqual({ PATH: '/b', ...GO_VET_FIXED_ENV });
  });
});

describe('GoVetChecker — package validation', () => {
  it('case 18: packagePattern refuses outside-module, `...` and never yields a leading `-`', () => {
    const mod = path.resolve('/w/mod');
    expect(packagePattern(mod, mod)).toBe('.');
    expect(packagePattern(mod, path.join(mod, 'a', 'b'))).toBe('./a/b');
    expect(packagePattern(mod, path.resolve('/w/other'))).toBeNull();
    expect(packagePattern(mod, path.join(mod, 'x...y'))).toBeNull();
    expect(packagePattern(mod, path.join(mod, '-flag'))).toBe('./-flag');
  });

  it('case 18: 21 packages → 20 vetted, the 21st file omitted-by-cap', async () => {
    const root = tempDir('ptah-govet-');
    write(root, 'go.mod', 'module example.com/m\n');
    const files = Array.from({ length: 21 }, (_, index) =>
      write(root, `p${index}/f.go`, `package p${index}\n`),
    );
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files });

    expect(spawner.requests[0].args).toHaveLength(2 + 20);
    expect(result.skippedFiles).toEqual([
      { file: files[20], reason: 'omitted-by-cap' },
    ]);
    expect(result.checkedFiles).toHaveLength(20);
  });

  it('a directory whose name contains `...` is never passed; its file is invalid-package-path', async () => {
    const { root, a } = goModule();
    const odd = write(root, 'x...y/c.go', 'package c\n');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({
      workspaceRoot: root,
      files: [a, odd],
    });

    expect(spawner.requests[0].args).toEqual(['vet', '-json', './a']);
    expect(result.skippedFiles).toEqual([
      { file: odd, reason: 'invalid-package-path' },
    ]);
  });

  it('files outside the root and non-Go files are ignored; an unscoped call runs nothing', async () => {
    const { root } = goModule();
    const outside = write(tempDir('ptah-govet-out-'), 'z.go', 'package z\n');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const unscoped = await checker.check({ workspaceRoot: root });
    const foreign = await checker.check({
      workspaceRoot: root,
      files: [outside, path.join(root, 'README.md')],
    });

    expect(unscoped).toMatchObject({ status: 'unchecked', reason: 'unscoped' });
    expect(foreign).toMatchObject({
      status: 'unchecked',
      reason: 'no-go-files',
    });
    expect(spawner.requests).toEqual([]);
  });

  it('no go.mod (GOPATH mode) → unchecked/no-go-mod, nothing runs', async () => {
    const root = tempDir('ptah-govet-');
    const file = write(root, 'main.go', 'package main\n');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [file] });

    expect(result).toMatchObject({ status: 'unchecked', reason: 'no-go-mod' });
    expect(result.skippedFiles).toEqual([{ file, reason: 'no-go-mod' }]);
    expect(spawner.requests).toEqual([]);
  });

  it('partial success: one module vetted; a second module, a cgo file and a missing directory are named, not claimed', async () => {
    const { root, a } = goModule();
    write(root, 'tools/go.mod', 'module example.com/tools\n');
    const other = write(root, 'tools/t.go', 'package tools\n');
    const cgo = write(
      root,
      'a/c.go',
      'package a\n\n' + 'imp' + 'ort "C"\n\nfunc C() {}\n',
    );
    const gone = path.join(root, 'gone', 'g.go');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({
      workspaceRoot: root,
      files: [a, other, cgo, gone],
    });

    expect(spawner.requests[0].args).toEqual(['vet', '-json', './a']);
    expect(result.status).toBe('checked');
    expect(result.checkedFiles).toEqual([a]);
    expect(result.skippedFiles).toEqual([
      { file: other, reason: 'other-module' },
      { file: cgo, reason: 'cgo' },
      { file: gone, reason: 'not-found' },
    ]);
    expect(result.notChecked.map((group) => group.count)).toEqual([1, 1, 1]);
  });

  it('scanGoHeader reads single, grouped, named and commented imports', () => {
    const quoteC = '"C"';
    const imports = (source: string): readonly string[] | undefined =>
      scanGoHeader(source)?.imports;
    expect(imports('package a\n' + IMPORT + ' ' + quoteC + '\n')).toEqual([
      'C',
    ]);
    expect(
      imports('package a\n' + IMPORT + ' (\n\t"fmt"\n\t' + quoteC + '\n)\n'),
    ).toEqual(['fmt', 'C']);
    expect(
      imports(
        'package a\n' + IMPORT + ' (\n\tf "fmt"\n\t_ "os"\n\t. "io"\n)\n',
      ),
    ).toEqual(['fmt', 'os', 'io']);
    expect(
      imports('package a\n\n// ' + IMPORT + ' ' + quoteC + '\nfunc A() {}\n'),
    ).toEqual([]);
    // An escaped path cannot be decoded with certainty: not scanned.
    expect(scanGoHeader('package a\n' + IMPORT + ' "\\x43"\n')).toBeNull();
    expect(scanGoHeader('/* open\npackage a\n')).toBeNull();
  });

  it('hasFilenameConstraint follows Go’s GOOS/GOARCH file-name rule', () => {
    expect(hasFilenameConstraint('x_windows.go')).toBe(true);
    expect(hasFilenameConstraint('x_linux_arm64.go')).toBe(true);
    expect(hasFilenameConstraint('y_arm64_test.go')).toBe(true);
    expect(hasFilenameConstraint('linux.go')).toBe(false);
    expect(hasFilenameConstraint('a_test.go')).toBe(false);
    expect(hasFilenameConstraint('my_helper.go')).toBe(false);
  });
});

describe('GoVetChecker — review r1 finding 1: only files Go selects are credited', () => {
  async function vetOne(
    extra: Record<string, string>,
  ): Promise<{ result: GoVetCheckResult; root: string; a: string }> {
    const { root, a } = goModule();
    for (const [relative, content] of Object.entries(extra)) {
      write(root, relative, content);
    }
    const { checker, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);
    const files = [a, ...Object.keys(extra).map((r) => path.join(root, r))];
    const result = await checker.check({ workspaceRoot: root, files });
    return { result, root, a };
  }

  it('a missing file in an existing package is not-found, never checked', async () => {
    const { root, a } = goModule();
    const missing = path.join(root, 'a', 'missing.go');
    const { checker, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({
      workspaceRoot: root,
      files: [a, missing],
    });

    expect(result.status).toBe('checked');
    expect(result.checkedFiles).toEqual([a]);
    expect(result.skippedFiles).toEqual([
      { file: missing, reason: 'not-found' },
    ]);
  });

  it.each<[string, string, string, string]>([
    [
      'a //go:build line',
      'a/tagged.go',
      '//go:build excludedtag\n\npackage a\n',
      'build-constraints',
    ],
    [
      'a legacy // +build line',
      'a/legacy.go',
      '// +build excludedtag\n\npackage a\n',
      'build-constraints',
    ],
    ['a GOOS suffix', 'a/x_plan9.go', 'package a\n', 'build-constraints'],
    [
      'a GOARCH test suffix',
      'a/y_s390x_test.go',
      'package a\n',
      'build-constraints',
    ],
    ['a leading underscore', 'a/_skip.go', 'package a\n', 'ignored-name'],
    [
      'a cgo import with a trailing block comment',
      'a/native.go',
      'package a\n\n' + IMPORT + ' "C" /* trailing */\n',
      'cgo',
    ],
    [
      'a cgo import past the first 64 KiB',
      'a/late.go',
      `/*${' '.repeat(70 * 1024)}*/\npackage a\n\n${IMPORT} "C"\n`,
      'cgo',
    ],
    [
      'an unreadable import header',
      'a/escaped.go',
      'package a\n\n' + IMPORT + ' "\\x43"\n',
      'unverifiable',
    ],
    // Lane K closing review finding 3.
    [
      'an upper-case .GO extension',
      'a/IGNORED.GO',
      'package a\n\nfunc I() {}\n',
      'not-go-source',
    ],
    [
      'a mixed-case .Go extension',
      'a/Mixed.Go',
      'package a\n\nfunc M() {}\n',
      'not-go-source',
    ],
    [
      'a package documentation file',
      'a/documentation.go',
      '// Package docs only.\npackage documentation\n',
      'documentation-package',
    ],
    [
      'a //go:build ignore generator file',
      'a/gen.go',
      '//go:build ignore\n\npackage main\n\nfunc main() {}\n',
      'build-constraints',
    ],
  ])('%s → %s, not checked', async (_label, relative, content, reason) => {
    const { result, root, a } = await vetOne({ [relative]: content });

    expect(result.status).toBe('checked');
    expect(result.checkedFiles).toEqual([a]);
    expect(result.skippedFiles).toEqual([
      { file: path.join(root, relative), reason },
    ]);
  });

  it('closing review 3: a doc.go of the package itself is vetted and credited', async () => {
    const { result, root, a } = await vetOne({
      'a/doc.go': '// Package a is documented here.\npackage a\n',
    });

    expect(result.checkedFiles).toEqual([a, path.join(root, 'a/doc.go')]);
    expect(result.skippedFiles).toEqual([]);
  });

  it('a commented-out cgo import does not exclude the file', async () => {
    const { result, root, a } = await vetOne({
      'a/plain.go': 'package a\n\n// ' + IMPORT + ' "C"\n\nfunc P() {}\n',
    });

    expect(result.checkedFiles).toEqual([a, path.join(root, 'a/plain.go')]);
    expect(result.skippedFiles).toEqual([]);
  });
});

describe('GoVetChecker — review r1 finding 2: links never leave the consented root', () => {
  it('a file through an outward junction to another module is outside-root; nothing runs there', async () => {
    const { root, a } = goModule();
    const other = tempDir('ptah-govet-other-');
    write(other, 'go.mod', 'module example.com/other\n');
    write(other, 'plain.go', 'package other\n');
    fs.symlinkSync(other, path.join(root, 'linked'), 'junction');
    const linked = path.join(root, 'linked', 'plain.go');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const only = await checker.check({ workspaceRoot: root, files: [linked] });
    expect(only).toMatchObject({ status: 'unchecked', reason: 'no-go-files' });
    expect(only.skippedFiles).toEqual([
      { file: linked, reason: 'outside-root' },
    ]);
    expect(spawner.requests).toEqual([]);

    const mixed = await checker.check({
      workspaceRoot: root,
      files: [linked, a],
    });
    expect(spawner.requests).toHaveLength(1);
    expect(spawner.requests[0]).toMatchObject({
      cwd: fs.realpathSync.native(root),
      args: ['vet', '-json', './a'],
    });
    expect(mixed.checkedFiles).toEqual([a]);
    expect(mixed.skippedFiles).toEqual([
      { file: linked, reason: 'outside-root' },
    ]);
  });

  it('a package directory linked outward (no go.mod there) is outside-root too', async () => {
    const { root } = goModule();
    const outside = tempDir('ptah-govet-pkg-');
    write(outside, 'p.go', 'package p\n');
    fs.symlinkSync(outside, path.join(root, 'p'), 'junction');
    const linked = path.join(root, 'p', 'p.go');
    const { checker, spawner, store } = harness(root, EMPTY_VET);
    await store.grant(root, BINARY);

    const result = await checker.check({
      workspaceRoot: root,
      files: [linked],
    });

    expect(result.skippedFiles).toEqual([
      { file: linked, reason: 'outside-root' },
    ]);
    expect(spawner.requests).toEqual([]);
  });

  it('a workspace root that is itself a junction runs in its real folder and reports the caller’s paths', async () => {
    const { root: real, a: realA } = goModule();
    const holder = tempDir('ptah-govet-holder-');
    const root = path.join(holder, 'ws');
    fs.symlinkSync(real, root, 'junction');
    const a = path.join(root, path.relative(real, realA));
    const tree = {
      'example.com/m/a': {
        printf: [
          { posn: `${fs.realpathSync.native(realA)}:3:1`, message: 'm' },
        ],
      },
    };
    const { checker, spawner, store } = harness(root, {
      exit: 0,
      stderr: JSON.stringify(tree),
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(spawner.requests[0].cwd).toBe(fs.realpathSync.native(real));
    expect(result.checkedFiles).toEqual([a]);
    expect(result.diagnostics.map((entry) => entry.file)).toEqual([a]);
  });
});

describe('GoVetChecker — review r1 finding 3: unmappable findings are never erased', () => {
  function outsideFinding(packageId: string, extra: object = {}): string {
    return JSON.stringify({
      [packageId]: {
        printf: [
          {
            posn: path.resolve('/elsewhere/generated.go:42:1'),
            message: 'bad',
          },
        ],
      },
      ...extra,
    });
  }

  it('an outside position makes the answer qualified and its package’s file not ok; other packages stay checked', async () => {
    const { root, a, b } = goModule();
    const { checker, store, logger } = harness(root, {
      exit: 0,
      stderr: outsideFinding('example.com/m/a [example.com/m/a.test]'),
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a, b] });

    expect(result).toMatchObject({
      status: 'checked',
      outcome: 'findings',
      reason: 'unmapped-findings',
      unmappedFindings: 1,
      checkedFiles: [b],
    });
    expect(result.skippedFiles).toEqual([
      { file: a, reason: 'unmapped-findings' },
    ]);
    expect(result.notChecked[0].reason).toContain('outside the workspace');
    expect(logger.info.mock.calls[0][1]).toMatchObject({
      outcome: 'findings',
      reason: 'unmapped-findings',
    });
  });

  it('an unmappable finding in a package id outside the module disqualifies every vetted file', async () => {
    const { root, a, b } = goModule();
    const { checker, store } = harness(root, {
      exit: 0,
      stderr: outsideFinding('command-line-arguments'),
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a, b] });

    expect(result.outcome).toBe('findings');
    expect(result.checkedFiles).toEqual([]);
    expect(result.skippedFiles.map((entry) => entry.reason)).toEqual([
      'unmapped-findings',
      'unmapped-findings',
    ]);
  });

  it('packageDirForId maps a module package and its test variants, nothing else', () => {
    const mod = path.resolve('/w/mod');
    expect(packageDirForId('example.com/m', 'example.com/m', mod)).toBe(mod);
    expect(
      packageDirForId(
        'example.com/m/a_test [example.com/m/a.test]',
        'example.com/m',
        mod,
      ),
    ).toBe(path.join(mod, 'a'));
    expect(
      packageDirForId('example.com/other', 'example.com/m', mod),
    ).toBeNull();
    expect(
      packageDirForId('example.com/m/../x', 'example.com/m', mod),
    ).toBeNull();
  });
});

describe('GoVetChecker — results', () => {
  it('parses findings into per-file warnings with the analyzer as code; the claim is never a type check', async () => {
    const { root, a } = goModule();
    const tree = {
      'example.com/m/a': {
        printf: [
          {
            posn: `${a}:3:2`,
            message: 'fmt.Printf format %d has arg of wrong type',
          },
        ],
        unreachable: [{ posn: 'a/a.go:5:1', message: 'unreachable code' }],
      },
    };
    const { checker, store } = harness(root, {
      exit: 0,
      stderr: `# example.com/m/a\n${JSON.stringify(tree, null, '\t')}\n`,
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result).toMatchObject({ status: 'checked', outcome: 'findings' });
    expect(result.diagnostics).toEqual([
      {
        file: path.resolve(a),
        diagnostics: [
          {
            message: 'fmt.Printf format %d has arg of wrong type',
            line: 3,
            severity: 'warning',
            code: 'printf',
          },
          {
            message: 'unreachable code',
            line: 5,
            severity: 'warning',
            code: 'unreachable',
          },
        ],
      },
    ]);
    expect(GO_VET_COVERAGE.checks).not.toBe('type-check');
    expect(GO_VET_COVERAGE.approximations).toEqual(['go:syntax-only']);
  });

  it(`caps diagnostics at ${GO_VET_MAX_DIAGNOSTICS} and says so`, async () => {
    const { root, a } = goModule();
    const many = Array.from({ length: GO_VET_MAX_DIAGNOSTICS + 3 }, (_, i) => ({
      posn: `${a}:${i + 1}:1`,
      message: 'm',
    }));
    const { checker, store } = harness(root, {
      exit: 0,
      stderr: JSON.stringify({ 'example.com/m/a': { x: many } }),
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics[0].diagnostics).toHaveLength(
      GO_VET_MAX_DIAGNOSTICS,
    );
  });

  it.each<[string, string, string]>([
    [
      'toolchain-mismatch',
      'go: go.mod requires go >= 1.99 (running go 1.22.3; GOTOOLCHAIN=local)\n',
      'newer Go',
    ],
    [
      'missing-modules',
      'a/a.go:3:8: no required module provides package example.invalid/x; to add it:\n',
      'dependencies are missing',
    ],
    [
      'build-errors',
      '# example.com/m/a\nvet: a/a.go:3:2: undefined: x\n',
      'does not build',
    ],
    ['unparseable', 'panic: something odd\n', 'could not be read'],
  ])(
    'a non-zero exit is failed/%s with no Go diagnostics',
    async (reason, stderr, text) => {
      const { root, a } = goModule();
      const { checker, store } = harness(root, { exit: 1, stderr });
      await store.grant(root, BINARY);

      const result = await checker.check({ workspaceRoot: root, files: [a] });

      expect(result).toMatchObject({
        status: 'failed',
        outcome: 'failed',
        reason,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.checkedFiles).toEqual([]);
      expect(result.notChecked[0]).toMatchObject({ files: [a] });
      expect(result.notChecked[0].reason).toContain(text);
    },
  );

  it('case 21: a clean exit with unreadable output is failed/unparseable, never "No issues"', async () => {
    const { root, a } = goModule();
    const { checker, store } = harness(root, {
      exit: 0,
      stderr: 'something that is not vet json\n',
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result).toMatchObject({ status: 'failed', reason: 'unparseable' });
  });

  it('an analyzer error in the JSON tree is failed/analyzer-error', async () => {
    const { root, a } = goModule();
    const { checker, store } = harness(root, {
      exit: 0,
      stderr: JSON.stringify({ 'example.com/m/a': { printf: { error: 'x' } } }),
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'analyzer-error',
    });
  });

  it('case 19: delayed spawn then timeout → failed/timeout and a tree kill', async () => {
    const { root, a } = goModule();
    const { checker, store, killTree } = harness(
      root,
      { hang: true, spawnDelayMs: 40 },
      { timeoutMs: 10 },
    );
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(result).toMatchObject({
      status: 'failed',
      outcome: 'timeout',
      reason: 'timeout',
      diagnostics: [],
    });
    expect(killTree).toHaveBeenCalledWith(777);
  });

  it('case 20: output over 2 MiB → failed/too-large and a kill', async () => {
    const { root, a } = goModule();
    const { checker, store, killTree } = harness(root, {
      flood: 2 * 1024 * 1024 + 1,
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result).toMatchObject({
      status: 'failed',
      outcome: 'too-large',
      reason: 'too-large',
    });
    expect(killTree).toHaveBeenCalledWith(777);
  });

  it('case 22: cancellation mid-run → killed; no partial Go claim', async () => {
    const { root, a } = goModule();
    const { checker, store, killTree } = harness(root, { hang: true });
    await store.grant(root, BINARY);
    const controller = new AbortController();

    const pending = checker.check({
      workspaceRoot: root,
      files: [a],
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    const result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'cancelled',
      diagnostics: [],
      checkedFiles: [],
    });
    expect(killTree).toHaveBeenCalledWith(777);
  });

  it('case 23: a spawner getter that throws → failed/no-spawner', async () => {
    const { root, a } = goModule();
    const { checker, store } = harness(root, EMPTY_VET, {
      getSpawner: () => {
        throw new Error('SDK_PROCESS_SPAWNER not registered');
      },
    });
    await store.grant(root, BINARY);

    const result = await checker.check({ workspaceRoot: root, files: [a] });

    expect(result).toMatchObject({ status: 'failed', reason: 'no-spawner' });
  });
});

describe('GoVetChecker — audit', () => {
  it('case 24: one fixed-text line per run; the root appears only as its hash; no path, output or error text', async () => {
    const { root, a } = goModule();
    const { checker, store, logger } = harness(root, {
      exit: 1,
      stderr: `vet: ${a}:3:2: undefined: secretSymbol\n`,
    });
    await store.grant(root, BINARY);

    await checker.check({ workspaceRoot: root, files: [a] });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [message, fields] = logger.info.mock.calls[0];
    expect(message).toBe('[Diagnostics] go vet run');
    expect(fields).toEqual({
      workspaceHash: createHash('sha256')
        .update(path.resolve(root))
        .digest('hex')
        .slice(0, 16),
      packages: 1,
      durationMs: expect.any(Number),
      outcome: 'failed',
      reason: 'build-errors',
    });
    const logged = JSON.stringify(logger.info.mock.calls);
    for (const leak of [
      root,
      root.replace(/\\/g, '\\\\'),
      path.basename(root),
      'a.go',
      'secretSymbol',
      BINARY.path,
    ]) {
      expect(logged).not.toContain(leak);
    }
  });
});

describe('splitVetOutput', () => {
  it('reads `# pkg` headers and JSON objects; anything else is stray', () => {
    expect(splitVetOutput('# a\n{"x":{"y":[]}}\n# b\n{}\n')).toEqual({
      objects: [{ x: { y: [] } }, {}],
      stray: false,
    });
    expect(splitVetOutput('{"s":"}{"}\n').objects).toEqual([{ s: '}{' }]);
    expect(splitVetOutput('go: downloading x\n').stray).toBe(true);
    expect(splitVetOutput('{"unterminated": 1').stray).toBe(true);
  });
});
