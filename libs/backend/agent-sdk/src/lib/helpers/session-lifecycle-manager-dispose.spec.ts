import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { SubagentRegistryService } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  ISdkPermissionHandler,
  AuthEnv,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

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
  const moduleLoader = { getQueryFunction: jest.fn() } as unknown as SdkModuleLoader;
  const queryOptionsBuilder = { build: jest.fn() } as unknown as SdkQueryOptionsBuilder;
  const messageFactory = {} as unknown as SdkMessageFactory;
  const subagentRegistry = {} as unknown as SubagentRegistryService;
  const authEnv = {} as AuthEnv;
  const modelResolver = { resolve: jest.fn((m: string) => m) } as unknown as IModelResolver;
  const sessionEndRegistry = { notifyAll: jest.fn() } as unknown as SessionEndCallbackRegistry;
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
    const rec = manager.register('tab_after_ctor', config, new AbortController());

    expect(rec.tabId).toBe('tab_after_ctor');
    manager.dispose();
  });
});
