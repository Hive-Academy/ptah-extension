import 'reflect-metadata';

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { SDK_TOKENS, registerSdkServices } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderAccountService,
  registerAuthProvidersServices,
} from '@ptah-extension/auth-providers';
import type {
  ClaudeAccountAdmissionRequest,
  ProviderAccountAdmissionPort,
} from '@ptah-extension/auth-providers-tokens';
import type { ProviderAccountBinding } from '@ptah-extension/shared';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';

const ENHANCED_PROMPTS_SERVICE = Symbol.for('SdkEnhancedPromptsService');
jest.mock('@ptah-extension/agent-generation', () => ({
  AGENT_GENERATION_TOKENS: {
    ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  },
}));

import {
  createClaudeLaneReadOnlyBindings,
  registerCliAgentRuntimeServices,
} from './register';
import { ClaudeCliAdapter } from '../cli-agents/cli-adapters/claude-cli.adapter';
import { resolveLaneAccountResume } from '../cli-agents/lane-resume-gate';
import { CLAUDE_LANE_ACCOUNT_PERSISTENCE, CLI_AGENT_RUNTIME_TOKENS } from './tokens';
import { AgentRoleResolver } from '../roles';
import { AgentProcessManager } from '../cli-agents/agent-process-manager.service';
import { AgentSpawnEnvironment } from '../cli-agents/agent-spawn-environment.service';
import { AgentOutputBuffer } from '../cli-agents/agent-output-buffer.service';
import { LaneOwnerResolver } from '../cli-agents/limits/lane-owner.resolver';
import { LaneLimitLookupService } from '../cli-agents/limits/lane-limit-lookup.service';
import { PlanLimitOwnerDiscoveryService } from '../cli-agents/limits/plan-limit-owner-discovery.service';

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
  c.register(PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS, {
    useValue: { present: jest.fn(), resolve: jest.fn(), isEligible: jest.fn(() => false), open: jest.fn(), dispose: jest.fn() },
  });
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
  // Every host registers it (platform-vscode/-electron/-cli registration);
  // the manager's resume gate logs through it (TASK_2026_597, R9.1).
  c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, {
    useValue: {
      name: 'Ptah',
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
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
  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: {
      readFile: jest.fn(async () => ''),
      readDirectory: jest.fn(async () => []),
      stat: jest.fn(async () => undefined),
      exists: jest.fn(async () => false),
    },
  });
  // Global state: the plan-limit ledger the manager files lane evidence in
  // persists through it (TASK_2026_596). Every host's platform registration
  // provides it.
  c.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
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

  it('injects the registered plan-limit ledger and a lane owner resolver (TASK_2026_596)', () => {
    const ledger = container.resolve(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER);
    const manager = container.resolve<AgentProcessManager>(
      TOKENS.AGENT_PROCESS_MANAGER,
    );
    const internals = manager as unknown as {
      planLimits: unknown;
      laneOwners: unknown;
    };

    expect(internals.planLimits).toBe(ledger);
    expect(internals.laneOwners).toBeInstanceOf(LaneOwnerResolver);
    expect(internals.laneOwners).toBe(
      container.resolve(CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER),
    );
  });

  it('resolves the plan-limit lane lookup and owner discovery as singletons (TASK_2026_596)', () => {
    const lookup = container.resolve(CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP);
    const discovery = container.resolve(
      CLI_AGENT_RUNTIME_TOKENS.PLAN_LIMIT_OWNER_DISCOVERY,
    );

    expect(lookup).toBeInstanceOf(LaneLimitLookupService);
    expect(discovery).toBeInstanceOf(PlanLimitOwnerDiscoveryService);
    expect(container.resolve(CLI_AGENT_RUNTIME_TOKENS.LANE_LIMIT_LOOKUP)).toBe(
      lookup,
    );
    expect(
      container.resolve(CLI_AGENT_RUNTIME_TOKENS.PLAN_LIMIT_OWNER_DISCOVERY),
    ).toBe(discovery);
  });

  describe('ClaudeCliAdapter account persistence (TASK_2026_712 D25 F3)', () => {
    const binding: ProviderAccountBinding = {
      version: 1, provider: 'claude', profileId: 'account123', runId: 'run12345',
      routeRevision: 0, authEpoch: 0, routeFingerprint: 'a'.repeat(64),
      identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
    };
    const continueInput = { cli: 'claude' as const, cliSessionId: 'sdk-session-1' };

    function useAccountService(
      lookupBySdkSession: ProviderAccountService['lookupBySdkSession'],
    ): jest.Mock {
      const lookup = jest.fn(lookupBySdkSession);
      // Test double: the read-only bindings only call `lookupBySdkSession`.
      const service = { lookupBySdkSession: lookup } as Pick<ProviderAccountService, 'lookupBySdkSession'>;
      container.register(ProviderAccountService, {
        useValue: service as ProviderAccountService,
      });
      return lookup;
    }

    it('gives the adapter the read-only bindings when no host registers full persistence', async () => {
      expect(container.isRegistered(CLAUDE_LANE_ACCOUNT_PERSISTENCE, true)).toBe(false);
      const lookup = useAccountService(async () => ({ status: 'absent' }));

      const port = container.resolve(ClaudeCliAdapter).accountBindings;

      expect(port).toBeDefined();
      const reference = { accountBinding: binding, accountBindingId: binding.runId };
      await expect(port?.persistReference(reference, 'sdk-session-1')).rejects.toMatchObject({
        name: 'LaneAccountResumeError',
        code: 'unavailable-storage',
      });
      await expect(port?.validateResume(reference)).resolves.toEqual({
        code: 'unavailable-storage',
      });
      expect(lookup).not.toHaveBeenCalled();
    });

    it('treats an explicit null full-persistence binding as absent and falls back to read-only', () => {
      container.register(CLAUDE_LANE_ACCOUNT_PERSISTENCE, { useFactory: () => null });

      expect(container.resolve(ClaudeCliAdapter).accountBindings).toBeDefined();
    });

    it('(a) resumes an ambient continue of a never-bound session with no refusal', async () => {
      const lookup = useAccountService(async () => ({ status: 'absent' }));
      const accountBindings = container.resolve(ClaudeCliAdapter).accountBindings;

      await expect(
        resolveLaneAccountResume({ ...continueInput, accountBindings }),
      ).resolves.toBeUndefined();
      expect(lookup).toHaveBeenCalledWith({ provider: 'claude', sdkSessionId: 'sdk-session-1' });
    });

    it('(b) refuses a bound named session with unavailable-storage without certified persistence', async () => {
      const lookup = useAccountService(async () => ({ status: 'bound', binding }));
      const accountBindings = container.resolve(ClaudeCliAdapter).accountBindings;

      await expect(
        resolveLaneAccountResume({ ...continueInput, accountBindings }),
      ).rejects.toMatchObject({ name: 'LaneAccountResumeError', code: 'unavailable-storage' });
      expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('(c) refuses unavailable-storage when the account service is missing or fails, without leaking', async () => {
      const missing = createClaudeLaneReadOnlyBindings(() => null);
      await expect(
        resolveLaneAccountResume({ ...continueInput, accountBindings: missing }),
      ).rejects.toMatchObject({ code: 'unavailable-storage' });

      useAccountService(async () => {
        throw new Error('SQLITE_CANTOPEN D:/secret/accounts.db');
      });
      const failing = container.resolve(ClaudeCliAdapter).accountBindings;
      await expect(failing?.lookupBySdkSession({ provider: 'claude', sdkSessionId: 's' }))
        .resolves.toEqual({ status: 'unavailable-storage' });
      const refusal = resolveLaneAccountResume({ ...continueInput, accountBindings: failing });
      await expect(refusal).rejects.toMatchObject({ code: 'unavailable-storage' });
      await expect(refusal).rejects.not.toThrow(/secret|SQLITE/);
    });

    it('(d) still refuses named admission without full persistence, before admitting a route', async () => {
      const lookup = useAccountService(async () => ({ status: 'absent' }));
      const admitClaudeRoute = jest.fn();
      const admission: ProviderAccountAdmissionPort = {
        admitClaudeRoute,
        releaseReservation: jest.fn(),
        retainUnresolvedReservation: jest.fn(),
      };
      container.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION, { useValue: admission });
      const accountAdmission = {
        provider: 'claude',
        selection: { kind: 'named', profileId: 'profile' },
      } as ClaudeAccountAdmissionRequest;

      await expect(
        container.resolve(ClaudeCliAdapter).runSdk({
          task: 'do work', workingDirectory: '/workspace', accountAdmission,
        }),
      ).rejects.toMatchObject({ code: 'unavailable-storage' });
      expect(admitClaudeRoute).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });

    it('passes the host-registered persistence port to the adapter', () => {
      const persistence = {
        available: false,
        lookupBySdkSession: jest.fn(async () => ({ status: 'absent' as const })),
        validateResume: jest.fn(),
      };
      container.register(CLAUDE_LANE_ACCOUNT_PERSISTENCE, { useValue: persistence });

      expect(container.resolve(ClaudeCliAdapter).accountBindings).toBe(persistence);
    });
  });

  it('resolves CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER as a singleton', () => {
    const resolver = container.resolve<AgentRoleResolver>(
      CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER,
    );

    expect(resolver).toBeInstanceOf(AgentRoleResolver);
    expect(
      container.resolve<AgentRoleResolver>(
        CLI_AGENT_RUNTIME_TOKENS.AGENT_ROLE_RESOLVER,
      ),
    ).toBe(resolver);
  });
});
