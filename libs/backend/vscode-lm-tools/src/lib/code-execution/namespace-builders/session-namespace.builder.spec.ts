import type {
  ISessionHandoff,
  ISessionSpawner,
  SessionChildSnapshot,
} from '@ptah-extension/cli-agent-runtime';
import {
  SESSION_HANDOFF_UNAVAILABLE_MESSAGE,
  SESSION_SPAWNER_UNAVAILABLE_MESSAGE,
  buildSessionNamespace,
  type SessionNamespaceDependencies,
} from './session-namespace.builder';

const CHILD = {
  childSessionId: 'c-1',
  branch: 'feat/x',
  worktreePath: '/repo/.worktrees/feat-x',
} as SessionChildSnapshot;

function fakeSpawner(): jest.Mocked<ISessionSpawner> {
  return {
    start: jest.fn().mockResolvedValue({ ok: true, child: CHILD }),
    send: jest
      .fn()
      .mockResolvedValue({ delivered: true, effect: 'started-turn' }),
    status: jest.fn().mockReturnValue({ ok: true, children: [] }),
    read: jest.fn().mockResolvedValue({ ok: false, reason: 'unknown-child' }),
    stop: jest.fn().mockResolvedValue({ ok: true, child: CHILD }),
    listUiDescriptors: jest.fn(),
    takeHeldCompletions: jest.fn().mockReturnValue([]),
    dispose: jest.fn(),
  };
}

const HANDED_OFF = {
  ok: true,
  tabId: 'tab-new',
  label: 'Continued: x',
  workspaceRoot: '/repo',
  cwd: '/repo',
  tabOpened: true,
} as const;

function harness(overrides: Partial<SessionNamespaceDependencies> = {}) {
  const spawner = fakeSpawner();
  const handoff: jest.Mocked<ISessionHandoff> = {
    handoff: jest.fn().mockResolvedValue(HANDED_OFF),
  };
  let caller: string | undefined = 'tab-parent';
  const onWorktreeChanged = jest.fn();
  const getSpawner = jest.fn((): ISessionSpawner | undefined => spawner);
  const getHandoff = jest.fn((): ISessionHandoff | undefined => handoff);
  const session = buildSessionNamespace({
    getSpawner,
    getHandoff,
    getCallerSessionId: () => caller,
    onWorktreeChanged,
    ...overrides,
  });
  return {
    session,
    spawner,
    handoff,
    getSpawner,
    getHandoff,
    onWorktreeChanged,
    setCaller: (id: string | undefined) => {
      caller = id;
    },
  };
}

describe('buildSessionNamespace', () => {
  it('passes the transport caller to every operation, never an argument', async () => {
    const h = harness();

    await h.session.start({ task: 't', branch: 'b' });
    await h.session.send({ childSessionId: 'c-1', message: 'm' });
    await h.session.status();
    await h.session.read('c-1', 8);
    await h.session.stop('c-1');
    h.session.takeHeldCompletions();

    expect(h.spawner.start).toHaveBeenCalledWith({
      task: 't',
      branch: 'b',
      callerSessionId: 'tab-parent',
    });
    expect(h.spawner.send).toHaveBeenCalledWith({
      callerSessionId: 'tab-parent',
      childSessionId: 'c-1',
      message: 'm',
      mode: 'queue',
    });
    expect(h.spawner.status).toHaveBeenCalledWith({
      callerSessionId: 'tab-parent',
      childSessionId: undefined,
    });
    expect(h.spawner.read).toHaveBeenCalledWith({
      callerSessionId: 'tab-parent',
      childSessionId: 'c-1',
      tailKiB: 8,
    });
    expect(h.spawner.stop).toHaveBeenCalledWith({
      callerSessionId: 'tab-parent',
      childSessionId: 'c-1',
    });
    expect(h.spawner.takeHeldCompletions).toHaveBeenCalledWith('tab-parent');
  });

  it('reads the caller at call time', async () => {
    const h = harness();
    h.setCaller('tab-later');
    await h.session.status();
    expect(h.spawner.status).toHaveBeenCalledWith({
      callerSessionId: 'tab-later',
      childSessionId: undefined,
    });
  });

  it('fires the worktree change handler after a successful start only', async () => {
    const h = harness();
    await h.session.start({ task: 't', branch: 'b' });
    expect(h.onWorktreeChanged).toHaveBeenCalledWith({
      action: 'created',
      worktreePath: CHILD.worktreePath,
      branch: CHILD.branch,
    });

    h.onWorktreeChanged.mockClear();
    h.spawner.start.mockResolvedValueOnce({
      ok: false,
      refusal: 'branch-exists',
      detail: 'x',
    });
    await h.session.start({ task: 't', branch: 'b' });
    expect(h.onWorktreeChanged).not.toHaveBeenCalled();
  });

  it('looks the spawner up on every call (lazy)', async () => {
    const h = harness();
    expect(h.getSpawner).not.toHaveBeenCalled();
    await h.session.status();
    await h.session.status();
    expect(h.getSpawner).toHaveBeenCalledTimes(2);
  });

  describe('handoff (TASK_2026_655)', () => {
    const input = { handoffPath: '/repo/HANDOFF.md', prompt: 'p' };

    it('passes the transport caller and returns the service result', async () => {
      const h = harness();
      await expect(h.session.handoff(input)).resolves.toEqual(HANDED_OFF);
      expect(h.handoff.handoff).toHaveBeenCalledWith({
        ...input,
        callerSessionId: 'tab-parent',
      });
    });

    it('looks the service up on every call, never at build time', async () => {
      const h = harness();
      expect(h.getHandoff).not.toHaveBeenCalled();
      await h.session.handoff(input);
      await h.session.handoff(input);
      expect(h.getHandoff).toHaveBeenCalledTimes(2);
    });

    it('rejects with the named error when the host has no handoff service', async () => {
      const { session } = harness({ getHandoff: () => undefined });
      await expect(session.handoff(input)).rejects.toThrow(
        SESSION_HANDOFF_UNAVAILABLE_MESSAGE,
      );
    });

    it('does not need a spawner', async () => {
      const { session } = harness({ getSpawner: () => undefined });
      await expect(session.handoff(input)).resolves.toEqual(HANDED_OFF);
    });
  });

  describe('without a spawner', () => {
    const absent = () => harness({ getSpawner: () => undefined }).session;

    it.each([
      [
        'start',
        (s: ReturnType<typeof absent>) => s.start({ task: 't', branch: 'b' }),
      ],
      [
        'send',
        (s: ReturnType<typeof absent>) =>
          s.send({ childSessionId: 'c', message: 'm' }),
      ],
      ['status', (s: ReturnType<typeof absent>) => s.status()],
      ['read', (s: ReturnType<typeof absent>) => s.read('c')],
      ['stop', (s: ReturnType<typeof absent>) => s.stop('c')],
    ])('%s rejects with the named error', async (_name, op) => {
      await expect(op(absent())).rejects.toThrow(
        SESSION_SPAWNER_UNAVAILABLE_MESSAGE,
      );
    });

    it('takeHeldCompletions returns nothing', () => {
      expect(absent().takeHeldCompletions()).toEqual([]);
    });
  });
});
