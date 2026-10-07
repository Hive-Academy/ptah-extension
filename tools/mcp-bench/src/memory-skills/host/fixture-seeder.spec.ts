import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IsolatedPaths } from '../../transport/bench-host-boot';
import { FixtureSeedError, seedFixtures } from './fixture-seeder';
import type { MemorySkillsFixture } from './plan.schema';

const sha = (text: string | Buffer): string =>
  createHash('sha256').update(text).digest('hex');

/** A directory link that needs no privilege on Windows (junction). */
function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('seedFixtures', () => {
  let root: string;
  let realHome: string;
  let realDb: string;
  let bench: string;
  let committed: string;
  let isolation: IsolatedPaths;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-seeder-'));
    realHome = join(root, 'real-home');
    mkdirSync(join(realHome, '.ptah', 'state'), { recursive: true });
    realDb = join(realHome, '.ptah', 'state', 'ptah.sqlite');
    writeFileSync(realDb, 'REAL USER DATABASE');
    bench = join(root, 'bench');
    mkdirSync(join(bench, 'snapshots'), { recursive: true });
    committed = join(root, 'repo-fixtures');
    mkdirSync(committed, { recursive: true });
    const home = join(root, 'iso-home');
    mkdirSync(join(home, '.ptah', 'state'), { recursive: true });
    isolation = {
      home,
      userDataPath: join(home, '.ptah'),
      dbPath: join(home, '.ptah', 'state', 'ptah.sqlite'),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const seed = (
    fixtures: MemorySkillsFixture[],
    allowedRoots: string[] = [bench, committed],
  ): ReturnType<typeof seedFixtures> =>
    seedFixtures({ fixtures, isolation, realHome, allowedRoots });

  it('copies a database, a file and a directory tree with matching hashes', () => {
    const dbSource = join(bench, 'snapshots', 'seed.sqlite');
    writeFileSync(dbSource, 'SQLITE BYTES');
    writeFileSync(`${dbSource}-wal`, ''); // an empty WAL is a checkpointed DB
    const session = join(committed, 's.jsonl');
    writeFileSync(session, '{"a":1}\n');
    const candidates = join(bench, 'candidates');
    mkdirSync(join(candidates, 'b-skill'), { recursive: true });
    writeFileSync(join(candidates, 'b-skill', 'SKILL.md'), 'b');
    writeFileSync(join(candidates, 'a.md'), 'a');
    mkdirSync(join(candidates, 'empty'));

    const seeded = seed([
      { kind: 'database', source: dbSource },
      { kind: 'file', source: session, target: '.claude/projects/p/s.jsonl' },
      {
        kind: 'directory',
        source: candidates,
        target: '.ptah/skills/_candidates',
      },
    ]);

    expect(seeded[0]).toEqual({
      kind: 'database',
      source: dbSource,
      target: isolation.dbPath,
      files: 1,
      bytes: 12,
      sha256: sha('SQLITE BYTES'),
    });
    expect(readFileSync(isolation.dbPath, 'utf8')).toBe('SQLITE BYTES');
    expect(seeded[1]?.target).toBe(
      join(isolation.home, '.claude', 'projects', 'p', 's.jsonl'),
    );
    expect(seeded[1]?.sha256).toBe(sha('{"a":1}\n'));

    const tree = join(isolation.home, '.ptah', 'skills', '_candidates');
    expect(readFileSync(join(tree, 'b-skill', 'SKILL.md'), 'utf8')).toBe('b');
    expect(existsSync(join(tree, 'empty'))).toBe(true);
    expect(seeded[2]).toMatchObject({ kind: 'directory', files: 2, bytes: 2 });
    expect(seeded[2]?.sha256).toBe(
      sha(`a.md\0${sha('a')}\nb-skill/SKILL.md\0${sha('b')}\n`),
    );
    // Sources are untouched.
    expect(readFileSync(dbSource, 'utf8')).toBe('SQLITE BYTES');
  });

  it('refuses a source in the real ~/.ptah even when its root is allowed', () => {
    const call = (): unknown =>
      seed([{ kind: 'database', source: realDb }], [realHome, bench]);
    expect(call).toThrow(FixtureSeedError);
    expect(call).toThrow(/lies in the real/);
    expect(existsSync(isolation.dbPath)).toBe(false);
  });

  it('refuses a source outside the allowed roots and a missing source', () => {
    const outside = join(root, 'elsewhere.jsonl');
    writeFileSync(outside, 'x');
    expect(() =>
      seed([{ kind: 'file', source: outside, target: 'x' }]),
    ).toThrow(/outside/);
    expect(() =>
      seed([{ kind: 'file', source: join(bench, 'nope'), target: 'x' }]),
    ).toThrow(/is missing/);
  });

  it('refuses a source whose real path is in ~/.ptah through a linked ancestor', () => {
    linkDir(join(realHome, '.ptah'), join(bench, 'linked'));
    const call = (): unknown =>
      seed([
        {
          kind: 'database',
          source: join(bench, 'linked', 'state', 'ptah.sqlite'),
        },
      ]);
    expect(call).toThrow(/lies in the real/);
    expect(existsSync(isolation.dbPath)).toBe(false);
  });

  it('refuses a linked source and a link inside a copied tree', () => {
    linkDir(join(root, 'repo-fixtures'), join(bench, 'link-source'));
    expect(() =>
      seed([
        {
          kind: 'directory',
          source: join(bench, 'link-source'),
          target: 'd',
        },
      ]),
    ).toThrow(/is a symbolic link/);

    const tree = join(bench, 'tree');
    mkdirSync(tree);
    writeFileSync(join(tree, 'ok.md'), 'ok');
    linkDir(join(realHome, '.ptah'), join(tree, 'zz-escape'));
    expect(() =>
      seed([{ kind: 'directory', source: tree, target: 't' }]),
    ).toThrow(/contains a symbolic link/);
  });

  it('refuses a kind that does not match the source', () => {
    const file = join(bench, 'f.txt');
    writeFileSync(file, 'f');
    expect(() =>
      seed([{ kind: 'directory', source: file, target: 'd' }]),
    ).toThrow(/is not a directory/);
    expect(() =>
      seed([{ kind: 'file', source: bench + '/snapshots', target: 'f' }]),
    ).toThrow(/is not a file/);
  });

  it('refuses a database with a non-empty -wal or a -journal sidecar', () => {
    const db = join(bench, 'snapshots', 'live.sqlite');
    writeFileSync(db, 'x');
    writeFileSync(`${db}-wal`, 'uncheckpointed pages');
    expect(() => seed([{ kind: 'database', source: db }])).toThrow(
      /non-empty -wal/,
    );
    rmSync(`${db}-wal`);
    writeFileSync(`${db}-journal`, '');
    expect(() => seed([{ kind: 'database', source: db }])).toThrow(
      /-journal sidecar/,
    );
  });

  it('never overwrites an existing target', () => {
    const db = join(bench, 'snapshots', 'seed.sqlite');
    writeFileSync(db, 'x');
    writeFileSync(isolation.dbPath, 'engine already created it');
    expect(() => seed([{ kind: 'database', source: db }])).toThrow(
      /already exists/,
    );
    expect(readFileSync(isolation.dbPath, 'utf8')).toBe(
      'engine already created it',
    );
  });

  it('refuses a target that escapes the isolated home', () => {
    const file = join(bench, 'f.txt');
    writeFileSync(file, 'f');
    expect(() =>
      seed([{ kind: 'file', source: file, target: '../outside.txt' }]),
    ).toThrow(/outside the isolated home/);
  });

  it('refuses when the real home and the isolated home overlap', () => {
    expect(() =>
      seedFixtures({
        fixtures: [],
        isolation,
        realHome: isolation.home,
        allowedRoots: [bench],
      }),
    ).toThrow(/overlap/);
    expect(() =>
      seedFixtures({
        fixtures: [],
        isolation,
        realHome,
        allowedRoots: [],
      }),
    ).toThrow(/no allowed source root/);
  });

  it('refuses an isolated home that is the real ~/.ptah or holds it (review finding 1)', () => {
    const asHome = (home: string): IsolatedPaths => ({
      home,
      userDataPath: join(home, '.ptah'),
      dbPath: join(home, '.ptah', 'state', 'ptah.sqlite'),
    });
    for (const home of [
      join(realHome, '.ptah'),
      join(realHome, '.ptah', 'state'),
      root,
    ]) {
      expect(() =>
        seedFixtures({
          fixtures: [],
          isolation: asHome(home),
          realHome,
          allowedRoots: [bench],
        }),
      ).toThrow(/overlap/);
    }
    // A junction to the real ~/.ptah as the isolated home: caught on the real path.
    const linkedHome = join(root, 'linked-home');
    linkDir(join(realHome, '.ptah'), linkedHome);
    expect(() =>
      seedFixtures({
        fixtures: [],
        isolation: asHome(linkedHome),
        realHome,
        allowedRoots: [bench],
      }),
    ).toThrow(/overlap/);
  });

  it('compares the isolated home with ~/.ptah case-insensitively on win32', () => {
    expect(() =>
      seedFixtures({
        fixtures: [],
        isolation: {
          home: 'C:\\Users\\Dev\\.PTAH',
          userDataPath: 'C:\\Users\\Dev\\.PTAH\\.ptah',
          dbPath: 'C:\\Users\\Dev\\.PTAH\\.ptah\\state\\ptah.sqlite',
        },
        realHome: 'c:\\users\\dev',
        allowedRoots: ['D:\\bench'],
        platform: 'win32',
        realpath: (path) => path,
      }),
    ).toThrow(/overlap/);
  });

  it('accepts a source reached through a linked allowed root (review finding 5b)', () => {
    const file = join(bench, 'f.txt');
    writeFileSync(file, 'via link');
    const linkedBench = join(root, 'linked-bench');
    linkDir(bench, linkedBench);
    const [seeded] = seed(
      [{ kind: 'file', source: join(linkedBench, 'f.txt'), target: 'f.txt' }],
      [linkedBench],
    );
    expect(readFileSync(seeded.target, 'utf8')).toBe('via link');
  });

  it('refuses a source in the target of a linked ~/.ptah (review finding 5a)', () => {
    const ptahTarget = join(root, 'ptah-target');
    mkdirSync(ptahTarget);
    writeFileSync(join(ptahTarget, 'memories.json'), 'REAL');
    const linkedRealHome = join(root, 'linked-real-home');
    mkdirSync(linkedRealHome);
    linkDir(ptahTarget, join(linkedRealHome, '.ptah'));
    const allowedLink = join(root, 'allowed-link');
    linkDir(ptahTarget, allowedLink);
    expect(() =>
      seedFixtures({
        fixtures: [
          {
            kind: 'file',
            source: join(allowedLink, 'memories.json'),
            target: 'm.json',
          },
        ],
        isolation,
        realHome: linkedRealHome,
        allowedRoots: [allowedLink],
      }),
    ).toThrow(/lies in the real/);
  });

  it('seeds nothing for an empty fixture list', () => {
    expect(seed([])).toEqual([]);
  });
});
