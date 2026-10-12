/**
 * TASK_2026_625: the postinstall patch that hides the console windows of
 * `@openai/codex-sdk`, `@cursor/sdk` and `chrome-launcher` spawns on Windows.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';

type Fn = (...args: unknown[]) => unknown;

interface Edit {
  readonly from: string;
  readonly to: string;
}
interface PackagePatch {
  readonly name: string;
  readonly version: string;
  readonly files: readonly { readonly file: string; readonly edits: readonly Edit[] }[];
  readonly shimDirs: readonly string[];
}
type PatchState =
  | 'missing'
  | 'version-mismatch'
  | 'anchor-mismatch'
  | 'unpatched'
  | 'patched';
interface PatcherApi {
  readonly PATCHES: readonly PackagePatch[];
  inspectPackage(nodeModulesDir: string, patch: PackagePatch): { state: PatchState; detail?: string };
  applyPackagePatch(
    nodeModulesDir: string,
    patch: PackagePatch,
    shimSourceDir: string,
  ): { state: PatchState; detail?: string };
}
const WRAPPED = [
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'fork',
  'exec',
  'execSync',
] as const;
type WrappedName = (typeof WRAPPED)[number];
type FakeChildProcess = Record<WrappedName, jest.Mock> & {
  ChildProcess: unknown;
};
interface ShimApi {
  createWindowsHideChildProcess(
    cp: FakeChildProcess,
  ): Record<WrappedName, Fn> & { ChildProcess: unknown };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const patcher: PatcherApi = require('./patch-windows-hide-deps.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const shim: ShimApi = require('./ptah-windows-hide-child-process.cjs');

const SHIM_NAMES = [
  'ptah-windows-hide-child-process.cjs',
  'ptah-windows-hide-child-process.mjs',
];

describe('ptah-windows-hide-child-process', () => {
  function fakeChildProcess(): FakeChildProcess {
    const mocks = Object.fromEntries(
      WRAPPED.map((name) => [name, jest.fn(() => name)]),
    ) as Record<WrappedName, jest.Mock>;
    return { ...mocks, ChildProcess: class FakeChildProcess {} };
  }

  it('adds windowsHide when no options are passed', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);

    wrapped['spawn']('git');
    wrapped['spawn']('git', ['status']);
    wrapped['exec']('dir');

    expect(cp['spawn'].mock.calls[0]).toEqual(['git', { windowsHide: true }]);
    expect(cp['spawn'].mock.calls[1]).toEqual([
      'git',
      ['status'],
      { windowsHide: true },
    ]);
    expect(cp['exec'].mock.calls[0]).toEqual(['dir', { windowsHide: true }]);
  });

  it('merges into a caller options object without mutating it', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);
    const options = { cwd: '/repo', stdio: 'pipe' };

    wrapped['spawn']('git', ['status'], options);
    wrapped['spawnSync']('git', options);

    expect(cp['spawn'].mock.calls[0]?.[2]).toEqual({
      cwd: '/repo',
      stdio: 'pipe',
      windowsHide: true,
    });
    expect(cp['spawnSync'].mock.calls[0]?.[1]).toEqual({
      cwd: '/repo',
      stdio: 'pipe',
      windowsHide: true,
    });
    expect(options).toEqual({ cwd: '/repo', stdio: 'pipe' });
  });

  it('keeps an explicit windowsHide value', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);

    wrapped['spawn']('pwsh', [], { windowsHide: false });

    expect(cp['spawn'].mock.calls[0]?.[2]).toEqual({ windowsHide: false });
  });

  it('puts options before a callback in the options slot', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);
    const callback = (): void => undefined;

    wrapped['execFile']('git', ['status'], callback);
    wrapped['execFile']('git', callback);
    wrapped['exec']('dir', callback);

    expect(cp['execFile'].mock.calls[0]).toEqual([
      'git',
      ['status'],
      { windowsHide: true },
      callback,
    ]);
    expect(cp['execFile'].mock.calls[1]).toEqual([
      'git',
      { windowsHide: true },
      callback,
    ]);
    expect(cp['exec'].mock.calls[0]).toEqual([
      'dir',
      { windowsHide: true },
      callback,
    ]);
  });

  it('reads options after a null args slot', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);

    wrapped['spawn']('git', null, { cwd: '/repo' });

    expect(cp['spawn'].mock.calls[0]).toEqual([
      'git',
      null,
      { cwd: '/repo', windowsHide: true },
    ]);
  });

  it('keeps the util.promisify hook of execFile and exec, with the default', () => {
    const cp = fakeChildProcess();
    const custom = jest.fn();
    Object.assign(cp['execFile'] as object, {
      [util.promisify.custom]: custom,
    });
    const wrapped = shim.createWindowsHideChildProcess(cp);

    const hook = (wrapped['execFile'] as unknown as Record<symbol, Fn>)[
      util.promisify.custom
    ];
    expect(typeof hook).toBe('function');
    hook?.('git', ['status']);
    expect(custom).toHaveBeenCalledWith('git', ['status'], {
      windowsHide: true,
    });
  });

  it('keeps the other members of child_process', () => {
    const cp = fakeChildProcess();
    const wrapped = shim.createWindowsHideChildProcess(cp);

    expect(wrapped['ChildProcess']).toBe(cp.ChildProcess);
  });

  it('wraps the real child_process and keeps its member names', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const real = require('child_process') as Record<string, unknown>;
    expect(Object.keys(shim).sort()).toEqual(Object.keys(real).sort());
  });

  it('re-exports every wrapped function from the ESM face', () => {
    const mjs = fs.readFileSync(path.join(__dirname, SHIM_NAMES[1] ?? ''), 'utf8');
    const block = /export const \{([^}]*)\} = cp;/.exec(mjs)?.[1] ?? '';
    const names = block
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
    expect(names).toEqual([...WRAPPED].sort());
  });
});

describe('patch-windows-hide-deps', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-windows-hide-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A fake install of `patch` whose files hold exactly the anchor text. */
  function install(patch: PackagePatch, version = patch.version): string {
    const pkgDir = path.join(tmp, patch.name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: patch.name, version }),
    );
    for (const filePatch of patch.files) {
      const file = path.join(pkgDir, filePatch.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        `/* head */${filePatch.edits.map((edit) => edit.from).join(';')}/* tail */`,
      );
    }
    for (const dir of patch.shimDirs) {
      fs.mkdirSync(path.join(pkgDir, dir), { recursive: true });
    }
    return pkgDir;
  }

  function byName(name: string): PackagePatch {
    const patch = patcher.PATCHES.find((candidate) => candidate.name === name);
    if (!patch) throw new Error(`no patch for ${name}`);
    return patch;
  }

  it.each(['@openai/codex-sdk', '@cursor/sdk', 'chrome-launcher'])(
    'patches %s, copies its shims, and is idempotent',
    (name) => {
      const patch = byName(name);
      const pkgDir = install(patch);

      expect(patcher.applyPackagePatch(tmp, patch, __dirname).state).toBe(
        'unpatched',
      );

      for (const filePatch of patch.files) {
        const text = fs.readFileSync(path.join(pkgDir, filePatch.file), 'utf8');
        for (const edit of filePatch.edits) {
          expect(text).not.toContain(edit.from);
          expect(text).toContain(edit.to);
        }
        expect(text.startsWith('/* head */')).toBe(true);
        expect(text.endsWith('/* tail */')).toBe(true);
      }
      for (const dir of patch.shimDirs) {
        for (const shimName of SHIM_NAMES) {
          expect(fs.existsSync(path.join(pkgDir, dir, shimName))).toBe(true);
        }
      }

      expect(patcher.applyPackagePatch(tmp, patch, __dirname).state).toBe(
        'patched',
      );
    },
  );

  it('leaves a different version untouched', () => {
    const patch = byName('@openai/codex-sdk');
    const pkgDir = install(patch, '0.999.0');
    const file = path.join(pkgDir, 'dist/index.js');
    const before = fs.readFileSync(file, 'utf8');

    expect(patcher.applyPackagePatch(tmp, patch, __dirname).state).toBe(
      'version-mismatch',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(pkgDir, 'dist', SHIM_NAMES[0] ?? ''))).toBe(
      false,
    );
  });

  it('leaves a package untouched when one anchor does not match', () => {
    const patch = byName('@cursor/sdk');
    const pkgDir = install(patch);
    const esm = path.join(pkgDir, 'dist/esm/index.js');
    fs.writeFileSync(esm, 'import*as d from"node:child_process";');
    const cjs = path.join(pkgDir, 'dist/cjs/index.js');
    const cjsBefore = fs.readFileSync(cjs, 'utf8');

    expect(patcher.applyPackagePatch(tmp, patch, __dirname).state).toBe(
      'anchor-mismatch',
    );
    expect(fs.readFileSync(cjs, 'utf8')).toBe(cjsBefore);
    expect(
      fs.existsSync(path.join(pkgDir, 'dist/cjs', SHIM_NAMES[0] ?? '')),
    ).toBe(false);
  });

  it('reports a package that is not installed', () => {
    expect(
      patcher.inspectPackage(tmp, byName('chrome-launcher')).state,
    ).toBe('missing');
  });

  /** The nearest node_modules above this file (a worktree has none of its own). */
  function findNodeModules(): string | undefined {
    let dir = __dirname;
    for (;;) {
      const candidate = path.join(dir, 'node_modules');
      if (fs.existsSync(path.join(candidate, 'chrome-launcher'))) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  }

  // A dependency bump that the patch does not match fails here, not silently
  // at install time.
  it.each(['@openai/codex-sdk', '@cursor/sdk', 'chrome-launcher'])(
    'matches the installed %s',
    (name) => {
      const nodeModules = findNodeModules();
      expect(nodeModules).toBeDefined();
      const result = patcher.inspectPackage(nodeModules ?? '', byName(name));
      expect({ name, ...result, updates: undefined }).toEqual({
        name,
        state: expect.stringMatching(/^(unpatched|patched)$/),
        updates: undefined,
      });
    },
  );
});
