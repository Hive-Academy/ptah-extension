import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type { SubagentRecord } from '@ptah-extension/shared';
import { SubagentHookHandler } from './subagent-hook-handler';
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
        sessionId: 'parent-sess-1',
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
    const fn = getStartCallback(handler, '/workspace', '');

    const result = await fn(startInput(), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tu-1',
        sessionId: 'payload-parent-sess',
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
    const fn = getStartCallback(handler, '/workspace', undefined);

    await fn(startInput(), 'tu-1', { signal: new AbortController().signal });

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'payload-parent-sess',
        sessionId: 'payload-parent-sess',
      }),
    );
  });

  it('never stores an empty parentSessionId: an empty payload id falls back to the closure', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
    const fn = getStartCallback(handler, '/workspace', 'closure-parent-sess');

    await fn(startInput({ session_id: '' }), 'tu-1', {
      signal: new AbortController().signal,
    });

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: 'closure-parent-sess',
        sessionId: 'closure-parent-sess',
      }),
    );
  });

  it('drops the registration and WARNS (not debug) when neither source has a parent id', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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

  it('drops the registration and names the missing toolUseId when it is absent', async () => {
    const logger = makeLogger();
    const registry = makeRegistry(null);
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
    const fn = getStartCallback(handler, '/workspace', 'closure-parent-sess');

    await fn(startInput(), undefined, {
      signal: new AbortController().signal,
    });

    expect(registry.register).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Subagent NOT registered'),
      expect.objectContaining({ reason: expect.stringContaining('toolUseId') }),
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

  it('falls back to the closure id when the payload session_id is empty', async () => {
    const logger = makeLogger();
    const registry = makeRegistry({ toolCallId: 'tu-1' });
    const stopRegistry = new SubagentStopCallbackRegistry(logger);
    const captured: SubagentStopPayload[] = [];
    stopRegistry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
    const handler = new SubagentHookHandler(logger, registry, stopRegistry);
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
