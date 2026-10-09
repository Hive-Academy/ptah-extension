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
  SetupRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';
import { createCliWorkspaceWatcherOptions } from '@ptah-extension/cli-engine';
import {
  CliWorkspaceWatcher,
  registerPlatformCliServices,
} from '@ptah-extension/platform-cli';

import { EXPECTED_RESOLVABLE } from './expected-resolvable';

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

  registerSharedRpcHandlers(c);
  return c;
}

describe('CLI DI — shared RPC handler resolution', () => {
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
      // its dependencies are bound by other libraries in production.
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
