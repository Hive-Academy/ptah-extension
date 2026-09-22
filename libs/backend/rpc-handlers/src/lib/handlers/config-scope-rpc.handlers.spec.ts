/**
 * Pins for `ConfigScopeRpcHandlers` (TASK_2026_523 plan pin 7).
 *
 * The pin: after clearing an AUTH-SCOPED key, `sdkAdapter.reset()` must run,
 * awaited, so the running SDK stops reading a credential the user just
 * cleared; the auth status cache must be invalidated behind it. That is the
 * finally-nested pair at `config-scope-rpc.handlers.ts:137-146`. A clear that
 * partially fails must still invalidate both — the behaviour the finally
 * nesting buys. A clear of a global-only key must never touch the adapter.
 */

import 'reflect-metadata';

import { RpcUserError } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  RpcMethodHandler,
} from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import type { RpcMethodName } from '@ptah-extension/shared';

import { ConfigScopeRpcHandlers } from './config-scope-rpc.handlers';
import { AuthRpcHandlers } from './auth-rpc.handlers';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

type RpcHandlerSurface = Pick<RpcHandler, 'registerMethod'>;

type ScopeResolverSurface = Pick<
  WorkspaceScopeResolver,
  | 'getActivePath'
  | 'inspect'
  | 'hasOverride'
  | 'clearOverride'
  | 'clearMoreSpecific'
  | 'effectiveKey'
>;

interface Harness {
  /** The RPC method bodies registered by `register()`, keyed by method name. */
  methods: Map<RpcMethodName, (raw: unknown) => Promise<unknown>>;
  scopeResolver: ScopeResolverSurface & {
    inspect: jest.Mock<
      Promise<readonly { key: string; value: unknown }[]> | readonly { key: string; value: unknown }[],
      [string, boolean]
    >;
    clearOverride: jest.Mock<Promise<void>, [string, boolean]>;
    clearMoreSpecific: jest.Mock<Promise<void>, [string, string, boolean]>;
    effectiveKey: jest.Mock<string, [string, boolean]>;
  };
  sdkReset: jest.Mock<Promise<void>, []>;
  invalidateAuthStatusCache: jest.Mock<void, []>;
}

function createHarness(): Harness {
  const logger = createMockLogger();

  const methods = new Map<RpcMethodName, (raw: unknown) => Promise<unknown>>();
  const rpcHandler: RpcHandlerSurface = {
    registerMethod: jest.fn(
      <TParams = unknown, TResult = unknown>(
        name: string,
        handler: RpcMethodHandler<TParams, TResult>,
      ): void => {
        // The signature above matches `RpcHandler.registerMethod` exactly. One
        // map holds handlers with differing `TParams`, so the element type is
        // erased at the storage boundary and only there.
        methods.set(
          name as RpcMethodName,
          handler as RpcMethodHandler<unknown, unknown>,
        );
      },
    ),
  };

  const scopeResolver = {
    getActivePath: jest.fn((): string | undefined => '/repo/project'),
    inspect: jest.fn<
      readonly { key: string; value: unknown }[],
      [string, boolean]
    >(() => []),
    hasOverride: jest.fn<boolean, [string, boolean]>(() => false),
    clearOverride: jest.fn<Promise<void>, [string, boolean]>(
      async () => undefined,
    ),
    clearMoreSpecific: jest.fn<Promise<void>, [string, string, boolean]>(
      async () => undefined,
    ),
    effectiveKey: jest.fn<string, [string, boolean]>(
      (globalKey: string) => globalKey,
    ),
  } as unknown as ScopeResolverSurface;

  const sdkReset = jest.fn<Promise<void>, []>(async () => undefined);
  const sdkAdapter = { reset: sdkReset } as unknown as SdkAgentAdapter;

  const invalidateAuthStatusCache = jest.fn<void, []>(() => undefined);
  const authHandlers = {
    invalidateAuthStatusCache,
  } as unknown as AuthRpcHandlers;

  const handlers = new ConfigScopeRpcHandlers(
    asLogger(logger),
    rpcHandler as unknown as RpcHandler,
    scopeResolver as unknown as WorkspaceScopeResolver,
    sdkAdapter,
    authHandlers,
  );
  handlers.register();

  return {
    methods,
    scopeResolver: scopeResolver as unknown as Harness['scopeResolver'],
    sdkReset,
    invalidateAuthStatusCache,
  };
}

function clearHandler(
  harness: Harness,
): (raw: unknown) => Promise<unknown> {
  const handler = harness.methods.get('config:clearScopeOverride');
  if (!handler) throw new Error('config:clearScopeOverride was not registered');
  return handler;
}

describe('ConfigScopeRpcHandlers — clear invalidates the running SDK (pin 7)', () => {
  it('resets the SDK adapter after clearing an auth-scoped key, then invalidates the auth cache', async () => {
    const harness = createHarness();
    const clear = await clearHandler(harness);

    // A workspace-level authMethod override exists before the clear and is
    // gone after: inspect answers per-call, in this order.
    harness.scopeResolver.inspect
      .mockReturnValueOnce([
        { key: 'workspace.7f3a.authMethod', value: 'oauth' },
        { key: 'authMethod', value: 'apiKey' },
      ])
      .mockReturnValueOnce([{ key: 'authMethod', value: 'apiKey' }]);
    harness.scopeResolver.effectiveKey.mockReturnValue('authMethod');

    const result = await clear({ key: 'authMethod', target: 'nearest' });

    expect(result).toEqual({
      success: true,
      cleared: ['workspace.7f3a.authMethod'],
      resolvesFrom: 'global',
    });
    expect(harness.scopeResolver.clearOverride).toHaveBeenCalledWith(
      'authMethod',
      true,
    );
    expect(harness.sdkReset).toHaveBeenCalledTimes(1);
    expect(harness.invalidateAuthStatusCache).toHaveBeenCalledTimes(1);
    // The nested finally: the SDK reset completes BEFORE the cache drops.
    expect(harness.sdkReset.mock.invocationCallOrder[0]).toBeLessThan(
      harness.invalidateAuthStatusCache.mock.invocationCallOrder[0],
    );
  });

  it('clears every more-specific scope for an auth-scoped provider key the same way', async () => {
    const harness = createHarness();
    const clear = await clearHandler(harness);

    harness.scopeResolver.inspect
      .mockReturnValueOnce([
        {
          key: 'workspace.7f3a.provider.apiKey.selectedModel',
          value: 'model-x',
        },
        { key: 'app.9c2e.provider.apiKey.selectedModel', value: 'model-y' },
        { key: 'provider.apiKey.selectedModel', value: 'model-z' },
      ])
      .mockReturnValueOnce([{ key: 'provider.apiKey.selectedModel', value: 'model-z' }]);
    harness.scopeResolver.effectiveKey.mockReturnValue(
      'provider.apiKey.selectedModel',
    );

    const result = await clear({
      key: 'provider.apiKey.selectedModel',
      target: 'all-above-global',
    });

    expect(harness.scopeResolver.clearMoreSpecific).toHaveBeenCalledWith(
      'provider.apiKey.selectedModel',
      'global',
      true,
    );
    expect(harness.scopeResolver.clearOverride).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      cleared: [
        'workspace.7f3a.provider.apiKey.selectedModel',
        'app.9c2e.provider.apiKey.selectedModel',
      ],
      resolvesFrom: 'global',
    });
    expect(harness.sdkReset).toHaveBeenCalledTimes(1);
    expect(harness.invalidateAuthStatusCache).toHaveBeenCalledTimes(1);
  });

  it('still resets the adapter when the clear itself fails, and never forwards the storage error', async () => {
    const harness = createHarness();
    const clear = await clearHandler(harness);

    harness.scopeResolver.inspect.mockReturnValueOnce([
      { key: 'workspace.7f3a.authMethod', value: 'oauth' },
      { key: 'authMethod', value: 'apiKey' },
    ]);
    harness.scopeResolver.clearOverride.mockRejectedValue(
      new Error('sqlite disk I/O error'),
    );

    const thrown: unknown = await clear({ key: 'authMethod' }).then(
      () => undefined,
      (error: unknown) => error,
    );
    if (!(thrown instanceof Error)) {
      throw new Error('the clear was expected to throw');
    }
    expect(thrown.message).toBe('Unable to clear the setting override');
    // The raw diagnostics from the storage layer must not leak through.
    expect(thrown.message).not.toContain('sqlite');
    expect(harness.sdkReset).toHaveBeenCalledTimes(1);
    expect(harness.invalidateAuthStatusCache).toHaveBeenCalledTimes(1);
    expect(harness.sdkReset.mock.invocationCallOrder[0]).toBeLessThan(
      harness.invalidateAuthStatusCache.mock.invocationCallOrder[0],
    );
  });

  it('never clears and never resets for a global-only key', async () => {
    const harness = createHarness();
    const clear = await clearHandler(harness);

    const result = await clear({ key: 'skillSynthesis.judgeModel' });

    expect(result).toEqual({ success: true, cleared: [], resolvesFrom: 'global' });
    expect(harness.scopeResolver.clearOverride).not.toHaveBeenCalled();
    expect(harness.scopeResolver.clearMoreSpecific).not.toHaveBeenCalled();
    expect(harness.scopeResolver.inspect).not.toHaveBeenCalled();
    expect(harness.sdkReset).not.toHaveBeenCalled();
    expect(harness.invalidateAuthStatusCache).not.toHaveBeenCalled();
  });

  it('refuses a key outside the allowlist before touching anything', async () => {
    const harness = createHarness();
    const clear = await clearHandler(harness);

    await expect(clear({ key: 'memory.curatorModel.apiKey' })).rejects.toBeInstanceOf(
      RpcUserError,
    );
    expect(harness.scopeResolver.clearOverride).not.toHaveBeenCalled();
    expect(harness.sdkReset).not.toHaveBeenCalled();
  });
});