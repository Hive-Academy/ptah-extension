import 'reflect-metadata';
import { container } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  ISdkPermissionHandler,
  AuthEnv,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkPermissionHandler } from '../sdk-permission-handler';

import { SessionLifecycleManager } from './session-lifecycle-manager';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { SdkMessageFactory } from './sdk-message-factory';
import type { IModelResolver } from '../auth-env.port';
import type { SessionEndCallbackRegistry } from './session-end-callback-registry';
import type { SdkQueryRunner } from './sdk-query-runner.service';
import { SessionRegistry } from './session-lifecycle/session-registry.service';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function makeManager(): {
  manager: SessionLifecycleManager;
  logger: MockLogger;
  startSpy: jest.SpyInstance;
  stopSpy: jest.SpyInstance;
} {
  const logger = createMockLogger();
  const permissionHandler = {} as ISdkPermissionHandler;
  const moduleLoader = {
    getQueryFunction: jest.fn(),
  } as unknown as SdkModuleLoader;
  const queryOptionsBuilder = {
    build: jest.fn(),
  } as unknown as SdkQueryOptionsBuilder;
  const messageFactory = {} as unknown as SdkMessageFactory;
  const subagentRegistry = {} as unknown as SubagentRegistryService;
  const authEnv = {} as AuthEnv;
  const modelResolver = {
    resolve: jest.fn((m: string) => m),
  } as unknown as IModelResolver;
  const sessionEndRegistry = {
    notifyAll: jest.fn(),
  } as unknown as SessionEndCallbackRegistry;
  const queryRunner = {} as unknown as SdkQueryRunner;

  const startSpy = jest.spyOn(SessionRegistry.prototype, 'startEvictionSweep');
  const stopSpy = jest.spyOn(SessionRegistry.prototype, 'stopEvictionSweep');

  const manager = new SessionLifecycleManager(
    asLogger(logger),
    permissionHandler,
    moduleLoader,
    queryOptionsBuilder,
    messageFactory,
    subagentRegistry,
    authEnv,
    modelResolver,
    sessionEndRegistry,
    queryRunner,
  );

  return { manager, logger, startSpy, stopSpy };
}

describe('SessionLifecycleManager — dispose (Batch C)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('starts the eviction sweep in the constructor', () => {
    const { startSpy, manager } = makeManager();
    expect(startSpy).toHaveBeenCalled();
    manager.dispose();
  });

  it('dispose() stops the eviction sweep', () => {
    const { manager, stopSpy } = makeManager();
    stopSpy.mockClear();

    manager.dispose();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('dispose() is idempotent', () => {
    const { manager } = makeManager();
    manager.dispose();
    expect(() => manager.dispose()).not.toThrow();
  });

  it('register() after construction still works (sweep does not interfere)', () => {
    const { manager } = makeManager();

    const config: AISessionConfig = {
      model: 'test',
      projectPath: '/ws',
    } as AISessionConfig;
    const rec = manager.register(
      'tab_after_ctor',
      config,
      new AbortController(),
    );

    expect(rec.tabId).toBe('tab_after_ctor');
    manager.dispose();
  });
});

// ===========================================================================
// TASK_2026_247 — disposeAllSessions must clean up only the sessions it is
// actually disposing.
//
// session-lifecycle-manager.spec.ts pins the ORDER of the teardown steps.
// This pins their SCOPE. The defect: disposeAllSessions() called
// `cleanupPendingPermissions()` with NO session id, which walks the ENTIRE
// pending map and resolves every in-flight request as a deny — including
// requests owned by sessions in other windows / tabs / background subagents
// that this call never touched. An auth or config change therefore killed
// unrelated agents, which read the deny as a deliberate user refusal.
// ===========================================================================

/** Wires a REAL SdkPermissionHandler into a real SessionLifecycleManager. */
function makeScopedHarness(): {
  manager: SessionLifecycleManager;
  permissionHandler: SdkPermissionHandler;
} {
  const logger = createMockLogger();

  const webviewManager = {
    sendMessage: jest.fn(async () => true),
  };

  container.clearInstances();
  container.registerInstance(TOKENS.WEBVIEW_MANAGER, webviewManager);

  const subagentRegistry = {
    getToolCallIdByAgentId: jest.fn().mockReturnValue(null),
    get: jest.fn().mockReturnValue(undefined),
    beginSessionTeardown: jest.fn(),
    endSessionTeardown: jest.fn(),
    markAllInterrupted: jest.fn(),
  } as unknown as SubagentRegistryService;

  const permissionHandler = new SdkPermissionHandler(
    asLogger(logger),
    subagentRegistry,
    webviewManager as unknown as ConstructorParameters<
      typeof SdkPermissionHandler
    >[2],
  );

  const manager = new SessionLifecycleManager(
    asLogger(logger),
    permissionHandler as unknown as ISdkPermissionHandler,
    { getQueryFunction: jest.fn() } as unknown as SdkModuleLoader,
    { build: jest.fn() } as unknown as SdkQueryOptionsBuilder,
    {} as unknown as SdkMessageFactory,
    subagentRegistry,
    {} as AuthEnv,
    { resolve: jest.fn((m: string) => m) } as unknown as IModelResolver,
    { notifyAll: jest.fn() } as unknown as SessionEndCallbackRegistry,
    {} as unknown as SdkQueryRunner,
  );

  return { manager, permissionHandler };
}

type SessionIdParam = Parameters<SdkPermissionHandler['createCallback']>[0];
type TabIdParam = Parameters<SdkPermissionHandler['createCallback']>[2];

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SessionLifecycleManager — disposeAllSessions permission scope (TASK_2026_247)', () => {
  // Valid UUIDs: non-UUID routing ids are classified "unroutable" and arm a 60s
  // deny timer, which would resolve the very promise this spec needs to observe
  // as still-pending.
  const TAB_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const REAL_A = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
  const TAB_B = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  const REAL_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  afterEach(() => {
    container.clearInstances();
    jest.restoreAllMocks();
  });

  it('denies pending permissions of the disposed session ONLY, leaving an unrelated session’s request pending', async () => {
    const { manager, permissionHandler } = makeScopedHarness();

    const config: AISessionConfig = {
      model: 'test',
      projectPath: '/ws/a',
    } as AISessionConfig;

    // Session A is the only session in the registry — the one being disposed.
    manager.register(TAB_A, config, new AbortController());
    manager.bindRealSessionId(TAB_A, REAL_A);

    // A's interactive (tab-keyed) in-flight request.
    const pendingATab = permissionHandler.createCallback(
      REAL_A as SessionIdParam,
      undefined,
      TAB_A as TabIdParam,
    )(
      'Bash',
      { command: 'ls' },
      { signal: new AbortController().signal, toolUseID: 'tool-a-tab' },
    );

    // A's CLI-path request — keyed by realSessionId only, with no tabId. This
    // is why the fix must clean up realSessionId as well as tabId.
    const pendingACli = permissionHandler.createCallback(
      REAL_A as SessionIdParam,
    )(
      'Write',
      { file_path: '/tmp/a', content: 'x' },
      { signal: new AbortController().signal, toolUseID: 'tool-a-cli' },
    );

    // Session B belongs to a DIFFERENT window / background subagent and is NOT
    // in this manager's registry. Nothing here is disposing it.
    let bSettled = false;
    const pendingB = permissionHandler.createCallback(
      REAL_B as SessionIdParam,
      undefined,
      TAB_B as TabIdParam,
    )(
      'Bash',
      { command: 'npm test' },
      { signal: new AbortController().signal, toolUseID: 'tool-b' },
    );
    pendingB.then(
      () => {
        bSettled = true;
      },
      () => {
        bSettled = true;
      },
    );

    await flushMicrotasks();

    await manager.disposeAllSessions();
    await flushMicrotasks();

    // A's requests — both keying paths — are cleaned up.
    await expect(pendingATab).resolves.toMatchObject({ behavior: 'deny' });
    await expect(pendingACli).resolves.toMatchObject({ behavior: 'deny' });

    // B's request is untouched. Its owner can still answer it. This is THE
    // assertion: before the fix, the global cleanup denied it too.
    expect(bSettled).toBe(false);

    // Prove it is still answerable rather than merely lost.
    permissionHandler.cleanupPendingPermissions(TAB_B);
    await expect(pendingB).resolves.toMatchObject({ behavior: 'deny' });

    manager.dispose();
  });

  it('an empty registry disposes without denying anybody’s pending request', async () => {
    const { manager, permissionHandler } = makeScopedHarness();

    let settled = false;
    const pending = permissionHandler.createCallback(
      REAL_B as SessionIdParam,
      undefined,
      TAB_B as TabIdParam,
    )(
      'Bash',
      { command: 'ls' },
      { signal: new AbortController().signal, toolUseID: 'tool-orphan' },
    );
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await flushMicrotasks();

    // No sessions registered — there is nothing to clean up, so nothing may be
    // denied. The old global cleanup denied everything regardless.
    await manager.disposeAllSessions();
    await flushMicrotasks();

    expect(settled).toBe(false);

    permissionHandler.cleanupPendingPermissions(TAB_B);
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' });

    manager.dispose();
  });
});
