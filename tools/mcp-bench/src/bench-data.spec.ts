import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';

import {
  BENCH_DATA_DIR_ENV,
  BenchDataDirError,
  findRepositoryRoot,
  isPathInside,
  isSamePath,
  resolveBenchDataDir,
} from './bench-data';

/** Junctions need no privilege on win32; POSIX dir symlinks never do. */
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
const LINK_NOTE = '(skipped only where the OS refuses to create the link)';

/** Whether this OS lets the spec create a {@link LINK_TYPE} link. */
function canCreateLinks(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'ptah-bench-link-probe-'));
  try {
    mkdirSync(join(probe, 'target'));
    symlinkSync(join(probe, 'target'), join(probe, 'link'), LINK_TYPE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

const itWithLinks = canCreateLinks() ? it : it.skip;

describe('resolveBenchDataDir', () => {
  const posixBase = {
    platform: 'linux' as const,
    realHome: '/home/dev',
    repoRoot: '/work/ptah-extension',
  };
  const winBase = {
    platform: 'win32' as const,
    realHome: 'C:\\Users\\Dev',
    repoRoot: 'D:\\projects\\ptah-extension',
  };

  it('uses an absolute PTAH_MCP_BENCH_DATA_DIR override', () => {
    const dir = resolveBenchDataDir({
      ...posixBase,
      env: { [BENCH_DATA_DIR_ENV]: '/data/bench/../bench-data' },
    });
    expect(dir).toBe('/data/bench-data');
  });

  it('defaults to ~/.cache/ptah-mcp-bench outside win32', () => {
    expect(resolveBenchDataDir({ ...posixBase, env: {} })).toBe(
      posix.join('/home/dev', '.cache', 'ptah-mcp-bench'),
    );
  });

  it('defaults to %LOCALAPPDATA%\\ptah-mcp-bench on win32', () => {
    expect(
      resolveBenchDataDir({
        ...winBase,
        env: { LOCALAPPDATA: 'C:\\Users\\Dev\\AppData\\Local' },
      }),
    ).toBe(win32.join('C:\\Users\\Dev\\AppData\\Local', 'ptah-mcp-bench'));
  });

  it('falls back to <home>\\AppData\\Local on win32 when LOCALAPPDATA is unset', () => {
    expect(resolveBenchDataDir({ ...winBase, env: {} })).toBe(
      'C:\\Users\\Dev\\AppData\\Local\\ptah-mcp-bench',
    );
  });

  it('rejects a relative override, naming the path and the rule', () => {
    const call = (): string =>
      resolveBenchDataDir({
        ...posixBase,
        env: { [BENCH_DATA_DIR_ENV]: 'bench-data' },
      });
    expect(call).toThrow(BenchDataDirError);
    expect(call).toThrow(/must be an absolute path, got bench-data/);
  });

  it.each(['/home/dev/.ptah', '/home/dev/.ptah/bench'])(
    'rejects %s (the real ~/.ptah or under it)',
    (override) => {
      expect(() =>
        resolveBenchDataDir({
          ...posixBase,
          env: { [BENCH_DATA_DIR_ENV]: override },
        }),
      ).toThrow(
        new RegExp(`${override}.*real Ptah state directory /home/dev/.ptah`),
      );
    },
  );

  it.each([
    '/work/ptah-extension',
    '/work/ptah-extension/.claude-worktrees/task/bench',
  ])('rejects %s (the repository root or inside it)', (override) => {
    expect(() =>
      resolveBenchDataDir({
        ...posixBase,
        env: { [BENCH_DATA_DIR_ENV]: override },
      }),
    ).toThrow(/repository root \/work\/ptah-extension or lies inside it/);
  });

  it('accepts a sibling whose name only starts like the repository', () => {
    expect(
      resolveBenchDataDir({
        ...posixBase,
        env: { [BENCH_DATA_DIR_ENV]: '/work/ptah-extension-bench' },
      }),
    ).toBe('/work/ptah-extension-bench');
  });

  it('folds case on win32 for both rules', () => {
    expect(() =>
      resolveBenchDataDir({
        ...winBase,
        env: { [BENCH_DATA_DIR_ENV]: 'c:\\users\\DEV\\.PTAH\\bench' },
      }),
    ).toThrow(/real Ptah state directory/);
    expect(() =>
      resolveBenchDataDir({
        ...winBase,
        env: { [BENCH_DATA_DIR_ENV]: 'd:\\PROJECTS\\Ptah-Extension\\tmp' },
      }),
    ).toThrow(/repository root/);
  });

  it('does not fold case outside win32', () => {
    expect(
      resolveBenchDataDir({
        ...posixBase,
        env: { [BENCH_DATA_DIR_ENV]: '/home/dev/.PTAH/bench' },
      }),
    ).toBe('/home/dev/.PTAH/bench');
  });

  describe('with the file system', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'ptah-bench-data-spec-'));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('creates the folder only when asked', () => {
      const target = join(root, 'data', 'nested');
      const options = {
        env: { [BENCH_DATA_DIR_ENV]: target },
        realHome: join(root, 'home'),
        repoRoot: join(root, 'repo'),
      };
      expect(resolveBenchDataDir(options)).toBe(target);
      expect(existsSync(target)).toBe(false);
      expect(resolveBenchDataDir({ ...options, create: true })).toBe(target);
      expect(existsSync(target)).toBe(true);
    });

    describe('links (junction on win32, dir symlink elsewhere)', () => {
      let realHome: string;
      let repoRoot: string;
      let outside: string;

      beforeEach(async () => {
        realHome = join(root, 'real-home');
        repoRoot = join(root, 'repo');
        outside = join(root, 'outside');
        await mkdir(join(realHome, '.ptah', 'state'), { recursive: true });
        await mkdir(join(repoRoot, 'tmp'), { recursive: true });
        await mkdir(outside, { recursive: true });
      });

      const resolveWith = (dir: string): string =>
        resolveBenchDataDir({
          env: { [BENCH_DATA_DIR_ENV]: dir },
          realHome,
          repoRoot,
        });

      itWithLinks(
        `rejects a link into the real ~/.ptah, naming its real path ${LINK_NOTE}`,
        () => {
          const link = join(outside, 'data-link');
          symlinkSync(join(realHome, '.ptah', 'state'), link, LINK_TYPE);
          expect(() => resolveWith(link)).toThrow(BenchDataDirError);
          expect(() => resolveWith(link)).toThrow(
            /\(real path .*state\) is the real Ptah state directory .*\(real path .*\.ptah\) or lies under it/,
          );
        },
      );

      itWithLinks(
        `rejects a link into the repository root ${LINK_NOTE}`,
        () => {
          const link = join(outside, 'repo-link');
          symlinkSync(join(repoRoot, 'tmp'), link, LINK_TYPE);
          expect(() => resolveWith(link)).toThrow(
            /is the repository root .* or lies inside it/,
          );
        },
      );

      itWithLinks(
        `rejects a not-yet-existing child of such a link, returning nothing ${LINK_NOTE}`,
        () => {
          const link = join(outside, 'data-link');
          symlinkSync(join(realHome, '.ptah'), link, LINK_TYPE);
          const child = join(link, 'not', 'created', 'yet');
          expect(() => resolveWith(child)).toThrow(/real Ptah state directory/);
          expect(existsSync(join(realHome, '.ptah', 'not'))).toBe(false);
        },
      );

      itWithLinks(
        `rejects a real ~/.ptah that is itself a link, reached by its target ${LINK_NOTE}`,
        async () => {
          const target = join(root, 'ptah-target');
          await mkdir(target, { recursive: true });
          const linkedHome = join(root, 'linked-home');
          await mkdir(linkedHome, { recursive: true });
          symlinkSync(target, join(linkedHome, '.ptah'), LINK_TYPE);
          expect(() =>
            resolveBenchDataDir({
              env: { [BENCH_DATA_DIR_ENV]: join(target, 'bench') },
              realHome: linkedHome,
              repoRoot,
            }),
          ).toThrow(/real Ptah state directory/);
        },
      );

      it('accepts a plain directory outside both, returning the lexical path', () => {
        const dir = join(outside, 'bench-data');
        expect(resolveWith(dir)).toBe(dir);
      });

      it('fails closed when the real path cannot be read (not ENOENT)', () => {
        const denied = Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        });
        expect(() =>
          resolveBenchDataDir({
            env: { [BENCH_DATA_DIR_ENV]: join(outside, 'bench-data') },
            realHome,
            repoRoot,
            realpath: () => {
              throw denied;
            },
          }),
        ).toThrow(
          /cannot resolve the real path of .*EACCES.*refusing the bench data folder/,
        );
      });

      it('resolves a missing candidate through its nearest existing ancestor', () => {
        const seen: string[] = [];
        const mapped = join(realHome, '.ptah');
        expect(() =>
          resolveBenchDataDir({
            env: { [BENCH_DATA_DIR_ENV]: join(outside, 'alias', 'bench') },
            realHome,
            repoRoot,
            realpath: (path) => {
              seen.push(path);
              if (path === join(outside, 'alias')) return mapped;
              if (path.startsWith(join(outside, 'alias'))) {
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
              }
              return path;
            },
          }),
        ).toThrow(/real path .*\.ptah.bench\)/);
        expect(seen.slice(0, 2)).toEqual([
          join(outside, 'alias', 'bench'),
          join(outside, 'alias'),
        ]);
      });
    });

    it('finds the outermost nx.json, so a worktree under the main checkout is covered', async () => {
      const main = join(root, 'main');
      const worktree = join(main, '.claude-worktrees', 'task');
      await mkdir(join(worktree, 'tools'), { recursive: true });
      await writeFile(join(main, 'nx.json'), '{}');
      await writeFile(join(worktree, 'nx.json'), '{}');
      expect(findRepositoryRoot(join(worktree, 'tools'))).toBe(main);
    });
  });
});

describe('path comparison rule', () => {
  it('isPathInside is strict and resolves both sides', () => {
    expect(isPathInside('/a/b/c', '/a/b', 'linux')).toBe(true);
    expect(isPathInside('/a/b', '/a/b', 'linux')).toBe(false);
    expect(isPathInside('/a/b/../c', '/a/b', 'linux')).toBe(false);
  });

  it('isSamePath folds case only on win32', () => {
    expect(isSamePath('C:\\Home', 'c:\\home', 'win32')).toBe(true);
    expect(isSamePath('/Home', '/home', 'linux')).toBe(false);
  });
});
