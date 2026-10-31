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
 * Why a hand-built minimal container (not `ElectronDIContainer.setup()`):
 * the real container pulls in better-sqlite3, sqlite-vec, the Anthropic SDK,
 * Electron, the embedder worker, and more — none of which can boot under
 * Jest without elaborate mocks. The minimal container registers exactly the
 * tokens these handlers `@inject`, so any future drift between decorator and
 * registration immediately fails this test.
 */

import 'reflect-metadata';
import {
  ClaudeAmbientLoginStatusReader,
  ClaudeNamedAccountPersistence,
  OpenRouterPricingService,
  ProviderAccountService,
  registerAuthProvidersServices,
} from '@ptah-extension/auth-providers';
import {
  SDK_NAMED_ACCOUNT_PERSISTENCE,
  SDK_SESSION_IMPORT_BINDING_LOOKUP,
  SessionStatsReaderService,
} from '@ptah-extension/agent-sdk';
import {
  registerUsageAnalytics,
  USAGE_ANALYTICS_TOKENS,
} from '@ptah-extension/usage-analytics';

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
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  LANE_ROUTING_TOKENS,
  registerLaneRoutingServices,
} from '@ptah-extension/lane-routing';
import { createMockOutputChannel } from '@ptah-extension/platform-core/testing';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import {
  SDK_TOKENS,
  registerSdkServices,
  type PostToolUseCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  LANE_OUTCOME_TOKENS,
  registerLaneOutcomeServices,
} from '@ptah-extension/lane-outcomes';
import { registerSkillSynthesisServices } from '@ptah-extension/skill-synthesis';
import {
  CLAUDE_LANE_ACCOUNT_PERSISTENCE,
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
  AuthRpcHandlers,
  DecisionModelCatalogRpcHandlers,
  LanePlanLimitsRpcHandlers,
  PluginRpcHandlers,
  ProviderAccountRpcHandlers,
  SetupRpcHandlers,
  SkillsSynthesisRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';

import {
  DECISION_MODEL_CATALOG_TOKEN,
  DECISION_MODEL_CONFIG_TOKEN,
  EXPECTED_RESOLVABLE,
  EXPECTED_RESOLVABLE_TOKENS,
  HOST_ATTENTION_COORDINATOR_TOKEN,
  LANE_MODEL_LISTING_TOKEN,
  STRUCTURED_DECISION_TOKEN,
} from './expected-resolvable';
import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';
import { registerPhase4Handlers } from './phase-4-handlers';
import { registerClaudeNamedAccountBindings } from './claude-named-account-bindings';
import { UPDATE_MANAGER_TOKEN } from '../services/update/update-tokens';
import { createElectronRpcHostProfile } from '../rpc-host-profile';

describe('Electron DI — host attention coordinator', () => {
  it('resolves the phase-2 singleton independently of handler classes', () => {
    const c = buildMinimalContainer();
    c.register(PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS, {
      useValue: {
        present: jest.fn(),
        resolve: jest.fn(),
        isEligible: jest.fn(() => false),
        open: jest.fn(),
        dispose: jest.fn(),
      },
    });
    c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: { getWorkspaceRoot: jest.fn(() => null) },
    });
    registerSdkServices(c, c.resolve<Logger>(TOKENS.LOGGER));
    c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
      useValue: { get: jest.fn(), getAll: jest.fn() },
    });
    const coordinator = c.resolve(HOST_ATTENTION_COORDINATOR_TOKEN);
    expect(coordinator).toBeDefined();
    expect(c.resolve(HOST_ATTENTION_COORDINATOR_TOKEN)).toBe(coordinator);
  });
});

describe('Electron DI — skill telemetry seam', () => {
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
  c.register(PLATFORM_TOKENS.HOST_ATTENTION_NOTIFICATIONS, {
    useValue: {
      present: jest.fn(),
      resolve: jest.fn(),
      isEligible: jest.fn(() => false),
      open: jest.fn(),
      dispose: jest.fn(),
    },
  });

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
  // `watch` / `onDidChange` are here for `registerSdkServices`, which EAGERLY
  // resolves `SDK_CONFIG_WATCHER` (`agent-sdk/src/lib/di/register.ts:502`) and
  // whose constructor subscribes to both. The shared handler describe never
  // touches them.
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
  c.register(PLATFORM_TOKENS.EDITOR_PROVIDER, {
    useValue: { notifyFileOpened: jest.fn() },
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
  // `RecentWorkspacesService` (TASK_2026_721) persists its MRU list here. The
  // real Electron container binds it in `platform-electron/src/registration.ts`.
  c.register(PLATFORM_TOKENS.STATE_STORAGE, {
    useValue: {
      get: jest.fn(() => undefined),
      update: jest.fn(async () => undefined),
      keys: jest.fn(() => []),
    },
  });
  // `EditorRpcHandlers`, `FileViewRpcHandlers` and `FileEditRpcHandlers` inject
  // `FileLinkRootPolicy`, which needs GitInfoService to widen the authorized
  // root set to a registered folder's worktrees (TASK_2026_413 Batch 8a). The
  // real Electron container binds this in `phase-4-handlers.ts`.
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

  c.register<Pick<OpenRouterPricingService, 'getPricing'>>(
    OpenRouterPricingService,
    { useValue: { getPricing: jest.fn() } },
  );
  c.register<Pick<SessionStatsReaderService, 'scanDatedUsage'>>(
    SessionStatsReaderService,
    { useValue: { scanDatedUsage: jest.fn() } },
  );
  registerUsageAnalytics(c);
  registerSharedRpcHandlers(c);
  return c;
}

describe('Electron DI — shared RPC handler resolution', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
  });

  it('resolves the usage analytics service token', () => {
    expect(
      c.resolve(USAGE_ANALYTICS_TOKENS.USAGE_ANALYTICS_SERVICE),
    ).toBeDefined();
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

describe('Electron DI — provider accounts (TASK_2026_712 D32)', () => {
  it('resolves ProviderAccountRpcHandlers once and registers exactly its eleven methods', () => {
    const c = buildMinimalContainer();
    c.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: { broadcastMessage: jest.fn(async () => undefined) },
    });
    c.register<Pick<ProviderAccountService, 'list'>>(ProviderAccountService, {
      useValue: { list: jest.fn(() => []) },
    });
    // The ambient login read (P5) is injected by class; a stub stands in.
    c.register<Pick<ClaudeAmbientLoginStatusReader, 'read'>>(
      ClaudeAmbientLoginStatusReader,
      {
        useValue: {
          read: jest.fn(async () => ({
            state: 'signed-out' as const,
            checkedAt: null,
          })),
        },
      },
    );
    // The handler injects the actions port by its token (Batch 17).
    const unsubscribe = jest.fn();
    const actions = {
      readStatus: jest.fn(),
      startSignIn: jest.fn(),
      cancelSignIn: jest.fn(),
      signOut: jest.fn(),
      onStateChanged: jest.fn(() => unsubscribe),
    };
    c.register(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ACTIONS, {
      useValue: actions,
    });

    const handlers = c.resolve(ProviderAccountRpcHandlers);
    expect(handlers).toBeInstanceOf(ProviderAccountRpcHandlers);
    expect(c.resolve(ProviderAccountRpcHandlers)).toBe(handlers);

    const rpcHandler = c.resolve<{ registerMethod: jest.Mock }>(
      TOKENS.RPC_HANDLER,
    );
    rpcHandler.registerMethod.mockClear();
    handlers.register();
    expect(actions.onStateChanged).toHaveBeenCalledTimes(1);
    const registered = rpcHandler.registerMethod.mock.calls.map(
      ([method]) => method as string,
    );
    expect([...registered].sort()).toEqual(
      [...ProviderAccountRpcHandlers.METHODS].sort(),
    );
    expect(registered).toContain('provider:getAmbientClaudeStatus');
    expect(registered).toHaveLength(11);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('the Electron host profile turns providerAccounts on', () => {
    const c = buildMinimalContainer();
    const profile = createElectronRpcHostProfile(
      c,
      c.resolve<Logger>(TOKENS.LOGGER),
    );
    expect(profile.capabilities.providerAccounts).toBe(true);
  });
});

/**
 * Named Claude account persistence (TASK_2026_719 B17). Runs the REAL
 * auth-providers and agent-sdk registrations in phase 2 order, then the REAL
 * Electron binding helper. `phase-2-libraries.ts` cannot load under Jest, so
 * its call site is pinned by reading the source.
 */
describe('Electron DI — named Claude account persistence (TASK_2026_719 B17)', () => {
  function buildAccountsContainer(withSqlite: boolean): DependencyContainer {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    registerAuthProvidersServices(c, logger);
    registerSdkServices(c, logger);
    // Leaf stubs for collaborators whose own graphs this harness does not
    // bind. The assertions cover only the account persistence slots.
    for (const token of [
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
      SDK_TOKENS.SDK_RUNTIME_STATE,
      SDK_TOKENS.SDK_MODULE_LOADER,
      SDK_TOKENS.SDK_SUBAGENT_HOOK_HANDLER,
      SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER,
      SDK_TOKENS.SDK_MODEL_SERVICE,
    ]) {
      c.register(token, { useValue: {} });
    }
    c.register(PLATFORM_TOKENS.PLATFORM_INFO, {
      useValue: { platform: process.platform },
    });
    c.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
      useValue: {
        saveAccountBound: jest.fn(async () => undefined),
        resolveAccountBinding: jest.fn(async () => null),
      },
    });
    c.register<Pick<ProviderAccountService, 'readStoredSelection'>>(
      ProviderAccountService,
      {
        useValue: {
          readStoredSelection: jest.fn(async () => ({ profileId: null })),
        },
      },
    );
    if (withSqlite) {
      c.registerInstance(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {});
    }
    return c;
  }

  it('binds the three tokens to one adapter and the query runner holds it', () => {
    const c = buildAccountsContainer(true);
    expect(registerClaudeNamedAccountBindings(c)).toBe(true);

    const adapter = c.resolve(ClaudeNamedAccountPersistence);
    expect(adapter).toBeInstanceOf(ClaudeNamedAccountPersistence);
    expect(c.resolve(SDK_NAMED_ACCOUNT_PERSISTENCE)).toBe(adapter);
    expect(c.resolve(SDK_SESSION_IMPORT_BINDING_LOOKUP)).toBe(adapter);
    expect(c.resolve(CLAUDE_LANE_ACCOUNT_PERSISTENCE)).toBe(adapter);
    expect(
      c.resolve(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_SELECTION_READER),
    ).not.toBeNull();

    const runner = c.resolve<{ accountPersistence: unknown }>(
      SDK_TOKENS.SDK_QUERY_RUNNER,
    );
    expect(runner.accountPersistence).not.toBeNull();
    expect(runner.accountPersistence).toBe(adapter);
  });

  it('keeps the null defaults when SQLITE_CONNECTION is not registered', () => {
    const c = buildAccountsContainer(false);
    expect(registerClaudeNamedAccountBindings(c)).toBe(false);
    expect(c.resolve(SDK_NAMED_ACCOUNT_PERSISTENCE)).toBeNull();
    expect(c.resolve(SDK_SESSION_IMPORT_BINDING_LOOKUP)).toBeNull();
    expect(c.isRegistered(CLAUDE_LANE_ACCOUNT_PERSISTENCE, true)).toBe(false);
    const runner = c.resolve<{ accountPersistence: unknown }>(
      SDK_TOKENS.SDK_QUERY_RUNNER,
    );
    expect(runner.accountPersistence).toBeNull();
  });

  it('phase 2 calls the binding helper after the SQLite block', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );
    const sqlite = source.indexOf(
      'registerPersistenceSqliteServices(container, logger);',
    );
    const bind = source.indexOf(
      'registerClaudeNamedAccountBindings(container)',
    );
    const sdk = source.indexOf('registerSdkServices(container, logger);');
    expect(sqlite).toBeGreaterThan(-1);
    expect(sdk).toBeGreaterThan(-1);
    expect(bind).toBeGreaterThan(sqlite);
    expect(bind).toBeGreaterThan(sdk);
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
 * TASK_2026_701 B12/B13 (A-smoke). Electron registers both
 * `PluginRpcHandlers` and `SkillsSynthesisRpcHandlers`. They are registered
 * in the host's handler phase, not by `registerSharedRpcHandlers`, so they
 * are not in the handler-only `EXPECTED_RESOLVABLE`. Resolving them over the
 * shared registrations proves the marketplace and Library services they
 * depend on (`CloneRebaseService`, `CloneProvenanceResolver`, and in Batch 20
 * the local-item approval and apply services) resolve. The host-phase
 * collaborators of `PluginRpcHandlers` are stubbed; their own wiring is
 * covered by the host's phase specs.
 */
describe('Electron DI — plugin and Library handler resolution (TASK_2026_701)', () => {
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
    ['SkillsSynthesisRpcHandlers', SkillsSynthesisRpcHandlers],
  ] as const)('resolves %s', (_name, token) => {
    let instance: unknown;
    expect(() => {
      instance = c.resolve<unknown>(token);
    }).not.toThrow();
    expect(instance).toBeDefined();
  });
});

describe('Electron DI — lane model listing', () => {
  it('resolves LANE_MODEL_LISTING as one singleton', () => {
    const c = buildMinimalContainer();
    registerLaneModelListingFixtures(c);

    const first: unknown = c.resolve(LANE_MODEL_LISTING_TOKEN);

    expect(first).toBeDefined();
    expect(c.resolve(LANE_MODEL_LISTING_TOKEN)).toBe(first);
  });
});

describe('Electron DI — structured decision', () => {
  it('resolves STRUCTURED_DECISION as one singleton', () => {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
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

describe('Electron DI — decision model config (TL-59)', () => {
  it('registers lane routing once, before vscode-lm-tools and the RPC surface', () => {
    const phase2 = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );
    expect(phase2.match(/registerLaneRoutingServices\(/g)).toHaveLength(1);
    expect(phase2).toContain('registerLaneRoutingServices(container, logger);');

    const di = fs.readFileSync(path.join(__dirname, 'container.ts'), 'utf8');
    expect(di.indexOf('registerPhase2Libraries(root')).toBeLessThan(
      di.indexOf('registerPhase3Storage(root'),
    );
    const phase3 = fs.readFileSync(
      path.join(__dirname, 'phase-3-storage.ts'),
      'utf8',
    );
    expect(
      phase3.indexOf('registerVsCodeLmToolsServices(container, logger);'),
    ).toBeGreaterThan(-1);

    const main = fs.readFileSync(path.join(__dirname, '../main.ts'), 'utf8');
    expect(main.indexOf('bootstrapElectron(')).toBeLessThan(
      main.indexOf('wireRuntimePreWindow('),
    );
    const wire = fs.readFileSync(
      path.join(__dirname, '../activation/wire-runtime.ts'),
      'utf8',
    );
    expect(wire.indexOf('registerRpcSurface(')).toBeGreaterThan(-1);
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

describe('Electron DI — lane outcomes', () => {
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
    expect(source).toMatch(
      /container\.register\(CLI_AGENT_RUNTIME_TOKENS\.MCP_ATTACHMENT_PROBE,\s*\{\s*useValue: mcpAttachmentObserver,\s*\}\);/,
    );
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
    expect(source).toContain(
      'useToken: LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER',
    );
    expect(source).toContain('observeSubagentEnded: true');
  });

  it('resolves the lane-routing and lane-outcome aliases', () => {
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
    c.register(LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER, {
      useToken: LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER,
    });
    expect(c.resolve(LANE_ROUTING_TOKENS.LANE_OUTCOME_READER)).toBe(
      c.resolve(LANE_OUTCOME_TOKENS.READER),
    );
    expect(c.resolve(LANE_OUTCOME_TOKENS.FAILURE_CLASSIFIER)).toBe(
      c.resolve(LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER),
    );
    expect(c.resolve(LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER)).toBe(
      c.resolve(LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER),
    );
  });
});

describe('Electron DI — trusted host kind', () => {
  it('resolves HOST_KIND as electron after phase 1 registration', () => {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    const userDataPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ptah-host-kind-'),
    );

    try {
      registerPhase1Infra(
        c,
        {
          appPath: userDataPath,
          userDataPath,
          logsPath: path.join(userDataPath, 'logs'),
          safeStorage: {
            isEncryptionAvailable: () => false,
            encryptString: (value: string) => Buffer.from(value),
            decryptString: (value: Buffer) => value.toString(),
          },
          dialog: {} as never,
          getWindow: () => null,
        },
        logger,
      );

      expect(c.resolve(PLATFORM_TOKENS.HOST_KIND)).toBe('electron');
    } finally {
      fs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});

/**
 * The aliasing describe below calls `registerPhase4Handlers` on its own, so it
 * has to satisfy phase 4's phase-2 precondition itself.
 *
 * `registerPhase4Handlers` calls `registerChatServices`, which THROWS at
 * registration time — not at resolve time — unless
 * `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION` is already bound
 * (`rpc-handlers/src/lib/chat/di.ts`). `ChatSessionService` injects it and
 * `output-styles` owns it, so the precondition is cross-lib and cross-phase.
 *
 * The shipped Electron boot satisfies it three phases earlier —
 * `phase-2-libraries.ts:188` via `container.ts:43`, before
 * `phase-4-handlers.ts:85` via `container.ts:45` — so the ordering fault was
 * only ever in this harness. Calls the REAL `registerOutputStyleServices`
 * rather than stubbing the token, so the harness keeps tracking phase 2 if that
 * contract moves.
 */
function buildPhase4Container(): { c: DependencyContainer; logger: Logger } {
  const c = rootContainer.createChildContainer();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;

  registerOutputStyleServices(c, logger);
  // The isolated phase-4 alias test supplies the earlier-phase tokens that
  // registerHostRouting validates at registration time.
  for (const token of [
    LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING,
    LANE_ROUTING_TOKENS.SCOPE_CHECK_SERVICE,
    LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE,
    LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
    SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE,
    TOKENS.PTAH_API_BUILDER,
  ]) {
    c.register(token, { useValue: {} });
  }

  return { c, logger };
}

/**
 * `SDK_TOKENS.SDK_PROCESS_SPAWNER` must be resolvable by a phase-4 handler
 * (TASK_2026_385, plan Assumption 1).
 *
 * The Electron boot registers it in phase 2 (`phase-2-libraries.ts` ->
 * `registerSdkServices`), several phases before `registerPhase4Handlers` runs,
 * so a handler constructed in phase 4 can `@inject` it. This asserts that
 * ordering against the REAL `registerSdkServices`, not a hand-written
 * `container.register` copy of it — a copy would keep passing after the
 * production registration moved or was dropped.
 *
 * `OffThreadProcessSpawner` is the one implementation and its only dependency
 * is `TOKENS.LOGGER`, which the minimal container already provides.
 */
describe('Electron DI — SDK process spawner (plan Assumption 1)', () => {
  it('resolves SDK_PROCESS_SPAWNER from a container that has run phase 2', () => {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);

    registerSdkServices(c, logger);

    const spawner = c.resolve(SDK_TOKENS.SDK_PROCESS_SPAWNER);

    expect(spawner).toBeDefined();
    expect(typeof (spawner as { spawnProcess: unknown }).spawnProcess).toBe(
      'function',
    );
  });
});

describe('Electron DI — SDK budget-stop registry', () => {
  it('resolves the same registry instance on repeated requests', () => {
    const c = buildMinimalContainer();
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

/**
 * Risk R1 — duplicate `UpdateManager` instance.
 *
 * `PLATFORM_TOKENS.APP_UPDATER` must be an ALIAS of `UPDATE_MANAGER_TOKEN`,
 * never a second registration. `activation/post-window.ts` resolves
 * `UPDATE_MANAGER_TOKEN` and calls `start()`, which performs the GitHub
 * Releases check and mutates the manager's private `_currentState`; `main.ts`
 * disposes that same instance on will-quit. A second `UpdateManager` would be
 * the one `update:get-state` reads, so it would answer `{state:'idle'}` forever
 * — the update dialog would never appear and nothing would throw.
 *
 * This asserts against the REAL wiring in `registerPhase4Handlers`, not a copy
 * of it, and it asserts reference identity (`toBe`): the two unions are
 * structurally identical, so `toEqual` would pass under a duplicate-instance
 * wiring and prove nothing.
 */
describe('Electron DI — app updater token aliasing (Risk R1)', () => {
  it('resolves APP_UPDATER to the very same instance as UPDATE_MANAGER_TOKEN', () => {
    const { c, logger } = buildPhase4Container();
    // UpdateManager is @injectable and injects these three; they are its
    // constructor dependencies, not part of the wiring under test.
    c.register(TOKENS.LOGGER, { useValue: logger });
    c.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: { broadcastMessage: jest.fn(async () => undefined) },
    });
    c.register(PLATFORM_TOKENS.STATE_STORAGE, {
      useValue: {
        get: jest.fn(() => undefined),
        update: jest.fn(async () => undefined),
        keys: jest.fn(() => []),
      },
    });

    registerPhase4Handlers(c, logger);
    expect(c.isRegistered(EXPECTED_RESOLVABLE_TOKENS[0][1])).toBe(true);

    const viaPort = c.resolve(PLATFORM_TOKENS.APP_UPDATER);
    const viaConcreteToken = c.resolve(UPDATE_MANAGER_TOKEN);

    expect(viaPort).toBeDefined();
    expect(viaPort).toBe(viaConcreteToken);
  });
});

/**
 * `PLATFORM_TOKENS.WORKSPACE_WATCHER` (TASK_2026_437 C8) is bound in PHASE 0,
 * by the real `registerPhase0Platform`, so every later phase and the heavy boot
 * can inject it. Pinned here rather than in `expected-resolvable.ts` (plan
 * defect D2). Resolving must fork NOTHING — the host starts on the first
 * `watch` — and `will-quit` must get the very instance consumers hold.
 */
describe('Electron DI — workspace watcher (TASK_2026_437)', () => {
  it('resolves WORKSPACE_WATCHER from phase 0 as an unforked singleton', () => {
    const c = rootContainer.createChildContainer();
    const userDataPath = path.join(os.tmpdir(), `ptah-watch-di-${Date.now()}`);
    const fork = jest.fn();

    registerPhase0Platform(c, {
      appPath: userDataPath,
      userDataPath,
      logsPath: path.join(userDataPath, 'logs'),
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value: string) => Buffer.from(value),
        decryptString: (value: Buffer) => value.toString(),
      },
      dialog: {} as never,
      getWindow: () => null,
      workspaceWatchHost: { host: { fork } },
    });

    const watcher = c.resolve<{ watch: unknown; dispose: unknown }>(
      PLATFORM_TOKENS.WORKSPACE_WATCHER,
    );
    expect(typeof watcher.watch).toBe('function');
    expect(typeof watcher.dispose).toBe('function');
    expect(c.resolve(PLATFORM_TOKENS.WORKSPACE_WATCHER)).toBe(watcher);
    expect(fork).not.toHaveBeenCalled();
  });

  it('phase 0 supplies the production host wiring when the caller passes none', () => {
    const c = rootContainer.createChildContainer();
    const userDataPath = path.join(
      os.tmpdir(),
      `ptah-watch-di-${Date.now()}-b`,
    );

    registerPhase0Platform(c, {
      appPath: userDataPath,
      userDataPath,
      logsPath: path.join(userDataPath, 'logs'),
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value: string) => Buffer.from(value),
        decryptString: (value: Buffer) => value.toString(),
      },
      dialog: {} as never,
      getWindow: () => null,
    });

    expect(c.isRegistered(PLATFORM_TOKENS.WORKSPACE_WATCHER)).toBe(true);
    expect(() => c.resolve(PLATFORM_TOKENS.WORKSPACE_WATCHER)).not.toThrow();
    expect(c.isRegistered(PLATFORM_TOKENS.ARTIFACT_STORE)).toBe(true);
    expect(c.resolve(PLATFORM_TOKENS.ARTIFACT_STORE)).toBeDefined();
  });
});

/**
 * `TOKENS.MAIN_LOOP_WATCHDOG` (TASK_2026_437) is bound by
 * `registerVsCodeCorePlatformAgnostic`, which this host reaches through
 * `apps/ptah-electron/src/di/phase-1-infra.ts`. Pinned here rather than in `expected-resolvable.ts`, which
 * lists RPC handler classes only (batches.md plan defect D2). Resolving must
 * NOT start the worker — arming belongs to `armDiagnostics`.
 */
describe('Electron DI — main-loop watchdog (TASK_2026_437)', () => {
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
 * `apps/ptah-electron/src/di/phase-1-infra.ts`. Pinned here rather than in `expected-resolvable.ts` (plan defect D2).
 * Resolving attaches no lag source and arms no timer; it starts clear.
 */
describe('Electron DI — background-work governor (TASK_2026_437)', () => {
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
 * Session organization (TASK_2026_580, risk R-TL11, B2 follow-up).
 *
 * `WorktreeHookHandler`, `SessionForkService`, `PtahAPIBuilder` and the 584
 * `SessionSpawnerService` (R-TL8) are singletons that take
 * `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` as an OPTIONAL constructor
 * argument. One resolved before phase 2 binds the
 * recorder keeps `undefined` for the life of the process and silently never
 * records. Capture also subscribes to the PostToolUse registry; without it,
 * `startSessionOrganization` reports a non-fatal failure and no PR is captured.
 *
 * The real Electron container cannot boot under Jest (see the header and
 * `phase-2-diagnostics-override.spec.ts`), so the call order is pinned by
 * reading the source, and the registrations run for real in that order:
 * `registerSdkServices` (phase 2), the session-organization pair (phase 2,
 * after the SQLite block), then `registerVsCodeLmToolsServices` (phase 3).
 */
describe('Electron DI — session organization recorder binding (TASK_2026_580 R-TL11)', () => {
  it('phase 2 registers and starts session organization once, after the SDK and SQLite registrations', () => {
    const phase2 = fs.readFileSync(
      path.join(__dirname, 'phase-2-libraries.ts'),
      'utf8',
    );
    const at = (call: string): number => {
      const index = phase2.indexOf(call);
      expect(index).toBeGreaterThan(-1);
      return index;
    };

    expect(phase2.match(/registerSessionOrganizationServices\(/g)).toHaveLength(
      1,
    );
    expect(phase2.match(/startSessionOrganization\(/g)).toHaveLength(1);
    const register = at('registerSessionOrganizationServices(container);');
    expect(at('registerSdkServices(container, logger);')).toBeLessThan(
      register,
    );
    expect(
      at('registerPersistenceSqliteServices(container, logger);'),
    ).toBeLessThan(register);
    expect(at('startTaskSpecsIndex(container, logger);')).toBeLessThan(
      register,
    );
    expect(register).toBeLessThan(at('startSessionOrganization(container);'));
    // Phase 2 itself never resolves a producer early.
    expect(phase2).not.toMatch(
      /SDK_WORKTREE_HOOK_HANDLER|SDK_SESSION_FORK_SERVICE|PTAH_API_BUILDER|SESSION_SPAWNER/,
    );

    // The API builder is registered in phase 3, after phase 2 bound the recorder.
    const orchestrator = fs.readFileSync(
      path.join(__dirname, 'container.ts'),
      'utf8',
    );
    const phase2At = orchestrator.indexOf('registerPhase2Libraries(root');
    expect(phase2At).toBeGreaterThan(-1);
    expect(phase2At).toBeLessThan(
      orchestrator.indexOf('registerPhase3Storage(root'),
    );
    expect(
      fs.readFileSync(path.join(__dirname, 'phase-3-storage.ts'), 'utf8'),
    ).toContain('registerVsCodeLmToolsServices(container, logger);');
  });

  /**
   * Phase 1's one binding plus phase 2 in production order. The connection is
   * never opened. `withCliAgentRuntime` adds the runtime registration (it sits
   * between the SDK and session organization in phase 2) with the spawner's
   * run collaborators stubbed, so constructing the spawner touches only the
   * SDK registries and the recorder.
   */
  function composePhase2(withCliAgentRuntime: boolean) {
    const c = buildMinimalContainer();
    const logger = c.resolve<Logger>(TOKENS.LOGGER);
    const output = createMockOutputChannel();
    c.register(PLATFORM_TOKENS.OUTPUT_CHANNEL, { useValue: output });
    // Phase 1 binds this in production; `SessionMetadataStore` injects it.
    c.register(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE, {
      useValue: {
        get: jest.fn(() => undefined),
        update: jest.fn(async () => undefined),
        keys: jest.fn(() => []),
      },
    });

    registerSdkServices(c, logger);
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
      // its dependencies are bound by other phase-2 libraries in production.
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

  /**
   * Phase 3's `registerVsCodeLmToolsServices`, which binds
   * `TOKENS.PTAH_API_BUILDER`. Required producer dependencies unrelated to
   * these checks (bound by other phase-2 libraries in production) are bare
   * stubs, as in `ptah-extension-vscode/src/di/surface-composition.spec.ts`.
   */
  function composePhase3(c: DependencyContainer, logger: Logger): void {
    c.register(TOKENS.CONTEXT_ORCHESTRATION_SERVICE, { useValue: {} });
    registerVsCodeLmToolsServices(c, logger);
    for (const token of [
      AUTH_PROVIDERS_TOKENS.SDK_MODEL_RESOLVER,
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_ENV,
      AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER,
      SDK_TOKENS.PRICING_PROVIDER,
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
      PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER,
    ]) {
      if (!c.isRegistered(token, true)) c.register(token, { useValue: {} });
    }
  }

  it('the bound recorder reaches all three producers and capture subscribes to PostToolUse', () => {
    const { c, logger, output } = composePhase2(false);
    composePhase3(c, logger);

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

  it('resolves one lane instruction file store for the Electron runtime', () => {
    const { c } = composePhase2(true);
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

  /**
   * TASK_2026_623 assumption A2. `LanePlanLimitsRpcHandlers` is a lib-owned,
   * capability-gated family: `registerRpcSurface` runs
   * `container.resolve(ctor).register()` for it, with no `registerSingleton`
   * in `phase-4-handlers.ts`. Its third constructor slot is
   * `TOKENS.PTAH_API_BUILDER`, bound in phase 3, so it must resolve against
   * the phase-2-plus-phase-3 composition and register its one method.
   */
  it('resolves LanePlanLimitsRpcHandlers against the phase-3 API builder and registers agent:getLanePlanLimits (A2)', () => {
    const { c, logger } = composePhase2(false);
    composePhase3(c, logger);

    const handlers = c.resolve(LanePlanLimitsRpcHandlers);
    expect(handlers).toBeInstanceOf(LanePlanLimitsRpcHandlers);
    expect((handlers as unknown as { apiBuilder: unknown }).apiBuilder).toBe(
      c.resolve(TOKENS.PTAH_API_BUILDER),
    );

    const rpcHandler = c.resolve<{ registerMethod: jest.Mock }>(
      TOKENS.RPC_HANDLER,
    );
    rpcHandler.registerMethod.mockClear();
    handlers.register();
    const registered = rpcHandler.registerMethod.mock.calls.map(
      ([method]) => method as string,
    );
    expect(registered).toEqual([...LanePlanLimitsRpcHandlers.METHODS]);
    expect(registered).toEqual(['agent:getLanePlanLimits']);
  });
});
