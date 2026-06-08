import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { HookInput } from '../types/sdk-types/claude-sdk.types';
import { StopFailureHookHandler } from './stop-failure-hook-handler';
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
  handler: StopFailureHookHandler,
  sessionId: string,
  cwd: string,
) {
  const hooks = handler.createHooks(sessionId, cwd);
  const matchers = hooks.StopFailure;
  expect(matchers).toBeDefined();
  const fn = matchers?.[0]?.hooks?.[0];
  expect(typeof fn).toBe('function');
  return fn as (
    input: HookInput,
    toolUseId: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<{ continue: true }>;
}

describe('StopFailureHookHandler', () => {
  it('happy path: forwards SDK fields onto SdkAdapterTurnFailedEvent', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<unknown> = [];
    events.onTurnFailed((event) => {
      captured.push(event);
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: 'too many tokens',
      last_assistant_message: 'partial',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      expect.objectContaining({
        sessionId: 'sess-1',
        cwd: '/workspace',
        lastAssistantMessage: 'partial',
        error: 'rate_limit',
        errorDetails: 'too many tokens',
        terminalReason: null,
      }),
    );
  });

  it('null fallbacks: lastAssistantMessage and errorDetails default to null when SDK omits', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{
      lastAssistantMessage: string | null;
      errorDetails: string | null;
    }> = [];
    events.onTurnFailed((event) => {
      captured.push({
        lastAssistantMessage: event.lastAssistantMessage,
        errorDetails: event.errorDetails,
      });
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'server_error',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      {
        lastAssistantMessage: null,
        errorDetails: null,
      },
    ]);
  });

  it('wrong hook_event_name early-returns without emitting', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onTurnFailed(busListener);
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'Stop',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
    expect(busListener).not.toHaveBeenCalled();
  });

  it('skips bus emit when resolved sessionId is empty', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onTurnFailed(busListener);
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, '', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'unknown',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(busListener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[StopFailureHookHandler] StopFailure missing sessionId or cwd, skipping bus emit',
      expect.objectContaining({
        hasSessionId: false,
        hasCwd: true,
        errorCode: 'unknown',
      }),
    );
  });

  it('skips bus emit when resolved cwd is empty', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const busListener = jest.fn();
    events.onTurnFailed(busListener);
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(busListener).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[StopFailureHookHandler] StopFailure missing sessionId or cwd, skipping bus emit',
      expect.objectContaining({
        hasSessionId: true,
        hasCwd: false,
        errorCode: 'rate_limit',
      }),
    );
  });

  it('prefers input.session_id over the closure sessionId when present', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ sessionId: string }> = [];
    events.onTurnFailed((event) => {
      captured.push({ sessionId: event.sessionId });
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'closure-sess', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      session_id: 'sdk-sess-real',
      error: 'server_error',
    } as unknown as HookInput;

    await fn(input, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([{ sessionId: 'sdk-sess-real' }]);
  });

  it('representative SDKAssistantMessageError variants roundtrip through emit', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{ error: string }> = [];
    events.onTurnFailed((event) => {
      captured.push({ error: event.error });
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const variants = [
      'authentication_failed',
      'oauth_org_not_allowed',
      'billing_error',
      'rate_limit',
      'invalid_request',
      'model_not_found',
      'server_error',
      'unknown',
      'max_output_tokens',
    ];
    for (const error of variants) {
      const input = {
        hook_event_name: 'StopFailure',
        error,
      } as unknown as HookInput;
      await fn(input, undefined, { signal: new AbortController().signal });
    }

    expect(captured.map((c) => c.error)).toEqual(variants);
  });

  it('back-to-back StopFailure emits deliver distinct payloads on the bus', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    const captured: Array<{
      errorDetails: string | null;
      lastAssistantMessage: string | null;
    }> = [];
    events.onTurnFailed((event) => {
      captured.push({
        errorDetails: event.errorDetails,
        lastAssistantMessage: event.lastAssistantMessage,
      });
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const first = {
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: 'first',
      last_assistant_message: 'partial-1',
    } as unknown as HookInput;
    const second = {
      hook_event_name: 'StopFailure',
      error: 'server_error',
      error_details: 'second',
      last_assistant_message: 'partial-2',
    } as unknown as HookInput;

    await fn(first, undefined, { signal: new AbortController().signal });
    await fn(second, undefined, { signal: new AbortController().signal });

    expect(captured).toEqual([
      { errorDetails: 'first', lastAssistantMessage: 'partial-1' },
      { errorDetails: 'second', lastAssistantMessage: 'partial-2' },
    ]);
  });

  it('listener throw inside emitTurnFailed does not propagate (safeEmit)', async () => {
    const logger = makeLogger();
    const events = new SdkAdapterEvents(logger);
    events.onTurnFailed(() => {
      throw new Error('listener boom');
    });
    const handler = new StopFailureHookHandler(logger, events);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'unknown',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
  });

  it('no-op when sdkAdapterEvents not injected (back-compat for tests)', async () => {
    const logger = makeLogger();
    const handler = new StopFailureHookHandler(logger);
    const fn = getHookCallback(handler, 'sess-1', '/workspace');

    const input = {
      hook_event_name: 'StopFailure',
      error: 'unknown',
    } as unknown as HookInput;

    const result = await fn(input, undefined, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ continue: true });
  });
});
