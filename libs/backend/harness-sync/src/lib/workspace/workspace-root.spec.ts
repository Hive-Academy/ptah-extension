/**
 * Workspace root resolution (E14) — every target writes at the workspace ROOT,
 * never at the caller's cwd, and the ascent must never cross into the real home
 * directory (the regression guard: `~/.ptah` must never be mistaken for a
 * workspace).
 *
 * Source-under-test: `resolveHarnessWorkspaceRoot`.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { resolveHarnessWorkspaceRoot } from './workspace-root';

describe('resolveHarnessWorkspaceRoot (E14)', () => {
  // Bounds the ascent at the OS temp directory for every test that does not
  // care about the home boundary itself. Using an unrelated sibling temp dir
  // here would NOT bound anything — the ascent path from a temp workspace
  // never passes through it — and the walk would then escape into the real
  // user home tree, which may have its own `.git`/`.ptah` markers.
  const unrelatedHome = resolve(tmpdir());
  const cleanups: string[] = [];

  afterEach(() => {
    for (const dir of cleanups.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    cleanups.push(dir);
    return dir;
  }

  it('[E14] returns the dir itself when it contains .ptah', () => {
    const ws = tempDir('harness-sync-root-');
    mkdirSync(join(ws, '.ptah'));

    expect(resolveHarnessWorkspaceRoot(ws, { homeDir: unrelatedHome })).toBe(
      resolve(ws),
    );
  });

  it('[E14] walks up from a nested sub-folder to the nearest .ptah ancestor', () => {
    const ws = tempDir('harness-sync-root-');
    mkdirSync(join(ws, '.ptah'));
    const nested = join(ws, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    expect(
      resolveHarnessWorkspaceRoot(nested, { homeDir: unrelatedHome }),
    ).toBe(resolve(ws));
  });

  it('[E14] .git works as a marker when .ptah is absent', () => {
    const ws = tempDir('harness-sync-root-');
    mkdirSync(join(ws, '.git'));
    const nested = join(ws, 'x');
    mkdirSync(nested);

    expect(
      resolveHarnessWorkspaceRoot(nested, { homeDir: unrelatedHome }),
    ).toBe(resolve(ws));
  });

  it('[E14] the nearest .ptah anywhere in the ancestor chain beats a nearer .git — markers are tried in priority order across the WHOLE chain, not nearest-wins', () => {
    const root = tempDir('harness-sync-root-');
    mkdirSync(join(root, '.ptah'));
    const sub = join(root, 'sub');
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(sub, '.git'));
    const nested = join(sub, 'nested');
    mkdirSync(nested, { recursive: true });

    // `.git` at `sub` is closer to `nested` than `.ptah` at `root`, but the
    // resolver exhausts the `.ptah` search across every ancestor before it
    // ever tries `.git`, so the farther `.ptah` wins.
    expect(
      resolveHarnessWorkspaceRoot(nested, { homeDir: unrelatedHome }),
    ).toBe(resolve(root));
  });

  it('[E14 regression] stops at the home boundary — a workspace nested under home with no marker of its own resolves to ITSELF, never to home', () => {
    const homeRoot = tempDir('harness-sync-home-marker-');
    // The marker Ptah itself would leave in the REAL home directory.
    mkdirSync(join(homeRoot, '.ptah'));
    const ws = join(homeRoot, 'scratch', 'workspace');
    mkdirSync(ws, { recursive: true });

    expect(resolveHarnessWorkspaceRoot(ws, { homeDir: homeRoot })).toBe(
      resolve(ws),
    );
  });

  it('empty string in -> empty string out', () => {
    expect(resolveHarnessWorkspaceRoot('', { homeDir: unrelatedHome })).toBe(
      '',
    );
  });
});

/**
 * The home boundary is case-INSENSITIVE on Windows, and this is the case that
 * used to slip through it.
 *
 * `os.homedir()` answers `C:\Users\Abdallah`, while a cwd inherited from a
 * spawned rival CLI, a terminal or a `cd` routinely arrives lower-cased. A
 * byte-exact `===` calls those two different directories, the ascent walks
 * straight past home, finds the `.ptah` marker Ptah put in the home directory
 * itself, and the reconciler copies the user layer into `~/.claude/skills` —
 * the precise accident the boundary exists to prevent.
 *
 * `process.platform` is stubbed rather than skipping on POSIX: the rule must be
 * pinned on every CI runner, not only on Windows agents.
 */
describe('resolveHarnessWorkspaceRoot — home boundary is case-insensitive on win32', () => {
  const originalPlatform = process.platform;
  const cleanups: string[] = [];

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      value,
      configurable: true,
    });
  }

  afterEach(() => {
    setPlatform(originalPlatform);
    for (const dir of cleanups.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('[E14] a differently-cased cwd under home still stops at the boundary on win32', () => {
    setPlatform('win32');
    const homeRoot = mkdtempSync(join(tmpdir(), 'HarnessSyncHomeCase-'));
    cleanups.push(homeRoot);
    // The marker Ptah leaves in the REAL home directory — the one that makes
    // home look like a workspace if the walk ever reaches it.
    mkdirSync(join(homeRoot, '.ptah'));
    const ws = join(homeRoot, 'Scratch', 'Workspace');
    mkdirSync(ws, { recursive: true });

    // The caller's spelling differs from `homedir()`'s only by case, which is
    // the same directory on NTFS.
    const resolved = resolveHarnessWorkspaceRoot(ws.toLowerCase(), {
      homeDir: homeRoot,
    });

    expect(resolved).toBe(resolve(ws.toLowerCase()));
    expect(resolved.toLowerCase()).not.toBe(resolve(homeRoot).toLowerCase());
  });

  it('[E14] the same mixed-case cwd IS mistaken for a workspace-less path on a case-sensitive platform, which is correct there', () => {
    setPlatform('linux');
    const homeRoot = mkdtempSync(join(tmpdir(), 'HarnessSyncHomeCase-'));
    cleanups.push(homeRoot);
    mkdirSync(join(homeRoot, '.ptah'));
    const ws = join(homeRoot, 'Scratch');
    mkdirSync(ws, { recursive: true });

    // Exact spelling: the boundary holds on every platform when the two paths
    // agree byte for byte. This is the control for the win32 case above.
    expect(resolveHarnessWorkspaceRoot(ws, { homeDir: homeRoot })).toBe(
      resolve(ws),
    );
  });
});
