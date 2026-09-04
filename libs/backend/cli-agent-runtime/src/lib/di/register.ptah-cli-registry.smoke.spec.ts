/**
 * DI container smoke spec for PtahCliRegistry (TASK_2026_367 Fix F2).
 *
 * Verifies that:
 * 1. `CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY` resolves to a `PtahCliRegistry` instance.
 * 2. The injected `processSpawner` is the real `OffThreadProcessSpawner` registered by `registerSdkServices`.
 *
 * NOTE on OffThreadProcessSpawner assertion:
 * `OffThreadProcessSpawner` is an internal class not exported in the public `@ptah-extension/agent-sdk` barrel.
 * We assert `spawner.constructor.name === 'OffThreadProcessSpawner'` and `typeof spawner.spawn === 'function'`.
 */

import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SDK_TOKENS, registerSdkServices } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  registerAuthProvidersServices,
} from '@ptah-extension/auth-providers';

const ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  },
}));

import { CLI_AGENT_RUNTIME_TOKENS } from './tokens';
import { registerCliAgentRuntimeServices } from './register';
import { PtahCliRegistry } from '../ptah-cli';
import type { ISdkProcessSpawner } from '../spawn/sdk-process-spawner.port';

function createMockLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
}

function buildSmokeContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();
  const logger = createMockLogger();

  c.register(TOKENS.LOGGER, { useValue: logger });

  // Platform dependencies required by ConfigWatcher during registerSdkServices
  c.register(TOKENS.CONFIG_MANAGER, {
    useValue: {
      get: jest.fn(() => undefined),
      set: jest.fn(async () => undefined),
      getWithDefault: jest.fn((_key, defaultValue) => defaultValue),
      watch: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: {
      get: jest.fn(async () => undefined),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });

  // Host platform & collaborator fakes required for SDK and CLI runtime services
  c.register(TOKENS.AUTH_SECRETS_SERVICE, {
    useValue: {
      getProviderKey: jest.fn(async () => undefined),
      hasProviderKey: jest.fn(async () => false),
    },
  });
  c.register(TOKENS.SUBAGENT_REGISTRY_SERVICE, {
    useValue: {
      register: jest.fn(),
      unregister: jest.fn(),
      get: jest.fn(),
    },
  });
  c.register(TOKENS.GIT_INFO_SERVICE, { useValue: {} });
  c.register(Symbol.for('WorkspaceScopeResolver'), {
    useValue: { read: jest.fn(() => undefined) },
  });
  c.register(TOKENS.SENTRY_SERVICE, {
    useValue: { captureException: jest.fn(), captureMessage: jest.fn() },
  });
  c.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: { broadcastMessage: jest.fn(async () => undefined) },
  });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV, { useValue: {} });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER, {
    useValue: { resolveModel: jest.fn() },
  });
  c.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS, {
    useValue: {
      getModelTiers: jest.fn(() => ({ sonnet: null, opus: null, haiku: null })),
    },
  });
  c.register(ENHANCED_PROMPTS_SERVICE, {
    useValue: {
      setAnalysisReader: jest.fn(),
      getStatus: jest.fn(),
    },
  });
  c.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: {
      platform: process.platform,
      arch: process.arch,
      osVersion: 'test',
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });

  registerAuthProvidersServices(c, logger);
  registerSdkServices(c, logger);
  // SessionLifecycleManager pulls in full query runner and auth strategy platform stacks.
  // Stub it after registerSdkServices to isolate the PtahCliRegistry container resolution.
  c.register(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { useValue: {} });
  registerCliAgentRuntimeServices(c, logger);

  return c;
}

describe('registerCliAgentRuntimeServices — PtahCliRegistry DI smoke', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    container = buildSmokeContainer();
  });

  it('resolves CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY to a PtahCliRegistry instance', () => {
    const registry = container.resolve<PtahCliRegistry>(
      CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );

    expect(registry).toBeDefined();
    expect(registry).toBeInstanceOf(PtahCliRegistry);
  });

  it('injects the real OffThreadProcessSpawner from registerSdkServices into PtahCliRegistry', () => {
    const registry = container.resolve<PtahCliRegistry>(
      CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY,
    );

    const spawner = (
      registry as unknown as { processSpawner: ISdkProcessSpawner }
    ).processSpawner;

    expect(spawner).toBeDefined();
    // OffThreadProcessSpawner is internal to agent-sdk (not exported in public barrel).
    // Pinned by constructor name and runtime spawn method.
    expect(spawner.constructor.name).toBe('OffThreadProcessSpawner');
    expect(typeof spawner.spawn).toBe('function');
  });
});
