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
import { createMockOutputChannel } from '@ptah-extension/platform-core/testing';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import {
  SDK_TOKENS,
  registerSdkServices,
  type PostToolUseCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
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
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  AuthRpcHandlers,
  SetupRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';

import { EXPECTED_RESOLVABLE } from './expected-resolvable';
import { registerPhase0Platform } from './phase-0-platform';
import { registerPhase1Infra } from './phase-1-infra';
import { registerPhase4Handlers } from './phase-4-handlers';
import { UPDATE_MANAGER_TOKEN } from '../services/update/update-tokens';

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

  registerSharedRpcHandlers(c);
  return c;
}

describe('Electron DI — shared RPC handler resolution', () => {
  let c: DependencyContainer;

  beforeAll(() => {
    c = buildMinimalContainer();
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
    c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: { isOpen: false },
    });
    registerSessionOrganizationServices(c);
    startSessionOrganization(c);
    return { c, logger, output };
  }

  it('the bound recorder reaches all three producers and capture subscribes to PostToolUse', () => {
    const { c, logger, output } = composePhase2(false);

    // Phase 3. Required producer dependencies unrelated to this check (bound
    // by other phase-2 libraries in production) are bare stubs, as in
    // `ptah-extension-vscode/src/di/surface-composition.spec.ts`.
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
    expect(
      output.__state.lines.filter((line) =>
        line.startsWith('[SessionOrganization]'),
      ),
    ).toEqual([]);
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
