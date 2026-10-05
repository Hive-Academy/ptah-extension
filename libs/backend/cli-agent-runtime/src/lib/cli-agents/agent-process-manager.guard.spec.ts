/**
 * AgentProcessManager — the lane budget guard hook and the blocked-model
 * refusal (TASK_2026_597, component 16 and R9.5).
 *
 * The contract under test: a lane's `tool-call` segments feed one guard; the
 * steer threshold sends ONE mid-turn `handle.steer` (never `sendToAgent`, and
 * only "not delivered" on a handle without one); the stop threshold stops the
 * lane through `stop` with `stopReason` on the record; a caller's new turn
 * resets the counts; the guard is dropped when the lane ends; and a blocked
 * model is refused before the adapter is asked to start anything.
 */
import 'reflect-metadata';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  AgentProcessInfo,
  CliOutputSegment,
  SpawnAgentRequest,
} from '@ptah-extension/shared';
import {
  AgentProcessManager,
  LaneModelBlockedError,
} from './agent-process-manager.service';
import { AgentMessageRouter } from './agent-message-router.service';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import { AgentOutputBuffer } from './agent-output-buffer.service';
import type { SdkHandle } from './cli-adapters/cli-adapter.interface';

const ROOT = 'D:\\projects\\workspace-a';

/** steer at 2 calls, stop at 4, repeat-stop at 3 identical calls. */
const GUARD_SETTINGS: Record<string, number> = {
  'agentOrchestration.laneToolCallSteerAt': 2,
  'agentOrchestration.laneToolCallStopAt': 4,
  'agentOrchestration.laneRepeatCallStopAt': 3,
};

interface Harness {
  readonly manager: AgentProcessManager;
  readonly logger: Record<'info' | 'warn' | 'error' | 'debug', jest.Mock>;
}

function makeHarness(): Harness {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(ROOT),
    getWorkspaceFolders: jest.fn().mockReturnValue([ROOT]),
    getConfiguration: jest.fn(
      (_section: string, key: string, dflt?: unknown) =>
        GUARD_SETTINGS[key] ?? dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;

  type Args = ConstructorParameters<typeof AgentProcessManager>;
  type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;
  const cliDetection = { getAdapter: jest.fn() } as unknown as Args[1];
  const sentryService = { captureException: jest.fn() };
  const environment = new AgentSpawnEnvironment(
    logger as unknown as Args[0],
    cliDetection,
    workspaceProvider,
    { effort: { get: jest.fn(() => '') } } as unknown as EnvironmentArgs[3],
    sentryService as unknown as EnvironmentArgs[4],
    null,
    null,
    null,
  );
  jest.spyOn(environment, 'validateWorkingDirectory').mockResolvedValue();
  const manager = new AgentProcessManager(
    logger as unknown as Args[0],
    cliDetection,
    {
      getRunningBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[2],
    sentryService as unknown as Args[3],
    new AgentMessageRouter(logger as unknown as Args[0], cliDetection),
    environment,
    new AgentOutputBuffer(logger as unknown as Args[0]),
    { signal: jest.fn() } as unknown as Args[7],
    { evaluate: jest.fn() } as unknown as Args[8],
    // No quota owner and no ledger: plan limits are pinned by the manager spec.
    { ownerForLane: jest.fn(() => undefined) } as unknown as Args[9],
    {
      recordWindowEvidence: jest.fn(),
      recordOwnerEvidence: jest.fn(),
      recordSuccess: jest.fn(),
    } as unknown as Args[10],
  );
  return { manager, logger };
}

interface FakeLane {
  readonly handle: SdkHandle;
  /** The handle's mid-turn `steer`, when the lane was built with one. */
  readonly steer: jest.Mock;
  emit(segment: CliOutputSegment): void;
  finish(code: number): void;
}

interface LaneOptions {
  /** Give the handle a mid-turn `steer` (only Pi has one in production). */
  readonly steer?: boolean;
  /** Give the handle continuation, so a caller can start another turn. */
  readonly continuation?: boolean;
}

/** A segment-streaming handle whose `done` settles on abort or `finish`. */
function makeLane(options: LaneOptions = {}): FakeLane {
  let segmentListener: ((segment: CliOutputSegment) => void) | undefined;
  let settle: (code: number) => void = () => undefined;
  const done = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const abort = new AbortController();
  abort.signal.addEventListener('abort', () => settle(130));
  const steer = jest.fn();
  const handle = {
    abort,
    done,
    onOutput: jest.fn(),
    onSegment: (listener: (segment: CliOutputSegment) => void) => {
      segmentListener = listener;
    },
    ...(options.steer ? { steer } : {}),
    ...(options.continuation
      ? {
          supportsContinuation: () => true,
          continue: jest.fn(async () => ({
            done: new Promise<number>(() => undefined),
          })),
        }
      : {}),
  } as unknown as SdkHandle;
  return {
    handle,
    steer,
    emit: (segment) => segmentListener?.(segment),
    finish: (code) => settle(code),
  };
}

function toolCall(toolName: string, path: string): CliOutputSegment {
  return {
    type: 'tool-call',
    content: '',
    toolName,
    toolInput: { path },
  } as CliOutputSegment;
}

async function startLane(
  manager: AgentProcessManager,
  options: LaneOptions = {},
): Promise<{
  readonly lane: FakeLane;
  readonly agentId: string;
}> {
  const lane = makeLane(options);
  const result = await manager.spawnFromSdkHandle(lane.handle, {
    task: 'build the thing',
    cli: 'codex',
    workingDirectory: ROOT,
  });
  return { lane, agentId: result.agentId };
}

function guardCount(manager: AgentProcessManager): number {
  return (manager as unknown as { laneGuards: Map<string, unknown> }).laneGuards
    .size;
}

/** Let the fire-and-forget steer and stop promises run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function statusOf(
  manager: AgentProcessManager,
  agentId: string,
): AgentProcessInfo {
  return manager.getStatus(agentId) as AgentProcessInfo;
}

describe('AgentProcessManager lane budget guard', () => {
  it('steers once, mid-turn through handle.steer, never through sendToAgent', async () => {
    const { manager } = makeHarness();
    const { lane, agentId } = await startLane(manager, { steer: true });
    const send = jest.spyOn(manager, 'sendToAgent');

    lane.emit(toolCall('read', 'a'));
    lane.emit({ type: 'text', content: 'thinking' } as CliOutputSegment);
    expect(lane.steer).not.toHaveBeenCalled();
    lane.emit(toolCall('read', 'b'));
    lane.emit(toolCall('read', 'c'));
    await settle();

    expect(lane.steer).toHaveBeenCalledTimes(1);
    expect(lane.steer).toHaveBeenCalledWith(
      expect.stringContaining('2 tool calls'),
    );
    expect(send).not.toHaveBeenCalled();
    expect(statusOf(manager, agentId).status).toBe('running');
  });

  it('stops the lane at the stop threshold and surfaces stopReason in status', async () => {
    const { manager } = makeHarness();
    const { lane, agentId } = await startLane(manager, { steer: true });
    const stop = jest.spyOn(manager, 'stop');
    const exited: AgentProcessInfo[] = [];
    manager.events.on('agent:exited', (info: AgentProcessInfo) =>
      exited.push(info),
    );

    for (const path of ['a', 'b', 'c', 'd']) lane.emit(toolCall('read', path));
    await settle();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(agentId);
    const info = statusOf(manager, agentId);
    expect(info.status).toBe('stopped');
    expect(info.stopReason).toBe('tool-call-budget');
    expect(exited).toEqual([
      expect.objectContaining({
        status: 'stopped',
        stopReason: 'tool-call-budget',
      }),
    ]);
  });

  it('stops a lane repeating one identical call with repeat-call', async () => {
    const { manager } = makeHarness();
    const { lane, agentId } = await startLane(manager);

    for (let i = 0; i < 3; i++) lane.emit(toolCall('read', 'same'));
    await settle();

    expect(statusOf(manager, agentId).stopReason).toBe('repeat-call');
  });

  it('does not queue or interrupt-resume the steer on a handle without steer', async () => {
    const { manager, logger } = makeHarness();
    // Continuation but no steer: the general router would park the message as
    // a post-completion turn. The guard must not.
    const { lane, agentId } = await startLane(manager, { continuation: true });
    const send = jest.spyOn(manager, 'sendToAgent');

    lane.emit(toolCall('read', 'a'));
    lane.emit(toolCall('read', 'b'));
    await settle();
    expect(send).not.toHaveBeenCalled();
    const notDelivered = logger.warn.mock.calls.filter(([text]) =>
      String(text).includes(
        'Lane budget steer not delivered (no mid-turn steer)',
      ),
    );
    expect(notDelivered).toEqual([
      [expect.any(String), expect.objectContaining({ agentId, toolCalls: 2 })],
    ]);

    lane.emit(toolCall('read', 'c'));
    lane.emit(toolCall('read', 'd'));
    await settle();

    const info = statusOf(manager, agentId);
    expect(info.status).toBe('stopped');
    expect(info.stopReason).toBe('tool-call-budget');
  });

  it('releases the guard when the lane exits, and ignores later segments', async () => {
    const { manager } = makeHarness();
    const { lane, agentId } = await startLane(manager);
    const send = jest.spyOn(manager, 'sendToAgent');
    expect(guardCount(manager)).toBe(1);

    lane.finish(0);
    await settle();

    expect(guardCount(manager)).toBe(0);
    expect(statusOf(manager, agentId).status).toBe('completed');
    for (const path of ['a', 'b', 'c', 'd']) lane.emit(toolCall('read', path));
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(statusOf(manager, agentId).stopReason).toBeUndefined();
  });

  it('releases the guard when the lane is stopped by the budget', async () => {
    const { manager } = makeHarness();
    const { lane } = await startLane(manager);

    for (const path of ['a', 'b', 'c', 'd']) lane.emit(toolCall('read', path));
    await settle();

    expect(guardCount(manager)).toBe(0);
  });

  it('gives a new caller task a fresh budget and its own steer', async () => {
    const { manager } = makeHarness();
    const { lane, agentId } = await startLane(manager, {
      steer: true,
      continuation: true,
    });

    // Turn 1: three calls, one steer, then the lane completes its task.
    for (const path of ['a', 'b', 'c']) lane.emit(toolCall('read', path));
    lane.finish(0);
    await settle();
    expect(statusOf(manager, agentId).status).toBe('completed');
    expect(lane.steer).toHaveBeenCalledTimes(1);

    // Turn 2 from the caller: without a reset the first call would be the
    // 4th and stop the lane; with it, the steer fires again at 2.
    await manager.continueConversation(agentId, 'next task');
    for (const path of ['d', 'e', 'f']) lane.emit(toolCall('read', path));
    await settle();

    const info = statusOf(manager, agentId);
    expect(info.status).toBe('running');
    expect(info.stopReason).toBeUndefined();
    expect(lane.steer).toHaveBeenCalledTimes(2);
  });
});

describe('AgentProcessManager blocked lane models', () => {
  it('refuses a blocked model before runSdk and starts nothing', async () => {
    const { manager } = makeHarness();
    const runSdk = jest.fn();
    const spawned = jest.fn();
    manager.events.on('agent:spawned', spawned);
    const doSpawnSdk = (
      manager as unknown as {
        doSpawnSdk(options: unknown): Promise<unknown>;
      }
    ).doSpawnSdk.bind(manager);
    const request: SpawnAgentRequest = {
      task: 'build the thing',
      cli: 'codex',
      model: 'openrouter/MIMO-v2.6-flash-free',
    };

    const attempt = doSpawnSdk({
      runSdk,
      request,
      task: request.task,
      workingDirectory: ROOT,
      cli: 'codex',
      displayName: 'Codex',
      roleChannel: 'developer-instructions',
    });

    await expect(attempt).rejects.toBeInstanceOf(LaneModelBlockedError);
    await expect(attempt).rejects.toThrow(
      'Model `openrouter/MIMO-v2.6-flash-free` is blocked for lanes because it is known to loop. Choose another model.',
    );
    expect(runSdk).not.toHaveBeenCalled();
    expect(spawned).not.toHaveBeenCalled();
    expect(manager.getStatus()).toEqual([]);
    expect(guardCount(manager)).toBe(0);
  });
});
