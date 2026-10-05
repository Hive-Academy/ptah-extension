import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { SubagentRecord } from '@ptah-extension/shared';
import { SubagentHookHandler } from './subagent-hook-handler';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import {
  SubagentStopCallbackRegistry,
  type SubagentStopPayload,
} from './subagent-stop-callback-registry';
import type {
  HookInput,
  HookJSONOutput,
} from '../types/sdk-types/claude-sdk.types';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function makeRegistry(
  record: Partial<SubagentRecord> | null,
): jest.Mocked<SubagentRegistryService> {
  const resolved: SubagentRecord | null = record
    ? ({
        toolCallId: 'tu-1',
        agentType: 'backend-developer',
        agentId: 'agent-xyz',
        startedAt: 0,
        status: 'running',
        ...record,
      } as unknown as SubagentRecord)
    : null;
  return {
    register: jest.fn(),
    get: jest.fn().mockReturnValue(resolved),
    update: jest.fn(),
    getToolCallIdByAgentId: jest.fn(),
    getToolCallIdsByAgentId: jest.fn().mockReturnValue([]),
    holdUnboundStart: jest.fn(),
    discardHeldUnboundStarts: jest.fn(),
  } as unknown as jest.Mocked<SubagentRegistryService>;
}

function getStartCallback(
  handler: SubagentHookHandler,
  workspacePath: string,
  parentSessionId?: string,
) {
  const hooks = handler.createHooks(workspacePath, parentSessionId);
  const fn = hooks.SubagentStart?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<HookJSONOutput>;
}

function startInput(over: Record<string, unknown> = {}): HookInput {
  return {
    hook_event_name: 'SubagentStart',
    session_id: 'payload-parent-sess',
    agent_id: 'agent-xyz',
    agent_type: 'backend-developer',
    ...over,
  } as unknown as HookInput;
}

function getStopCallback(
  handler: SubagentHookHandler,
  workspacePath: string,
  parentSessionId?: string,
) {
  const hooks = handler.createHooks(workspacePath, parentSessionId);
  const matchers = hooks.SubagentStop;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<HookJSONOutput>;
}

const VALID_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('SubagentHookHandler — SubagentStopCallbackRegistry fan-out', () => {
  it('valid agent_transcript_path with UUID basename → notifyAll fires with derived subagentSessionId', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      toolCallId: 'tu-1',
      agentType: 'backend-developer',
    });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-sess-1');

    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        subagentSessionId: VALID_UUID,
        parentSessionId: 'parent-sess-1',
        workspaceRoot: '/workspace',
        agentId: 'agent-xyz',
        agentType: 'backend-developer',
        transcriptPath: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      }),
    );
  });

  it('agent-prefixed transcript path (agent-<hex>.jsonl) → notifyAll fires with agent-prefixed id and explicit transcriptPath', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({
      toolCallId: 'tu-1',
      agentType: 'backend-developer',
    });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-sess-1');

    const transcriptPath =
      '/home/u/.claude/projects/proj/parent-sess-1/subagents/agent-a5fb6580acd4a4883.jsonl';
    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: transcriptPath,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        subagentSessionId: 'agent-a5fb6580acd4a4883',
        parentSessionId: 'parent-sess-1',
        workspaceRoot: '/workspace',
        transcriptPath,
      }),
    );
  });

  it('Windows agent-prefixed transcript path (backslashes) derives the agent id', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, 'C:\\ws', 'parent-sess-1');

    const transcriptPath =
      'C:\\Users\\u\\.claude\\projects\\proj\\parent-sess-1\\subagents\\agent-a54127225c34b5903.jsonl';
    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: transcriptPath,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0].subagentSessionId).toBe('agent-a54127225c34b5903');
    expect(captured[0].transcriptPath).toBe(transcriptPath);
  });

  it('agent_transcript_path without UUID basename → no fan-out; logger.warn fires with path', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-sess-1');

    const badPath = '/tmp/transcripts/not-a-uuid.jsonl';
    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: badPath,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(0);
    const warnedAboutDerive = logger.warn.mock.calls.some(
      ([msg, ctx]) =>
        typeof msg === 'string' &&
        msg.includes('could not derive subagentSessionId') &&
        (ctx as { transcriptPath?: string } | undefined)?.transcriptPath ===
          badPath,
    );
    expect(warnedAboutDerive).toBe(true);
  });

  it('registry.notifyAll subscriber throws → registry logs error; subagentRegistry.update still ran; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    stopRegistry.register(() => {
      throw new Error('subscriber boom');
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-sess-1');

    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(registry.update).toHaveBeenCalledWith(
      'tu-1',
      expect.objectContaining({ status: 'completed' }),
    );
    const errorLogged = logger.error.mock.calls.some(
      ([msg]) =>
        typeof msg === 'string' &&
        msg.includes('SubagentStopCallbackRegistry') &&
        msg.includes('subscriber threw'),
    );
    expect(errorLogged).toBe(true);
  });

  it('record is null (no toolCallId match, no agentId fallback) → fan-out STILL fires with agentType:unknown', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    (registry.getToolCallIdByAgentId as jest.Mock).mockReturnValue(undefined);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-sess-1');

    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'parent-sess-1',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      stop_hook_active: false,
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        subagentSessionId: VALID_UUID,
        parentSessionId: 'parent-sess-1',
        workspaceRoot: '/workspace',
        agentId: 'agent-xyz',
        agentType: 'unknown',
        transcriptPath: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      }),
    );
  });
});

/**
 * TASK_2026_295 — SubagentStart used to gate registration on the id captured
 * when the hooks were built, while the authoritative parent id sat on
 * `input.session_id` of the same object. The closure is `''` for a new session
 * (`SdkQueryOptionsBuilder` passes `sessionId ?? ''`) and was `undefined`
 * outright for internal one-shot queries, so registration was dropped with only
 * a debug log — and with no SubagentRecord there is nothing for
 * `subagent:send-message`, `subagent:stop`, background listing or
 * interrupted-agent resumption to address.
 */
describe('SubagentHookHandler — SubagentStart registration identity (TASK_2026_295)', () => {
  it('registers using the payload session_id when the closure id is empty', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStartCallback(handler, '/workspace', '');

    const result = await fn(startInput(), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tu-1',
        parentSessionId: 'payload-parent-sess',
        agentType: 'backend-developer',
        agentId: 'agent-xyz',
      }),
    );
  });

  it('registers using the payload session_id when the closure id is absent (internal one-shot query)', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStartCallback(handler, '/workspace', undefined);

    await fn(startInput(), 'tu-1', { signal: new AbortController().signal });

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'payload-parent-sess',
      }),
    );
  });

  it('never stores an empty parentSessionId: an empty payload id falls back to the closure', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStartCallback(handler, '/workspace', 'closure-parent-sess');

    await fn(startInput({ session_id: '' }), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'closure-parent-sess',
      }),
    );
  });

  it('drops the registration and WARNS (not debug) when neither source has a parent id', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStartCallback(handler, '/workspace', '');

    const result = await fn(startInput({ session_id: '' }), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(registry.register).not.toHaveBeenCalled();
    // A dropped registration is a subagent nobody can steer or stop. It must
    // not be a debug line.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Subagent NOT registered'),
      expect.objectContaining({
        reason: expect.stringContaining('no parent sessionId'),
      }),
    );
  });

  it('holds a start without toolUseId that no record names, for the Task result to bind (F-F)', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStartCallback(handler, '/workspace', 'closure-parent-sess');

    await fn(startInput(), undefined, {
      signal: new AbortController().signal,
    });

    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.getToolCallIdsByAgentId).toHaveBeenCalledWith(
      'agent-xyz',
      'payload-parent-sess',
    );
    expect(registry.holdUnboundStart).toHaveBeenCalledWith({
      agentId: 'agent-xyz',
      agentType: 'backend-developer',
      parentSessionId: 'payload-parent-sess',
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('held until the Task result names its agentId'),
      expect.objectContaining({ agentId: 'agent-xyz' }),
    );
  });
});

/**
 * TASK_2026_614 F-F — a SubagentStart without a `toolUseId` binds only on an
 * exact `agentId` match in the same parent session; none or several stay
 * unbound with a WARN.
 */
describe('SubagentHookHandler — SubagentStart without toolUseId binds by exact agentId (F-F)', () => {
  function setup(
    matches: string[],
    record: Partial<SubagentRecord> | null,
  ): {
    logger: jest.Mocked<Logger>;
    registry: jest.Mocked<SubagentRegistryService>;
    fn: ReturnType<typeof getStartCallback>;
  } {
    const logger = makeLogger();
    const registry = makeRegistry(record);
    (registry.getToolCallIdsByAgentId as jest.Mock).mockReturnValue(matches);
    const handler = new SubagentHookHandler(
      logger,
      registry,
      new SubagentStopCallbackRegistry(logger),
      new SessionStatsOwnerService(),
    );
    return {
      logger,
      registry,
      fn: getStartCallback(handler, '/workspace', 'closure-parent-sess'),
    };
  }

  const signal = new AbortController().signal;

  it('re-registers the single interrupted match as running under its own toolCallId', async () => {
    const { logger, registry, fn } = setup(['tu-old'], {
      toolCallId: 'tu-old',
      status: 'interrupted',
      teammateName: 'scout',
      taskId: 'task-7',
    });

    const result = await fn(startInput(), undefined, { signal });

    expect(result).toEqual({ continue: true });
    expect(registry.get).toHaveBeenCalledWith('tu-old');
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tu-old',
        agentId: 'agent-xyz',
        agentType: 'backend-developer',
        parentSessionId: 'payload-parent-sess',
        teammateName: 'scout',
        taskId: 'task-7',
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('bound by exact agentId'),
      expect.objectContaining({
        toolCallId: 'tu-old',
        priorStatus: 'interrupted',
      }),
    );
  });

  it('keeps a single live match and only counts the start as activity', async () => {
    const { logger, registry, fn } = setup(['tu-live'], {
      toolCallId: 'tu-live',
      status: 'running',
    });

    await fn(startInput(), undefined, { signal });

    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.update).toHaveBeenCalledWith('tu-live', {});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('stays unbound and WARNS when several records name the agentId', async () => {
    const { logger, registry, fn } = setup(['tu-a', 'tu-b'], {
      status: 'interrupted',
    });

    await fn(startInput(), undefined, { signal });

    expect(registry.get).not.toHaveBeenCalled();
    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Subagent NOT registered'),
      expect.objectContaining({
        reason: expect.stringContaining('several registry records'),
        matchCount: 2,
      }),
    );
  });

  it('stays unbound and WARNS when the single match vanished before it was read', async () => {
    const { logger, registry, fn } = setup(['tu-gone'], null);

    await fn(startInput(), undefined, { signal });

    expect(registry.register).not.toHaveBeenCalled();
    expect(registry.update).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Subagent NOT registered'),
      expect.objectContaining({ matchCount: 1 }),
    );
  });
});

/**
 * TASK_2026_295 — SubagentStop fanned `parentSessionId: input.session_id` out
 * unvalidated while its twin (`subagent-stop-hook-handler`) resolved
 * payload-first AND rejected `''` for the same SDK event.
 */
describe('SubagentHookHandler — SubagentStop parentSessionId rigour (TASK_2026_295)', () => {
  function stopInput(over: Record<string, unknown> = {}): HookInput {
    return {
      hook_event_name: 'SubagentStop',
      session_id: 'payload-parent-sess',
      agent_id: 'agent-xyz',
      agent_type: 'backend-developer',
      agent_transcript_path: `/tmp/transcripts/${VALID_UUID}.jsonl`,
      stop_hook_active: false,
      ...over,
    } as unknown as HookInput;
  }

  it('scopes an unbound shared agent stop to its payload parent session', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const heldStarts = new Set([
      'shared-agent:payload-parent-sess',
      'shared-agent:parent-b',
    ]);
    registry.discardHeldUnboundStarts.mockImplementation(
      (agentId, parentSessionId) => {
        if (parentSessionId) {
          heldStarts.delete(`${agentId}:${parentSessionId}`);
        }
      },
    );
    const handler = new SubagentHookHandler(
      logger,
      registry,
      new SubagentStopCallbackRegistry(logger),
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'parent-a');

    await fn(stopInput({ agent_id: 'shared-agent' }), undefined, {
      signal: new AbortController().signal,
    });

    // The state-store regression keeps parent-b's start; this pins the
    // payload-first scope forwarded by the hook for two sessions sharing one
    // agent id.
    expect(registry.discardHeldUnboundStarts).toHaveBeenCalledWith(
      'shared-agent',
      'payload-parent-sess',
    );
    expect(heldStarts.has('shared-agent:payload-parent-sess')).toBe(false);
    expect(heldStarts.has('shared-agent:parent-b')).toBe(true);
  });

  it.each([
    ['a new-session closure', ''],
    ['a one-shot query closure', undefined],
  ])(
    'drops a held start under the payload session after stop from %s',
    async (_description, closureParentSessionId) => {
      const logger = makeLogger();
      const registry = makeRegistry(null);
      const heldStarts = new Set<string>();
      registry.holdUnboundStart.mockImplementation((start) => {
        heldStarts.add(`${start.agentId}:${start.parentSessionId}`);
      });
      registry.discardHeldUnboundStarts.mockImplementation(
        (agentId, parentSessionId) => {
          if (parentSessionId) {
            heldStarts.delete(`${agentId}:${parentSessionId}`);
          }
        },
      );
      const handler = new SubagentHookHandler(
        logger,
        registry,
        new SubagentStopCallbackRegistry(logger),
        new SessionStatsOwnerService(),
      );
      const start = getStartCallback(
        handler,
        '/workspace',
        closureParentSessionId,
      );
      const stop = getStopCallback(
        handler,
        '/workspace',
        closureParentSessionId,
      );
      const signal = { signal: new AbortController().signal };

      await start(startInput({ agent_id: 'held-agent' }), undefined, signal);
      expect(heldStarts.has('held-agent:payload-parent-sess')).toBe(true);

      await stop(stopInput({ agent_id: 'held-agent' }), undefined, signal);

      expect(registry.discardHeldUnboundStarts).toHaveBeenCalledWith(
        'held-agent',
        'payload-parent-sess',
      );
      expect(heldStarts.has('held-agent:payload-parent-sess')).toBe(false);
      // A later Task result naming this agent has no held start to bind.
      expect(heldStarts.has('held-agent:payload-parent-sess')).toBe(false);
    },
  );

  it('falls back to the closure id when the payload session_id is empty', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', 'closure-parent-sess');

    await fn(stopInput({ session_id: '' }), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].parentSessionId).toBe('closure-parent-sess');
  });

  it('skips the fan-out rather than publishing an empty parentSessionId', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(
      logger,
      registry,
      stopRegistry,
      new SessionStatsOwnerService(),
    );
    const fn = getStopCallback(handler, '/workspace', '');

    const result = await fn(stopInput({ session_id: '' }), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(0);
    // The registry update is independent of the fan-out and must still run.
    expect(registry.update).toHaveBeenCalledWith(
      'tu-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no resolvable parentSessionId'),
      expect.objectContaining({ subagentSessionId: VALID_UUID }),
    );
  });
});

// ---------------------------------------------------------------------------

/**
 * TASK_2026_533: the AGENTS chip counts unique subagent identities of the
 * session. The hook is the live seam; the registry's `toolUseId` gate must
 * not gate membership, and start + stop + aliases count once.
 */
describe('SubagentHookHandler — session agent identities (TASK_2026_533)', () => {
  const PARENT = 'payload-parent-sess';

  function setup() {
    const logger = makeLogger();
    const owner = new SessionStatsOwnerService();
    owner.startNew(PARENT);
    const handler = new SubagentHookHandler(
      logger,
      makeRegistry(null),
      new SubagentStopCallbackRegistry(logger),
      owner,
    );
    return {
      owner,
      start: getStartCallback(handler, '/workspace', PARENT),
      stop: getStopCallback(handler, '/workspace', PARENT),
    };
  }

  const signal = { signal: new AbortController().signal };

  it('records the real agent id even when the start hook has no toolUseId', async () => {
    const { owner, start } = setup();

    await start(startInput({ agent_id: 'a1' }), undefined, signal);

    expect(owner.snapshot(PARENT)?.agentSessionCount).toBe(1);
  });

  it('counts start, stop and alias of one agent once, and five agents as five', async () => {
    const { owner, start, stop } = setup();

    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await start(startInput({ agent_id: id }), `tu-${id}`, signal);
    }
    await stop(
      {
        hook_event_name: 'SubagentStop',
        session_id: PARENT,
        agent_id: 'agent-a1',
        stop_hook_active: false,
      } as unknown as HookInput,
      'tu-a1',
      signal,
    );
    await start(startInput({ agent_id: 'a5' }), 'tu-a5', signal);

    expect(owner.snapshot(PARENT)?.agentSessionCount).toBe(5);
  });

  // CodeRabbit: the SDK runs hook callbacks from its read loop while `init`
  // can still sit unconsumed in the message queue, so a subagent hook may
  // arrive before the tab-keyed owner is rebound to the canonical id.
  it('records under the provisional tab key before rebind, and the identity survives rebind', async () => {
    const TAB = 'tab_new';
    const logger = makeLogger();
    const owner = new SessionStatsOwnerService();
    const { generation } = owner.startNew(TAB);
    const handler = new SubagentHookHandler(
      logger,
      makeRegistry(null),
      new SubagentStopCallbackRegistry(logger),
      owner,
    );
    const start = getStartCallback(handler, '/workspace', TAB);

    await start(startInput({ agent_id: 'a1' }), 'tu-a1', signal);
    owner.rebind(TAB, PARENT, generation);

    expect(owner.snapshot(PARENT)?.agentSessionCount).toBe(1);
  });

  it('never records under the tab key while the canonical owner exists', async () => {
    const TAB = 'tab_other';
    const logger = makeLogger();
    const owner = new SessionStatsOwnerService();
    owner.startNew(PARENT);
    owner.startNew(TAB);
    const handler = new SubagentHookHandler(
      logger,
      makeRegistry(null),
      new SubagentStopCallbackRegistry(logger),
      owner,
    );
    const start = getStartCallback(handler, '/workspace', TAB);

    await start(startInput({ agent_id: 'a1' }), 'tu-a1', signal);

    expect(owner.snapshot(PARENT)?.agentSessionCount).toBe(1);
    expect(owner.snapshot(TAB)?.agentSessionCount).toBe(0);
  });
});
