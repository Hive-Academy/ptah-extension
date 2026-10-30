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
 * Why a hand-built minimal container (not `CliDIContainer.setup()`): the real
 * CLI container pulls in better-sqlite3 / sqlite-vec / tree-sitter WASM and a
 * long chain of adapters. The minimal container below registers exactly the
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
  TOKENS,
  registerVsCodeCorePlatformAgnostic,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IHostAttentionNotifications,
} from '@ptah-extension/platform-core';
import {
  LANE_ROUTING_TOKENS,
  registerLaneRoutingServices,
} from '@ptah-extension/lane-routing';
import {
  LANE_OUTCOME_TOKENS,
  registerLaneOutcomeServices,
} from '@ptah-extension/lane-outcomes';
import { createMockOutputChannel } from '@ptah-extension/platform-core/testing';
import {
  SDK_TOKENS,
  registerSdkServices,
  type PostToolUseCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { registerSkillSynthesisServices } from '@ptah-extension/skill-synthesis';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  ChildWorktreeProvisioner,
  LaneCompletionNotifier,
  registerCliAgentRuntimeServices,
} from '@ptah-extension/cli-agent-runtime';
import {
  SESSION_ORGANIZATION_TOKENS,
  registerSessionOrganizationServices,
  startSessionOrganization,
} from '@ptah-extension/session-organization';
import { registerVsCodeLmToolsServices } from '@ptah-extension/vscode-lm-tools';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import { PLUGIN_MARKETPLACE_TOKENS } from '@ptah-extension/plugin-marketplace';
import { HARNESS_SYNC_TOKENS } from '@ptah-extension/harness-sync';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  AgentRpcHandlers,
  DecisionModelCatalogRpcHandlers,
  PluginRpcHandlers,
  SetupRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { createCliWorkspaceWatcherOptions } from '@ptah-extension/cli-engine';
import {
  CliWorkspaceWatcher,
  registerPlatformCliServices,
} from '@ptah-extension/platform-cli';

import {
  DECISION_MODEL_CATALOG_TOKEN,
  DECISION_MODEL_CONFIG_TOKEN,
  EXPECTED_HOST_ATTENTION_TOKENS,
  EXPECTED_RESOLVABLE,
  LANE_MODEL_LISTING_TOKEN,
  STRUCTURED_DECISION_TOKEN,
} from './expected-resolvable';

describe('CLI DI — skill telemetry seam', () => {
  it('resolves after skill services register', () => {
    const child = rootContainer.createChildContainer();
    const logger = { info: jest.fn() } as unknown as Logger;
    child.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    child.registerInstance(PERSISTENCE_TOKENS.VEC_STATUS, {});
    // The seam reads through the owning stores, which inject the host Logger.
    child.registerInstance(TOKENS.LOGGER, logger);
    registerSkillSynthesisServices(child, logger);
    expect(() =>
      child.resolve(LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM),
    ).not.toThrow();
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
  c.register(TOKENS.SAVE_DIALOG_PROVIDER, {
    useValue: { showSaveDialog: jest.fn() },
  });
  c.register(TOKENS.PLATFORM_COMMANDS, {
    useValue: { executeCommand: jest.fn(), registerCommand: jest.fn() },
  });

  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceFolders: jest.fn(() => []),
      getConfiguration: jest.fn(() => ({ get: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });
  c.register(PLATFORM_TOKENS.SECRET_STORAGE, {
    useValue: {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
      has: jest.fn(),
    },
  });
  c.register(TOKENS.MODEL_DISCOVERY, {
    useValue: {
      listModels: jest.fn(async () => []),
    },
  });
  c.register(TOKENS.CONFIG_MANAGER, {
    useValue: {
      get: jest.fn(),
      set: jest.fn(async () => undefined),
    },
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
  // (TASK_2026_361). The real CLI container registers it with the rest of the
  // agent-generation services.
  c.register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
    useValue: {
      resolveAuthorizedAnalysisDir: jest.fn(),
      getAnalysisDir: jest.fn(),
    },
  });
  // Batch 11 `GenerationPreviewService` (injected into
  // `WizardGenerationRpcHandlers`) reads wizard agent origins through this.
  // The real CLI container registers it with the rest of the
  // agent-generation services.
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

  c.register<Pick<OpenRouterPricingService, 'getPricing'>>(OpenRouterPricingService, { useValue: { getPricing: jest.fn() } });
  c.register<Pick<SessionStatsReaderService, 'scanDatedUsage'>>(SessionStatsReaderService, { useValue: { scanDatedUsage: jest.fn() } });
  registerUsageAnalytics(c);
  registerSharedRpcHandlers(c);
  return c;
}

describe('CLI DI — shared RPC handler resolution', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
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
  const persistence = CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_CONFIG_PERSISTENCE;
  if (!c.isRegistered(persistence)) {
    c.register(persistence, { useValue: {} });
  }
}

/**
 * TASK_2026_701 B12/B13 (A-smoke). The CLI container registers
 * `PluginRpcHandlers` only; it does not register `SkillsSynthesisRpcHandlers`.
 * Handlers are registered in the host's handler phase, not by
 * `registerSharedRpcHandlers`, so they are not in the handler-only `EXPECTED_RESOLVABLE`. Resolving them over the
 * shared registrations proves the marketplace and Library services they
 * depend on (`CloneRebaseService`, `CloneProvenanceResolver`, and in Batch 20
 * the local-item approval and apply services) resolve. The host-phase
 * collaborators of `PluginRpcHandlers` are stubbed; their own wiring is
 * covered by the host's phase specs.
 */
describe('CLI DI — plugin and Library handler resolution (TASK_2026_701)', () => {
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

describe('CLI DI — lane model listing', () => {
  it('resolves LANE_MODEL_LISTING as one singleton', () => {
    const c = buildMinimalContainer();
    registerLaneModelListingFixtures(c);

    const first: unknown = c.resolve(LANE_MODEL_LISTING_TOKEN);

    expect(first).toBeDefined();
    expect(c.resolve(LANE_MODEL_LISTING_TOKEN)).toBe(first);
  });
});

describe('CLI DI — structured decision', () => {
  it('resolves STRUCTURED_DECISION as one singleton', () => {
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

describe('CLI DI — SDK budget-stop registry', () => {
  it('resolves the same registry instance on repeated requests', () => {
    const c = buildMinimalContainer();
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
    registerSdkServices(c, c.resolve<Logger>(TOKENS.LOGGER));
    const first = c.resolve(
      SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY,
    );
    expect(
      c.resolve(SDK_TOKENS.SDK_SUBAGENT_BUDGET_STOP_CALLBACK_REGISTRY),
    ).toBe(first);
    const idleCompaction = c.resolve(SDK_TOKENS.SDK_IDLE_COMPACTION);
    expect(c.resolve(SDK_TOKENS.SDK_IDLE_COMPACTION)).toBe(idleCompaction);
  });
});

describe('CLI DI — lane outcomes', () => {
  it('registers outcomes once before CLI runtime and aliases after both libraries', () => {
    const setup = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../libs/backend/cli-engine/src/lib/container.ts',
      ),
      'utf8',
    );
    const wiring = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts',
      ),
      'utf8',
    );
    const routing = setup.indexOf(
      'registerLaneRoutingServices(container, logger);',
    );
    const outcomes = setup.indexOf('wireLaneOutcomes(container, logger);');
    const runtime = setup.indexOf(
      'registerCliAgentRuntimeServices(container, logger);',
    );
    const register = wiring.indexOf(
      'registerLaneOutcomeServices(container, logger);',
    );
    const reader = wiring.indexOf('useToken: LANE_OUTCOME_TOKENS.READER');
    const classifier = wiring.indexOf(
      'useToken: LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER',
    );
    expect(wiring.match(/registerLaneOutcomeServices\(/g)).toHaveLength(1);
    expect(routing).toBeGreaterThan(-1);
    expect(outcomes).toBeGreaterThan(routing);
    expect(outcomes).toBeLessThan(runtime);
    expect(register).toBeGreaterThan(-1);
    expect(reader).toBeGreaterThan(register);
    expect(classifier).toBeGreaterThan(register);
  });

  it('resolves both aliases', () => {
    const c = buildMinimalContainer();
    c.register(PLATFORM_TOKENS.STATE_STORAGE, {
      useValue: {
        get: jest.fn(() => undefined),
        update: jest.fn(async () => undefined),
        keys: jest.fn(() => []),
      },
    });
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
  });
});

describe('CLI DI — decision model config (TL-59)', () => {
  it('registers lane routing once, before vscode-lm-tools and the RPC surface', () => {
    const setup = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../libs/backend/cli-engine/src/lib/container.ts',
      ),
      'utf8',
    );
    const lane = setup.indexOf(
      'registerLaneRoutingServices(container, logger);',
    );
    const lmTools = setup.indexOf(
      'registerVsCodeLmToolsServices(container, logger);',
    );
    const rpc = setup.indexOf(
      'registerRpcSurface(container, createCliRpcHostProfile(host));',
    );

    expect(setup.match(/registerLaneRoutingServices\(/g)).toHaveLength(1);
    expect(lane).toBeGreaterThan(-1);
    expect(lane).toBeLessThan(lmTools);
    expect(lmTools).toBeLessThan(rpc);
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

/**
 * `TOKENS.MAIN_LOOP_WATCHDOG` (TASK_2026_437) is bound by
 * `registerVsCodeCorePlatformAgnostic`, which this host reaches through
 * `libs/backend/cli-engine/src/lib/container.ts`. Pinned here rather than in `expected-resolvable.ts`, which
 * lists RPC handler classes only (batches.md plan defect D2). Resolving must
 * NOT start the worker — arming belongs to `armDiagnostics`.
 */
describe('CLI DI — main-loop watchdog (TASK_2026_437)', () => {
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
 * `libs/backend/cli-engine/src/lib/container.ts` (on every boot, `--verbose` or not). Pinned here rather than in `expected-resolvable.ts` (plan defect D2).
 * Resolving attaches no lag source and arms no timer; it starts clear.
 */
describe('CLI DI — background-work governor (TASK_2026_437)', () => {
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
 * `PLATFORM_TOKENS.WORKSPACE_WATCHER` (TASK_2026_437 C9) is bound in PHASE 0 by
 * `registerPlatformCliServices`, with the wiring
 * `libs/backend/cli-engine/src/lib/container.ts` passes. Pinned here rather
 * than in `expected-resolvable.ts` (plan defect D2). Resolving must fork
 * NOTHING — the host starts on the first `watch`.
 */
describe('CLI DI — workspace watcher (TASK_2026_437)', () => {
  // Left in the OS temp dir: the CLI output channel opens its log stream
  // asynchronously, and removing the directory under it fails that open.
  const userDataPath = path.join(
    os.tmpdir(),
    `ptah-cli-watch-di-${process.pid}`,
  );

  afterAll(() => jest.restoreAllMocks());

  it('resolves WORKSPACE_WATCHER from phase 0 as an unforked singleton', () => {
    const c = rootContainer.createChildContainer();
    const nodeChildProcess =
      jest.requireActual<typeof import('node:child_process')>(
        'node:child_process',
      );
    const fork = jest.spyOn(nodeChildProcess, 'fork');
    // A fresh user data dir has no settings.json; its load warning is noise here.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bundleDir = path.join(userDataPath, 'dist', 'apps', 'ptah-cli');
    const workspaceWatchHost = createCliWorkspaceWatcherOptions(c, bundleDir);

    registerPlatformCliServices(c, {
      appPath: bundleDir,
      userDataPath,
      workspacePath: userDataPath,
      logsPath: path.join(userDataPath, 'logs'),
      workspaceWatchHost,
    });

    // The same file for `main.mjs` and `tui.mjs`, which share this directory.
    expect(workspaceWatchHost.hostPath).toBe(
      path.join(bundleDir, 'workspace-watch-host.mjs'),
    );
    const watcher = c.resolve<CliWorkspaceWatcher>(
      PLATFORM_TOKENS.WORKSPACE_WATCHER,
    );
    expect(
      c.resolve<IHostAttentionNotifications>(
        EXPECTED_HOST_ATTENTION_TOKENS.notifications,
      ).isEligible(),
    ).toBe(false);
    expect(watcher).toBeInstanceOf(CliWorkspaceWatcher);
    expect(c.resolve(PLATFORM_TOKENS.WORKSPACE_WATCHER)).toBe(watcher);
    expect(fork).not.toHaveBeenCalled();
    watcher.dispose();
  });
});

/**
 * Session organization (TASK_2026_580, risk R-TL11, B2 follow-up).
 *
 * `WorktreeHookHandler`, `SessionForkService`, `PtahAPIBuilder` and the 584
 * `SessionSpawnerService` (R-TL8) are singletons that take
 * `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` as an OPTIONAL constructor
 * argument. One resolved before `registerThothLibraries`
 * binds the recorder keeps `undefined` for the life of the process and
 * silently never records. Capture also subscribes to the PostToolUse registry;
 * without it, `startSessionOrganization` reports a non-fatal failure and no PR
 * is captured.
 *
 * `CliDIContainer.setup()` cannot run under Jest (see the header and
 * `cli-engine/src/lib/container-diagnostics-override.spec.ts`), so the call
 * order is pinned by reading the cli-engine source, and the registrations run
 * for real in that order: `registerSdkServices`, the session-organization pair
 * inside `registerThothLibraries`, then `registerVsCodeLmToolsServices`.
 */
describe('CLI DI — session organization recorder binding (TASK_2026_580 R-TL11)', () => {
  const cliEngineLib = path.resolve(
    __dirname,
    '../../../../libs/backend/cli-engine/src/lib',
  );

  it('registers and starts session organization once, after the SDK and SQLite registrations', () => {
    const thoth = fs.readFileSync(
      path.join(cliEngineLib, 'thoth', 'register-thoth-libraries.ts'),
      'utf8',
    );
    const at = (source: string, call: string): number => {
      const index = source.indexOf(call);
      expect(index).toBeGreaterThan(-1);
      return index;
    };

    expect(thoth.match(/registerSessionOrganizationServices\(/g)).toHaveLength(
      1,
    );
    expect(thoth.match(/startSessionOrganization\(/g)).toHaveLength(1);
    const register = at(
      thoth,
      'registerSessionOrganizationServices(container);',
    );
    expect(
      at(thoth, 'registerPersistenceSqliteServices(container, logger);'),
    ).toBeLessThan(register);
    expect(at(thoth, 'startTaskSpecsIndex(container, logger);')).toBeLessThan(
      register,
    );
    expect(register).toBeLessThan(
      at(thoth, 'startSessionOrganization(container);'),
    );
    expect(thoth).not.toMatch(
      /SDK_WORKTREE_HOOK_HANDLER|SDK_SESSION_FORK_SERVICE|PTAH_API_BUILDER|SESSION_SPAWNER/,
    );

    const setup = fs.readFileSync(
      path.join(cliEngineLib, 'container.ts'),
      'utf8',
    );
    const thothCall = at(setup, 'registerThothLibraries(container, logger);');
    expect(at(setup, 'registerSdkServices(container, logger);')).toBeLessThan(
      thothCall,
    );
    expect(thothCall).toBeLessThan(
      at(setup, 'registerVsCodeLmToolsServices(container, logger);'),
    );
    // The spawner (R-TL8) is never resolved before the recorder is bound.
    const spawnerAt = setup.indexOf('SESSION_SPAWNER');
    expect(spawnerAt === -1 || spawnerAt > thothCall).toBe(true);
  });

  /**
   * The phase-1 bindings plus phase 2 in production order. The connection is
   * never opened. `withCliAgentRuntime` adds the runtime registration (before
   * `registerThothLibraries` in `container.ts`) with the spawner's run
   * collaborators stubbed, so constructing the spawner touches only the SDK
   * registries and the recorder.
   */
  function composePhase2(withCliAgentRuntime: boolean) {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    const output = createMockOutputChannel();
    c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, { useValue: output });
    // `registerSdkServices` eagerly resolves `SDK_CONFIG_WATCHER`, whose
    // constructor subscribes to both of these.
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
    // Phase 1 binds this in production; `SessionMetadataStore` injects it.
    c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: {
        get: jest.fn(() => undefined),
        update: jest.fn(async () => undefined),
        keys: jest.fn(() => []),
      },
    });

    c.register(EXPECTED_HOST_ATTENTION_TOKENS.notifications, {
      useValue: {
        isEligible: () => false,
        present: jest.fn(),
        resolve: jest.fn(),
        open: jest.fn(),
        dispose: jest.fn(),
      },
    });
    registerSdkServices(c, logger);
    expect(c.resolve(EXPECTED_HOST_ATTENTION_TOKENS.coordinator)).toBeDefined();
    if (withCliAgentRuntime) {
      registerCliAgentRuntimeServices(c, logger);
      for (const token of [
        TOKENS.AGENT_PROCESS_MANAGER,
        TOKENS.CLI_DETECTION_SERVICE,
        TOKENS.AGENT_ADAPTER,
        ChildWorktreeProvisioner,
        LaneCompletionNotifier,
        SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER,
        MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER,
      ] as InjectionToken[]) {
        c.register(token, { useValue: {} });
      }
      // The constructor subscribes to prompt lifecycle events.
      c.register(SDK_TOKENS.SDK_PERMISSION_HANDLER, {
        useValue: { onPromptLifecycle: () => () => undefined },
      });
      // `AgentSpawnEnvironment` (not exported) is built for real; these two of
      // its dependencies are bound by other libraries in production.
      for (const token of [
        SETTINGS_TOKENS.REASONING_SETTINGS,
        TOKENS.SENTRY_SERVICE,
      ]) {
        if (!c.isRegistered(token, true)) c.register(token, { useValue: {} });
      }
    }
    // Never opened: the store-open signal is subscribed but never fires.
    c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: {
        isOpen: false,
        onDidOpen: () => ({ dispose: () => undefined }),
      },
    });
    // Bound by the platform registration (phase 1) in production; the
    // auto-link service reads worktree pointers and task.md through it.
    if (!c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, true)) {
      c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { useValue: {} });
    }
    registerSessionOrganizationServices(c);
    startSessionOrganization(c);
    return { c, logger, output };
  }

  it('the bound recorder reaches all three producers and capture subscribes to PostToolUse', () => {
    const { c, logger, output } = composePhase2(false);

    // Phase 4. Required producer dependencies unrelated to this check (bound
    // by other libraries in production) are bare stubs, as in
    // `ptah-extension-vscode/src/di/surface-composition.spec.ts`.
    c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
    registerVsCodeLmToolsServices(c, logger);
    for (const token of [
      AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER,
      SDK_TOKENS.PRICING_PROVIDER,
      TOKENS.GIT_INFO_SERVICE,
      TOKENS.SUBAGENT_REGISTRY_SERVICE,
      TOKENS.WEBVIEW_MANAGER,
      MEMORY_CONTRACT_TOKENS.MEMORY_READER,
      MEMORY_CONTRACT_TOKENS.MEMORY_LISTER,
      PLATFORM_TOKENS.PLATFORM_INFO,
      PLUGIN_MARKETPLACE_TOKENS.STATE_STORE,
      TOKENS.WORKSPACE_ANALYZER_SERVICE,
      TOKENS.FILE_SYSTEM_MANAGER,
      TOKENS.CONTEXT_SIZE_OPTIMIZER,
      TOKENS.MONOREPO_DETECTOR_SERVICE,
      TOKENS.DEPENDENCY_ANALYZER_SERVICE,
      TOKENS.FILE_RELEVANCE_SCORER,
      TOKENS.TOKEN_COUNTER_SERVICE,
      TOKENS.WORKSPACE_INDEXER_SERVICE,
      TOKENS.PROJECT_DETECTOR_SERVICE,
      TOKENS.CONTEXT_ENRICHMENT_SERVICE,
      TOKENS.DEPENDENCY_GRAPH_SERVICE,
      TOKENS.TREE_SITTER_PARSER_SERVICE,
      TOKENS.AST_ANALYSIS_SERVICE,
      TOKENS.AGENT_PROCESS_MANAGER,
      TOKENS.CLI_DETECTION_SERVICE,
      PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER,
      PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER,
    ]) {
      if (!c.isRegistered(token, true)) c.register(token, { useValue: {} });
    }

    const recorder = c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER);
    expect(recorder).toBe(c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE));
    expect(
      c.resolve<{ recorder: unknown }>(SDK_TOKENS.SDK_WORKTREE_HOOK_HANDLER)
        .recorder,
    ).toBe(recorder);
    expect(
      c.resolve<{ recorder: unknown }>(SDK_TOKENS.SDK_SESSION_FORK_SERVICE)
        .recorder,
    ).toBe(recorder);
    expect(
      c.resolve<{ sessionOrganizationRecorder: unknown }>(
        TOKENS.PTAH_API_BUILDER,
      ).sessionOrganizationRecorder,
    ).toBe(recorder);

    // B2: the registry is bound on this host and capture actually subscribed.
    expect(
      c.isRegistered(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY, true),
    ).toBe(true);
    expect(
      c.resolve<PostToolUseCallbackRegistry>(
        SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
      ).size,
    ).toBeGreaterThan(0);
    // TASK_2026_854: auto-link subscribed to both prompt registries and the
    // session-id registry (next to capture's own subscription there).
    for (const token of [
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
      SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY,
      SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    ]) {
      expect(c.resolve<{ size: number }>(token).size).toBeGreaterThan(0);
    }
    expect(
      c.resolve<{ size: number }>(
        SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
      ).size,
    ).toBeGreaterThan(1);
    expect(
      output.__state.lines.filter((line) =>
        line.startsWith('[SessionOrganization]'),
      ),
    ).toEqual([]);
  });

  it('resolves one lane instruction file store for the CLI runtime', () => {
    const { c } = composePhase2(true);
    // The platform layer binds the file system in production; this harness
    // composes phase 2 only.
    if (!c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, true)) {
      c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, { useValue: {} });
    }
    const token = CLI_AGENT_RUNTIME_TOKENS.LANE_INSTRUCTION_FILE_STORE;
    expect(c.resolve(token)).toBe(c.resolve(token));
  });

  it('the bound recorder reaches the child-session spawner (R-TL8)', () => {
    const { c } = composePhase2(true);

    const recorder = c.resolve(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER);
    expect(recorder).toBe(c.resolve(SESSION_ORGANIZATION_TOKENS.SERVICE));
    expect(
      c.resolve<{ organizationRecorder: unknown }>(
        CLI_AGENT_RUNTIME_TOKENS.SESSION_SPAWNER,
      ).organizationRecorder,
    ).toBe(recorder);
  });
});
