import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  HookInput,
  HookCallbackMatcher,
} from '../types/sdk-types/claude-sdk.types';
import { PreToolUseCallbackRegistry } from './pre-tool-use-callback-registry';
import { PreToolUseHookHandler } from './pre-tool-use-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getMatcher(
  handler: PreToolUseHookHandler,
  sessionId: string,
  cwd: string,
): HookCallbackMatcher {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.PreToolUse;
  expect(matchers).toBeDefined();
  const matcher = matchers?.[0];
  expect(matcher).toBeDefined();
  return matcher as HookCallbackMatcher;
}

function getHookCallback(
  handler: PreToolUseHookHandler,
  sessionId: string,
  cwd: string,
) {
  const matcher = getMatcher(handler, sessionId, cwd);
  const fn = matcher.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('PreToolUseHookHandler', () => {
  it('matcher is restricted to "Read" only', () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const handler = new PreToolUseHookHandler(logger, registry);
    const matcher = getMatcher(handler, 'sess-1', '/workspace');
    expect(matcher.matcher).toBe('Read');
  });

  it('happy path: Read tool fires registry.notifyAll with mapped payload', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/x/y.ts' },
      tool_use_id: 'tu-1',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        toolName: 'Read',
        toolInput: { file_path: '/x/y.ts' },
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('non-Read tool name early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'tu-2',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('ill-typed (non-PreToolUse) input early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: {},
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns { continue: true } when there are zero registered subscribers', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      tool_use_id: 'tu-3',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('registry-throw is swallowed via try/catch and logger.warn is called; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      tool_use_id: 'tu-4',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[PreToolUseHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });

  it('prefers input.session_id over closure-captured sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-sess-real',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      tool_use_id: 'tu-9',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('falls back to closure sessionId when input.session_id is missing or empty', async () => {
    const logger = makeLogger();
    const registry = new PreToolUseCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new PreToolUseHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const inputMissing = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      tool_use_id: 'tu-10',
    } as unknown as HookInput;
    await fn(inputMissing, undefined, {
      signal: new AbortController().signal,
    });

    const inputEmpty = {
      hook_event_name: 'PreToolUse',
      session_id: '',
      tool_name: 'Read',
      tool_input: { file_path: '/x' },
      tool_use_id: 'tu-11',
    } as unknown as HookInput;
    await fn(inputEmpty, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      { sessionId: 'closure-sess' },
      { sessionId: 'closure-sess' },
    ]);
  });
});
