import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookEvent, HookInput } from '../types/sdk-types/claude-sdk.types';
import { TeammateLifecycleHookHandler } from './teammate-lifecycle-hook-handler';
import { SdkAdapterEvents } from './sdk-adapter-events.service';

/**
 * Synthetic hook-input builders below are shaped to match the REAL SDK
 * types exactly (cross-checked against
 * node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts):
 *
 *   BaseHookInput = { session_id, transcript_path, cwd, permission_mode?,
 *                      agent_id?, agent_type?, effort? }
 *   TaskCreatedHookInput   = BaseHookInput & { hook_event_name: 'TaskCreated';
 *                              task_id: string; task_subject: string;
 *                              teammate_name?: string; team_name?: string; }
 *   TaskCompletedHookInput = BaseHookInput & { hook_event_name: 'TaskCompleted';
 *                              task_id: string; task_subject: string;
 *                              teammate_name?: string; team_name?: string; }
 *   TeammateIdleHookInput  = BaseHookInput & { hook_event_name: 'TeammateIdle';
 *                              teammate_name: string; team_name: string; }
 *
 * Note TeammateIdle's teammate_name/team_name are REQUIRED at the type
 * level (unlike TaskCreated/TaskCompleted, where they are optional) — see
 * the "type-guard does not enforce required fields" test below for what
 * that means at runtime.
 */

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

type HookFn = (
  input: HookInput,
  toolUseId: string | undefined,
  options: { signal: AbortSignal },
) => Promise<{ continue: true }>;

function getHookCallback(
  handler: TeammateLifecycleHookHandler,
  event: HookEvent,
  sessionId: string,
  cwd: string,
): HookFn {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks[event];
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as HookFn;
}

function invoke(fn: HookFn, input: HookInput) {
  return fn(input, undefined, { signal: new AbortController().signal });
}

function baseHookInput(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'sdk-sess-real',
    transcript_path: '/transcripts/t.jsonl',
    cwd: '/workspace',
    ...overrides,
  };
}

describe('TeammateLifecycleHookHandler.createHooks — wiring proof', () => {
  it('returns matchers for all three teammate lifecycle events (TaskCreated, TaskCompleted, TeammateIdle)', () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);

    const hooks = handler.createHooks('sess-1', '/workspace');

    expect(Object.keys(hooks).sort()).toEqual(
      ['TaskCompleted', 'TaskCreated', 'TeammateIdle'].sort(),
    );
    for (const event of [
      'TaskCreated',
      'TaskCompleted',
      'TeammateIdle',
    ] as const) {
      expect(hooks[event]).toHaveLength(1);
      expect(hooks[event]?.[0]?.hooks).toHaveLength(1);
      expect(typeof hooks[event]?.[0]?.hooks?.[0]).toBe('function');
    }
  });
});

describe('TeammateLifecycleHookHandler — TaskCreated', () => {
  it('happy path: logs at info with taskId/taskSubject/teammateName/teamName and returns {continue:true}', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TaskCreated', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TaskCreated',
      task_id: 'task-abc',
      task_subject: 'Implement teammate hooks',
      teammate_name: 'backend-developer',
      team_name: 'default',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] >>> TaskCreated HOOK INVOKED <<<',
      expect.objectContaining({
        sessionId: 'sess-1',
        taskId: 'task-abc',
        taskSubject: 'Implement teammate hooks',
        teammateName: 'backend-developer',
        teamName: 'default',
      }),
    );
  });

  it('logs undefined teammateName/teamName when the SDK omits the optional fields', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TaskCreated', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TaskCreated',
      task_id: 'task-anon',
      task_subject: 'Anonymous task',
    }) as unknown as HookInput;

    await invoke(fn, input);

    expect(logger.info).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] >>> TaskCreated HOOK INVOKED <<<',
      expect.objectContaining({
        taskId: 'task-anon',
        teammateName: undefined,
        teamName: undefined,
      }),
    );
  });

  it('wrong hook_event_name early-returns without logging', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TaskCreated', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'Stop',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('never throws — logger.info throwing is swallowed and warn is logged', async () => {
    const logger = makeLogger();
    logger.info.mockImplementation(() => {
      throw new Error('logger boom');
    });
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TaskCreated', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TaskCreated',
      task_id: 'task-x',
      task_subject: 'subject',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] TaskCreated hook threw, swallowing',
      expect.objectContaining({ error: 'logger boom' }),
    );
  });
});

describe('TeammateLifecycleHookHandler — TaskCompleted', () => {
  it('happy path: logs at info with taskId/taskSubject/teammateName/teamName and returns {continue:true}', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TaskCompleted',
      'sess-1',
      '/workspace',
    );

    const input = baseHookInput({
      hook_event_name: 'TaskCompleted',
      task_id: 'task-abc',
      task_subject: 'Implement teammate hooks',
      teammate_name: 'backend-developer',
      team_name: 'default',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] >>> TaskCompleted HOOK INVOKED <<<',
      expect.objectContaining({
        sessionId: 'sess-1',
        taskId: 'task-abc',
        taskSubject: 'Implement teammate hooks',
        teammateName: 'backend-developer',
        teamName: 'default',
      }),
    );
  });

  it('wrong hook_event_name early-returns without logging', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TaskCompleted',
      'sess-1',
      '/workspace',
    );

    const input = baseHookInput({
      hook_event_name: 'TaskCreated',
      task_id: 'task-abc',
      task_subject: 'subject',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('never throws — logger.info throwing is swallowed and warn is logged', async () => {
    const logger = makeLogger();
    logger.info.mockImplementation(() => {
      throw new Error('logger boom');
    });
    const events = new SdkAdapterEvents(logger);
    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TaskCompleted',
      'sess-1',
      '/workspace',
    );

    const input = baseHookInput({
      hook_event_name: 'TaskCompleted',
      task_id: 'task-x',
      task_subject: 'subject',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] TaskCompleted hook threw, swallowing',
      expect.objectContaining({ error: 'logger boom' }),
    );
  });
});

describe('TeammateLifecycleHookHandler — TeammateIdle', () => {
  it('happy path: emits SdkAdapterTeammateIdleEvent onto SdkAdapterEvents and a subscriber receives it', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{
      sessionId: string;
      cwd: string;
      teammateName: string;
      timestamp: number;
    }> = [];
    events.onTeammateIdle((event) => captured.push(event));

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TeammateIdle',
      'closure-sess',
      '/workspace',
    );

    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      session_id: 'sdk-sess-real',
      teammate_name: 'reviewer',
      team_name: 'default',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sdk-sess-real',
        cwd: '/workspace',
        teammateName: 'reviewer',
      }),
    );
    expect(typeof captured[0].timestamp).toBe('number');

    expect(logger.info).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] >>> TeammateIdle HOOK INVOKED <<<',
      expect.objectContaining({
        sessionId: 'closure-sess',
        teammateName: 'reviewer',
        teamName: 'default',
      }),
    );
  });

  it('falls back to the constructor/closure sessionId when input.session_id is empty', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ sessionId: string }> = [];
    events.onTeammateIdle((event) =>
      captured.push({ sessionId: event.sessionId }),
    );

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TeammateIdle',
      'closure-sess',
      '/workspace',
    );

    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      session_id: '',
      teammate_name: 'reviewer',
      team_name: 'default',
    }) as unknown as HookInput;

    await invoke(fn, input);

    expect(captured).toEqual([{ sessionId: 'closure-sess' }]);
  });

  it('falls back to the constructor/closure sessionId when input.session_id is absent', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ sessionId: string }> = [];
    events.onTeammateIdle((event) =>
      captured.push({ sessionId: event.sessionId }),
    );

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(
      handler,
      'TeammateIdle',
      'closure-sess',
      '/workspace',
    );

    const input = {
      transcript_path: '/transcripts/t.jsonl',
      cwd: '/workspace',
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer',
      team_name: 'default',
    } as unknown as HookInput;

    await invoke(fn, input);

    expect(captured).toEqual([{ sessionId: 'closure-sess' }]);
  });

  it('skips emit (but still logs) when sdkAdapterEvents is not injected', async () => {
    const logger = makeLogger();
    const handler = new TeammateLifecycleHookHandler(logger);
    const fn = getHookCallback(handler, 'TeammateIdle', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer',
      team_name: 'default',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] >>> TeammateIdle HOOK INVOKED <<<',
      expect.objectContaining({ teammateName: 'reviewer' }),
    );
  });

  it('skips emit when the closure cwd is empty, even with a resolvable sessionId', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onTeammateIdle(busListener);

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TeammateIdle', 'sess-1', '');

    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      session_id: 'sdk-sess-real',
      teammate_name: 'reviewer',
      team_name: 'default',
    }) as unknown as HookInput;

    await invoke(fn, input);

    expect(busListener).not.toHaveBeenCalled();
  });

  it('wrong hook_event_name early-returns without logging or emitting', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onTeammateIdle(busListener);

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TeammateIdle', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TaskCreated',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.info).not.toHaveBeenCalled();
    expect(busListener).not.toHaveBeenCalled();
  });

  it('never throws when emitTeammateIdle itself throws (handler-level catch)', async () => {
    const logger = makeLogger();
    const throwingEvents = {
      emitTeammateIdle: jest.fn(() => {
        throw new Error('emit boom');
      }),
    } as unknown as SdkAdapterEvents;

    const handler = new TeammateLifecycleHookHandler(logger, throwingEvents);
    const fn = getHookCallback(handler, 'TeammateIdle', 'sess-1', '/workspace');

    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      teammate_name: 'reviewer',
      team_name: 'default',
    }) as unknown as HookInput;

    const result = await invoke(fn, input);

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[TeammateLifecycleHookHandler] TeammateIdle hook threw, swallowing',
      expect.objectContaining({ error: 'emit boom' }),
    );
  });

  // The SDK types (sdk.d.ts) declare TeammateIdleHookInput.teammate_name and
  // .team_name as REQUIRED (no `?`), unlike TaskCreated/TaskCompleted where
  // they are optional. Ptah's isTeammateIdleHook() guard, however, narrows
  // purely on hook_event_name — same pattern as every other guard in
  // claude-sdk.types.ts. This is consistent codebase convention (the guard
  // is a discriminant check, not a full runtime shape validator), but it
  // means a spec-violating payload from the SDK (or a bug upstream) would
  // pass Ptah's guard and flow teammateName: undefined into the emitted
  // event instead of being rejected. Documented here, not asserted as a bug
  // to fix — flagged in the final report.
  it('guard does not enforce the required teammate_name field — passes through as undefined', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ teammateName: string }> = [];
    events.onTeammateIdle((event) =>
      captured.push({ teammateName: event.teammateName }),
    );

    const handler = new TeammateLifecycleHookHandler(logger, events);
    const fn = getHookCallback(handler, 'TeammateIdle', 'sess-1', '/workspace');

    // teammate_name deliberately omitted despite being a required field on
    // TeammateIdleHookInput per the SDK's own .d.ts.
    const input = baseHookInput({
      hook_event_name: 'TeammateIdle',
      team_name: 'default',
    }) as unknown as HookInput;

    await invoke(fn, input);

    expect(captured).toEqual([{ teammateName: undefined }]);
  });
});
