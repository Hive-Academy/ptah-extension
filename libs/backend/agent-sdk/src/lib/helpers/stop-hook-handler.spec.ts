import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { StopCallbackRegistry } from './stop-callback-registry';
import { StopHookHandler } from './stop-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: StopHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.Stop;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('StopHookHandler', () => {
  it('happy path: maps last_assistant_message, effort.level, and background_tasks', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
      last_assistant_message: 'all done',
      effort: { level: 'high' },
      background_tasks: [{ id: 'bg-1' }],
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
        lastAssistantMessage: 'all done',
        effortLevel: 'high',
        hasBackgroundWork: true,
      }),
    );
  });

  it('defaults: null message, null effort, no background work when fields absent', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const captured: Array<{
      lastAssistantMessage: string | null;
      effortLevel: string | null;
      hasBackgroundWork: boolean;
    }> = [];
    registry.register((payload) => {
      captured.push({
        lastAssistantMessage: payload.lastAssistantMessage,
        effortLevel: payload.effortLevel,
        hasBackgroundWork: payload.hasBackgroundWork,
      });
    });
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      {
        lastAssistantMessage: null,
        effortLevel: null,
        hasBackgroundWork: false,
      },
    ]);
  });

  it('empty background_tasks array maps to hasBackgroundWork=false', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const captured: Array<{ hasBackgroundWork: boolean }> = [];
    registry.register((payload) => {
      captured.push({ hasBackgroundWork: payload.hasBackgroundWork });
    });
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
      background_tasks: [],
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ hasBackgroundWork: false }]);
  });

  it('wrong hook_event_name early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SubagentStop',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('zero subscribers short-circuits without calling notifyAll', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
      last_assistant_message: 'x',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('prefers input.session_id over the closure sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'Stop',
      session_id: 'sdk-sess-real',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('registry-throw is swallowed and logged; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new StopCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new StopHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[StopHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });
});
