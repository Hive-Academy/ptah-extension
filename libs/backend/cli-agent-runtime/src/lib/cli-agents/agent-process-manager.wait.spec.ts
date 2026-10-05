/**
 * AgentProcessManager.waitForAgents — the event-driven blocking wait behind
 * `ptah_agent_wait` (TASK_2026_597, D13).
 *
 * The contract under test: it settles on `agent:exited` (no polling), within
 * one tick of the event; a timeout returns a partial result rather than an
 * error; unknown and other-workspace ids are reported per id; and the
 * listener is removed on every exit path.
 */
import 'reflect-metadata';
import { getEventListeners } from 'node:events';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { AgentId, AgentProcessInfo } from '@ptah-extension/shared';
import {
  AgentProcessManager,
  MAX_AGENT_WAIT_MS,
} from './agent-process-manager.service';
import { AgentMessageRouter } from './agent-message-router.service';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import { AgentOutputBuffer } from './agent-output-buffer.service';

const ID_A = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const ID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const ID_DONE = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003';
const ID_ELSEWHERE = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000004';
const ID_UNKNOWN = 'aaaaaaaa-bbbb-4ccc-8ddd-00000000dead';

const ROOT_A = 'D:\\projects\\workspace-a';
const ROOT_B = 'D:\\projects\\workspace-b';

function makeManager(): AgentProcessManager {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(ROOT_A),
    getWorkspaceFolders: jest.fn().mockReturnValue([ROOT_A]),
    getConfiguration: jest.fn(
      (_section: string, _key: string, dflt?: unknown) => dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;

  type Args = ConstructorParameters<typeof AgentProcessManager>;
  type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;
  const cliDetection = { getAdapter: jest.fn() } as unknown as Args[1];
  const sentryService = { captureException: jest.fn() };
  return new AgentProcessManager(
    logger as unknown as Args[0],
    cliDetection,
    {
      getRunningBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[2],
    sentryService as unknown as Args[3],
    new AgentMessageRouter(logger as unknown as Args[0], cliDetection),
    new AgentSpawnEnvironment(
      logger as unknown as Args[0],
      cliDetection,
      workspaceProvider,
      { effort: { get: jest.fn(() => '') } } as unknown as EnvironmentArgs[3],
      sentryService as unknown as EnvironmentArgs[4],
      null,
      null,
      null,
    ),
    new AgentOutputBuffer(logger as unknown as Args[0]),
    { signal: jest.fn() } as unknown as Args[7],
    { evaluate: jest.fn() } as unknown as Args[8],
  );
}

function infoOf(
  agentId: string,
  overrides: Partial<AgentProcessInfo> = {},
): AgentProcessInfo {
  return {
    agentId: agentId as AgentId,
    cli: 'codex',
    task: 'build the thing',
    workingDirectory: ROOT_A,
    status: 'running',
    startedAt: '2026-10-04T10:00:00.000Z',
    ...overrides,
  };
}

/** Seed the manager's private map, the way the sibling restore spec reads it. */
function seed(manager: AgentProcessManager, info: AgentProcessInfo): void {
  (
    manager as unknown as { agents: Map<string, { info: AgentProcessInfo }> }
  ).agents.set(String(info.agentId), { info });
}

function exitListeners(manager: AgentProcessManager): number {
  return manager.events.listenerCount('agent:exited');
}

describe('AgentProcessManager.waitForAgents', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves within one tick of the agent:exited event, without polling', async () => {
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    let settled = false;
    const wait = manager.waitForAgents([ID_A], 'all', 60_000).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(exitListeners(manager)).toBe(1);

    manager.events.emit(
      'agent:exited',
      infoOf(ID_A, { status: 'completed', exitCode: 0 }),
    );
    // The listener resolves synchronously; the `.then` above runs on the
    // following microtasks, with no timer turn in between.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);

    const result = await wait;
    expect(result.timedOut).toBe(false);
    expect(result.entries).toEqual([
      {
        agentId: ID_A,
        state: 'exited',
        info: expect.objectContaining({ status: 'completed', exitCode: 0 }),
      },
    ]);
    expect(exitListeners(manager)).toBe(0);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("'all' waits for every lane; 'any' returns on the first", async () => {
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    seed(manager, infoOf(ID_B));

    const any = manager.waitForAgents([ID_A, ID_B], 'any', 60_000);
    const all = manager.waitForAgents([ID_A, ID_B], 'all', 60_000);
    manager.events.emit('agent:exited', infoOf(ID_A, { status: 'failed' }));

    const anyResult = await any;
    expect(anyResult.timedOut).toBe(false);
    expect(anyResult.entries.map((e) => e.state)).toEqual([
      'exited',
      'running',
    ]);

    let allSettled = false;
    void all.then(() => {
      allSettled = true;
    });
    await Promise.resolve();
    expect(allSettled).toBe(false);

    manager.events.emit('agent:exited', infoOf(ID_B, { status: 'completed' }));
    const allResult = await all;
    expect(allResult.entries.map((e) => e.state)).toEqual(['exited', 'exited']);
    expect(exitListeners(manager)).toBe(0);
  });

  it('returns a partial result on timeout, not an error, and removes the listener', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    seed(manager, infoOf(ID_B));

    const wait = manager.waitForAgents([ID_A, ID_B], 'all', 5_000);
    manager.events.emit('agent:exited', infoOf(ID_A, { status: 'completed' }));
    jest.advanceTimersByTime(5_000);

    const result = await wait;
    expect(result.timedOut).toBe(true);
    expect(result.entries).toEqual([
      expect.objectContaining({ agentId: ID_A, state: 'exited' }),
      expect.objectContaining({ agentId: ID_B, state: 'running' }),
    ]);
    expect(exitListeners(manager)).toBe(0);
  });

  it('reports a lane that turned terminal without an exit event as exited on timeout', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    const record = infoOf(ID_A);
    seed(manager, record);

    const wait = manager.waitForAgents([ID_A], 'all', 1_000);
    // A timed-out lane whose adapter never settles its abort: the status is
    // stamped, but no `agent:exited` is ever emitted.
    seed(manager, { ...record, status: 'timeout' });
    jest.advanceTimersByTime(1_000);

    const result = await wait;
    expect(result.timedOut).toBe(true);
    expect(result.entries).toEqual([
      {
        agentId: ID_A,
        state: 'exited',
        info: expect.objectContaining({ status: 'timeout' }),
      },
    ]);
  });

  it('settles when the inactivity timeout ends a lane whose abort never settles, and emits that ending once', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    const internals = manager as unknown as {
      agents: Map<string, { info: AgentProcessInfo; hasExited: boolean }>;
      killProcess: () => Promise<void>;
      handleTimeout: (agentId: string) => Promise<void>;
      handleExit: (
        agentId: string,
        code: number | null,
        signal: string | null,
      ) => void;
    };
    internals.agents.set(ID_A, { info: infoOf(ID_A), hasExited: false });
    // The adapter's abort never settles, so `handleExit` is never reached.
    internals.killProcess = () => new Promise<void>(() => undefined);
    const exits: AgentProcessInfo[] = [];
    manager.events.on('agent:exited', (info) => exits.push(info));

    const wait = manager.waitForAgents([ID_A], 'all', 60_000);
    void internals.handleTimeout(ID_A);

    const result = await wait;
    expect(result.timedOut).toBe(false);
    expect(result.entries).toEqual([
      {
        agentId: ID_A,
        state: 'exited',
        info: expect.objectContaining({ status: 'timeout' }),
      },
    ]);

    // A real exit arriving later must not emit the same ending again.
    internals.handleExit(ID_A, 1, null);
    jest.runOnlyPendingTimers();
    expect(exits).toHaveLength(1);
  });

  it('reports unknown and other-workspace ids per id and never waits on them', async () => {
    const manager = makeManager();
    seed(manager, infoOf(ID_ELSEWHERE, { workingDirectory: ROOT_B }));
    seed(manager, infoOf(ID_DONE, { status: 'completed', exitCode: 0 }));

    const result = await manager.waitForAgents(
      [ID_UNKNOWN, ID_ELSEWHERE, ID_DONE, ID_UNKNOWN],
      'all',
      60_000,
    );

    expect(result.timedOut).toBe(false);
    expect(result.entries).toEqual([
      { agentId: ID_UNKNOWN, state: 'not_found' },
      { agentId: ID_ELSEWHERE, state: 'other_workspace' },
      expect.objectContaining({ agentId: ID_DONE, state: 'exited' }),
    ]);
    expect(exitListeners(manager)).toBe(0);
  });

  it('ignores exit events for ids it is not waiting on', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    seed(manager, infoOf(ID_A));

    const wait = manager.waitForAgents([ID_A], 'any', 2_000);
    manager.events.emit('agent:exited', infoOf(ID_B, { status: 'completed' }));
    jest.advanceTimersByTime(2_000);

    const result = await wait;
    expect(result.timedOut).toBe(true);
    expect(result.entries).toEqual([
      expect.objectContaining({ agentId: ID_A, state: 'running' }),
    ]);
  });

  it('ends promptly on abort with a cancelled partial result and leaves no listener (E.3)', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    seed(manager, infoOf(ID_B));
    const controller = new AbortController();
    const baseline = exitListeners(manager);

    const wait = manager.waitForAgents(
      [ID_A, ID_B],
      'all',
      MAX_AGENT_WAIT_MS,
      controller.signal,
    );
    manager.events.emit('agent:exited', infoOf(ID_A, { status: 'completed' }));
    expect(exitListeners(manager)).toBe(baseline + 1);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1);

    // No timer turn: the abort alone settles the wait.
    controller.abort();
    const result = await wait;

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.entries).toEqual([
      expect.objectContaining({ agentId: ID_A, state: 'exited' }),
      expect.objectContaining({ agentId: ID_B, state: 'running' }),
    ]);
    expect(exitListeners(manager)).toBe(baseline);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns at once for a signal already aborted on entry', async () => {
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    const controller = new AbortController();
    controller.abort();

    const result = await manager.waitForAgents(
      [ID_A],
      'all',
      60_000,
      controller.signal,
    );

    expect(result.cancelled).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.entries).toEqual([
      expect.objectContaining({ agentId: ID_A, state: 'running' }),
    ]);
    expect(exitListeners(manager)).toBe(0);
  });

  it('removes the abort listener when the lanes end first', async () => {
    const manager = makeManager();
    seed(manager, infoOf(ID_A));
    const controller = new AbortController();

    const wait = manager.waitForAgents(
      [ID_A],
      'all',
      60_000,
      controller.signal,
    );
    manager.events.emit('agent:exited', infoOf(ID_A, { status: 'completed' }));
    const result = await wait;

    expect(result.cancelled).toBe(false);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('clamps the timeout to 0..MAX_AGENT_WAIT_MS', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    seed(manager, infoOf(ID_A));

    const immediate = await manager.waitForAgents([ID_A], 'all', -5);
    expect(immediate.timedOut).toBe(true);
    expect(exitListeners(manager)).toBe(0);

    let settled = false;
    const capped = manager
      .waitForAgents([ID_A], 'all', MAX_AGENT_WAIT_MS * 10)
      .then((r) => {
        settled = true;
        return r;
      });
    jest.advanceTimersByTime(MAX_AGENT_WAIT_MS - 1);
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    expect((await capped).timedOut).toBe(true);
  });
});
