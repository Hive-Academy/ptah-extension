/**
 * GitHistoryReader (via `GitInfoService.getLog`) against REAL git
 * (TASK_2026_576 Requirement 12, plan Component 33).
 *
 * - Base order: `origin/HEAD` (when it points at a commit), else
 *   `origin/main`, `origin/master`, `main`, `master`; none → `recent`. The
 *   range uses full refs, so a same-named tag cannot shadow the base.
 * - `since-base` lists `<base>..HEAD`, newest first, at most 200 commits;
 *   `recent` (HEAD is the base branch, or no base) lists the last 50.
 * - No own commits, detached HEAD, unborn branch, root and merge commits.
 * - Subjects are carried verbatim (unicode, `|`, `%`, tabs).
 *
 * Every repository is created under the OS temp directory and deleted
 * afterwards.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/services/git/git-history.reader.ts
 */

import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { GitLogResult } from '@ptah-extension/shared';
import { GitInfoService } from './git-info.service';
import type { Logger } from '../logging';

const SETUP_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  GIT_EDITOR: 'true',
};

function git(repo: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: SETUP_ENV,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const createdDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  createdDirs.push(dir);
  return dir;
}

function configure(repo: string): void {
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Ptah Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.autocrlf', 'false']);
}

function makeRepo(initialBranch = 'main'): string {
  const dir = makeTempDir('ptah-history-');
  git(dir, ['init', '-q', '-b', initialBranch, '.']);
  configure(dir);
  return dir;
}

function commit(repo: string, subject: string): string {
  git(repo, ['commit', '-q', '--allow-empty', '-m', subject]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** `main` with two commits, then `feature` with `count` commits on top. */
function makeFeatureRepo(count: number): { repo: string; shas: string[] } {
  const repo = makeRepo();
  commit(repo, 'root');
  commit(repo, 'main second');
  git(repo, ['checkout', '-q', '-b', 'feature']);
  const shas: string[] = [];
  for (let i = 1; i <= count; i++) shas.push(commit(repo, `feature ${i}`));
  return { repo, shas };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function expectOk(
  result: GitLogResult,
): Extract<GitLogResult, { status: 'ok' }> {
  if (result.status !== 'ok') {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result;
}

function subjects(result: GitLogResult): string[] {
  return expectOk(result).commits.map((entry) => entry.subject);
}

describe('GitHistoryReader against real git', () => {
  let service: GitInfoService;

  beforeEach(() => {
    service = new GitInfoService(makeLogger());
  });

  afterAll(() => {
    for (const dir of createdDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists the commits since main on a feature branch, newest first', async () => {
    const { repo, shas } = makeFeatureRepo(3);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'main',
      branch: 'feature',
      truncated: false,
    });
    expect(result.commits.map((entry) => entry.sha)).toEqual(
      [...shas].reverse(),
    );
    const newest = result.commits[0];
    expect(newest.subject).toBe('feature 3');
    expect(newest.authorName).toBe('Ptah Test');
    expect(newest.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(newest.sha.startsWith(newest.shortSha)).toBe(true);
    expect(newest.parentCount).toBe(1);
    expect(newest.isRoot).toBe(false);
  });

  it('returns an empty since-base list when the branch has no own commits', async () => {
    const { repo } = makeFeatureRepo(0);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'main',
      branch: 'feature',
      commits: [],
      truncated: false,
    });
  });

  it('lists recent commits on the base branch itself and flags the root commit', async () => {
    const { repo } = makeFeatureRepo(2);
    git(repo, ['checkout', '-q', 'main']);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'recent',
      base: 'main',
      branch: 'main',
    });
    expect(subjects(result)).toEqual(['main second', 'root']);
    const root = result.commits[1];
    expect(root.isRoot).toBe(true);
    expect(root.parentCount).toBe(0);
  });

  it('measures a detached HEAD from the base', async () => {
    const { repo, shas } = makeFeatureRepo(2);
    git(repo, ['checkout', '-q', '--detach', shas[1]]);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'main',
      branch: null,
    });
    expect(subjects(result)).toEqual(['feature 2', 'feature 1']);
  });

  it('prefers origin/HEAD over local main', async () => {
    const upstream = makeRepo();
    commit(upstream, 'root');
    commit(upstream, 'upstream second');
    const clone = makeTempDir('ptah-history-clone-');
    git(clone, ['clone', '-q', upstream, '.']);
    configure(clone);
    // Local main moves ahead of origin/main; the feature branch starts there.
    commit(clone, 'local main only');
    git(clone, ['checkout', '-q', '-b', 'feature']);
    commit(clone, 'feature 1');

    const result = expectOk(await service.getLog(clone));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'origin/main',
      branch: 'feature',
    });
    expect(subjects(result)).toEqual(['feature 1', 'local main only']);

    git(clone, ['checkout', '-q', 'main']);
    expect(expectOk(await service.getLog(clone))).toMatchObject({
      mode: 'recent',
      base: 'origin/main',
      branch: 'main',
    });
  });

  it('prefers origin/main over a stale local main when origin/HEAD is unset', async () => {
    const upstream = makeRepo();
    commit(upstream, 'root');
    const clone = makeTempDir('ptah-history-stale-');
    git(clone, ['clone', '-q', upstream, '.']);
    configure(clone);
    git(clone, ['remote', 'set-head', 'origin', '--delete']);
    // origin/main moves on; local main stays behind.
    commit(upstream, 'landed upstream 1');
    commit(upstream, 'landed upstream 2');
    git(clone, ['fetch', '-q', 'origin']);
    git(clone, ['checkout', '-q', '-b', 'feature', 'origin/main']);
    commit(clone, 'feature 1');

    const result = expectOk(await service.getLog(clone));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'origin/main',
      branch: 'feature',
    });
    expect(subjects(result)).toEqual(['feature 1']);
  });

  it('is not shadowed by a tag named like the base branch', async () => {
    const { repo } = makeFeatureRepo(2);
    // A tag `main` on the root commit would add `main second` to `main..HEAD`.
    git(repo, ['tag', 'main', 'main~1']);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({ mode: 'since-base', base: 'main' });
    expect(subjects(result)).toEqual(['feature 2', 'feature 1']);
  });

  it('falls back to main when origin/HEAD is absent or dangling', async () => {
    const { repo } = makeFeatureRepo(1);
    git(repo, [
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/gone',
    ]);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({ mode: 'since-base', base: 'main' });
    expect(subjects(result)).toEqual(['feature 1']);
  });

  it('falls back to master when there is no main', async () => {
    const repo = makeRepo('master');
    commit(repo, 'root');
    git(repo, ['checkout', '-q', '-b', 'topic']);
    commit(repo, 'topic 1');

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'master',
      branch: 'topic',
    });
    expect(subjects(result)).toEqual(['topic 1']);
  });

  it('lists recent commits when no base resolves', async () => {
    const repo = makeRepo('trunk');
    commit(repo, 'only');

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'recent',
      base: null,
      branch: 'trunk',
    });
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0].isRoot).toBe(true);
  });

  it('returns an empty list on an unborn branch', async () => {
    const repo = makeRepo();

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      base: null,
      branch: 'main',
      commits: [],
      truncated: false,
    });
  });

  it('flags the root of an unrelated (orphan) branch and counts merge parents', async () => {
    const repo = makeRepo();
    commit(repo, 'main root');
    git(repo, ['checkout', '-q', '--orphan', 'orphan']);
    commit(repo, 'orphan root');
    git(repo, ['checkout', '-q', '-b', 'side']);
    commit(repo, 'side 1');
    git(repo, ['checkout', '-q', 'orphan']);
    git(repo, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);

    const result = expectOk(await service.getLog(repo));

    expect(result).toMatchObject({
      mode: 'since-base',
      base: 'main',
      branch: 'orphan',
    });
    const bySubject = new Map(
      result.commits.map((entry) => [entry.subject, entry]),
    );
    expect(bySubject.get('merge side')?.parentCount).toBe(2);
    expect(bySubject.get('orphan root')?.isRoot).toBe(true);
    expect(bySubject.has('main root')).toBe(false);
  });

  it('caps since-base at 200 commits and reports truncation', async () => {
    const repo = makeRepo();
    const base = commit(repo, 'root');
    // One fast-import run instead of 205 `git commit` spawns.
    const records: string[] = [];
    for (let i = 1; i <= 205; i++) {
      const message = `bulk ${i}\n`;
      records.push(
        'commit refs/heads/feature',
        'committer Ptah Test <test@example.com> 1700000000 +0000',
        `data ${Buffer.byteLength(message, 'utf8')}`,
        message,
      );
      if (i === 1) records.push(`from ${base}`);
    }
    git(repo, ['fast-import', '--quiet'], `${records.join('\n')}\n`);
    git(repo, ['checkout', '-q', 'feature']);

    const result = expectOk(await service.getLog(repo));

    expect(result.mode).toBe('since-base');
    expect(result.commits).toHaveLength(200);
    expect(result.truncated).toBe(true);
    expect(result.commits[0].subject).toBe('bulk 205');
    expect(result.commits[199].subject).toBe('bulk 6');
  });

  it('carries subjects and author names with unicode, | and % verbatim', async () => {
    const { repo } = makeFeatureRepo(0);
    const tricky = [
      'fix | pipe | separated',
      'unicode é ✓ 日本語 🚀',
      'percent %x00 %s %H literal',
      'tab\tinside and trailing |',
    ];
    git(repo, ['config', 'user.name', 'Zoë | Ünïcode']);
    for (const subject of tricky) commit(repo, subject);

    const result = expectOk(await service.getLog(repo));

    expect(subjects(result)).toEqual([...tricky].reverse());
    expect(
      result.commits.every((entry) => entry.authorName === 'Zoë | Ünïcode'),
    ).toBe(true);
  });

  it('answers unavailable outside a repository', async () => {
    const dir = makeTempDir('ptah-history-norepo-');

    const result = await service.getLog(dir);

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'not-a-repository',
    });
  });
});
