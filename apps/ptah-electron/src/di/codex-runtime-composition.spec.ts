import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { IAgentAdapter, SessionId } from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  type CodexChatHostPorts,
} from '@ptah-extension/rpc-handlers';
import type { ElectronCodexBindingInput } from './codex-binding.types';
import {
  createElectronCodexSessionState,
  createElectronCodexSessionLifecycle,
} from './codex-session-binding';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import {
  mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ELECTRON_CODEX_BOUND_TOKENS } from './expected-resolvable';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexParityGate,
  findCodexExecutablePin,
  buildCodexExecutionProfile,
  resolveGatedCodexRuntime,
  type CodexRuntime,
} from '@ptah-extension/codex-runtime';
import {
  CodexChatAdapter,
  registerCodexChatServices,
  SDK_TOKENS,
  SessionTurnStateRegistry,
  wireAgentAdapterAliases,
  type CodexChatAdapterPorts,
  type PermissionPromptLifecycleEvent,
  resolveCodexNativeBinaryPath,
} from '@ptah-extension/agent-sdk';
import {
  bindElectronCodexChat,
  createElectronCodexExecutable,
  inspectElectronCodexBinary,
  resolveElectronCodexBundledRoot,
  createElectronCodexRouting,
  createElectronCodexScopeFactory,
  type ElectronCodexScopeInput,
} from './codex-runtime-composition';
import { resolveElectronCodexLaneRuntime } from './codex-lane-composition';

jest.mock('@ptah-extension/codex-runtime', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
    '@ptah-extension/codex-runtime',
  ),
  findCodexExecutablePin: jest.fn(),
  buildCodexExecutionProfile: jest.fn(
    jest.requireActual<typeof import('@ptah-extension/codex-runtime')>(
      '@ptah-extension/codex-runtime',
    ).buildCodexExecutionProfile,
  ),
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>(
    '@ptah-extension/agent-sdk',
  ),
  resolveCodexNativeBinaryPath: jest.fn(),
}));

jest.mock('@ptah-extension/rpc-handlers', () => {
  const actual = jest.requireActual<typeof import('@ptah-extension/rpc-handlers')>(
    '@ptah-extension/rpc-handlers',
  );
  return {
    ...actual,
    createCodexChatHostPorts: jest.fn(actual.createCodexChatHostPorts),
  };
});

let temporaryRoot: string;
let bundledRoot: string;
let executablePath: string;
beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'ptah-codex-'));
  bundledRoot = join(temporaryRoot, 'node_modules');
  mkdirSync(bundledRoot);
  executablePath = join(bundledRoot, 'codex');
  writeFileSync(executablePath, 'fixture');
  jest.mocked(findCodexExecutablePin).mockReset().mockReturnValue({
    ...manifest, binarySha256: createHash('sha256').update('fixture').digest('hex'),
  });
  jest.mocked(resolveCodexNativeBinaryPath).mockReset().mockReturnValue(executablePath);
});
afterEach(() => rmSync(temporaryRoot, { recursive: true, force: true }));

const platform = { platform: 'win32', arch: 'x64' };
const manifest = {
  ...platform,
  pinnedVersion: '0.155.1',
  version: '0.155.1',
  binarySha256: 'a'.repeat(64),
  schemaSha256: 'b'.repeat(64),
};

function setup(isPackaged = false, env: Record<string, string> = {}) {
  const parent = container.createChildContainer();
  const input: ElectronCodexScopeInput = {
    parent,
    isPackaged,
    env,
    platform,
    expectedManifestRow: manifest,
    bundledRoot,
    ports: {
      binary: {
        ...platform,
        executablePath: realpathSync(executablePath),
        versionOutput: 'codex-cli 0.155.1',
        sha256: 'a'.repeat(64),
      },
      spawner: {
        spawnProcess: jest.fn(() => {
          throw new Error('Unexpected spawn');
        }),
      },
      store: {
        persist: jest.fn(async () => undefined),
        markInactive: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
      },
      clock: {
        now: () => 0,
        setTimeout: () => ({ dispose: jest.fn() }),
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      usage: null,
    },
  };
  return { input, parent };
}

describe('Electron Codex runtime infrastructure', () => {
  afterEach(() => jest.restoreAllMocks());

  it('does not inspect the executable when creating a factory or rejecting native-off use', async () => {
    const { input, parent } = setup();
    jest.mocked(resolveCodexNativeBinaryPath).mockClear();
    const factory = createElectronCodexScopeFactory(input);
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    expect(() => factory({ request: async () => 'decline' })).toThrow(
      'Native Codex chat is disabled',
    );
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    await parent.dispose();
  });

  it('owns lane and chat runtimes in separate scopes with separate approval sinks', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const chatSink = { request: jest.fn(async () => 'decline' as const) };
    const laneSink = { request: jest.fn(async () => 'decline' as const) };
    const chat = createElectronCodexScopeFactory(input)(chatSink);
    const lane = createElectronCodexScopeFactory(input, 'lane')(laneSink);
    try {
      expect(chat.container.resolve(CODEX_RUNTIME_TOKENS.Runtime))
        .not.toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(chat.container.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(chatSink);
      expect(lane.container.resolve(CODEX_RUNTIME_TOKENS.ApprovalSink)).toBe(laneSink);
      expect(resolveGatedCodexRuntime(chat.container, 'chat', platform)).toBeDefined();
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: false, platform,
      })).toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform,
      })).toBe(lane.container.resolve(CODEX_RUNTIME_TOKENS.Runtime));
      expect(() => resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform: { platform: 'linux', arch: 'x64' },
      })).toThrow('parity gate');
      expect(input.ports.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await lane.dispose();
      await chat.dispose();
      await parent.dispose();
    }
  });

  it('uses the gated runtime for a packaged lane after parity admission', async () => {
    const original = Object.getOwnPropertyDescriptor(CodexParityGate.prototype, 'isEnabled');
    Object.defineProperty(CodexParityGate.prototype, 'isEnabled', {
      configurable: true, value: () => true,
    });
    const { input, parent } = setup(true);
    const lane = createElectronCodexScopeFactory(input, 'lane')({
      request: async () => 'decline',
    });
    try {
      expect(resolveElectronCodexLaneRuntime(lane.container, {
        isPackaged: true, platform,
      })).toBe(resolveGatedCodexRuntime(lane.container, 'lane', platform));
    } finally {
      await lane.dispose();
      await parent.dispose();
      if (original) Object.defineProperty(CodexParityGate.prototype, 'isEnabled', original);
    }
  });

  it('defers a missing bundled binary until native scope creation without allocating a child', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    jest.mocked(resolveCodexNativeBinaryPath).mockClear();
    const factory = createElectronCodexScopeFactory(input);
    expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
    const createChild = jest.spyOn(parent, 'createChildContainer');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => factory({ request: async () => 'decline' })).toThrow(
      'Bundled Codex executable unavailable',
    );
    expect(createChild).not.toHaveBeenCalled();
    await parent.dispose();
  });

  it('keeps the default capability disabled', () => {
    expect(
      createElectronCodexRouting({ platform, isPackaged: false, env: {} }),
    ).toEqual({
      devRoute: null,
      capabilities: { nativeCodex: false, nativeCodexGateway: false },
    });
  });

  it('ignores the development switch in packaged Electron', () => {
    expect(
      createElectronCodexRouting({
        platform,
        isPackaged: true,
        env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      }),
    ).toEqual({
      devRoute: null,
      capabilities: { nativeCodex: false, nativeCodexGateway: false },
    });
  });

  it('uses parity gate values for both consumers without the development switch', () => {
    const gate = new CodexParityGate();
    expect(
      createElectronCodexRouting({ platform, isPackaged: false, env: {} }).capabilities,
    ).toEqual({
      nativeCodex: gate.isEnabled('chat', platform),
      nativeCodexGateway: gate.isEnabled('gateway', platform),
    });
  });

  it('enables development chat and gateway while leaving lane gated', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    try {
      expect(createElectronCodexRouting(input).capabilities).toEqual({
        nativeCodex: true,
        nativeCodexGateway: true,
      });
      expect(resolveGatedCodexRuntime(scope.container, 'chat', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      expect(resolveGatedCodexRuntime(scope.container, 'gateway', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      expect(() =>
        resolveGatedCodexRuntime(scope.container, 'lane', platform),
      ).toThrow('parity gate');
      expect(parent.isRegistered(CODEX_RUNTIME_TOKENS.Runtime)).toBe(false);
      expect(input.ports.spawner.spawnProcess).not.toHaveBeenCalled();
    } finally {
      await scope.dispose();
      await parent.dispose();
    }
  });

  it('closes runtime before container after a rejected open; disposal is idempotent', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    const runtime = scope.container.resolve<CodexRuntime>(
      CODEX_RUNTIME_TOKENS.Runtime,
    );
    const order: string[] = [];
    jest.spyOn(runtime, 'close').mockImplementation(async () => {
      order.push('runtime');
    });
    const dispose = scope.container.dispose.bind(scope.container);
    jest.spyOn(scope.container, 'dispose').mockImplementation(async () => {
      order.push('container');
      await dispose();
    });
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat-1',
        consumer: 'chat',
        providerId: 'openai-codex',
        workspaceId: 'workspace-1',
        cwd: '/work',
        model: 'model',
        permissionLevel: 'ask',
      },
      defaultHome: '/home',
      paths: {
        platform: 'posix',
        baseDirectory: '/',
        entries: {
          '/work': { kind: 'directory', realpath: '/work' },
          '/home': { kind: 'directory', realpath: '/home' },
        },
      },
    });
    // Real open reaches the deliberately failing process port. Cleanup follows
    // the adapter's finally path and must still close runtime before container.
    try {
      await expect(
        resolveGatedCodexRuntime(scope.container, 'chat', platform).open(
          profile,
        ),
      ).rejects.toThrow();
    } finally {
      await Promise.all([scope.dispose(), scope.dispose()]);
    }
    expect(order).toEqual(['runtime', 'container']);
    await parent.dispose();
  });

  it('disposes the container even when runtime close fails', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    const runtime = scope.container.resolve<CodexRuntime>(
      CODEX_RUNTIME_TOKENS.Runtime,
    );
    jest.spyOn(runtime, 'close').mockRejectedValue(new Error('close failed'));
    const dispose = jest.spyOn(scope.container, 'dispose');
    await expect(scope.dispose()).rejects.toThrow('close failed');
    expect(dispose).toHaveBeenCalledTimes(1);
    await parent.dispose();
  });

  it('uses only the bundled resolver and refuses an absent executable', () => {
    expect(
      createElectronCodexExecutable(manifest, bundledRoot).resolvedPath,
    ).toBe(realpathSync(executablePath));
    expect(resolveCodexNativeBinaryPath).toHaveBeenLastCalledWith();
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => createElectronCodexExecutable(manifest, bundledRoot)).toThrow(
      'Bundled Codex executable unavailable',
    );
    const globalExecutable = join(temporaryRoot, 'global-codex');
    writeFileSync(globalExecutable, 'global');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(globalExecutable);
    expect(() => createElectronCodexExecutable(manifest, bundledRoot)).toThrow(
      'outside the host bundle',
    );
  });
  it('finds the nearest workspace node_modules from the dist app', () => {
    expect(resolveElectronCodexBundledRoot({
      isPackaged: false, resourcesPath: join(temporaryRoot, 'resources'),
      appPath: join(temporaryRoot, 'dist', 'apps', 'ptah-electron'),
    })).toBe(bundledRoot);
  });

  it('keeps the packaged root strict even when it does not exist', () => {
    const resourcesPath = join(temporaryRoot, 'resources');
    const root = resolveElectronCodexBundledRoot({
      isPackaged: true, resourcesPath, appPath: temporaryRoot,
    });
    expect(root).toBe(join(resourcesPath, 'app.asar.unpacked', 'node_modules'));
    expect(() => createElectronCodexExecutable(manifest, root)).toThrow();
  });

  it('rejects a packaged build whose executable resolves outside the bundle', () => {
    const resourcesPath = join(temporaryRoot, 'resources');
    const root = resolveElectronCodexBundledRoot({
      isPackaged: true, resourcesPath, appPath: temporaryRoot,
    });
    mkdirSync(root, { recursive: true });
    const globalExecutable = join(temporaryRoot, 'packaged-global-codex');
    writeFileSync(globalExecutable, 'global');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(globalExecutable);
    expect(() => createElectronCodexExecutable(manifest, root)).toThrow(
      'Codex executable is outside the host bundle',
    );
  });

  it('accepts a worktree junction and reports the canonical executable identity', () => {
    const junction = join(temporaryRoot, 'worktree-modules');
    symlinkSync(bundledRoot, junction, 'junction');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(join(junction, 'codex'));
    expect(createElectronCodexExecutable(manifest, junction).resolvedPath)
      .toBe(realpathSync(executablePath));
  });

  it('rejects a package symlink escaping the bundle', () => {
    const outside = join(temporaryRoot, 'global');
    mkdirSync(outside);
    writeFileSync(join(outside, 'codex'), 'global');
    const link = join(bundledRoot, 'linked-package');
    symlinkSync(outside, link, 'junction');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValue(join(link, 'codex'));
    expect(() => createElectronCodexExecutable(manifest, bundledRoot))
      .toThrow('Codex executable is outside the host bundle');
  });

  it('disposes an allocated child when runtime resolution fails', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const child = parent.createChildContainer();
    jest.spyOn(parent, 'createChildContainer').mockReturnValue(child);
    jest.spyOn(child, 'resolve').mockImplementation(() => { throw new Error('resolve failed'); });
    const dispose = jest.spyOn(child, 'dispose');
    expect(() => createElectronCodexScopeFactory(input)({ request: async () => 'decline' }))
      .toThrow('resolve failed');
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
    await parent.dispose();
  });
});

function bindingFixture() {
  const parent = container.createChildContainer();
  const unsubscribe = jest.fn();
  parent.register(TOKENS.LOGGER, { useValue: createMockLogger() });
  parent.register(SDK_TOKENS.SDK_SESSION_METADATA_STORE, {
    useValue: {
      getAll: jest.fn(async () => []),
      get: jest.fn(async () => null),
      onMetadataChanged: () => unsubscribe,
      updateCodexExecution: jest.fn(async () => undefined),
    },
  });
  const scopeResolver = { readForPath: jest.fn() };
  const settingsStore: ElectronCodexBindingInput['settingsStore'] = {
    readGlobal: jest.fn(),
    writeGlobal: jest.fn(async () => undefined),
    readSecret: jest.fn(async () => undefined),
    writeSecret: jest.fn(async () => undefined),
    deleteSecret: jest.fn(async () => undefined),
    watchGlobal: jest.fn(() => ({ dispose: jest.fn() })),
    watchSecret: jest.fn(() => ({ dispose: jest.fn() })),
    flushSync: jest.fn(),
  };
  parent.register(
    AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER,
    {
      useValue: { resolveExecutionProfile: jest.fn() },
    },
  );
  parent.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: { getWorkspaceFolders: jest.fn(() => []) },
  });
  parent.register(PLATFORM_TOKENS.PLATFORM_INFO, {
    useValue: { extensionPath: '/bundled', globalStoragePath: '/data' },
  });
  parent.register(TOKENS.WEBVIEW_MANAGER, {
    useValue: { broadcastMessage: jest.fn(async () => undefined) },
  });
  parent.register(SDK_TOKENS.HOST_ATTENTION_COORDINATOR, {
    useValue: { resolve: jest.fn() },
  });
  const legacy = { initialize: jest.fn(async () => true) };
  parent.register(SDK_TOKENS.SDK_AGENT_ADAPTER, { useValue: legacy });
  const permissionHandler = {
    handleResponse: jest.fn(),
    publishPromptLifecycle: jest.fn(),
  };
  parent.register(SDK_TOKENS.SDK_PERMISSION_HANDLER, {
    useValue: permissionHandler,
  });
  parent.register(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY, {
    useValue: new SessionTurnStateRegistry(),
  });
  registerCodexChatServices(parent);
  wireAgentAdapterAliases(parent);
  return {
    parent, unsubscribe, legacy, permissionHandler, scopeResolver, settingsStore,
  };
}

describe('Electron complete Codex binding', () => {
  it('forwards Codex prompt lifecycle events to the permission handler', async () => {
    const { parent, permissionHandler, scopeResolver, settingsStore } = bindingFixture();
    jest.mocked(createCodexChatHostPorts).mockClear();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform,
      bundledRoot,
      scopeResolver,
      settingsStore,
    });
    try {
      const deps = jest.mocked(createCodexChatHostPorts).mock.calls.at(-1)?.[0];
      const event: PermissionPromptLifecycleEvent = {
        phase: 'requested',
        requestId: 'codex-request-1',
        routingHint: 'gw-conversation-1',
        toolName: 'Bash',
        description: 'Run a command',
        routable: false,
        timeoutMs: 60_000,
      };

      expect(deps?.promptLifecycle).toBeDefined();
      deps?.promptLifecycle?.publish(event);

      expect(permissionHandler.publishPromptLifecycle).toHaveBeenCalledWith(event);
    } finally {
      await binding.dispose();
      await parent.dispose();
    }
  });

  it('binds the saved Codex permission reader to the profile workspace', async () => {
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    parent.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: createMockWorkspaceProvider({ folders: [temporaryRoot] }),
    });
    parent.register(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER, {
      useValue: {
        resolveExecutionProfile: jest.fn().mockResolvedValue({
          runtime: 'codex-app-server',
          seed: {
            providerId: 'openai-codex', consumer: 'chat',
            workspacePath: temporaryRoot, home: temporaryRoot,
            normalizedHome: temporaryRoot, model: 'gpt-5',
          },
        }),
      },
    });
    scopeResolver.readForPath.mockImplementation((name: string) => ({
      'autopilot.enabled': true,
      'autopilot.permissionLevel': 'auto-edit',
    })[name as 'autopilot.enabled' | 'autopilot.permissionLevel']);
    jest.mocked(buildCodexExecutionProfile).mockClear();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform, bundledRoot, scopeResolver, settingsStore,
    });
    try {
      const ports = parent.resolve<CodexChatHostPorts>(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
      await expect(ports.profile({
        projectPath: temporaryRoot, workspaceId: temporaryRoot, model: 'gpt-5',
      })).rejects.toThrow('Codex executable verification failed');
      expect(scopeResolver.readForPath).toHaveBeenCalledWith('autopilot.enabled', temporaryRoot, true);
      expect(scopeResolver.readForPath).toHaveBeenCalledWith('autopilot.permissionLevel', temporaryRoot, true);
      expect(jest.mocked(buildCodexExecutionProfile).mock.calls.at(-1)?.[0].session.permissionLevel).toBe('auto-edit');
    } finally {
      await binding.dispose();
      await parent.dispose();
    }
  });
  it.each([
    { isPackaged: false, env: {}, enabled: false },
    { isPackaged: true, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, enabled: false },
    { isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, enabled: true },
  ])(
    'binds six stable ports without binary I/O: %j',
    async ({ isPackaged, env, enabled }) => {
      const { parent, unsubscribe, legacy, scopeResolver, settingsStore } = bindingFixture();
      jest.mocked(resolveCodexNativeBinaryPath).mockClear();
      const binding = await bindElectronCodexChat(parent, {
        isPackaged,
        env,
        platform,
        bundledRoot,
        scopeResolver,
        settingsStore,
      });
      try {
        for (const token of ELECTRON_CODEX_BOUND_TOKENS) {
          const value = parent.resolve(token);
          expect(value).not.toBeNull();
          expect(parent.resolve(token)).toBe(value);
        }
        expect(binding.capabilities.nativeCodex).toBe(enabled);
        expect(binding.capabilities.nativeCodexGateway).toBe(enabled);
        if (!enabled) expect(binding.devRoute).toBeNull();
        await expect(
          parent.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER).initialize(),
        ).resolves.toBe(true);
        expect(legacy.initialize).toHaveBeenCalledTimes(1);
        expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
        const ports = parent.resolve<
          CodexChatHostPorts
        >(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
        expect(typeof ports.handlePermissionResponse).toBe('function');
      } finally {
        await binding.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        await parent.dispose();
      }
    },
  );

  it('rejects scope creation when the profile port bypasses verification', async () => {
    const { parent, scopeResolver, settingsStore } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform,
      bundledRoot,
      scopeResolver,
      settingsStore,
    });
    const ports = parent.resolve<CodexChatAdapterPorts>(
      SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS,
    );
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat',
        consumer: 'chat',
        providerId: 'openai-codex',
        workspaceId: '/work',
        cwd: '/work',
        model: 'gpt',
        permissionLevel: 'ask',
      },
      defaultHome: '/home',
      paths: {
        platform: 'posix',
        baseDirectory: '/',
        entries: {
          '/work': { kind: 'directory', realpath: '/work' },
          '/home': { kind: 'directory', realpath: '/home' },
        },
      },
    });
    const adapter = new CodexChatAdapter({
      ...ports,
      profile: async () => ({ profile }),
    }, new SessionTurnStateRegistry());
    try {
      await expect(
        adapter.startChatSession({ tabId: 'tab', prompt: 'hello' }),
      ).rejects.toMatchObject({ code: 'runtime-failed' });
    } finally {
      adapter.dispose();
      await binding.dispose();
      await parent.dispose();
    }
  });
});

describe('Electron Codex binding failure', () => {
  it('retains default ports and disposes the identity lookup if a dependency fails', async () => {
    const { parent, unsubscribe, scopeResolver, settingsStore } = bindingFixture();
    const defaults = new Map(ELECTRON_CODEX_BOUND_TOKENS.map((token) => [token, parent.resolve(token)]));
    parent.register(PLATFORM_TOKENS.PLATFORM_INFO, {
      useFactory: () => { throw new Error('platform unavailable'); },
    });
    try {
      await expect(bindElectronCodexChat(parent, {
        isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, platform,
        bundledRoot, scopeResolver, settingsStore,
      })).rejects.toThrow('platform unavailable');
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      for (const token of ELECTRON_CODEX_BOUND_TOKENS) {
        expect(parent.resolve(token)).toBe(defaults.get(token));
      }
    } finally {
      await parent.dispose();
    }
  });
});

describe('Electron Codex asynchronous binary inspection', () => {
  it('shares one inspection across concurrent opens and repeats only after a file change', async () => {
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    const [first, second] = await Promise.all([
      inspectElectronCodexBinary(executablePath, readVersion, platform),
      inspectElectronCodexBinary(executablePath, readVersion, platform),
    ]);
    expect(first).toBe(second);
    expect(first.sha256).toHaveLength(64);
    expect(first.versionOutput).toBe('codex-cli 0.155.1');
    expect(readVersion).toHaveBeenCalledTimes(1);
    await inspectElectronCodexBinary(executablePath, readVersion, platform);
    expect(readVersion).toHaveBeenCalledTimes(1);
    writeFileSync(executablePath, 'updated fixture with a different size');
    jest.mocked(findCodexExecutablePin).mockReturnValue({
      ...manifest,
      binarySha256: createHash('sha256').update('updated fixture with a different size').digest('hex'),
    });
    const changed = await inspectElectronCodexBinary(executablePath, readVersion, platform);
    expect(changed.sha256).not.toBe(first.sha256);
    expect(readVersion).toHaveBeenCalledTimes(2);
  });

  it.each(['version process failed', 'version process timed out', 'EBUSY'])(
    'retries a rejected inspection on the next open: %s', async (message) => {
      const failure = new Error(message);
      const readVersion = jest.fn<Promise<string>, [string]>()
        .mockRejectedValueOnce(failure)
        .mockResolvedValue('codex-cli 0.155.1');
      await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).rejects.toBe(failure);
      await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).resolves.toMatchObject({
        versionOutput: 'codex-cli 0.155.1',
      });
      expect(readVersion).toHaveBeenCalledTimes(2);
    },
  );

  it('rejects an unreviewed digest without executing the binary', async () => {
    jest.mocked(findCodexExecutablePin).mockReturnValue(manifest);
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).rejects.toMatchObject({
      code: 'codex-digest-mismatch',
    });
    expect(readVersion).not.toHaveBeenCalled();
    jest.mocked(findCodexExecutablePin).mockReturnValue({
      ...manifest, binarySha256: createHash('sha256').update('fixture').digest('hex'),
    });
    await expect(inspectElectronCodexBinary(executablePath, readVersion, platform)).resolves.toMatchObject({
      versionOutput: 'codex-cli 0.155.1',
    });
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it('rejects a platform without a reviewed pin without executing the binary', async () => {
    jest.mocked(findCodexExecutablePin).mockReturnValue(undefined);
    const readVersion = jest.fn(async () => 'codex-cli 0.155.1');
    await expect(inspectElectronCodexBinary(executablePath, readVersion, { platform: 'linux', arch: 'arm64' })).rejects.toMatchObject({
      code: 'codex-pin-unavailable',
    });
    expect(readVersion).not.toHaveBeenCalled();
  });
});


describe('Electron Codex session lifecycle composition', () => {
  it('records opening and closing before Electron effects without mutating record hooks', async () => {
    const parent = container.createChildContainer();
    const state = createElectronCodexSessionState(parent);
    const id = 'session-1' as SessionId;
    const prepared = {
      profile: buildCodexExecutionProfile({
        session: {
          contextId: 'chat', consumer: 'chat', providerId: 'openai-codex',
          workspaceId: '/work', cwd: '/work', model: 'gpt', permissionLevel: 'ask',
        },
        defaultHome: '/home',
        paths: {
          platform: 'posix', baseDirectory: '/',
          entries: {
            '/work': { kind: 'directory', realpath: '/work' },
            '/home': { kind: 'directory', realpath: '/home' },
          },
        },
      }),
    };
    state.preparedTabs.set(prepared, 'tab-1');
    const order: string[] = [];
    const record = {
      lifecycle: Object.freeze({
        opened: jest.fn(() => {
          expect(state.profiles.has(id)).toBe(false);
          expect(state.tabs.has(id)).toBe(false);
          order.push('record opened');
        }),
        closed: jest.fn(() => {
          expect(state.profiles.get(id)).toBe(prepared);
          expect(state.tabs.get(id)).toBe('tab-1');
          order.push('record closed');
        }),
      }),
    };
    const lookup = {
      releaseSession: jest.fn(() => {
        expect(state.profiles.has(id)).toBe(false);
        expect(state.tabs.has(id)).toBe(false);
        order.push('identity released');
      }),
    };
    const controls = {
      releaseSession: jest.fn(() => { order.push('controls released'); }),
    };
    const lifecycle = createElectronCodexSessionLifecycle(record, state, lookup, controls);
    try {
      expect(lifecycle).not.toBe(record.lifecycle);
      lifecycle.opened(id, prepared);
      expect(state.profiles.get(id)).toBe(prepared);
      expect(state.tabs.get(id)).toBe('tab-1');
      lifecycle.closed(id);
      expect(record.lifecycle.opened).toHaveBeenCalledWith(id, prepared);
      expect(record.lifecycle.closed).toHaveBeenCalledWith(id);
      expect(lookup.releaseSession).toHaveBeenCalledWith(id);
      expect(controls.releaseSession).toHaveBeenCalledWith(id);
      expect(order).toEqual([
        'record opened', 'record closed', 'identity released', 'controls released',
      ]);
    } finally {
      await parent.dispose();
    }
  });
});
