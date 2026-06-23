import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { SessionStartCallbackRegistry } from './session-start-callback-registry';
import { SessionStartHookHandler } from './session-start-hook-handler';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function getHookCallback(
  handler: SessionStartHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.SessionStart;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('SessionStartHookHandler', () => {
  it('happy path: validated SessionStart input → registry.notifyAll with mapped payload', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const captured: Array<unknown> = [];
    registry.register((payload) => {
      captured.push(payload);
    });
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionStart',
      source: 'startup',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        source: 'startup',
        sessionId: 'sess-1',
        workspaceRoot: '/workspace',
      }),
    );
  });

  it('preserves source values: resume / clear / compact', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const captured: Array<{ source: string }> = [];
    registry.register((payload) => {
      captured.push({ source: payload.source });
    });
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    for (const source of ['resume', 'clear', 'compact'] as const) {
      await fn(
        { hook_event_name: 'SessionStart', source } as unknown as HookInput,
        undefined,
        { signal: new AbortController().signal },
      );
    }

    expect(captured).toEqual([
      { source: 'resume' },
      { source: 'clear' },
      { source: 'compact' },
    ]);
  });

  it('ill-typed (non-SessionStart) input early-returns without invoking registry', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const cb = jest.fn();
    registry.register(cb);
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionEnd',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns { continue: true } when there are zero registered subscribers', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const notifySpy = jest.spyOn(registry, 'notifyAll');
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionStart',
      source: 'startup',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('registry-throw is swallowed via try/catch and logger.warn is called; returns continue:true', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    jest.spyOn(registry, 'notifyAll').mockImplementation(() => {
      throw new Error('fan-out failure');
    });
    jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'SessionStart',
      source: 'startup',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(logger.warn).toHaveBeenCalledWith(
      '[SessionStartHookHandler] hook fan-out threw, swallowing',
      expect.objectContaining({
        error: 'fan-out failure',
        sessionId: 'sess-1',
      }),
    );
  });

  it('prefers input.session_id over closure-captured sessionId when present', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'SessionStart',
      session_id: 'sdk-sess-real',
      source: 'startup',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('falls back to closure sessionId when input.session_id is missing or empty', async () => {
    const logger = makeLogger();
    const registry = new SessionStartCallbackRegistry(logger);
    const captured: Array<{ sessionId: string }> = [];
    registry.register((payload) => {
      captured.push({ sessionId: payload.sessionId });
    });
    const handler = new SessionStartHookHandler(logger, registry);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    await fn(
      {
        hook_event_name: 'SessionStart',
        source: 'startup',
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );
    await fn(
      {
        hook_event_name: 'SessionStart',
        session_id: '',
        source: 'startup',
      } as unknown as HookInput,
      undefined,
      { signal: new AbortController().signal },
    );

    expect(captured).toEqual([
      { sessionId: 'closure-sess' },
      { sessionId: 'closure-sess' },
    ]);
  });
});
