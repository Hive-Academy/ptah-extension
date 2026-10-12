import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createReadPathGuard,
  listCommittedFiles,
  ReadPathRefusedError,
  type GitRunner,
} from './read-path-guard';

describe('read-path guard (runner parent, R10)', () => {
  let root: string;
  let repo: string;
  let bench: string;
  let home: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-readguard-'));
    repo = join(root, 'repo');
    bench = join(root, 'bench');
    home = join(root, 'home');
    for (const dir of [
      join(repo, 'tools', 'fixtures'),
      bench,
      join(home, '.ptah', 'state'),
      join(root, 'elsewhere'),
    ]) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      join(repo, 'tools', 'fixtures', 'facts.jsonl'),
      'committed\n',
    );
    writeFileSync(
      join(repo, 'tools', 'fixtures', 'draft.jsonl'),
      'untracked\n',
    );
    writeFileSync(join(bench, 'labels.csv'), 'private\n');
    writeFileSync(join(home, '.ptah', 'state', 'ptah.sqlite'), 'real\n');
    writeFileSync(join(root, 'elsewhere', 'x.txt'), 'x\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Per-path `git status` output at read time; '' means clean. */
  let liveStatus: Record<string, string>;
  let statusCalls: string[][];
  beforeEach(() => {
    liveStatus = {};
    statusCalls = [];
  });

  const git: GitRunner = (args) => {
    statusCalls.push([...args]);
    const pathspec = args[args.length - 1];
    return liveStatus[pathspec.replace(':(literal)', '')] ?? '';
  };

  const guardFor = (committed: string[] = ['tools/fixtures/facts.jsonl']) =>
    createReadPathGuard({
      repoRoot: repo,
      benchDataDir: bench,
      realHome: home,
      committedFiles: new Set(committed),
      git,
    });

  it('reads a committed repository file and a bench data file', () => {
    const guard = guardFor();
    expect(guard.readText(join(repo, 'tools', 'fixtures', 'facts.jsonl'))).toBe(
      'committed\n',
    );
    // The repository read re-checked that one path, as a literal pathspec.
    expect(statusCalls).toEqual([
      [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        ':(literal)tools/fixtures/facts.jsonl',
      ],
    ]);
    expect(guard.readBytes(join(bench, 'labels.csv')).toString('utf8')).toBe(
      'private\n',
    );
    // A bench path that does not exist yet is allowed (the read itself fails).
    expect(guard.assertReadable(join(bench, 'runs', 'new.json'))).toBe(
      join(bench, 'runs', 'new.json'),
    );
  });

  it('refuses a repository file that is untracked or changed since HEAD', () => {
    expect(() =>
      guardFor().readText(join(repo, 'tools', 'fixtures', 'draft.jsonl')),
    ).toThrow(/not a committed repository file/);
  });

  it('refuses a committed file edited after the guard was built (mid-run edit)', () => {
    const guard = guardFor();
    const facts = join(repo, 'tools', 'fixtures', 'facts.jsonl');
    writeFileSync(facts, 'edited mid-run\n');
    liveStatus['tools/fixtures/facts.jsonl'] =
      ' M tools/fixtures/facts.jsonl\0';
    expect(() => guard.readText(facts)).toThrow(
      /changed in the working tree since the run started/,
    );
    expect(() => guard.readBytes(facts)).toThrow(ReadPathRefusedError);
  });

  it('refuses the real ~/.ptah, even when it would otherwise be allowed', () => {
    const guard = guardFor();
    expect(() =>
      guard.readText(join(home, '.ptah', 'state', 'ptah.sqlite')),
    ).toThrow(ReadPathRefusedError);
    expect(() => guard.assertReadable(join(home, '.ptah'))).toThrow(
      /real Ptah state directory/,
    );
  });

  it('refuses a junction in the bench folder that leads into the real ~/.ptah', () => {
    const link = join(bench, 'state-link');
    symlinkSync(join(home, '.ptah', 'state'), link, 'junction');
    expect(() => guardFor().readText(join(link, 'ptah.sqlite'))).toThrow(
      /real Ptah state directory/,
    );
  });

  it('refuses a junction in the bench folder that leads out of it', () => {
    const link = join(bench, 'out-link');
    symlinkSync(join(root, 'elsewhere'), link, 'junction');
    expect(() => guardFor().readText(join(link, 'x.txt'))).toThrow(
      /leaves the bench data folder/,
    );
  });

  it('refuses a relative path and a path outside both roots', () => {
    const guard = guardFor();
    expect(() => guard.assertReadable('tools/fixtures/facts.jsonl')).toThrow(
      /not an absolute path/,
    );
    expect(() => guard.readText(join(root, 'elsewhere', 'x.txt'))).toThrow(
      /outside the committed repository files and the bench data folder/,
    );
  });

  it('folds case on win32 for the committed-file match', () => {
    const guard = createReadPathGuard({
      repoRoot: 'C:\\Repo',
      benchDataDir: 'D:\\Bench',
      realHome: 'C:\\Users\\dev',
      committedFiles: new Set(['tools/Fixtures/facts.jsonl']),
      platform: 'win32',
      realpath: (path) => path,
      git,
    });
    expect(guard.assertReadable('c:\\repo\\TOOLS\\fixtures\\facts.jsonl')).toBe(
      'c:\\repo\\TOOLS\\fixtures\\facts.jsonl',
    );
    expect(() =>
      guard.assertReadable('C:\\USERS\\DEV\\.PTAH\\state\\ptah.sqlite'),
    ).toThrow(/real Ptah state directory/);
  });
});

describe('listCommittedFiles', () => {
  it('keeps HEAD files without working-tree changes; a rename drops both names', () => {
    const git: GitRunner = (args) => {
      if (args[0] === 'ls-tree') {
        return [
          'a.json',
          'b.json',
          'c.json',
          'old.json',
          'dir/d.json',
          '',
        ].join('\0');
      }
      if (args[0] === 'status') {
        return [
          ' M b.json',
          'R  new.json',
          'old.json',
          'M  dir/d.json',
          '',
        ].join('\0');
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    expect([...listCommittedFiles(git)].sort()).toEqual(['a.json', 'c.json']);
  });
});
