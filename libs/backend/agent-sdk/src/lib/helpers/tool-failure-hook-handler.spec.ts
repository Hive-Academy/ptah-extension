import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { ToolFailureCallbackRegistry } from './tool-failure-callback-registry';
import { ToolFailureHookHandler } from './tool-failure-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: ToolFailureHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.PostToolUseFailure;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('ToolFailureHookHandler', () => {
  it('happy path: maps tool_name, error, and is_interrupt', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      error: 'tests failed',
      is_interrupt: true,
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        toolName: 'Bash',
        toolInput: { command: 'npm test' },
        error: 'tests failed',
        isInterrupt: true,
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('defaults isInterrupt to false when is_interrupt is absent', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    const captured: Array<{ isInterrupt: boolean }> = [];
    registry.register((payload) => {
      captured.push({ isInterrupt: payload.isInterrupt });
    });
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Edit',
      tool_input: {},
      error: 'boom',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ isInterrupt: false }]);
  });

  it('wrong hook_event_name early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('zero subscribers short-circuits without calling notifyAll', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: {},
      error: 'boom',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('prefers input.session_id over closure sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'PostToolUseFailure',
      session_id: 'sdk-sess-real',
      tool_name: 'Bash',
      tool_input: {},
      error: 'boom',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('registry-throw is swallowed and logged; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new ToolFailureCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new ToolFailureHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: {},
      error: 'boom',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[ToolFailureHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });
});
