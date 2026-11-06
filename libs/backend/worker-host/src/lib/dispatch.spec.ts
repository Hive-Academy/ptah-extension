import { runWorkerCommand, type CommandIo } from './dispatch';
import type { WorkerPaths } from '@ptah-extension/worker-runtime';

const paths: WorkerPaths = {
  directory: '/tmp/worker-host-test',
  workspaces: '/tmp/worker-host-test/workspaces',
  tokens: '/tmp/worker-host-test/tokens',
  adminKey: '/tmp/worker-host-test/admin',
  endpoint: '/tmp/worker-host-test/endpoint',
  events: '/tmp/worker-host-test/events',
};

jest.mock('./commands/admin-client', () => ({
  adminCall: jest.fn(async () => ({ ready: true })),
}));
jest.mock('./commands/pair', () => ({
  pairCommand: jest.fn(async () => ({ code: 'PAIR' })),
}));
jest.mock('./commands/workspace', () => ({
  workspaceCommand: jest.fn(async () => []),
}));
jest.mock('./commands/grants', () => ({
  grantsCommand: jest.fn(async () => []),
}));

jest.mock('@ptah-extension/platform-core', () => {
  const state = { id: '' };
  return {
    KernelSessionDriverLock: class {
      async acquire(id: string) {
        state.id = id;
        return { ok: true, nonce: 'n' };
      }
      async dispose() {
        return undefined;
      }
    },
    listLocalDriverLocks: jest.fn(async () => [
      { ok: true, locks: [{ sessionId: state.id }] },
    ]),
    requestRelease: jest.fn(async () => 'released'),
  };
});

function output(): { io: CommandIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      isTty: false,
      confirm: async () => false,
    },
    stdout,
    stderr,
  };
}

describe('worker command dispatch', () => {
  it.each([
    ['status', ['status', '--json'], { ready: true }],
    ['pair', ['pair', '--json'], { code: 'PAIR' }],
    ['workspace', ['workspace', 'list', '--json'], []],
    ['workspace add', ['workspace', 'add', '/tmp/project', '--json'], []],
    ['workspace remove', ['workspace', 'remove', '/tmp/project', '--json'], []],
    ['grants', ['grants', '--json'], []],
    ['grants add', ['grants', 'add', 'token-1', 'workspace-1', '--json'], []],
    ['grants revoke', ['grants', 'revoke', 'token-1', '--json'], []],
  ])('%s emits one JSON line', async (_name, args, expected) => {
    const { io, stdout, stderr } = output();
    expect(await runWorkerCommand(args as string[], io, paths)).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual(expected);
    expect(stderr).toEqual([]);
  });
  it('emits one JSON line for a successful lock self-test', async () => {
    const { io, stdout, stderr } = output();
    expect(
      await runWorkerCommand(['locks', '--self-test', '--json'], io, undefined),
    ).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual({ ok: true });
    expect(stderr).toEqual([]);
  });

  it('emits one JSON line for locks listing and release', async () => {
    const listed = output();
    expect(await runWorkerCommand(['locks', '--json'], listed.io)).toBe(0);
    expect(listed.stdout).toHaveLength(1);
    expect(JSON.parse(listed.stdout[0])).toEqual([
      { ok: true, locks: [{ sessionId: expect.any(String) }] },
    ]);
    expect(listed.stderr).toEqual([]);

    const released = output();
    expect(
      await runWorkerCommand(
        ['locks', 'release', 'session-1', '--yes', '--json'],
        released.io,
      ),
    ).toBe(0);
    expect(released.stdout).toHaveLength(1);
    expect(JSON.parse(released.stdout[0])).toEqual({
      sessionId: 'session-1',
      result: 'released',
    });
    expect(released.stderr).toEqual([]);
  });

  it('refuses non-TTY release without --yes, with only stderr output', async () => {
    const { io, stdout, stderr } = output();
    expect(await runWorkerCommand(['locks', 'release', 'session-1'], io)).toBe(
      1,
    );
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([expect.stringContaining('--yes')]);
  });

  it('reports an in-use lock release as a failure', async () => {
    const { requestRelease } = await import('@ptah-extension/platform-core');
    jest.mocked(requestRelease).mockResolvedValueOnce('in-use');
    const { io, stdout, stderr } = output();
    expect(
      await runWorkerCommand(['locks', 'release', 'session-1', '--yes'], io),
    ).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Lock release in-use']);
  });

  it('passes grants revoke its token ID and refuses extra arguments', async () => {
    const { grantsCommand } = await import('./commands/grants');
    expect(
      await runWorkerCommand(
        ['grants', 'revoke', 'token-1'],
        output().io,
        paths,
      ),
    ).toBe(0);
    expect(grantsCommand).toHaveBeenLastCalledWith(paths, 'revoke', 'token-1');
    const { io, stdout, stderr } = output();
    expect(
      await runWorkerCommand(
        ['grants', 'revoke', 'a', 'b', '--json'],
        io,
        paths,
      ),
    ).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Usage: grants revoke <tokenId> [--json]']);
  });

  it('returns non-zero for an invalid command', async () => {
    const { io, stdout, stderr } = output();
    expect(await runWorkerCommand(['invalid'], io)).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
  });

  it('reports a stopped service on stderr with a non-zero exit', async () => {
    const { adminCall } = await import('./commands/admin-client');
    jest
      .mocked(adminCall)
      .mockRejectedValueOnce(new Error('worker service is not running'));
    const { io, stdout, stderr } = output();
    expect(await runWorkerCommand(['status', '--json'], io, paths)).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['worker service is not running']);
  });
});
