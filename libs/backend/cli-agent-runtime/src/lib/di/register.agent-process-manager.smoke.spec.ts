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
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';

const ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  },
}));

import { registerCliAgentRuntimeServices } from './register';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { AgentSpawnEnvironment } from '../cli-agents/agent-spawn-environment.service';
import { AgentOutputBuffer } from '../cli-agents/agent-output-buffer.service';

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
      getWorkspaceRoot: jest.fn(() => undefined),
      getConfiguration: jest.fn(
        (_section: string, _key: string, defaultValue?: unknown) =>
          defaultValue,
      ),
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
  c.register(SETTINGS_TOKENS.REASONING_SETTINGS, {
    useValue: { effort: { get: jest.fn(() => '') } },
  });

  registerAuthProvidersServices(c, logger);
  registerSdkServices(c, logger);
  c.register(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { useValue: {} });
  registerCliAgentRuntimeServices(c, logger);

  return c;
}

describe('registerCliAgentRuntimeServices — AgentProcessManager DI smoke', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    container = buildSmokeContainer();
  });

  it('resolves TOKENS.AGENT_PROCESS_MANAGER to an AgentProcessManager instance', () => {
    const manager = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );

    expect(manager).toBeInstanceOf(AgentProcessManager);
  });

  it('resolves TOKENS.AGENT_PROCESS_MANAGER as a singleton', () => {
    const first = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );
    const second = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );

    expect(second).toBe(first);
  });

  it('resolves AgentSpawnEnvironment and AgentOutputBuffer as singletons', () => {
    const spawnEnvironment = container.resolve(AgentSpawnEnvironment);
    const outputBuffer = container.resolve(AgentOutputBuffer);

    expect(spawnEnvironment).toBeInstanceOf(AgentSpawnEnvironment);
    expect(outputBuffer).toBeInstanceOf(AgentOutputBuffer);
    expect(container.resolve(AgentSpawnEnvironment)).toBe(spawnEnvironment);
    expect(container.resolve(AgentOutputBuffer)).toBe(outputBuffer);
  });

  it('delegates workspace scoping to the container AgentSpawnEnvironment singleton', () => {
    const spawnEnvironment = container.resolve(AgentSpawnEnvironment);
    const scopedRoot = jest
      .spyOn(spawnEnvironment, 'scopedWorkspaceRoot')
      .mockReturnValue(undefined);
    const manager = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );

    expect(manager.getStatus()).toEqual([]);
    expect(scopedRoot).toHaveBeenCalledTimes(1);
  });

  it('injects the container AgentOutputBuffer singleton into the manager', () => {
    const outputBuffer = container.resolve(AgentOutputBuffer);
    const manager = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );

    expect(
      (manager as unknown as { outputBuffer: AgentOutputBuffer }).outputBuffer,
    ).toBe(outputBuffer);
  });
});
