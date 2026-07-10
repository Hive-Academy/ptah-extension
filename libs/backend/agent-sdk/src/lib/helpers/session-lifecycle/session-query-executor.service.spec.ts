/**
 * SessionQueryExecutor — permission-level seeding spec (TASK_2026_155, F1).
 *
 * Covers the caller-supplied `permissionLevel` seed added in Task 1.2:
 *
 * 1. `config.permissionLevel = 'yolo'` seeds `rec.permissionLevel === 'yolo'`
 *    AND the SDK options builder is invoked with `permissionMode === 'default'`
 *    (never `'bypassPermissions'` — the load-bearing invariant from
 *    permission-mode-map.ts).
 * 2. `config.permissionLevel` omitted falls back to the GLOBAL
 *    `permissionHandler.getPermissionLevel()` — byte-identical to prior
 *    behavior.
 * 3. `config.permissionLevel = 'auto-edit'` maps to SDK `permissionMode ===
 *    'acceptEdits'`.
 *
 * Uses the REAL `SessionRegistry` (not a mock) so `rec.permissionLevel` is
 * observed via actual mutation, not a stubbed return value — a behavioral
 * check, not contract theater. All other collaborators (module loader, query
 * options builder, message factory, query runner, permission handler) are
 * mocked; no real SDK is invoked.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  AuthEnv,
  ISdkPermissionHandler,
  PermissionLevel,
} from '@ptah-extension/shared';

import { SessionQueryExecutor } from './session-query-executor.service';
import { SessionRegistry } from './session-registry.service';
import type { SessionStreamPump } from './session-stream-pump.service';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SdkQueryRunner } from '../sdk-query-runner.service';
import type {
  ExecuteQueryConfig,
  Query,
  SDKUserMessage,
} from '../session-lifecycle-manager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
}

function makeSdkQuery(): Query {
  return {
    [Symbol.asyncIterator]: emptyAsyncIterable<never>()[Symbol.asyncIterator],
    next: async () => ({ done: true, value: undefined }),
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    applyFlagSettings: async () => undefined,
    streamInput: async () => undefined,
    stopTask: async () => undefined,
    rewindFiles: async () => ({ canRewind: false }),
  } as unknown as Query;
}

interface Harness {
  executor: SessionQueryExecutor;
  registry: SessionRegistry;
  buildSpy: jest.Mock;
  getPermissionLevelSpy: jest.Mock;
  sdkQuery: Query;
}

function makeHarness(globalPermissionLevel: PermissionLevel): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);

  const streamPump = {
    createUserMessageStream: jest
      .fn()
      .mockReturnValue(emptyAsyncIterable<SDKUserMessage>()),
    createIdlePromptStream: jest
      .fn()
      .mockReturnValue(emptyAsyncIterable<SDKUserMessage>()),
  } as unknown as SessionStreamPump;

  const getPermissionLevelSpy = jest
    .fn()
    .mockReturnValue(globalPermissionLevel);
  const permissionHandler = {
    getPermissionLevel: getPermissionLevelSpy,
  } as unknown as ISdkPermissionHandler;

  const queryFn = jest.fn();
  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
  } as unknown as SdkModuleLoader;

  // Mirrors the real SdkQueryOptionsBuilder.build() contract: it forwards the
  // caller-supplied `permissionMode` straight into `options.permissionMode`
  // (sdk-query-options-builder.ts:609,641) — the seam this test asserts on.
  const buildSpy = jest.fn().mockImplementation(
    async (input: { permissionMode?: string }) =>
      ({
        options: {
          model: 'test-model',
          cwd: '/tmp/test',
          permissionMode: input.permissionMode,
        },
        prompt: emptyAsyncIterable<SDKUserMessage>(),
      }) as const,
  );
  const queryOptionsBuilder = {
    build: buildSpy,
  } as unknown as SdkQueryOptionsBuilder;

  const messageFactory = {
    createUserMessage: jest.fn(),
  } as unknown as SdkMessageFactory;

  const authEnv = {} as AuthEnv;

  const sdkQuery = makeSdkQuery();
  const queryRunner = {
    invokeWithLoadedQuery: jest.fn().mockReturnValue({ sdkQuery }),
  } as unknown as SdkQueryRunner;

  const executor = new SessionQueryExecutor(
    logger,
    registry,
    streamPump,
    permissionHandler,
    moduleLoader,
    queryOptionsBuilder,
    messageFactory,
    authEnv,
    queryRunner,
  );

  return { executor, registry, buildSpy, getPermissionLevelSpy, sdkQuery };
}

function makeConfig(
  sessionId: string,
  overrides: Partial<ExecuteQueryConfig> = {},
): ExecuteQueryConfig {
  return {
    sessionId: sessionId as ExecuteQueryConfig['sessionId'],
    sessionConfig: {
      model: 'test-model',
      projectPath: '/tmp/test',
    } as AISessionConfig,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SessionQueryExecutor — permission-level seeding (F1, Task 1.2)', () => {
  it('config.permissionLevel = "yolo" seeds rec.permissionLevel and maps to SDK permissionMode "default" (never bypassPermissions)', async () => {
    const { executor, registry, buildSpy } = makeHarness('ask');

    await executor.executeQuery(
      makeConfig('tab-yolo', { permissionLevel: 'yolo' }),
    );

    const rec = registry.find('tab-yolo');
    expect(rec?.permissionLevel).toBe('yolo');

    expect(buildSpy).toHaveBeenCalledTimes(1);
    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    expect(buildInput.permissionMode).toBe('default');
    expect(buildInput.permissionMode).not.toBe('bypassPermissions');
  });

  it('config.permissionLevel omitted falls back to the GLOBAL permissionHandler.getPermissionLevel() — byte-identical to prior behavior', async () => {
    const { executor, registry, buildSpy, getPermissionLevelSpy } =
      makeHarness('auto-edit');

    await executor.executeQuery(makeConfig('tab-fallback'));

    expect(getPermissionLevelSpy).toHaveBeenCalledTimes(1);
    const rec = registry.find('tab-fallback');
    expect(rec?.permissionLevel).toBe('auto-edit');

    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    // auto-edit -> acceptEdits via PERMISSION_MODE_MAP, exactly as before F1.
    expect(buildInput.permissionMode).toBe('acceptEdits');
  });

  it('config.permissionLevel omitted (global "ask") falls back to "ask" and permissionMode "default"', async () => {
    const { executor, registry, getPermissionLevelSpy } = makeHarness('ask');

    await executor.executeQuery(makeConfig('tab-fallback-ask'));

    expect(getPermissionLevelSpy).toHaveBeenCalledTimes(1);
    const rec = registry.find('tab-fallback-ask');
    expect(rec?.permissionLevel).toBe('ask');
  });

  it('config.permissionLevel = "auto-edit" maps to SDK permissionMode "acceptEdits"', async () => {
    const { executor, registry, buildSpy, getPermissionLevelSpy } =
      makeHarness('ask');

    await executor.executeQuery(
      makeConfig('tab-auto-edit', { permissionLevel: 'auto-edit' }),
    );

    // Caller-supplied level wins; the global getter is never consulted.
    expect(getPermissionLevelSpy).not.toHaveBeenCalled();

    const rec = registry.find('tab-auto-edit');
    expect(rec?.permissionLevel).toBe('auto-edit');

    const buildInput = buildSpy.mock.calls[0][0] as {
      permissionMode?: string;
    };
    expect(buildInput.permissionMode).toBe('acceptEdits');
  });
});
