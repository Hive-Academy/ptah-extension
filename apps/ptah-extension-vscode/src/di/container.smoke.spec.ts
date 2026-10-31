/**
 * DI smoke test — proves every previously-factory-wired shared RPC handler
 * resolves cleanly against a production-shaped container.
 *
 * This test is intentionally tied to the constructor argument list rather than
 * to runtime behavior. Its job is to catch token-slot drift between a
 * handler's `@inject(...)` decorators and the container's `register(...)`
 * calls — exactly the failure mode that produced the v0.1.45 Sentry incident
 * (`SetupRpcHandlers` was wired with `CONFIG_MANAGER` in slot 3 after the
 * constructor swapped to `ModelSettings`).
 *
 * Why a hand-built minimal container (not `DIContainer.setup()`): the real
 * VS Code container relies on `vscode.ExtensionContext` and a long chain of
 * platform-vscode adapters. The minimal container below registers exactly the
 * tokens these handlers `@inject`, so any future drift between decorator and
 * registration immediately fails this test.
 */

import 'reflect-metadata';
import { OpenRouterPricingService } from '@ptah-extension/auth-providers';
import { SessionStatsReaderService } from '@ptah-extension/agent-sdk';
import { registerUsageAnalytics, USAGE_ANALYTICS_TOKENS } from '@ptah-extension/usage-analytics';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer, InjectionToken } from 'tsyringe';

import {
  GitInfoService,
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  type Logger,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { CLI_AGENT_RUNTIME_TOKENS, CliDetectionService, CodexAppServerLaneAdapter,
  CodexCliAdapter, registerCliAgentRuntimeServices,
  type CodexAdapterFactory } from '@ptah-extension/cli-agent-runtime';
import {
  LANE_ROUTING_TOKENS,
  registerLaneRoutingServices,
} from '@ptah-extension/lane-routing';
import {
  KeyValueLaneOutcomeStore,
  LANE_OUTCOME_TOKENS,
  registerLaneOutcomeServices,
} from '@ptah-extension/lane-outcomes';
import { registerSdkServices, SDK_TOKENS, wireAgentAdapterAliases } from '@ptah-extension/agent-sdk';
import { CODEX_RUNTIME_TOKENS, CodexParityGate } from '@ptah-extension/codex-runtime';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { HARNESS_SYNC_TOKENS } from '@ptah-extension/harness-sync';
import { PLUGIN_MARKETPLACE_TOKENS } from '@ptah-extension/plugin-marketplace';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import { OUTPUT_STYLE_TOKENS } from '@ptah-extension/output-styles';
import {
  AgentRpcHandlers,
  AuthRpcHandlers,
  DecisionModelCatalogRpcHandlers,
  PluginRpcHandlers,
  SetupRpcHandlers,
  registerSharedRpcHandlers,
  resolveRpcHandlerPlan,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';

import {
  DECISION_MODEL_CATALOG_TOKEN,
  DECISION_MODEL_CONFIG_TOKEN,
  EXPECTED_RESOLVABLE,
  EXPECTED_NULL_RUNTIME_TOKENS,
  EXPECTED_RUNTIME_TOKENS,
  EXPECTED_ATTENTION_TOKENS,
  LANE_MODEL_LISTING_TOKEN,
  STRUCTURED_DECISION_TOKEN,
} from './expected-resolvable';

describe('VS Code attention DI token guard', () => {
  it('pins visibility, host adapter and coordinator in dependency order', () => {
    expect(EXPECTED_ATTENTION_TOKENS).toEqual([
      PLATFORM_TOKENS.PTAH_VIEW_VISIBILITY,
      PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS,
      SDK_TOKENS.HOST_ATTENTION_COORDINATOR,
    ]);
  });
});
import {
  EXPECTED_ABSENT_CAPABILITIES,
  EXPECTED_ABSENT_HANDLERS,
} from './expected-absent';
import { createVscodeRpcHostProfile } from '../rpc-host-profile';
import { registerPhase3Handlers } from './phase-3-handlers';
import { registerVsCodeCodexLaneFactory } from './codex-lane-runtime-composition';

describe('VS Code native Codex lane factory binding', () => {
  function detector(isDevelopment: boolean): { c: DependencyContainer; service: CliDetectionService } {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    const spawner = { spawnProcess: jest.fn(() => { throw new Error('Unexpected spawn'); }) };
    c.register(SDK_TOKENS.SDK_PROCESS_SPAWNER, { useValue: spawner });
    registerVsCodeCodexLaneFactory(c, logger, {
      isDevelopment, env: process.env, platform: process,
    });
    const service = new CliDetectionService(
      logger,
      c.resolve<ConstructorParameters<typeof CliDetectionService>[1]>(TOKENS.SENTRY_SERVICE),
      spawner,
      c.resolve<ConstructorParameters<typeof CliDetectionService>[3]>(TOKENS.AUTH_SECRETS_SERVICE),
      null,
      c.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY)
        ? c.resolve<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY) : null,
    );
    expect(spawner.spawnProcess).not.toHaveBeenCalled();
    return { c, service };
  }

  afterEach(() => jest.restoreAllMocks());

  it('selects native in development without changing peer adapters', async () => {
    jest.spyOn(CodexParityGate.prototype, 'isEnabled').mockReturnValue(false);
    const dev = detector(true);
    const prod = detector(false);
    try {
      expect(dev.service.getAdapter('codex')).toBeInstanceOf(CodexAppServerLaneAdapter);
      expect(prod.service.getAdapter('codex')).toBeInstanceOf(CodexCliAdapter);
      expect(prod.c.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY)).toBe(false);
      for (const cli of ['copilot', 'cursor', 'antigravity', 'opencode', 'pi', 'grok'] as const)
        expect(dev.service.getAdapter(cli)?.constructor).toBe(prod.service.getAdapter(cli)?.constructor);
    } finally {
      await dev.c.dispose();
      await prod.c.dispose();
    }
  });

  it('selects native in production only when the lane gate admits it', async () => {
    const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
    Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
      configurable: true, value: () => true,
    });
    let prod: ReturnType<typeof detector> | undefined;
    try {
      prod = detector(false);
      expect(prod.service.getAdapter('codex')).toBeInstanceOf(CodexAppServerLaneAdapter);
    } finally {
      await prod?.c.dispose();
      if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
    }
  });
});

function buildMinimalContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();

  c.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: c });

  c.register(TOKENS.LOGGER, {
    useValue: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  });
  c.register(TOKENS.RPC_HANDLER, {
    useValue: {
      registerMethod: jest.fn(),
      handleMessage: jest.fn(),
    },
  });
  c.register(TOKENS.SENTRY_SERVICE, {
    useValue: { captureException: jest.fn(), captureMessage: jest.fn() },
  });
  c.register(TOKENS.LICENSE_SERVICE, {
    useValue: { getStatus: jest.fn() },
  });
  c.register(TOKENS.SAVE_DIALOG_PROVIDER, {
    useValue: { showSaveDialog: jest.fn() },
  });
  c.register(TOKENS.PLATFORM_COMMANDS, {
    useValue: { executeCommand: jest.fn(), registerCommand: jest.fn() },
  });
  c.register(TOKENS.MODEL_DISCOVERY, {
    useValue: {
      getCopilotModels: jest.fn(async () => []),
      getCodexModels: jest.fn(async () => []),
    },
  });
  c.register(TOKENS.CONFIG_MANAGER, {
    useValue: {
      get: jest.fn(() => undefined),
      set: jest.fn(async () => undefined),
    },
  });
  c.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: {
      get: jest.fn(async () => undefined),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    },
  });
  c.register(TOKENS.AUTH_SECRETS_SERVICE, {
    useValue: {
      getCredential: jest.fn(async () => undefined),
      setCredential: jest.fn(async () => undefined),
      deleteCredential: jest.fn(async () => undefined),
      hasCredential: jest.fn(async () => false),
      getProviderKey: jest.fn(async () => undefined),
      setProviderKey: jest.fn(async () => undefined),
      deleteProviderKey: jest.fn(async () => undefined),
      hasProviderKey: jest.fn(async () => false),
    },
  });

  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.EDITOR_LAUNCHER, {
    useValue: {
      detect: jest.fn(async () => []),
      openFile: jest.fn(async () => undefined),
      openWorkspace: jest.fn(async () => undefined),
    },
  });
  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: {},
  });
  // `EditorRpcHandlers` injects `FileLinkRootPolicy`, which needs
  // GitInfoService to widen the authorized root set to a registered folder's
  // worktrees (TASK_2026_413 Batch 8a). The real VS Code container binds this
  // in `phase-3-handlers.ts`.
  c.register(TOKENS.GIT_INFO_SERVICE, {
    useValue: { getWorktrees: jest.fn(async () => []) },
  });

  c.register(SDK_TOKENS.SDK_PLUGIN_LOADER, {
    useValue: {
      getWorkspacePluginConfig: jest.fn(() => ({ enabledPluginIds: [] })),
      resolvePluginPaths: jest.fn(() => []),
    },
  });
  c.register(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE, {
    useValue: {
      setAnalysisReader: jest.fn(),
      getStatus: jest.fn(),
    },
  });
  // `EnhancedPromptsRpcHandlers` injects this to canonicalize an inbound
  // `analysisDir` before the enhanced-prompt trace writer can be reached
  // (TASK_2026_361). The real container registers it in `phase-2-libraries`.
  c.register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
    useValue: {
      resolveAuthorizedAnalysisDir: jest.fn(),
      getAnalysisDir: jest.fn(),
    },
  });
  // Batch 11 `GenerationPreviewService` (injected into
  // `WizardGenerationRpcHandlers`) reads wizard agent origins through this.
  // The real container registers it in `phase-2-libraries`.
  c.register(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, {
    useValue: {
      read: jest.fn(),
      hashWrittenFile: jest.fn(),
    },
  });

  const fakeModelSettings = {
    selectedModel: { get: jest.fn(() => 'sonnet'), set: jest.fn() },
    setSelectedModel: jest.fn(),
  };
  c.register(SETTINGS_TOKENS.MODEL_SETTINGS, { useValue: fakeModelSettings });

  c.register(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER, {
    useValue: {
      resolveActiveAuth: jest.fn(() => ({ authMethod: 'claudeCli' })),
      resolveThirdPartyProviderId: jest.fn(() => 'anthropic'),
    },
  });

  // ConfigScopeRpcHandlers is in EXPECTED_RESOLVABLE. Its peer's full auth
  // graph is covered by auth-providers' registration regression test.
  c.registerInstance(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, {});
  c.registerInstance(SDK_TOKENS.SDK_AGENT_ADAPTER, {});
  c.register<Pick<AuthRpcHandlers, 'invalidateAuthStatusCache'>>(
    AuthRpcHandlers,
    {
      useValue: { invalidateAuthStatusCache: jest.fn() },
    },
  );

  c.register<Pick<OpenRouterPricingService, 'getPricing'>>(OpenRouterPricingService, { useValue: { getPricing: jest.fn() } });
  c.register<Pick<SessionStatsReaderService, 'scanDatedUsage'>>(SessionStatsReaderService, { useValue: { scanDatedUsage: jest.fn() } });
  registerUsageAnalytics(c);
  registerSharedRpcHandlers(c);
  return c;
}

describe('VS Code DI — shared RPC handler resolution', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
  });

  it('resolves one lane instruction file store after runtime registration', () => {
    const runtime = buildMinimalContainer();
    registerCliAgentRuntimeServices(runtime, runtime.resolve<Logger>(TOKENS.LOGGER));
    const token = CLI_AGENT_RUNTIME_TOKENS.LANE_INSTRUCTION_FILE_STORE;
    expect(runtime.resolve(token)).toBe(runtime.resolve(token));
  });

  it('resolves the usage analytics service token', () => {
    expect(c.resolve(USAGE_ANALYTICS_TOKENS.USAGE_ANALYTICS_SERVICE)).toBeDefined();
  });

  it.each(
    EXPECTED_RESOLVABLE.map(
      (token) => [token.name, token as InjectionToken<unknown>] as const,
    ),
  )('resolves %s', (_name, token) => {
    let instance: unknown;
    expect(() => {
      instance = c.resolve(token);
    }).not.toThrow();
    expect(instance).toBeDefined();
  });
});

/** Stubs the lane-listing constructor deps this container does not bind. */
function registerLaneModelListingFixtures(c: DependencyContainer): void {
  if (!c.isRegistered(TOKENS.CLI_DETECTION_SERVICE)) {
    c.register(TOKENS.CLI_DETECTION_SERVICE, { useValue: {} });
  }
  if (!c.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH)) {
    c.register(AUTH_PROVIDERS_TOKENS.SDK_CODEX_AUTH, { useValue: {} });
  }
  if (!c.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH)) {
    c.register(AUTH_PROVIDERS_TOKENS.SDK_COPILOT_AUTH, { useValue: {} });
  }
  if (!c.isRegistered(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)) {
    c.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS, { useValue: {} });
  }
  const persistence = Symbol.for('SdkPtahCliConfigPersistence');
  if (!c.isRegistered(persistence)) {
    c.register(persistence, { useValue: {} });
  }
}

/**
 * TASK_2026_701 B12/B13 (A-smoke). VS Code registers `PluginRpcHandlers`
 * (phase 3) only; `SkillsSynthesisRpcHandlers` is in its expected-absent list.
 * Handlers are registered in the host's handler phase, not by
 * `registerSharedRpcHandlers`, so they are not in the handler-only `EXPECTED_RESOLVABLE`. Resolving them over the
 * shared registrations proves the marketplace and Library services they
 * depend on (`CloneRebaseService`, `CloneProvenanceResolver`, and in Batch 20
 * the local-item approval and apply services) resolve. The host-phase
 * collaborators of `PluginRpcHandlers` are stubbed; their own wiring is
 * covered by the host's phase specs.
 */
describe('VS Code DI — plugin and Library handler resolution (TASK_2026_701)', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
    c.register(HARNESS_SYNC_TOKENS.PROPAGATION, { useValue: {} });
    // Batch 20: the local-item services read the destination scanner, the
    // digest-checked repair, the guarded agent writer and the file system;
    // stubbed (when the minimal container lacks them) like the ports above.
    for (const token of [
      HARNESS_SYNC_TOKENS.DESTINATION_SCANNER,
      HARNESS_SYNC_TOKENS.BLOCKED_REPAIR,
      AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE,
      PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
    ]) {
      if (!c.isRegistered(token)) c.register(token, { useValue: {} });
    }
    c.register(TOKENS.COMMAND_DISCOVERY_SERVICE, { useValue: {} });
    c.register(PLUGIN_MARKETPLACE_TOKENS.REGISTRY, { useValue: {} });
    c.register(PLUGIN_MARKETPLACE_TOKENS.INSTALLER, { useValue: {} });
    c.register(PLUGIN_MARKETPLACE_TOKENS.STATE_STORE, { useValue: {} });
  });

  it.each([
    ['PluginRpcHandlers', PluginRpcHandlers],
  ] as const)('resolves %s', (_name, token) => {
    let instance: unknown;
    expect(() => {
      instance = c.resolve<unknown>(token);
    }).not.toThrow();
    expect(instance).toBeDefined();
  });
});

describe('VS Code DI — lane model listing', () => {
  it('resolves LANE_MODEL_LISTING as one singleton', () => {
    const c = buildMinimalContainer();
    registerLaneModelListingFixtures(c);

    const first: unknown = c.resolve(LANE_MODEL_LISTING_TOKEN);

    expect(first).toBeDefined();
    expect(c.resolve(LANE_MODEL_LISTING_TOKEN)).toBe(first);
  });
});

describe('VS Code DI — structured decision', () => {
  it('resolves STRUCTURED_DECISION as one singleton with legacy-only chat bindings', () => {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    // `registerSdkServices` eagerly builds ConfigWatcher, which subscribes.
    c.register(TOKENS.CONFIG_MANAGER, {
      useValue: {
        get: jest.fn(() => undefined),
        set: jest.fn(async () => undefined),
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
    registerSdkServices(c, logger);
    for (const token of EXPECTED_RUNTIME_TOKENS) {
      expect(c.isRegistered(token, true)).toBe(true);
      expect(() => c.resolve(token)).not.toThrow();
    }
    for (const token of EXPECTED_NULL_RUNTIME_TOKENS) {
      expect(c.resolve(token)).toBeNull();
    }
    expect(c.resolve(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES)).toEqual({
      nativeCodex: false,
    });
    for (const token of Object.values(CODEX_RUNTIME_TOKENS)) {
      expect(c.isRegistered(token, true)).toBe(false);
    }
    // Isolate alias selection from the legacy adapter's unrelated dependencies.
    const legacyAdapter = { sendMessage: jest.fn() };
    c.register(SDK_TOKENS.SDK_AGENT_ADAPTER, { useValue: legacyAdapter });
    wireAgentAdapterAliases(c);
    expect(c.resolve(TOKENS.AGENT_ADAPTER)).toBe(legacyAdapter);
    const idleCompaction = c.resolve(SDK_TOKENS.SDK_IDLE_COMPACTION);
    expect(c.resolve(SDK_TOKENS.SDK_IDLE_COMPACTION)).toBe(idleCompaction);
    // The real service pulls SdkQueryRunner. The registration under test is
    // the structured-decision token; the query collaborator stays a stub.
    c.register(SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE, {
      useValue: { execute: () => Promise.reject(new Error('unused')) },
    });

    const first: unknown = c.resolve(STRUCTURED_DECISION_TOKEN);

    expect(first).toBeDefined();
    expect(c.resolve(STRUCTURED_DECISION_TOKEN)).toBe(first);
  });
});

/** Stubs AgentRpcHandlers deps this container does not bind. */
function registerAgentHandlerFixtures(c: DependencyContainer): void {
  if (!c.isRegistered(PLATFORM_TOKENS.STATE_STORAGE)) {
    c.register(PLATFORM_TOKENS.STATE_STORAGE, {
      useValue: {
        get: jest.fn(() => undefined),
        update: jest.fn(async () => undefined),
        keys: jest.fn(() => []),
      },
    });
  }
  if (!c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)) {
    c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { useValue: {} });
  }
  if (!c.isRegistered(PLATFORM_TOKENS.PLATFORM_INFO)) {
    c.register(PLATFORM_TOKENS.PLATFORM_INFO, { useValue: {} });
  }
  if (!c.isRegistered(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)) {
    c.register(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY, {
      useValue: {},
    });
  }
  if (!c.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
    c.register(TOKENS.AGENT_PROCESS_MANAGER, { useValue: {} });
  }
  if (!c.isRegistered(SDK_TOKENS.SDK_SESSION_METADATA_STORE)) {
    c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: {} });
  }
  registerLaneModelListingFixtures(c);
}

describe('VS Code DI — decision model config (TL-59)', () => {
  it('registers lane routing once, before vscode-lm-tools and the RPC surface', () => {
    const phase2 = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );
    const lane = phase2.indexOf(
      'registerLaneRoutingServices(container, logger);',
    );
    const lmTools = phase2.indexOf(
      'registerVsCodeLmToolsServices(container, logger);',
    );

    expect(phase2.match(/registerLaneRoutingServices\(/g)).toHaveLength(1);
    expect(lane).toBeGreaterThan(-1);
    expect(lane).toBeLessThan(lmTools);

    const bootstrap = fs.readFileSync(
      path.join(__dirname, '../activation/bootstrap.ts'),
      'utf8',
    );
    expect(bootstrap.indexOf('DIContainer.setup(context)')).toBeLessThan(
      bootstrap.indexOf('registerRpcSurface('),
    );
  });

  it('resolves DECISION_MODEL_CONFIG and AgentRpcHandlers', () => {
    const c = buildMinimalContainer();
    registerAgentHandlerFixtures(c);
    registerLaneRoutingServices(c, c.resolve<Logger>(TOKENS.LOGGER));

    expect(DECISION_MODEL_CONFIG_TOKEN).toBe(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    );
    const config: unknown = c.resolve(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    );
    expect(config).toBeDefined();
    expect(c.resolve(LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG)).toBe(config);

    const handlers = c.resolve(AgentRpcHandlers);
    expect(handlers).toBeInstanceOf(AgentRpcHandlers);
  });

  it('resolves DECISION_MODEL_CATALOG and DecisionModelCatalogRpcHandlers', () => {
    const c = buildMinimalContainer();
    registerAgentHandlerFixtures(c);
    registerLaneRoutingServices(c, c.resolve<Logger>(TOKENS.LOGGER));

    expect(DECISION_MODEL_CATALOG_TOKEN).toBe(
      LANE_ROUTING_TOKENS.DECISION_MODEL_CATALOG,
    );
    const catalog: unknown = c.resolve(DECISION_MODEL_CATALOG_TOKEN);
    expect(catalog).toBeDefined();
    expect(c.resolve(DECISION_MODEL_CATALOG_TOKEN)).toBe(catalog);

    const handlers = c.resolve(DecisionModelCatalogRpcHandlers);
    expect(handlers).toBeInstanceOf(DecisionModelCatalogRpcHandlers);
  });
});

describe('VS Code DI — lane outcomes', () => {
  it('registers outcomes once before CLI runtime and aliases after both libraries', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );
    const routing = source.indexOf(
      'registerLaneRoutingServices(container, logger);',
    );
    const outcomes = source.indexOf(
      'registerLaneOutcomeServices(container, logger);',
    );
    const runtime = source.indexOf(
      'registerCliAgentRuntimeServices(container, logger);',
    );
    expect(source).toContain('container.register(CLI_AGENT_RUNTIME_TOKENS.MCP_ATTACHMENT_PROBE, { useValue: mcpAttachmentObserver });');
    const reader = source.indexOf('useToken: LANE_OUTCOME_TOKENS.READER');
    const classifier = source.indexOf(
      'useToken: LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER',
    );
    expect(source.match(/registerLaneOutcomeServices\(/g)).toHaveLength(1);
    expect(routing).toBeGreaterThan(-1);
    expect(outcomes).toBeGreaterThan(routing);
    expect(outcomes).toBeLessThan(runtime);
    expect(reader).toBeGreaterThan(outcomes);
    expect(classifier).toBeGreaterThan(outcomes);
  });

  it('resolves both aliases and the durable VS Code store', () => {
    const c = buildMinimalContainer();
    const state = {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    };
    c.register(PLATFORM_TOKENS.STATE_STORAGE, { useValue: state });
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    registerLaneRoutingServices(c, logger);
    registerLaneOutcomeServices(c, logger);
    c.register(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER, {
      useToken: LANE_OUTCOME_TOKENS.READER,
    });
    c.register(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER, {
      useToken: LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER,
    });
    expect(c.resolve(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER)).toBe(
      c.resolve(LANE_OUTCOME_TOKENS.READER),
    );
    expect(c.resolve(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER)).toBe(
      c.resolve(LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER),
    );
    expect(c.resolve(LANE_OUTCOME_TOKENS.STORE)).toBeInstanceOf(
      KeyValueLaneOutcomeStore,
    );
    expect(state.get).toHaveBeenCalled();
  });
});

describe('VS Code DI — handlers that must NOT be constructed', () => {
  const profile = createVscodeRpcHostProfile({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Parameters<typeof createVscodeRpcHostProfile>[0]);

  const planned = new Set(
    resolveRpcHandlerPlan(profile).map((step) => step.ctor),
  );

  it.each(EXPECTED_ABSENT_HANDLERS.map((c) => [c.name, c] as const))(
    'never constructs %s',
    (_name, Ctor) => {
      expect(planned.has(Ctor as never)).toBe(false);
    },
  );

  it.each(EXPECTED_ABSENT_CAPABILITIES.map((c) => [c] as const))(
    'keeps the %s capability off',
    (capability) => {
      expect(profile.capabilities[capability]).toBe(false);
    },
  );
});

/**
 * `TOKENS.MAIN_LOOP_WATCHDOG` (TASK_2026_437) is bound by
 * `registerVsCodeCorePlatformAgnostic`, which this host reaches through
 * `libs/backend/vscode-core/src/di/register.ts`. Pinned here rather than in `expected-resolvable.ts`, which
 * lists RPC handler classes only (batches.md plan defect D2). Resolving must
 * NOT start the worker — arming belongs to `armDiagnostics`.
 */
describe('VS Code DI — main-loop watchdog (TASK_2026_437)', () => {
  it('resolves MAIN_LOOP_WATCHDOG as an unstarted singleton', () => {
    const c = rootContainer.createChildContainer();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });

    const watchdog = c.resolve<{
      running: boolean;
      setBreadcrumb: (key: string, value: string | number) => void;
    }>(TOKENS.MAIN_LOOP_WATCHDOG);

    expect(watchdog.running).toBe(false);
    expect(typeof watchdog.setBreadcrumb).toBe('function');
    expect(c.resolve(TOKENS.MAIN_LOOP_WATCHDOG)).toBe(watchdog);
  });
});

/**
 * `TOKENS.BACKGROUND_WORK_GOVERNOR` (TASK_2026_437 C14) is bound by
 * `registerVsCodeCorePlatformAgnostic`, which this host reaches through
 * `libs/backend/vscode-core/src/di/register.ts`. Pinned here rather than in `expected-resolvable.ts` (plan defect D2).
 * Resolving attaches no lag source and arms no timer; it starts clear.
 */
describe('VS Code DI — background-work governor (TASK_2026_437)', () => {
  it('resolves BACKGROUND_WORK_GOVERNOR as a clear singleton', () => {
    const c = rootContainer.createChildContainer();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    c.register(TOKENS.LOGGER, { useValue: logger });
    registerVsCodeCorePlatformAgnostic(c, logger, {
      includeLicensingAndAuth: false,
    });

    const governor = c.resolve<{
      isClear: () => boolean;
      whenClear: () => Promise<string>;
    }>(TOKENS.BACKGROUND_WORK_GOVERNOR);

    expect(governor.isClear()).toBe(true);
    expect(typeof governor.whenClear).toBe('function');
    expect(c.resolve(TOKENS.BACKGROUND_WORK_GOVERNOR)).toBe(governor);
  });
});

/**
 * `TOKENS.GIT_INFO_SERVICE` (TASK_2026_576 RC13) is bound by
 * `registerPhase3Handlers`. Cache invalidation from the worktree hook, the task
 * sweep and the file-link policy only reaches the next `git:*` RPC when every
 * resolver shares one instance.
 */
describe('VS Code DI — GitInfoService (TASK_2026_576 RC13)', () => {
  it('resolves GIT_INFO_SERVICE as one instance per container', () => {
    const c = rootContainer.createChildContainer();
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    c.register(TOKENS.LOGGER, { useValue: logger });
    // `registerChatServices` asserts phase 2 registered output-styles first.
    c.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} });
    // `registerPhase3Handlers` ends by constructing `SessionLifecycleNotifier`,
    // which subscribes to the SDK adapter bus and broadcasts to the webview.
    const unsubscribe = (): void => undefined;
    c.register(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      useValue: {
        onCompactionComplete: jest.fn(() => unsubscribe),
        onTurnEnded: jest.fn(() => unsubscribe),
        onTurnFailed: jest.fn(() => unsubscribe),
        onSubagentEnded: jest.fn(() => unsubscribe),
      },
    });
    c.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: { broadcastMessage: jest.fn() },
    });
    // ...and `TurnChangeSetRecorder` (TASK_2026_576 Component 19), which also
    // subscribes to prompt submits and reads session metadata and workspace
    // state. It is constructed only; none of these are called.
    c.register(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY, {
      useValue: { register: jest.fn(() => unsubscribe) },
    });
    c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, { useValue: {} });
    c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: { get: jest.fn(), update: jest.fn() },
    });

    registerPhase3Handlers(c, logger);

    const first = c.resolve<GitInfoService>(TOKENS.GIT_INFO_SERVICE);
    expect(first).toBeInstanceOf(GitInfoService);
    expect(c.resolve(TOKENS.GIT_INFO_SERVICE)).toBe(first);
  });
});

/**
 * `PLATFORM_TOKENS.WORKSPACE_WATCHER` (TASK_2026_437 C9) is bound in PHASE 0 by
 * `registerPlatformVscodeServices`, which `phase-0-platform.ts` calls. Pinned
 * here rather than in `expected-resolvable.ts` (plan defect D2). Resolving
 * creates no `FileSystemWatcher` — that happens per `watch` — and the instance
 * is on `context.subscriptions`, so deactivation disposes it.
 *
 * The registration runs against platform-vscode's stateful `vscode` double in
 * an isolated module registry: this app's shared `vscode` mock lacks the
 * window/workspace surface every phase-0 adapter touches, and swapping it for
 * the whole file would change what the handler suites above resolve against.
 */
describe('VS Code DI — workspace watcher (TASK_2026_437)', () => {
  it('resolves WORKSPACE_WATCHER from phase 0 as a context-disposed singleton', () => {
    let registerPlatformVscodeServices!: (
      container: DependencyContainer,
      context: unknown,
    ) => void;
    let vscodeDouble!: { workspace: { createFileSystemWatcher: jest.Mock } };
    jest.isolateModules(() => {
      jest.doMock('vscode', () =>
        jest.requireActual(
          '../../../../libs/backend/platform-vscode/__mocks__/vscode',
        ),
      );
      vscodeDouble = jest.requireMock('vscode');
      ({ registerPlatformVscodeServices } = jest.requireActual(
        '@ptah-extension/platform-vscode',
      ));
    });

    const storagePath = path.join(
      os.tmpdir(),
      `ptah-vscode-watch-di-${process.pid}`,
    );
    const subscriptions: Array<{ dispose(): unknown }> = [];
    const c = rootContainer.createChildContainer();
    registerPlatformVscodeServices(c, {
      extensionPath: storagePath,
      globalStorageUri: { fsPath: storagePath },
      storageUri: undefined,
      globalState: { get: jest.fn(), update: jest.fn(), keys: () => [] },
      secrets: {
        onDidChange: () => ({ dispose: jest.fn() }),
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
      },
      subscriptions,
    });

    const watcher = c.resolve<{ watch: unknown; dispose: () => void }>(
      PLATFORM_TOKENS.WORKSPACE_WATCHER,
    );
    expect(typeof watcher.watch).toBe('function');
    expect(c.resolve(PLATFORM_TOKENS.WORKSPACE_WATCHER)).toBe(watcher);
    expect(subscriptions).toContain(watcher);
    expect(
      vscodeDouble.workspace.createFileSystemWatcher,
    ).not.toHaveBeenCalled();
    for (const subscription of subscriptions) subscription.dispose();
  });
});
