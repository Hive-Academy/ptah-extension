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
