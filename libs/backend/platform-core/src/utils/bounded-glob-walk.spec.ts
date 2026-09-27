import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import fg from 'fast-glob';
import { countDirectoryReads } from '../testing/probes/count-directory-reads';
import { collectBounded } from './bounded-collect';
import { createFailureTally, walkGlobMatches } from './bounded-glob-walk';

/**
 * TASK_2026_559 Batch 23b reviews r2 M1, r3 B1/S1: a bounded glob walk that
 * returns what the adapters' fast-glob call returns for every pattern class,
 * holds one entry at a time, and never hides an unreadable directory.
 */
describe('walkGlobMatches', () => {
  let root: string;
  const slashed = (): string => root.replace(/\\/g, '/');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-bounded-walk-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function write(relative: string): void {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), '');
  }

  async function walk(
    pattern: string,
    exclude: string[],
    dot: boolean,
  ): Promise<{ files: string[]; failures: Record<string, number> }> {
    const tally = createFailureTally();
    const files: string[] = [];
    for await (const file of walkGlobMatches(pattern, {
      exclude,
      cwd: root,
      dot,
      onFailure: tally.onFailure,
    })) {
      files.push(file);
    }
    return { files: files.sort(), failures: { ...tally.failures()?.byCode } };
  }

  const FIXTURE = [
    'package.json',
    '.env',
    'src/a.ts',
    'src/b.ts',
    'src/APP.TS',
    'src/a.spec.ts',
    'src/deep/er/b.ts',
    'src/.hidden/c.ts',
    '.config/d.ts',
    'stats/analysis.R',
    'engine/core.C++',
    'node_modules/pkg/index.ts',
    'node_modules/pkg/package.json',
    'vendor/lib/v.ts',
    '.git/objects/x.ts',
    'README.md',
    'docs/guide.md',
    // r4 S1: Next.js-style route directories and a bracketed file name.
    'app/[id]/page.tsx',
    'app/(group)/layout.ts',
    'app/(group)/nested/x.ts',
    'lit[1].ts',
  ];

  // r3 S1: every pattern class, both `dot` settings, against fast-glob with
  // the adapters' options. `{abs}` is replaced by the fixture root.
  const PATTERNS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['package.json', []], // literal, relative
    ['{abs}/package.json', []], // literal, absolute
    ['./package.json', []], // literal with ./
    ['missing.json', []], // literal, absent
    ['src', []], // literal directory: files only
    ['.env', []], // literal dot file
    ['package.json', ['package.json']], // literal, excluded
    ['**/package.json', ['**/node_modules/**']],
    ['**/package.json', []],
    ['*.json', []], // one level only
    ['*', []],
    ['src/*.ts', []],
    ['./src/*.ts', []],
    ['src/{a,b}.ts', []], // brace (static after expansion)
    ['{src,docs}/**/*', []],
    ['src/+(a|b).ts', []], // extglob
    ['src/!(a).ts', []],
    ['src/*.TS', []], // case-sensitive match
    ['src/[aA]*.ts', []],
    ['**/*.ts', []],
    ['**/.*', []],
    ['**/.hidden/*', []],
    ['**/*.{[tT][sS],[rR],[cC][+][+]}', ['**/node_modules/**', '**/vendor/**']],
    ['src/**/*.ts', ['**/*.spec.ts']],
    ['**/*', ['**/node_modules/**', '**/.git/**']],
    ['{abs}/src/**/*.ts', []], // absolute glob
    // r4 S1: escaped metacharacters name literal directories and files.
    ['app/\\[id\\]/page.tsx', []], // escaped literal
    ['app/\\[id\\]/*.tsx', []], // escaped static base
    ['app/\\[id\\]/**/*', []],
    ['app/\\(group\\)/layout.ts', []],
    ['app/\\(group\\)/*.ts', []],
    ['app/\\(group\\)/**/*.ts', []],
    ['lit\\[1\\].ts', []], // literal file name with brackets
    ['{abs}/app/\\[id\\]/*.tsx', []], // absolute escaped base
    ['{abs}/lit\\[1\\].ts', []], // absolute escaped literal
    ['app/[id]/page.tsx', []], // unescaped: a character class, as in fast-glob
    ['app/*/page.tsx', []],
    ['**/*.tsx', []],
  ];

  describe.each([[true], [false]])('dot %s', (dot) => {
    it.each(PATTERNS)(
      'returns the same files as fast-glob for %s (exclude %j)',
      async (rawPattern, exclude) => {
        FIXTURE.forEach(write);
        const pattern = rawPattern.replace('{abs}', slashed());
        const expected = (
          await fg(pattern, {
            ignore: [...exclude],
            absolute: true,
            onlyFiles: true,
            dot,
            cwd: root,
          })
        ).sort();

        const { files, failures } = await walk(pattern, [...exclude], dot);
        expect(files).toEqual(expected);
        expect(failures).toEqual({});
      },
    );
  });

  it('prunes an excluded directory instead of opening it', async () => {
    write('src/a.ts');
    write('node_modules/pkg/deep/index.ts');
    const opened: string[] = [];
    const opendir = fs.promises.opendir.bind(fs.promises);
    jest
      .spyOn(fs.promises, 'opendir')
      .mockImplementation(async (dir, options) => {
        opened.push(path.basename(String(dir)));
        return opendir(dir, options);
      });

    const { files } = await walk('**/*.ts', ['**/node_modules/**'], true);
    expect(files).toHaveLength(1);
    expect(opened).not.toContain('node_modules');
    expect(opened).not.toContain('pkg');
  });

  it('never opens a directory below the depth a pattern without ** can match', async () => {
    write('package.json');
    write('src/deep/package.json');
    const probe = countDirectoryReads();

    expect((await walk('*.json', [], true)).files).toEqual([
      `${slashed()}/package.json`,
    ]);
    expect(probe.opened).toBe(1);
    probe.restore();
  });

  it('does not loop through a directory link back to an ancestor', async () => {
    write('src/a.ts');
    try {
      fs.symlinkSync(
        root,
        path.join(root, 'src', 'loop'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error: unknown) {
      console.warn(`[r2 M1] link spec skipped: ${String(error)}`);
      return;
    }
    expect((await walk('**/*.ts', [], true)).files).toEqual([
      `${slashed()}/src/a.ts`,
    ]);
  });

  // r3 B1 (FB): an unreadable directory was a silent empty branch.
  describe('I/O failures', () => {
    function failOpendir(match: (dir: string) => boolean, code: string): void {
      const opendir = fs.promises.opendir.bind(fs.promises);
      jest
        .spyOn(fs.promises, 'opendir')
        .mockImplementation(async (dir, options) => {
          if (match(String(dir))) {
            throw Object.assign(new Error(`${code}: opendir`), { code });
          }
          return opendir(dir, options);
        });
    }

    it.each([['EIO'], ['EACCES'], ['EPERM']])(
      'records a subtree %s and keeps walking the rest',
      async (code) => {
        write('src/a.ts');
        write('locked/b.ts');
        failOpendir((dir) => path.basename(dir) === 'locked', code);

        const { files, failures } = await walk('**/*.ts', [], true);

        expect(files).toEqual([`${slashed()}/src/a.ts`]);
        expect(failures).toEqual({ [code]: 1 });
      },
    );

    it('records a root failure: nothing found, and the failure says why', async () => {
      write('src/a.ts');
      failOpendir((dir) => path.resolve(dir) === path.resolve(root), 'EIO');

      expect(await walk('**/*.ts', [], true)).toEqual({
        files: [],
        failures: { EIO: 1 },
      });
    });

    // r4 B1 (FB): a missing root was exempt as ENOENT: an empty, complete
    // answer for a search that never happened.
    it('records a missing search root (ENOENT) instead of answering empty', async () => {
      const missing = path.join(root, 'nonexistent');
      const tally = createFailureTally();
      const files: string[] = [];
      for await (const file of walkGlobMatches('**/*.ts', {
        cwd: missing,
        dot: true,
        onFailure: tally.onFailure,
      })) {
        files.push(file);
      }
      expect(files).toEqual([]);
      expect(tally.failures()).toEqual({ total: 1, byCode: { ENOENT: 1 } });
    });

    it.each([['**/*.ts'], ['package.json']])(
      'records a search root that is a file (ENOTDIR) for %s',
      async (pattern) => {
        write('package.json');
        const tally = createFailureTally();
        for await (const file of walkGlobMatches(pattern, {
          cwd: path.join(root, 'package.json'),
          dot: true,
          onFailure: tally.onFailure,
        })) {
          throw new Error(`unexpected match ${file}`);
        }
        expect(tally.failures()).toEqual({ total: 1, byCode: { ENOTDIR: 1 } });
      },
    );

    it.each([['EACCES'], ['EPERM'], ['EIO']])(
      'records an unreadable search root (%s on stat)',
      async (code) => {
        write('src/a.ts');
        const stat = fs.promises.stat.bind(fs.promises);
        jest
          .spyOn(fs.promises, 'stat')
          .mockImplementation(async (target, options) => {
            if (path.resolve(String(target)) === path.resolve(root)) {
              throw Object.assign(new Error(code), { code });
            }
            return stat(target, options);
          });

        expect(await walk('**/*.ts', [], true)).toEqual({
          files: [],
          failures: { [code]: 1 },
        });
      },
    );

    it('treats ENOENT (a directory removed mid-walk) as no failure', async () => {
      write('src/a.ts');
      write('gone/b.ts');
      failOpendir((dir) => path.basename(dir) === 'gone', 'ENOENT');

      expect(await walk('**/*.ts', [], true)).toEqual({
        files: [`${slashed()}/src/a.ts`],
        failures: {},
      });
    });

    it('records a literal path whose stat fails with a non-ENOENT code', async () => {
      write('package.json');
      jest
        .spyOn(fs.promises, 'stat')
        .mockRejectedValue(
          Object.assign(new Error('EACCES'), { code: 'EACCES' }),
        );

      expect(await walk('package.json', [], true)).toEqual({
        files: [],
        failures: { EACCES: 1 },
      });
    });
  });

  // The reviewer's r2 case: a flat directory of 2,000 matches and a limit of
  // 5. fast-glob emitted all 2,000 before the limit was seen; the walk reads
  // entries one at a time, so only a directory buffer's worth is ever read.
  it('reads a bounded number of entries of a 2,000-file directory for a limit of 5, and closes it', async () => {
    fs.mkdirSync(path.join(root, 'flat'));
    for (let i = 0; i < 2_000; i++) {
      fs.writeFileSync(path.join(root, 'flat', `f${i}.ts`), '');
    }
    const probe = countDirectoryReads();

    const found = await collectBounded(
      walkGlobMatches('**/*.ts', {
        cwd: root,
        dot: true,
        onFailure: () => undefined,
      }),
      5,
    );

    expect(found).toHaveLength(5);
    expect(probe.entriesRead).toBeLessThanOrEqual(6);
    // The root and `flat`, both closed at the limit.
    expect(probe.opened).toBe(2);
    expect(probe.closed).toBe(2);
    probe.restore();
  });
});
