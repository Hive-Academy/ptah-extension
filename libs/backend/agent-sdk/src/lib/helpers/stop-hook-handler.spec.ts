import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { StopCallbackRegistry } from './stop-callback-registry';
import { StopHookHandler } from './stop-hook-handler';
import { SdkAdapterEvents } from './sdk-adapter-events.service';

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

  describe('SdkAdapterEvents bus emit (additive)', () => {
    it('emits turnEnded on the bus AFTER calling callbackRegistry.notifyAll', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const callOrder: string[] = [];
      registry.register(() => {
        callOrder.push('registry');
      });
      const notifySpy = jest.spyOn(registry, 'notifyAll').mockImplementation(((
        payload: unknown,
      ) => {
        callOrder.push('registry');
        return payload;
      }) as unknown as typeof registry.notifyAll);
      jest.spyOn(registry, 'size', 'get').mockReturnValue(1);
      const busListener = jest.fn(() => {
        callOrder.push('bus');
      });
      events.onTurnEnded(busListener);

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, 'sess-1', '/workspace');

      const input = {
        hook_event_name: 'Stop',
        last_assistant_message: 'done',
        background_tasks: [
          { id: 'bg-1', type: 'shell', status: 'running', description: 'd' },
        ],
        session_crons: [
          { id: 'cron-1', schedule: '* * * * *', recurring: true, prompt: 'p' },
        ],
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(notifySpy).toHaveBeenCalledTimes(1);
      expect(busListener).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['registry', 'bus']);
      expect(busListener).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          cwd: '/workspace',
          lastAssistantMessage: 'done',
          backgroundTasks: expect.arrayContaining([
            expect.objectContaining({ id: 'bg-1' }),
          ]),
          sessionCrons: expect.arrayContaining([
            expect.objectContaining({ id: 'cron-1' }),
          ]),
          terminalReason: null,
        }),
      );
    });

    it('emits turnEnded with empty arrays when SDK omits background_tasks and session_crons', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const busListener = jest.fn();
      events.onTurnEnded(busListener);

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, 'sess-1', '/workspace');

      const input = {
        hook_event_name: 'Stop',
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(busListener).toHaveBeenCalledTimes(1);
      expect(busListener).toHaveBeenCalledWith(
        expect.objectContaining({
          backgroundTasks: [],
          sessionCrons: [],
          lastAssistantMessage: null,
        }),
      );
    });

    it('propagates terminal_reason when SDK provides one (forward-compat)', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const busListener = jest.fn();
      events.onTurnEnded(busListener);

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, 'sess-1', '/workspace');

      const input = {
        hook_event_name: 'Stop',
        terminal_reason: 'aborted_streaming',
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(busListener).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalReason: 'aborted_streaming',
        }),
      );
    });

    it('skips bus emit when resolved sessionId is empty (closure empty + input absent)', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const busListener = jest.fn();
      events.onTurnEnded(busListener);
      const notifySpy = jest.spyOn(registry, 'notifyAll');
      jest.spyOn(registry, 'size', 'get').mockReturnValue(1);

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, '', '/workspace');

      const input = {
        hook_event_name: 'Stop',
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(notifySpy).toHaveBeenCalledTimes(1);
      expect(busListener).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[StopHookHandler] Stop missing sessionId or cwd, skipping bus emit',
        expect.objectContaining({
          hasSessionId: false,
          hasCwd: true,
        }),
      );
    });

    it('skips bus emit when resolved cwd is empty', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const busListener = jest.fn();
      events.onTurnEnded(busListener);

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, 'sess-1', '');

      const input = {
        hook_event_name: 'Stop',
      } as unknown as HookInput;

      await fn(input, undefined, { signal: new AbortController().signal });

      expect(busListener).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[StopHookHandler] Stop missing sessionId or cwd, skipping bus emit',
        expect.objectContaining({
          hasSessionId: true,
          hasCwd: false,
        }),
      );
    });

    it('back-to-back Stop emits deliver distinct payloads on the bus', async () => {
      const logger = makeLogger();
      const registry = new StopCallbackRegistry(logger);
      const events = new SdkAdapterEvents(logger);
      const captured: Array<{
        backgroundTasks: ReadonlyArray<{ id: string }>;
      }> = [];
      events.onTurnEnded((event) => {
        captured.push({
          backgroundTasks: event.backgroundTasks as ReadonlyArray<{
            id: string;
          }>,
        });
      });

      const handler = new StopHookHandler(logger, registry, events);
      const fn = getHookCallback(handler, 'sess-1', '/workspace');

      const first = {
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'bg-1' }],
      } as unknown as HookInput;
      const second = {
        hook_event_name: 'Stop',
        background_tasks: [{ id: 'bg-2' }],
      } as unknown as HookInput;

      await fn(first, undefined, { signal: new AbortController().signal });
      await fn(second, undefined, { signal: new AbortController().signal });

      expect(captured).toHaveLength(2);
      expect(captured[0].backgroundTasks[0].id).toBe('bg-1');
      expect(captured[1].backgroundTasks[0].id).toBe('bg-2');
      expect(captured[0].backgroundTasks).not.toBe(captured[1].backgroundTasks);
    });

    it('no-op when sdkAdapterEvents not injected (back-compat for tests)', async () => {
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
      } as unknown as HookInput;

      const result = await fn(input, undefined, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({ continue: true });
      expect(captured).toHaveLength(1);
    });
  });
});
