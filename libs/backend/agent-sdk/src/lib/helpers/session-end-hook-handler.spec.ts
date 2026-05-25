import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { SessionEndHookCallbackRegistry } from './session-end-hook-callback-registry';
import { SessionEndHookHandler } from './session-end-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: SessionEndHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.SessionEnd;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('SessionEndHookHandler', () => {
  it('happy path: maps reason and resolves workspaceRoot from cwd', async () => {
    const logger = makeLogger();
    const registry = new SessionEndHookCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SessionEndHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionEnd',
      reason: 'clear',
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
        reason: 'clear',
      }),
    );
  });

  it('wrong hook_event_name early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new SessionEndHookCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new SessionEndHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionStart',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('zero subscribers short-circuits without calling notifyAll', async () => {
    const logger = makeLogger();
    const registry = new SessionEndHookCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new SessionEndHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionEnd',
      reason: 'logout',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('prefers input.session_id over closure sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new SessionEndHookCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new SessionEndHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'SessionEnd',
      session_id: 'sdk-sess-real',
      reason: 'clear',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('registry-throw is swallowed and logged; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new SessionEndHookCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new SessionEndHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionEnd',
      reason: 'clear',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[SessionEndHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });
});
