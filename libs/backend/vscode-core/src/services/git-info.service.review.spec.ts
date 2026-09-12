import 'reflect-metadata';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { GitInfoService } from './git-info.service';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('GitInfoService historical review', () => {
  let root: string;
  let service: GitInfoService;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'ptah-review-'));
    git(root, 'init');
    git(root, 'config', 'user.email', 'ptah@example.test');
    git(root, 'config', 'user.name', 'Ptah Test');
    writeFileSync(path.join(root, 'text.txt'), 'one\ntwo\n');
    writeFileSync(path.join(root, 'rename-me.txt'), 'rename\n');
    writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'base');
    git(root, 'branch', '-M', 'main');
    git(root, 'checkout', '-b', 'feature');
    writeFileSync(path.join(root, 'text.txt'), 'one\ntwo changed\nthree\n');
    git(root, 'mv', 'rename-me.txt', 'renamed.txt');
    writeFileSync(path.join(root, 'added.txt'), 'new\nfile\n');
    writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 9, 2, 3]));
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'feature');
    service = new GitInfoService({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as never);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns merge-base stats and immutable file bodies without mutation', async () => {
    writeFileSync(path.join(root, 'uncommitted.txt'), 'leave me');
    const before = {
      head: git(root, 'rev-parse', 'HEAD'),
      index: git(root, 'write-tree'),
      status: git(root, 'status', '--porcelain=v1'),
    };

    const result = await service.reviewChanges(root, 'main', 'feature');
    if (!result.success || !result.mergeBaseSha || !result.head) {
      throw new Error('Expected a successful historical comparison');
    }
    const workingTree = await service.getGitInfo(root);

    expect(result.success).toBe(true);
    expect(result.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'text.txt',
        'renamed.txt',
        'added.txt',
        'binary.bin',
      ]),
    );
    expect(
      result.files.find((file) => file.path === 'binary.bin'),
    ).toMatchObject({
      additions: null,
      deletions: null,
      binary: true,
    });
    expect(
      result.files.find((file) => file.path === 'renamed.txt'),
    ).toMatchObject({
      originalPath: 'rename-me.txt',
      status: 'R',
    });
    expect(result.totals.additions).toBeGreaterThan(0);
    expect(
      workingTree.files.find((entry) => entry.path === 'uncommitted.txt'),
    ).toMatchObject({
      additions: 1,
      deletions: 0,
      binary: false,
    });

    const file = await service.reviewFile(root, {
      baseSha: result.mergeBaseSha,
      headSha: result.head.sha,
      path: 'text.txt',
    });
    expect(file.success).toBe(true);
    expect(file.original).toEqual({
      outcome: 'content',
      content: 'one\ntwo\n',
    });
    expect(file.modified).toEqual({
      outcome: 'content',
      content: 'one\ntwo changed\nthree\n',
    });
    expect(readFileSync(path.join(root, 'uncommitted.txt'), 'utf8')).toBe(
      'leave me',
    );
    expect({
      head: git(root, 'rev-parse', 'HEAD'),
      index: git(root, 'write-tree'),
      status: git(root, 'status', '--porcelain=v1'),
    }).toEqual(before);
  });

  it('rejects a SHA/path pair that reviewChanges did not issue', async () => {
    const result = await service.reviewChanges(root, 'main', 'feature');
    if (!result.success || !result.mergeBaseSha || !result.head) {
      throw new Error('Expected a successful historical comparison');
    }
    const file = await service.reviewFile(root, {
      baseSha: result.mergeBaseSha,
      headSha: result.head.sha,
      path: 'package.json',
    });
    expect(file.success).toBe(false);
  });
});
