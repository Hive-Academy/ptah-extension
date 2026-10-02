/**
 * ChildWorktreeProvisioner against a real git repository in a temp folder:
 * create + rollback must leave no worktree, no directory and no branch.
 */
import 'reflect-metadata';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import { execGit } from '@ptah-extension/vscode-core';
import { ChildWorktreeProvisioner } from './child-worktree.provisioner';

// Real git processes on a cold Windows runner are slow; the default 5 s
// jest timeout is what the pre-existing real-git specs trip over.
jest.setTimeout(120_000);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execGit(args, cwd, { timeoutMs: 60_000 });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

describe('ChildWorktreeProvisioner (real git)', () => {
  let root: string;
  const output = { appendLine: jest.fn() } as unknown as IOutputChannel;
  const provisioner = new ChildWorktreeProvisioner(output, null);

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ptah-child-wt-'));
    await git(root, 'init', '--quiet');
    await git(root, 'config', 'user.email', 'test@example.invalid');
    await git(root, 'config', 'user.name', 'Test');
    await git(root, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'README.md'), '# temp\n');
    await git(root, 'add', 'README.md');
    await git(root, 'commit', '--quiet', '-m', 'init');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function branches(): Promise<string[]> {
    return (await git(root, 'branch', '--format=%(refname:short)'))
      .split('\n')
      .filter(Boolean);
  }

  it('creates the worktree on a new branch at HEAD, then rolls both back', async () => {
    const head = await git(root, 'rev-parse', 'HEAD');

    const created = await provisioner.create(root, 'feat/child-int');
    if (!created.ok) throw new Error(`create refused: ${created.detail}`);
    const { worktree } = created;

    expect(worktree.baseSha).toBe(head);
    expect(existsSync(join(worktree.worktreePath, 'README.md'))).toBe(true);
    expect(await branches()).toContain('feat/child-int');
    expect(await git(worktree.worktreePath, 'branch', '--show-current')).toBe(
      'feat/child-int',
    );

    const steps = await provisioner.rollback(worktree);

    expect(steps).toEqual([
      { step: 'remove-worktree', ok: true },
      { step: 'delete-branch', ok: true },
    ]);
    expect(existsSync(worktree.worktreePath)).toBe(false);
    expect(await branches()).not.toContain('feat/child-int');
    expect(await git(root, 'worktree', 'list', '--porcelain')).not.toContain(
      worktree.worktreePath.replace(/\\/g, '/').split('/').pop() as string,
    );
  });

  it('refuses an existing branch and leaves the repository untouched', async () => {
    await git(root, 'branch', 'already-there');
    const before = await git(root, 'worktree', 'list', '--porcelain');

    const result = await provisioner.create(root, 'already-there');

    expect(result).toMatchObject({ ok: false, refusal: 'branch-exists' });
    expect(await git(root, 'worktree', 'list', '--porcelain')).toBe(before);
    await git(root, 'branch', '-D', 'already-there');
  });

  it('refuses a name git rejects and a base ref that is not a commit', async () => {
    await expect(provisioner.create(root, 'bad..name')).resolves.toMatchObject({
      ok: false,
      refusal: 'invalid-arguments',
    });
    await expect(
      provisioner.create(root, 'feat/ok-name', 'no-such-ref'),
    ).resolves.toMatchObject({ ok: false, refusal: 'invalid-arguments' });
    expect(await branches()).not.toContain('feat/ok-name');
  });
});
