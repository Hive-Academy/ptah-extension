import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { SubagentStopHookHandler } from './subagent-stop-hook-handler';
import { SdkAdapterEvents } from './sdk-adapter-events.service';
import { SessionTurnStateRegistry } from './session-turn-state.registry';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: SubagentStopHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.SubagentStop;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('SubagentStopHookHandler', () => {
  it('happy path: forwards SDK fields onto SdkAdapterSubagentEndedEvent', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<unknown> = [];
    events.onSubagentEnded((event) => {
      captured.push(event);
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
      agent_transcript_path: '/transcripts/agent-abc.jsonl',
      last_assistant_message: 'final',
      background_tasks: [
        { id: 'bg-1', type: 'shell', status: 'running', description: 'd' },
      ],
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-1',
        cwd: '/workspace',
        agentId: 'agent-abc',
        agentType: 'subagent',
        lastAssistantMessage: 'final',
        backgroundTasks: expect.arrayContaining([
          expect.objectContaining({ id: 'bg-1' }),
        ]),
      }),
    );
  });

  it('null fallback: lastAssistantMessage defaults to null when SDK omits', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ lastAssistantMessage: string | null }> = [];
    events.onSubagentEnded((event) => {
      captured.push({ lastAssistantMessage: event.lastAssistantMessage });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ lastAssistantMessage: null }]);
  });

  it('empty default fallback: background_tasks defaults to empty array when SDK omits', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{
      backgroundTasks: readonly { id: string }[];
    }> = [];
    events.onSubagentEnded((event) => {
      captured.push({
        backgroundTasks: event.backgroundTasks as readonly { id: string }[],
      });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ backgroundTasks: [] }]);
  });

  it('wrong hook_event_name early-returns without emitting', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onSubagentEnded(busListener);
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(busListener).not.toHaveBeenCalled();
  });

  it('skips bus emit when resolved sessionId is empty', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onSubagentEnded(busListener);
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, '', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(busListener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubagentStopHookHandler] SubagentStop missing sessionId or cwd, skipping bus emit',
      expect.objectContaining({
        hasSessionId: false,
        hasCwd: true,
        agentId: 'agent-abc',
        agentType: 'subagent',
      }),
    );
  });

  it('skips bus emit when resolved cwd is empty', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onSubagentEnded(busListener);
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-xyz',
      agent_type: 'shell',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(busListener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[SubagentStopHookHandler] SubagentStop missing sessionId or cwd, skipping bus emit',
      expect.objectContaining({
        hasSessionId: true,
        hasCwd: false,
        agentId: 'agent-xyz',
        agentType: 'shell',
      }),
    );
  });

  it('prefers input.session_id over the closure sessionId when present', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ sessionId: string }> = [];
    events.onSubagentEnded((event) => {
      captured.push({ sessionId: event.sessionId });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      session_id: 'sdk-sess-real',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('propagates agent_id verbatim onto the bus event (BackgroundAgentStore join key)', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ agentId: string }> = [];
    events.onSubagentEnded((event) => {
      captured.push({ agentId: event.agentId });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'a1b2c3d4',
      agent_type: 'subagent',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ agentId: 'a1b2c3d4' }]);
  });

  it('representative agent_type literals roundtrip through emit', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ agentType: string }> = [];
    events.onSubagentEnded((event) => {
      captured.push({ agentType: event.agentType });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const variants = ['subagent', 'shell', 'workflow', 'monitor'];
    for (const agentType of variants) {
      const input = {
        hook_event_name: 'SubagentStop',
        agent_id: `agent-${agentType}`,
        agent_type: agentType,
      } as unknown as HookInput;
      await fn(input, undefined, { signal: new AbortController().signal });
    }

    expect(captured.map((c) => c.agentType)).toEqual(variants);
  });

  it('listener throw inside emitSubagentEnded does not propagate (safeEmit)', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    events.onSubagentEnded(() => {
      throw new Error('listener boom');
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
  });

  it('back-to-back SubagentStop emits deliver distinct payloads on the bus', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ agentId: string; agentType: string }> = [];
    events.onSubagentEnded((event) => {
      captured.push({ agentId: event.agentId, agentType: event.agentType });
    });
    const handler = new SubagentStopHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const first = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-1',
      agent_type: 'subagent',
    } as unknown as HookInput;
    const second = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-2',
      agent_type: 'shell',
    } as unknown as HookInput;

    await fn(first, undefined, { signal: new AbortController().signal });
    await fn(second, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      { agentId: 'agent-1', agentType: 'subagent' },
      { agentId: 'agent-2', agentType: 'shell' },
    ]);
  });

  it('no-op when sdkAdapterEvents not injected (back-compat for tests)', async () => {
    const logger = makeLogger();
    const handler = new SubagentStopHookHandler(logger);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-abc',
      agent_type: 'subagent',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
  });
});

describe('SubagentStopHookHandler - SessionTurnStateRegistry snapshot (TASK_2026_360)', () => {
  const T1 = {
    id: 't1',
    type: 'subagent',
    status: 'running',
    description: 'a',
  };
  const T2 = {
    id: 't2',
    type: 'subagent',
    status: 'running',
    description: 'b',
  };

  function settledAwaiting(turnState: SessionTurnStateRegistry): void {
    turnState.markGenerating('sess-1');
    turnState.recordStop('sess-1', {
      backgroundTasks: [T1, T2],
      sessionCrons: [],
      terminalReason: 'completed',
    });
    turnState.settleTurn('sess-1');
  }

  async function fire(
    handler: SubagentStopHookHandler,
    backgroundTasks: unknown[],
  ): Promise<void> {
    const fn = getHookCallback(handler, 'sess-1', '/workspace');
    await fn(
      {
        hook_event_name: 'SubagentStop',
        session_id: 'sess-1',
        cwd: '/workspace',
        agent_id: 'agent-abc',
        agent_type: 'subagent',
        background_tasks: backgroundTasks,
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
  }

  it('replaces the remaining background tasks while awaiting-background', async () => {
    const logger = makeLogger();
    const turnState = new SessionTurnStateRegistry();
    settledAwaiting(turnState);
    const handler = new SubagentStopHookHandler(logger, undefined, turnState);

    await fire(handler, [T2]);
    expect(turnState.get('sess-1')).toMatchObject({
      phase: 'awaiting-background',
      backgroundTasks: [T2],
    });

    await fire(handler, []);
    expect(turnState.get('sess-1')?.phase).toBe('idle');
  });

  it('never touches a generating turn (a foreground subagent finishing mid-turn)', async () => {
    const logger = makeLogger();
    const turnState = new SessionTurnStateRegistry();
    const generating = turnState.markGenerating('sess-1');
    const handler = new SubagentStopHookHandler(logger, undefined, turnState);

    await fire(handler, []);

    expect(turnState.get('sess-1')).toBe(generating);
  });
});
