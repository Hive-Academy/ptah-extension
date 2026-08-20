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

import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer, InjectionToken } from 'tsyringe';

import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { registerOutputStyleServices } from '@ptah-extension/output-styles';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import {
  SetupRpcHandlers,
  registerSharedRpcHandlers,
} from '@ptah-extension/rpc-handlers';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers-tokens';

import { EXPECTED_RESOLVABLE } from './expected-resolvable';
import { ELECTRON_TOKENS } from './electron-tokens';
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
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
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
    if (token === SetupRpcHandlers) {
      // The bug class this whole refactor exists to prevent: slot 3 must be a
      // real ModelSettings, not a ConfigManager. Concretely we check that the
      // resolved instance has a working `modelSettings.selectedModel.get`.
      const ms = (
        instance as unknown as {
          modelSettings: { selectedModel: { get: () => unknown } };
        }
      ).modelSettings;
      expect(typeof ms.selectedModel.get).toBe('function');
    }
  });
});

/**
 * Both aliasing describes below call `registerPhase4Handlers` on its own, so
 * they have to satisfy phase 4's phase-2 precondition themselves.
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
 * Risk R2 — duplicate `PtyManagerService` instance.
 *
 * `PLATFORM_TOKENS.PTY_HOST` must be an ALIAS of
 * `ELECTRON_TOKENS.PTY_MANAGER_SERVICE`, never a second registration. IpcBridge
 * holds the concrete instance and owns the `sessions` Map
 * (`activation/bootstrap.ts` -> `ipc/ipc-bridge.ts`), while `terminal:create`
 * resolves the port. A second instance would hand back session ids that the
 * binary write/resize channel cannot find — terminals open and silently accept
 * no input — and `disposeAll` would leak the real PTYs on quit.
 *
 * This asserts against the REAL wiring in `registerPhase4Handlers`, not a copy
 * of it, and it asserts reference identity (`toBe`): a `registerSingleton`
 * would still satisfy a structural comparison.
 */
describe('Electron DI — PTY host token aliasing (Risk R2)', () => {
  it('resolves PTY_HOST to the very same instance as PTY_MANAGER_SERVICE', () => {
    const { c, logger } = buildPhase4Container();

    registerPhase4Handlers(c, logger);

    const viaPort = c.resolve(PLATFORM_TOKENS.PTY_HOST);
    const viaConcreteToken = c.resolve(ELECTRON_TOKENS.PTY_MANAGER_SERVICE);

    expect(viaPort).toBeDefined();
    expect(viaPort).toBe(viaConcreteToken);
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
 * — the update banner would never appear and nothing would throw.
 *
 * This asserts against the REAL wiring in `registerPhase4Handlers`, not a copy
 * of it, and it asserts reference identity (`toBe`): the two unions are
 * structurally identical, so `toEqual` would pass under a duplicate-instance
 * wiring and prove nothing.
 */
describe('Electron DI — app updater token aliasing (Risk R1)', () => {
  it('resolves APP_UPDATER to the very same instance as UPDATE_MANAGER_TOKEN', () => {
    const { c, logger } = buildPhase4Container();
    // UpdateManager is @injectable and injects these two; they are its
    // constructor dependencies, not part of the wiring under test.
    c.register(TOKENS.LOGGER, { useValue: logger });
    c.register(TOKENS.WEBVIEW_MANAGER, {
      useValue: { broadcastMessage: jest.fn(async () => undefined) },
    });

    registerPhase4Handlers(c, logger);

    const viaPort = c.resolve(PLATFORM_TOKENS.APP_UPDATER);
    const viaConcreteToken = c.resolve(UPDATE_MANAGER_TOKEN);

    expect(viaPort).toBeDefined();
    expect(viaPort).toBe(viaConcreteToken);
  });
});
