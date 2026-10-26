import 'reflect-metadata';
import type { IAgentAdapter } from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import { ELECTRON_CODEX_BOUND_TOKENS } from './expected-resolvable';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  buildCodexExecutionProfile,
  resolveGatedCodexRuntime,
  type CodexRuntime,
} from '@ptah-extension/codex-runtime';
import {
  CodexChatAdapter,
  registerCodexChatServices,
  SDK_TOKENS,
  wireAgentAdapterAliases,
  type CodexChatAdapterPorts,
  resolveCodexNativeBinaryPath,
} from '@ptah-extension/agent-sdk';
import {
  bindElectronCodexChat,
  createElectronCodexExecutable,
  createElectronCodexRouting,
  createElectronCodexScopeFactory,
  type ElectronCodexScopeInput,
} from './codex-runtime-composition';

jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>(
    '@ptah-extension/agent-sdk',
  ),
  resolveCodexNativeBinaryPath: jest.fn(() => '/bundled/codex'),
}));

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
    bundledRoot: '/bundled',
    ports: {
      binary: {
        ...platform,
        executablePath: '/bundled/codex',
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
    ).toEqual({ devRoute: null, capabilities: { nativeCodex: false } });
  });

  it('ignores the development switch in packaged Electron', () => {
    expect(
      createElectronCodexRouting({
        platform,
        isPackaged: true,
        env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      }),
    ).toEqual({ devRoute: null, capabilities: { nativeCodex: false } });
  });

  it('enables development chat only and leaves gateway and lane gated', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({
      request: async () => 'decline',
    });
    try {
      expect(createElectronCodexRouting(input).capabilities.nativeCodex).toBe(
        true,
      );
      expect(resolveGatedCodexRuntime(scope.container, 'chat', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      for (const consumer of ['gateway', 'lane'] as const) {
        expect(() =>
          resolveGatedCodexRuntime(scope.container, consumer, platform),
        ).toThrow('parity gate');
      }
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
      createElectronCodexExecutable(manifest, '/bundled').resolvedPath,
    ).toBe('/bundled/codex');
    expect(resolveCodexNativeBinaryPath).toHaveBeenLastCalledWith();
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => createElectronCodexExecutable(manifest, '/bundled')).toThrow(
      'Bundled Codex executable unavailable',
    );
    jest
      .mocked(resolveCodexNativeBinaryPath)
      .mockReturnValueOnce('/global/codex');
    expect(() => createElectronCodexExecutable(manifest, '/bundled')).toThrow(
      'outside the host bundle',
    );
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
  parent.register(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER, {
    useValue: { readForPath: jest.fn() },
  });
  parent.register(SETTINGS_TOKENS.SETTINGS_STORE, {
    useValue: { set: jest.fn() },
  });
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
  parent.register(SDK_TOKENS.SDK_PERMISSION_HANDLER, {
    useValue: { handleResponse: jest.fn() },
  });
  registerCodexChatServices(parent);
  wireAgentAdapterAliases(parent);
  return { parent, unsubscribe, legacy };
}

describe('Electron complete Codex binding', () => {
  it.each([
    { isPackaged: false, env: {}, enabled: false },
    { isPackaged: true, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, enabled: false },
    { isPackaged: false, env: { PTAH_CODEX_RUNTIME_DEV: '1' }, enabled: true },
  ])(
    'binds six stable ports without binary I/O: %j',
    async ({ isPackaged, env, enabled }) => {
      const { parent, unsubscribe, legacy } = bindingFixture();
      jest.mocked(resolveCodexNativeBinaryPath).mockClear();
      const binding = await bindElectronCodexChat(parent, {
        isPackaged,
        env,
        platform,
        bundledRoot: '/bundled',
      });
      try {
        for (const token of ELECTRON_CODEX_BOUND_TOKENS) {
          const value = parent.resolve(token);
          expect(value).not.toBeNull();
          expect(parent.resolve(token)).toBe(value);
        }
        expect(binding.capabilities.nativeCodex).toBe(enabled);
        if (!enabled) expect(binding.devRoute).toBeNull();
        await expect(
          parent.resolve<IAgentAdapter>(TOKENS.AGENT_ADAPTER).initialize(),
        ).resolves.toBe(true);
        expect(legacy.initialize).toHaveBeenCalledTimes(1);
        expect(resolveCodexNativeBinaryPath).not.toHaveBeenCalled();
        const ports = parent.resolve<
          CodexChatAdapterPorts & { handlePermissionResponse: unknown }
        >(SDK_TOKENS.CODEX_CHAT_ADAPTER_PORTS);
        expect(typeof ports.handlePermissionResponse).toBe('function');
      } finally {
        await binding.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        await parent.dispose();
      }
    },
  );

  it('reports a missing executable as runtime-failed on first open, after successful bind', async () => {
    const { parent } = bindingFixture();
    const binding = await bindElectronCodexChat(parent, {
      isPackaged: false,
      env: { PTAH_CODEX_RUNTIME_DEV: '1' },
      platform,
      bundledRoot: '/bundled',
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
    });
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
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
