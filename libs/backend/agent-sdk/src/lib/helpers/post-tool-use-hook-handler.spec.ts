import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { PostToolUseCallbackRegistry } from './post-tool-use-callback-registry';
import {
  POST_TOOL_USE_CAP_TIMEOUT_MS,
  PostToolUseHookHandler,
} from './post-tool-use-hook-handler';

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
      hook_event_name: 'SessionStart',
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

  describe('tool output capper', () => {
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { stdout: 'big output' },
      tool_use_id: 'tu-1',
    } as unknown as HookInput;
    const run = (cap: jest.Mock | undefined, logger: jest.Mocked<Logger>) => {
      const registry = new PostToolUseCallbackRegistry(logger);
      const handler = new PostToolUseHookHandler(
        logger,
        registry,
        cap ? ({ cap } as never) : undefined,
      );
      return getHookCallback(handler, 'sess-1', '/ws')(input, undefined, {
        signal: new AbortController().signal,
      }) as Promise<unknown>;
    };

    it('returns updatedToolOutput when the capper changed the response', async () => {
      const cap = jest.fn().mockResolvedValue({ stdout: 'capped' });
      const result = await run(cap, makeLogger());
      expect(cap).toHaveBeenCalledWith(
        'Bash',
        { command: 'ls' },
        { stdout: 'big output' },
        '/ws',
      );
      expect(result).toEqual({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          updatedToolOutput: { stdout: 'capped' },
        },
      });
    });

    it('omits hookSpecificOutput when the capper returns the same object', async () => {
      const cap = jest
        .fn()
        .mockImplementation(async (_n: string, _i: unknown, r: unknown) => r);
      expect(await run(cap, makeLogger())).toEqual({ continue: true });
    });

    it('a hook called without options never throws and is never treated as aborted', async () => {
      const logger = makeLogger();
      const cap = jest
        .fn()
        .mockImplementation(async (_n: string, _i: unknown, r: unknown) => r);
      const handler = new PostToolUseHookHandler(
        logger,
        new PostToolUseCallbackRegistry(logger),
        { cap } as never,
      );
      const hook = getHookCallback(handler, 'sess-1', '/ws') as unknown as (
        input: HookInput,
        toolUseId: string | undefined,
      ) => Promise<unknown>;
      expect(await hook(input, undefined)).toEqual({ continue: true });
      expect(cap).toHaveBeenCalledTimes(1);
    });

    it('fails open when the capper throws', async () => {
      const logger = makeLogger();
      const cap = jest.fn().mockRejectedValue(new Error('boom'));
      expect(await run(cap, logger)).toEqual({ continue: true });
      expect(logger.warn).toHaveBeenCalled();
    });

    // TASK_2026_614 D.12 A-m8: the cap is bounded in time and honours the
    // hook's abort signal, so a stalled outline never holds the tool result.
    describe('time bound and abort signal', () => {
      const callWith = (
        cap: jest.Mock,
        logger: jest.Mocked<Logger>,
        signal: AbortSignal,
      ) => {
        const registry = new PostToolUseCallbackRegistry(logger);
        const handler = new PostToolUseHookHandler(logger, registry, {
          cap,
        } as never);
        return getHookCallback(handler, 'sess-1', '/ws')(input, undefined, {
          signal,
        }) as Promise<unknown>;
      };

      afterEach(() => {
        jest.useRealTimers();
      });

      it('a capper that never resolves yields the original output after the bound, with one warn', async () => {
        jest.useFakeTimers();
        const logger = makeLogger();
        const cap = jest.fn(() => new Promise<unknown>(() => undefined));
        let settled: unknown = 'pending';
        const pending = callWith(
          cap,
          logger,
          new AbortController().signal,
        ).then((result) => {
          settled = result;
        });

        await jest.advanceTimersByTimeAsync(POST_TOOL_USE_CAP_TIMEOUT_MS - 1);
        expect(settled).toBe('pending');

        await jest.advanceTimersByTimeAsync(1);
        await pending;
        expect(settled).toEqual({ continue: true });
        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('exceeded its time bound'),
          { toolName: 'Bash', timeoutMs: POST_TOOL_USE_CAP_TIMEOUT_MS },
        );
        expect(jest.getTimerCount()).toBe(0);
      });

      it('an already aborted signal returns the original output at once without calling the capper', async () => {
        const logger = makeLogger();
        const cap = jest.fn().mockResolvedValue({ stdout: 'capped' });
        const controller = new AbortController();
        controller.abort();

        expect(await callWith(cap, logger, controller.signal)).toEqual({
          continue: true,
        });
        expect(cap).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledTimes(1);
      });

      it('an abort while the capper runs returns the original output at once and releases the listener', async () => {
        jest.useFakeTimers();
        const logger = makeLogger();
        const cap = jest.fn(() => new Promise<unknown>(() => undefined));
        const controller = new AbortController();
        const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');
        const pending = callWith(cap, logger, controller.signal);

        controller.abort();

        expect(await pending).toEqual({ continue: true });
        expect(cap).toHaveBeenCalledTimes(1);
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(jest.getTimerCount()).toBe(0);
        expect(logger.warn).not.toHaveBeenCalled();
      });

      it('a capper that finishes inside the bound clears its timer', async () => {
        jest.useFakeTimers();
        const cap = jest.fn().mockResolvedValue({ stdout: 'capped' });

        const result = await callWith(
          cap,
          makeLogger(),
          new AbortController().signal,
        );

        expect(result).toEqual({
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            updatedToolOutput: { stdout: 'capped' },
          },
        });
        expect(jest.getTimerCount()).toBe(0);
      });
    });
  });
});
