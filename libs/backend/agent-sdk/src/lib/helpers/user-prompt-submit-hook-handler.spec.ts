import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { POINTER_BUDGET_MS } from './compaction/subagent-handoff-index';
import { UserPromptSubmitCallbackRegistry } from './user-prompt-submit-callback-registry';
import {
  POINTER_TIMEOUT_MS,
  UserPromptSubmitHookHandler,
} from './user-prompt-submit-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: UserPromptSubmitHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.UserPromptSubmit;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
}

const SIGNAL = { signal: new AbortController().signal };
const POINTER = 'Ptah: subagent handoff records are pending.';

function promptInput(extra: Record<string, unknown> = {}): HookInput {
  return {
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sdk-sess',
    cwd: '/hook-cwd',
    prompt: 'go on',
    ...extra,
  } as unknown as HookInput;
}

describe('UserPromptSubmitHookHandler', () => {
  it('happy path: validated UserPromptSubmit input → registry.notifyAll with mapped payload', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello world',
      session_title: 'untitled',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        prompt: 'hello world',
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('ill-typed (non-UserPromptSubmit) input early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new UserPromptSubmitHookHandler(logger, registry);
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

  it('registry-throw is swallowed and logger.warn is called; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation((payload) => {
      // A callback that echoes its input into the error message.
      throw Object.assign(new TypeError(`bad prompt: ${payload.prompt}`), {
        code: 'E_CALLBACK',
      });
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'PROMPT-SECRET text',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
      { errorType: 'TypeError', sessionId: 'sess-1' },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
      'PROMPT-SECRET',
    );
  });

  it.each([
    ['in the name and the code', 'PROMPT-SECRET text'],
    ['as a code-shaped code', 'PROMPT_SECRET'],
  ])(
    'never logs a callback error that carries the prompt %s',
    async (_case, prompt) => {
      const logger = makeLogger();
      const registry = new UserPromptSubmitCallbackRegistry(logger);
      jest.spyOn(registry, 'notifyAll').mockImplementation((payload) => {
        throw Object.assign(new Error('x'), {
          name: payload.prompt,
          code: payload.prompt,
        });
      });
      jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
      const handler = new UserPromptSubmitHookHandler(logger, registry);
      const fn = getHookCallback(handler, 'sess-1', '/workspace');

      const input = {
        hook_event_name: 'UserPromptSubmit',
        prompt,
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(logger.warn).toHaveBeenCalledWith(
        '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
        { errorType: 'Error', sessionId: 'sess-1' },
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
        'PROMPT',
      );
    },
  );

  it('returns continue:true when the thrown value has throwing getters', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      const hostile = new Error('x');
      for (const key of ['name', 'code', 'message']) {
        Object.defineProperty(hostile, key, {
          get() {
            throw new Error('getter');
          },
        });
      }
      throw hostile;
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'p',
    } as unknown as HookInput;

    await expect(
      fn(input, undefined, { signal: new AbortController().signal }),
    ).resolves.toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[UserPromptSubmitHookHandler] hook fan-out threw, swallowing',
      { errorType: 'Error', sessionId: 'sess-1' },
    );
  });

  it('keeps the index pointer budget below the hook bound, so its timeout line arrives', () => {
    expect(POINTER_BUDGET_MS).toBeLessThan(POINTER_TIMEOUT_MS);
  });

  it('prefers input.session_id over closure-captured sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sdk-sess-real',
      prompt: 'hello',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('falls back to closure sessionId when input.session_id is missing or empty', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const inputMissing = {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello',
    } as unknown as HookInput;
    await fn(inputMissing, undefined, {
      signal: new AbortController().signal,
    });

    const inputEmpty = {
      hook_event_name: 'UserPromptSubmit',
      session_id: '',
      prompt: 'world',
    } as unknown as HookInput;
    await fn(inputEmpty, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      { sessionId: 'closure-sess' },
      { sessionId: 'closure-sess' },
    ]);
  });

  it('skips fan-out when there are zero registered subscribers', async () => {
    const logger = makeLogger();
    const registry = new UserPromptSubmitCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new UserPromptSubmitHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'nobody listening',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  describe('pending-handoff pointer', () => {
    function pointerHandler(
      handoffPointer: jest.Mock,
      registry = new UserPromptSubmitCallbackRegistry(makeLogger()),
    ) {
      const logger = makeLogger();
      const handler = new UserPromptSubmitHookHandler(logger, registry, {
        handoffPointer,
      });
      return { fn: getHookCallback(handler, 'closure-sess', '/ws'), logger };
    }

    it('adds the pointer as additionalContext on a main-thread prompt, even with no fan-out subscribers', async () => {
      const handoffPointer = jest.fn().mockResolvedValue(POINTER);
      const { fn } = pointerHandler(handoffPointer);

      const result = await fn(promptInput(), undefined, SIGNAL);

      expect(handoffPointer).toHaveBeenCalledWith('sdk-sess', '/hook-cwd');
      expect(result).toEqual({
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: POINTER,
        },
      });
    });

    it('names nothing on a subagent prompt (agent_id set)', async () => {
      const handoffPointer = jest.fn().mockResolvedValue(POINTER);
      const { fn } = pointerHandler(handoffPointer);

      const result = await fn(
        promptInput({ agent_id: 'agent-7' }),
        undefined,
        SIGNAL,
      );

      expect(handoffPointer).not.toHaveBeenCalled();
      expect(result).toEqual({ continue: true });
    });

    it('returns continue:true without context when nothing is pending', async () => {
      const { fn } = pointerHandler(jest.fn().mockResolvedValue(undefined));
      expect(await fn(promptInput(), undefined, SIGNAL)).toEqual({
        continue: true,
      });
    });

    it('a pointer that throws is swallowed with one warn', async () => {
      const { fn, logger } = pointerHandler(
        jest.fn().mockRejectedValue(new TypeError('boom')),
      );

      expect(await fn(promptInput(), undefined, SIGNAL)).toEqual({
        continue: true,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        '[UserPromptSubmitHookHandler] Handoff pointer failed, skipping',
        { errorType: 'TypeError', sessionId: 'sdk-sess' },
      );
    });

    it('a pointer slower than the bound is dropped for this prompt', async () => {
      jest.useFakeTimers();
      try {
        const { fn } = pointerHandler(
          jest.fn(() => new Promise<string>(() => undefined)),
        );
        const pending = fn(promptInput(), undefined, SIGNAL);
        await jest.advanceTimersByTimeAsync(POINTER_TIMEOUT_MS);
        expect(await pending).toEqual({ continue: true });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps the fan-out unchanged next to the pointer', async () => {
      const registry = new UserPromptSubmitCallbackRegistry(makeLogger());
      const captured: string[] = [];
      registry.register((payload) => {
        captured.push(payload.sessionId);
      });
      const { fn } = pointerHandler(
        jest.fn().mockResolvedValue(POINTER),
        registry,
      );

      await fn(promptInput(), undefined, SIGNAL);

      expect(captured).toEqual(['sdk-sess']);
    });
  });
});
