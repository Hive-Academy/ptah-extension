import 'reflect-metadata';

jest.mock('@ptah-extension/vscode-core', () => ({
  ...jest.requireActual<object>('@ptah-extension/vscode-core'),
  execGit: jest.fn(),
}));

jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: { ...actual.promises, lstat: jest.fn(), realpath: jest.fn() },
  };
});

import { promises as fs } from 'node:fs';
import { join } from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  WORKTREE_GIT_TIMEOUT_MS,
  execGit,
  resolveWorktreePath,
} from '@ptah-extension/vscode-core';
import { ChildWorktreeProvisioner } from './child-worktree.provisioner';

const ROOT = join('/', 'repo');
const BRANCH = 'feat/child-1';
const SHA = 'a'.repeat(40);
const WORKTREE = resolveWorktreePath(ROOT, BRANCH);

const execGitMock = execGit as jest.MockedFunction<typeof execGit>;
const lstatMock = fs.lstat as unknown as jest.Mock;
const realpathMock = fs.realpath as unknown as jest.Mock;

type GitReply = { exitCode: number; stdout?: string; stderr?: string } | Error;

/** Replies keyed by the git subcommand line, consumed in order per key. */
function scriptGit(replies: Record<string, GitReply[]>): void {
  execGitMock.mockImplementation(async (args) => {
    const key = args.join(' ');
    const match = Object.keys(replies).find((k) => key.startsWith(k));
    const queue = match ? replies[match] : undefined;
    const reply = queue?.shift() ?? { exitCode: 0 };
    if (reply instanceof Error) throw reply;
    return {
      exitCode: reply.exitCode,
      stdout: reply.stdout ?? '',
      stderr: reply.stderr ?? '',
    };
  });
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
}

function gitCalls(): string[] {
  return execGitMock.mock.calls.map(([args]) => args.join(' '));
}

function makeProvisioner(spawner: unknown = null) {
  const output = { appendLine: jest.fn() } as unknown as IOutputChannel;
  return {
    provisioner: new ChildWorktreeProvisioner(output, spawner as never),
    output,
  };
}

const HAPPY: Record<string, GitReply[]> = {
  'check-ref-format': [{ exitCode: 0, stdout: BRANCH }],
  'rev-parse --verify --quiet refs/heads/': [{ exitCode: 1 }],
  'rev-parse --verify --quiet HEAD^{commit}': [
    { exitCode: 0, stdout: `${SHA}\n` },
  ],
  'worktree add': [{ exitCode: 0 }],
};

beforeEach(() => {
  execGitMock.mockReset();
  lstatMock.mockReset().mockRejectedValue(enoent());
  realpathMock.mockReset().mockImplementation(async (p: string) => p);
});

describe('ChildWorktreeProvisioner.create', () => {
  it('runs the six steps as argument arrays and returns the worktree', async () => {
    scriptGit(structuredClone(HAPPY));
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toEqual({
      ok: true,
      worktree: {
        root: ROOT,
        branch: BRANCH,
        worktreePath: WORKTREE,
        baseSha: SHA,
      },
    });
    expect(gitCalls()).toEqual([
      `check-ref-format --branch ${BRANCH}`,
      `rev-parse --verify --quiet refs/heads/${BRANCH}`,
      'rev-parse --verify --quiet HEAD^{commit}',
      `worktree add -b ${BRANCH} ${WORKTREE} ${SHA}`,
    ]);
    for (const [, cwd, options] of execGitMock.mock.calls) {
      expect(cwd).toBe(ROOT);
      expect(options).toEqual({ timeoutMs: WORKTREE_GIT_TIMEOUT_MS });
    }
  });

  it('passes the off-thread spawner to git when the host binds one', async () => {
    scriptGit(structuredClone(HAPPY));
    const spawner = { spawn: jest.fn() };
    const { provisioner } = makeProvisioner(spawner);

    await provisioner.create(ROOT, BRANCH);

    for (const [, , options] of execGitMock.mock.calls) {
      expect(options).toEqual({ timeoutMs: WORKTREE_GIT_TIMEOUT_MS, spawner });
    }
  });

  it('resolves a given base ref to its commit', async () => {
    scriptGit({
      ...structuredClone(HAPPY),
      'rev-parse --verify --quiet origin/main^{commit}': [
        { exitCode: 0, stdout: SHA },
      ],
    });
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH, 'origin/main');

    expect(result.ok).toBe(true);
    expect(gitCalls()).toContain(
      'rev-parse --verify --quiet origin/main^{commit}',
    );
  });

  it.each(['', '   ', '-delete-me'])(
    'refuses branch %p before running git',
    async (branch) => {
      const { provisioner } = makeProvisioner();
      const result = await provisioner.create(ROOT, branch);
      expect(result).toMatchObject({ ok: false, refusal: 'invalid-arguments' });
      expect(execGitMock).not.toHaveBeenCalled();
    },
  );

  it('refuses a base ref that starts with "-" before running git', async () => {
    const { provisioner } = makeProvisioner();
    const result = await provisioner.create(ROOT, BRANCH, '--orphan');
    expect(result).toMatchObject({ ok: false, refusal: 'invalid-arguments' });
    expect(execGitMock).not.toHaveBeenCalled();
  });

  it('refuses a name git rejects (step 1)', async () => {
    scriptGit({
      'check-ref-format': [{ exitCode: 1, stderr: 'fatal: bad name' }],
    });
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, 'bad..name');

    expect(result).toEqual({
      ok: false,
      refusal: 'invalid-arguments',
      detail: '"bad..name" is not a valid branch name: fatal: bad name',
    });
    expect(gitCalls()).toHaveLength(1);
  });

  it('refuses an existing branch (step 2)', async () => {
    scriptGit({
      ...structuredClone(HAPPY),
      'rev-parse --verify --quiet refs/heads/': [{ exitCode: 0, stdout: SHA }],
    });
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toMatchObject({ ok: false, refusal: 'branch-exists' });
    expect(gitCalls().some((c) => c.startsWith('worktree'))).toBe(false);
  });

  it('refuses a base ref that names no commit (step 3)', async () => {
    scriptGit({
      ...structuredClone(HAPPY),
      'rev-parse --verify --quiet nope^{commit}': [{ exitCode: 1 }],
    });
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH, 'nope');

    expect(result).toMatchObject({ ok: false, refusal: 'invalid-arguments' });
    expect(gitCalls().some((c) => c.startsWith('worktree'))).toBe(false);
  });

  it('refuses when the worktree directory already exists (step 4)', async () => {
    scriptGit(structuredClone(HAPPY));
    lstatMock.mockResolvedValue({});
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toMatchObject({ ok: false, refusal: 'worktree-failed' });
    expect(gitCalls().some((c) => c.startsWith('worktree'))).toBe(false);
  });

  it('reports git stderr and rolls back only what the failed add left (step 5)', async () => {
    scriptGit({
      ...structuredClone(HAPPY),
      // step 2 says absent; the post-failure check finds the branch.
      'rev-parse --verify --quiet refs/heads/': [
        { exitCode: 1 },
        { exitCode: 0 },
      ],
      'worktree add': [{ exitCode: 128, stderr: 'fatal: disk full\n' }],
      'branch -D': [{ exitCode: 0 }],
    });
    // Absent before the add, absent after it: no directory to remove.
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toEqual({
      ok: false,
      refusal: 'worktree-failed',
      detail: 'fatal: disk full',
      rollback: [{ step: 'delete-branch', ok: true }],
    });
    expect(gitCalls()).not.toContain(`worktree remove --force ${WORKTREE}`);
  });

  it('maps a git timeout during the add to worktree-failed with a full rollback', async () => {
    scriptGit({
      ...structuredClone(HAPPY),
      'rev-parse --verify --quiet refs/heads/': [
        { exitCode: 1 },
        { exitCode: 0 },
      ],
      'worktree add': [new Error('git worktree timed out after 300000ms')],
    });
    lstatMock
      .mockRejectedValueOnce(enoent()) // step 4: absent
      .mockResolvedValueOnce({}); // after the timeout: partially created
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toEqual({
      ok: false,
      refusal: 'worktree-failed',
      detail: 'git worktree timed out after 300000ms',
      rollback: [
        { step: 'remove-worktree', ok: true },
        { step: 'delete-branch', ok: true },
      ],
    });
  });

  it('rolls back and refuses a worktree that resolves outside the root (step 6)', async () => {
    realpathMock.mockImplementation(async (p: string) =>
      p === WORKTREE ? join('/', 'elsewhere', 'wt') : p,
    );
    lstatMock
      .mockRejectedValueOnce(enoent()) // step 4
      .mockResolvedValueOnce({}); // rollback: directory exists
    scriptGit({
      ...structuredClone(HAPPY),
      'rev-parse --verify --quiet refs/heads/': [
        { exitCode: 1 },
        { exitCode: 0 },
      ],
    });
    const { provisioner } = makeProvisioner();

    const result = await provisioner.create(ROOT, BRANCH);

    expect(result).toMatchObject({
      ok: false,
      refusal: 'worktree-outside-workspace',
      rollback: [
        { step: 'remove-worktree', ok: true },
        { step: 'delete-branch', ok: true },
      ],
    });
  });

  it('returns worktree-failed when git cannot run at all, without throwing', async () => {
    scriptGit({ 'check-ref-format': [new Error('spawn git ENOENT')] });
    const { provisioner } = makeProvisioner();

    await expect(provisioner.create(ROOT, BRANCH)).resolves.toEqual({
      ok: false,
      refusal: 'worktree-failed',
      detail: 'spawn git ENOENT',
    });
  });
});

describe('ChildWorktreeProvisioner.rollback', () => {
  const worktree = {
    root: ROOT,
    branch: BRANCH,
    worktreePath: WORKTREE,
    baseSha: SHA,
  };

  it('removes the worktree, then deletes the branch', async () => {
    scriptGit({});
    const { provisioner } = makeProvisioner();

    await expect(provisioner.rollback(worktree)).resolves.toEqual([
      { step: 'remove-worktree', ok: true },
      { step: 'delete-branch', ok: true },
    ]);
    expect(gitCalls()).toEqual([
      `worktree remove --force ${WORKTREE}`,
      `branch -D ${BRANCH}`,
    ]);
  });

  it('runs every step and reports each failure without throwing', async () => {
    scriptGit({
      'worktree remove': [new Error('locked')],
      'branch -D': [{ exitCode: 1, stderr: 'error: branch not found' }],
    });
    const { provisioner, output } = makeProvisioner();

    await expect(provisioner.rollback(worktree)).resolves.toEqual([
      { step: 'remove-worktree', ok: false, detail: 'locked' },
      { step: 'delete-branch', ok: false, detail: 'error: branch not found' },
    ]);
    expect(output.appendLine).toHaveBeenCalledWith(
      expect.stringContaining(
        '[ChildWorktreeProvisioner] rollback remove-worktree failed',
      ),
    );
  });
});
