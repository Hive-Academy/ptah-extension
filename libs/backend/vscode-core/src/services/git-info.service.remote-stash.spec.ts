/**
 * GitInfoService push / pull / fetch and stash apply / pop / drop / show —
 * against REAL git in throwaway repositories under the OS temp directory.
 *
 * Remotes are local bare repositories, so nothing touches the network. Like
 * `git-info.service.apply-hunks.spec.ts`, this file does not mock
 * `cross-spawn`: the behaviour under test is git's own (upstream tracking,
 * fast-forward refusal, stash conflict handling).
 */

import 'reflect-metadata';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GitInfoService, parseStashNameStatus } from './git-info.service';
import type { Logger } from '../logging';

const GIT_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: GIT_ENV,
  });
}

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function configure(repo: string): void {
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Ptah Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.autocrlf', 'false');
}

function makeRepo(): string {
  const dir = tempDir('ptah-sync-');
  git(dir, 'init', '-q', '-b', 'main', '.');
  configure(dir);
  write(dir, 'a.txt', 'one\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

function makeBare(): string {
  const dir = tempDir('ptah-bare-');
  git(dir, 'init', '-q', '--bare', '-b', 'main', '.');
  return dir;
}

function write(repo: string, rel: string, contents: string): void {
  fs.writeFileSync(path.join(repo, rel), contents);
}

function read(repo: string, rel: string): string {
  return fs.readFileSync(path.join(repo, rel), 'utf8');
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

afterAll(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

jest.setTimeout(60_000);

describe('GitInfoService.push', () => {
  it('sets the upstream on origin when the branch has none', async () => {
    const repo = makeRepo();
    const bare = makeBare();
    git(repo, 'remote', 'add', 'origin', bare);
    const service = new GitInfoService(makeLogger());

    await expect(service.push(repo)).resolves.toEqual({ success: true });

    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe(
      'origin/main',
    );
    expect(git(bare, 'rev-parse', 'main').trim()).toBe(
      git(repo, 'rev-parse', 'HEAD').trim(),
    );
  });

  it('uses the only remote when it is not named origin', async () => {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'upstream', makeBare());
    const service = new GitInfoService(makeLogger());

    await expect(service.push(repo)).resolves.toEqual({ success: true });
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe(
      'upstream/main',
    );
  });

  it('pushes to the existing upstream on a later push', async () => {
    const repo = makeRepo();
    const bare = makeBare();
    git(repo, 'remote', 'add', 'origin', bare);
    const service = new GitInfoService(makeLogger());
    await service.push(repo);

    write(repo, 'a.txt', 'two\n');
    git(repo, 'commit', '-q', '-am', 'second');
    await expect(service.push(repo)).resolves.toEqual({ success: true });
    expect(git(bare, 'rev-parse', 'main').trim()).toBe(
      git(repo, 'rev-parse', 'HEAD').trim(),
    );
  });

  it('fails without a remote and without spawning a push', async () => {
    const repo = makeRepo();
    const service = new GitInfoService(makeLogger());

    await expect(service.push(repo)).resolves.toEqual({
      success: false,
      error: 'No remote is configured for this repository.',
    });
  });

  it('refuses a detached HEAD without an upstream', async () => {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'origin', makeBare());
    git(repo, 'checkout', '-q', '--detach');
    const service = new GitInfoService(makeLogger());

    const result = await service.push(repo);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/detached HEAD/);
  });

  it('refuses to pick between several remotes when none is origin', async () => {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'one', makeBare());
    git(repo, 'remote', 'add', 'two', makeBare());
    const service = new GitInfoService(makeLogger());

    const result = await service.push(repo);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no "origin" remote/);
  });
});

describe('GitInfoService.pull / fetch', () => {
  function cloneOf(bare: string): string {
    const dir = tempDir('ptah-clone-');
    // autocrlf pinned BEFORE checkout, or a global `true` leaves the fresh
    // working tree looking modified.
    git(dir, 'clone', '-q', '-c', 'core.autocrlf=false', bare, '.');
    configure(dir);
    return dir;
  }

  it('fast-forwards from the upstream', async () => {
    const origin = makeRepo();
    const bare = makeBare();
    git(origin, 'remote', 'add', 'origin', bare);
    git(origin, 'push', '-q', '-u', 'origin', 'main');
    const clone = cloneOf(bare);

    write(origin, 'a.txt', 'upstream change\n');
    git(origin, 'commit', '-q', '-am', 'upstream');
    git(origin, 'push', '-q');

    const service = new GitInfoService(makeLogger());
    await expect(service.pull(clone)).resolves.toEqual({ success: true });
    expect(read(clone, 'a.txt')).toBe('upstream change\n');
  });

  it('refuses to create a merge when the branch diverged', async () => {
    const origin = makeRepo();
    const bare = makeBare();
    git(origin, 'remote', 'add', 'origin', bare);
    git(origin, 'push', '-q', '-u', 'origin', 'main');
    const clone = cloneOf(bare);

    write(origin, 'a.txt', 'upstream\n');
    git(origin, 'commit', '-q', '-am', 'upstream');
    git(origin, 'push', '-q');
    write(clone, 'b.txt', 'local\n');
    git(clone, 'add', 'b.txt');
    git(clone, 'commit', '-q', '-m', 'local');
    const localHead = git(clone, 'rev-parse', 'HEAD').trim();

    const service = new GitInfoService(makeLogger());
    const result = await service.pull(clone);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(git(clone, 'rev-parse', 'HEAD').trim()).toBe(localHead);
  });

  it('fetches and prunes a remote branch deleted upstream', async () => {
    const origin = makeRepo();
    const bare = makeBare();
    git(origin, 'remote', 'add', 'origin', bare);
    git(origin, 'push', '-q', '-u', 'origin', 'main');
    git(origin, 'push', '-q', 'origin', 'main:feature');
    const clone = cloneOf(bare);
    expect(git(clone, 'branch', '-r')).toContain('origin/feature');

    git(origin, 'push', '-q', 'origin', '--delete', 'feature');
    write(origin, 'a.txt', 'fresh\n');
    git(origin, 'commit', '-q', '-am', 'fresh');
    git(origin, 'push', '-q');

    const service = new GitInfoService(makeLogger());
    await expect(service.fetch(clone)).resolves.toEqual({ success: true });
    expect(git(clone, 'branch', '-r')).not.toContain('origin/feature');
    expect(git(clone, 'rev-parse', 'origin/main').trim()).toBe(
      git(origin, 'rev-parse', 'HEAD').trim(),
    );
  });

  it('reports a fetch failure without a remote', async () => {
    const repo = makeRepo();
    git(repo, 'remote', 'add', 'origin', path.join(repo, 'does-not-exist'));
    const service = new GitInfoService(makeLogger());

    const result = await service.fetch(repo);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('GitInfoService stash operations', () => {
  /** Two stashes: stash@{0} edits a.txt + adds new.txt, stash@{1} edits a.txt. */
  function repoWithStashes(): string {
    const repo = makeRepo();
    write(repo, 'a.txt', 'older stash\n');
    git(repo, 'stash', 'push', '-q', '-m', 'older');
    write(repo, 'a.txt', 'newer stash\n');
    write(repo, 'new.txt', 'added\n');
    git(repo, 'add', 'new.txt');
    git(repo, 'stash', 'push', '-q', '-m', 'newer');
    return repo;
  }

  it('lists the files of one stash entry', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    await expect(service.stashShow(repo, 0)).resolves.toEqual({
      success: true,
      files: [
        { path: 'a.txt', status: 'M' },
        { path: 'new.txt', status: 'A' },
      ],
    });
    await expect(service.stashShow(repo, 1)).resolves.toEqual({
      success: true,
      files: [{ path: 'a.txt', status: 'M' }],
    });
  });

  it('reports a missing stash entry and a negative index', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    await expect(service.stashShow(repo, 5)).resolves.toEqual({
      success: false,
      files: [],
      error: 'Stash entry not found',
    });
    await expect(service.stashShow(repo, -1)).resolves.toEqual({
      success: false,
      files: [],
      error: 'Invalid stash index',
    });
    await expect(service.stashDrop(repo, 1.5)).resolves.toEqual({
      success: false,
      error: 'Invalid stash index',
    });
  });

  it('applies a stash and keeps the entry', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    await expect(service.stashApply(repo, 1)).resolves.toEqual({
      success: true,
    });
    expect(read(repo, 'a.txt')).toBe('older stash\n');
    expect((await service.stashList(repo)).count).toBe(2);
  });

  it('pops a stash, removing the entry and refreshing the cached list', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());
    expect((await service.stashList(repo)).count).toBe(2);

    await expect(service.stashPop(repo, 0)).resolves.toEqual({
      success: true,
    });
    expect(read(repo, 'new.txt')).toBe('added\n');
    const list = await service.stashList(repo);
    expect(list.count).toBe(1);
    expect(list.entries[0].message).toContain('older');
  });

  it('keeps the entry and fails when a pop conflicts', async () => {
    const repo = repoWithStashes();
    write(repo, 'a.txt', 'conflicting local edit\n');
    git(repo, 'commit', '-q', '-am', 'conflict');
    const service = new GitInfoService(makeLogger());

    const result = await service.stashPop(repo, 1);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect((await service.stashList(repo)).count).toBe(2);
  });

  it('drops a stash entry', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    await expect(service.stashDrop(repo, 0)).resolves.toEqual({
      success: true,
    });
    const list = await service.stashList(repo);
    expect(list.count).toBe(1);
    expect(list.entries[0].message).toContain('older');
  });

  it('serves a stash file diff through the review pair', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    const review = await service.reviewChanges(
      repo,
      'stash@{0}^1',
      'stash@{0}',
    );
    expect(review.success).toBe(true);
    expect(review.files.map((file) => file.path)).toEqual(['a.txt', 'new.txt']);

    const file = await service.reviewFile(repo, {
      baseSha: review.mergeBaseSha ?? '',
      headSha: review.head?.sha ?? '',
      path: 'a.txt',
    });
    expect(file.success).toBe(true);
    expect(file.original).toEqual({ outcome: 'content', content: 'one\n' });
    expect(file.modified).toEqual({
      outcome: 'content',
      content: 'newer stash\n',
    });
  });

  it('populates full commit hash on each stash entry', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());
    const list = await service.stashList(repo);

    expect(list.count).toBe(2);
    expect(list.entries[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(list.entries[1].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(list.entries[0].hash).not.toBe(list.entries[1].hash);
    expect(git(repo, 'rev-parse', 'stash@{0}').trim()).toBe(
      list.entries[0].hash,
    );
    expect(git(repo, 'rev-parse', 'stash@{1}').trim()).toBe(
      list.entries[1].hash,
    );
  });

  it('verifies expectedHash before running apply, pop or drop mutation', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());
    const list = await service.stashList(repo);
    const validHash0 = list.entries[0].hash;
    const wrongHash = '0123456789abcdef0123456789abcdef01234567';

    // Mismatch refuses and does not mutate
    await expect(service.stashApply(repo, 0, wrongHash)).resolves.toEqual({
      success: false,
      error: 'The stash list changed. Refresh and try again.',
    });
    await expect(service.stashPop(repo, 0, wrongHash)).resolves.toEqual({
      success: false,
      error: 'The stash list changed. Refresh and try again.',
    });
    await expect(service.stashDrop(repo, 0, wrongHash)).resolves.toEqual({
      success: false,
      error: 'The stash list changed. Refresh and try again.',
    });
    expect((await service.stashList(repo)).count).toBe(2);

    // Matching hash succeeds
    await expect(service.stashApply(repo, 0, validHash0)).resolves.toEqual({
      success: true,
    });
    await expect(service.stashDrop(repo, 0, validHash0)).resolves.toEqual({
      success: true,
    });
    expect((await service.stashList(repo)).count).toBe(1);
  });

  it('verifies expectedHash in stashShow before reading contents', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());
    const list = await service.stashList(repo);
    const validHash0 = list.entries[0].hash;
    const wrongHash = '0123456789abcdef0123456789abcdef01234567';

    await expect(service.stashShow(repo, 0, wrongHash)).resolves.toEqual({
      success: false,
      files: [],
      error: 'The stash list changed. Refresh and try again.',
    });

    await expect(service.stashShow(repo, 0, validHash0)).resolves.toEqual({
      success: true,
      files: [
        { path: 'a.txt', status: 'M' },
        { path: 'new.txt', status: 'A' },
      ],
    });
  });

  it('immediately reflects an external git stash drop without caching', async () => {
    const repo = repoWithStashes();
    const service = new GitInfoService(makeLogger());

    const firstRead = await service.stashList(repo);
    expect(firstRead.count).toBe(2);

    // External drop bypasses GitInfoService and produces no watcher event
    git(repo, 'stash', 'drop', 'stash@{0}');

    const secondRead = await service.stashList(repo);
    expect(secondRead.count).toBe(1);
    expect(secondRead.entries[0].message).toContain('older');
  });

  it('includes untracked files from parent 3 as status A in stashShow', async () => {
    const repo = makeRepo();
    write(repo, 'tracked.txt', 'tracked edit\n');
    git(repo, 'add', 'tracked.txt');
    git(repo, 'commit', '-q', '-m', 'add tracked');
    write(repo, 'tracked.txt', 'modified\n');
    write(repo, 'untracked.txt', 'untracked file content\n');
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    write(repo, 'sub/untracked2.txt', 'nested untracked\n');
    git(repo, 'stash', 'push', '-u', '-q', '-m', 'stash with untracked');

    const service = new GitInfoService(makeLogger());
    const result = await service.stashShow(repo, 0);

    expect(result.success).toBe(true);
    expect(result.files).toEqual(
      expect.arrayContaining([
        { path: 'tracked.txt', status: 'M' },
        { path: 'sub/untracked2.txt', status: 'A' },
        { path: 'untracked.txt', status: 'A' },
      ]),
    );
  });
});

describe('parseStashNameStatus', () => {
  it('parses additions, deletions, renames, copies and type changes', () => {
    const output = [
      'M',
      'a.txt',
      'A',
      'b.txt',
      'D',
      'c.txt',
      'R087',
      'old name.txt',
      'new name.txt',
      'C100',
      'src.txt',
      'copy.txt',
      'T',
      'link',
      '',
    ].join('\0');

    expect(parseStashNameStatus(output)).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'b.txt', status: 'A' },
      { path: 'c.txt', status: 'D' },
      { path: 'new name.txt', status: 'R', oldPath: 'old name.txt' },
      { path: 'copy.txt', status: 'A' },
      { path: 'link', status: 'M' },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseStashNameStatus('')).toEqual([]);
  });
});
