import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { PostToolUseCallbackRegistry } from './post-tool-use-callback-registry';
import { PostToolUseHookHandler } from './post-tool-use-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: PostToolUseHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.PostToolUse;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('PostToolUseHookHandler', () => {
  it('happy path: validated PostToolUse input → registry.notifyAll with mapped payload', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "x"' },
      tool_response: { exit_code: 0, stdout: 'ok' },
      tool_use_id: 'tu-1',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        toolName: 'Bash',
        exitCode: 0,
        success: true,
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('ill-typed (non-PostToolUse) input early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: {},
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('registry-throw is swallowed via try/catch and logger.warn is called; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      tool_response: null,
      tool_use_id: 'tu-2',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[PostToolUseHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });

  it('returns { continue: true } even when there are zero registered subscribers (early-exit branch)', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file: '/x' },
      tool_response: 'some content',
      tool_use_id: 'tu-3',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('derives exitCode=null and success=true when tool_response lacks exit_code and is_error', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const captured: Array<{ exitCode: number | null; success: boolean }> = [];
    registry.register((payload) => {
      captured.push({ exitCode: payload.exitCode, success: payload.success });
    });
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      tool_response: { ok: true },
      tool_use_id: 'tu-4',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ exitCode: null, success: true }]);
  });

  it('prefers input.session_id over closure-captured sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      session_id: 'sdk-sess-real',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { exit_code: 0 },
      tool_use_id: 'tu-9',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('falls back to closure sessionId when input.session_id is missing or empty', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const inputMissing = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { exit_code: 0 },
      tool_use_id: 'tu-10',
    } as unknown as HookInput;
    await fn(inputMissing, undefined, {
      signal: new AbortController().signal,
    });

    const inputEmpty = {
      hook_event_name: 'PostToolUse',
      session_id: '',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { exit_code: 0 },
      tool_use_id: 'tu-11',
    } as unknown as HookInput;
    await fn(inputEmpty, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      { sessionId: 'closure-sess' },
      { sessionId: 'closure-sess' },
    ]);
  });

  it('derives success=false when tool_response.is_error is true', async () => {
    const logger = makeLogger();
    const registry = new PostToolUseCallbackRegistry(logger);
    const captured: Array<{ exitCode: number | null; success: boolean }> = [];
    registry.register((payload) => {
      captured.push({ exitCode: payload.exitCode, success: payload.success });
    });
    const handler = new PostToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: {},
      tool_response: { is_error: true, message: 'failed' },
      tool_use_id: 'tu-5',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ exitCode: null, success: false }]);
  });
});
