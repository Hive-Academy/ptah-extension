import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  buildCodexExecutionProfile,
  resolveGatedCodexRuntime,
  type CodexRuntime,
} from '@ptah-extension/codex-runtime';
import { resolveCodexNativeBinaryPath } from '@ptah-extension/agent-sdk';
import {
  createElectronCodexExecutable,
  createElectronCodexRouting,
  createElectronCodexScopeFactory,
  type ElectronCodexScopeInput,
} from './codex-runtime-composition';

jest.mock('@ptah-extension/agent-sdk', () => ({
  resolveCodexNativeBinaryPath: jest.fn(() => '/bundled/codex'),
  initializeSessionRuntimeIdentityLookup: jest.fn(),
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
    parent, isPackaged, env, platform, expectedManifestRow: manifest, bundledRoot: '/bundled',
    ports: {
      binary: {
        ...platform, executablePath: '/bundled/codex',
        versionOutput: 'codex-cli 0.155.1', sha256: 'a'.repeat(64),
      },
      spawner: { spawnProcess: jest.fn(() => { throw new Error('Unexpected spawn'); }) },
      store: {
        persist: jest.fn(async () => undefined),
        markInactive: jest.fn(async () => undefined),
        read: jest.fn(async () => undefined),
      },
      clock: {
        now: () => 0,
        setTimeout: () => ({ dispose: jest.fn() }),
      },
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      usage: null,
    },
  };
  return { input, parent };
}

describe('Electron Codex runtime infrastructure', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the default capability disabled', () => {
    expect(createElectronCodexRouting({ platform, isPackaged: false, env: {} }))
      .toEqual({ devRoute: null, capabilities: { nativeCodex: false } });
  });

  it('ignores the development switch in packaged Electron', () => {
    expect(createElectronCodexRouting({
      platform, isPackaged: true, env: { PTAH_CODEX_RUNTIME_DEV: '1' },
    })).toEqual({ devRoute: null, capabilities: { nativeCodex: false } });
  });

  it('enables development chat only and leaves gateway and lane gated', async () => {
    const { input, parent } = setup(false, { PTAH_CODEX_RUNTIME_DEV: '1' });
    const scope = createElectronCodexScopeFactory(input)({ request: async () => 'decline' });
    try {
      expect(createElectronCodexRouting(input).capabilities.nativeCodex).toBe(true);
      expect(resolveGatedCodexRuntime(scope.container, 'chat', platform)).toBe(
        resolveGatedCodexRuntime(scope.container, 'chat', platform),
      );
      for (const consumer of ['gateway', 'lane'] as const) {
        expect(() => resolveGatedCodexRuntime(scope.container, consumer, platform)).toThrow('parity gate');
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
    const scope = createElectronCodexScopeFactory(input)({ request: async () => 'decline' });
    const runtime = scope.container.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    const order: string[] = [];
    jest.spyOn(runtime, 'close').mockImplementation(async () => { order.push('runtime'); });
    const dispose = scope.container.dispose.bind(scope.container);
    jest.spyOn(scope.container, 'dispose').mockImplementation(async () => {
      order.push('container');
      await dispose();
    });
    const profile = buildCodexExecutionProfile({
      session: {
        contextId: 'chat-1', consumer: 'chat', providerId: 'openai-codex',
        workspaceId: 'workspace-1', cwd: '/work', model: 'model', permissionLevel: 'ask',
      },
      defaultHome: '/home',
      paths: {
        platform: 'posix', baseDirectory: '/',
        entries: {
          '/work': { kind: 'directory', realpath: '/work' },
          '/home': { kind: 'directory', realpath: '/home' },
        },
      },
    });
    // Real open reaches the deliberately failing process port. Cleanup follows
    // the adapter's finally path and must still close runtime before container.
    try {
      await expect(resolveGatedCodexRuntime(scope.container, 'chat', platform).open(profile)).rejects.toThrow();
    } finally {
      await Promise.all([scope.dispose(), scope.dispose()]);
    }
    expect(order).toEqual(['runtime', 'container']);
    await parent.dispose();
  });

  it('disposes the container even when runtime close fails', async () => {
    const { input, parent } = setup();
    const scope = createElectronCodexScopeFactory(input)({ request: async () => 'decline' });
    const runtime = scope.container.resolve<CodexRuntime>(CODEX_RUNTIME_TOKENS.Runtime);
    jest.spyOn(runtime, 'close').mockRejectedValue(new Error('close failed'));
    const dispose = jest.spyOn(scope.container, 'dispose');
    await expect(scope.dispose()).rejects.toThrow('close failed');
    expect(dispose).toHaveBeenCalledTimes(1);
    await parent.dispose();
  });

  it('uses only the bundled resolver and refuses an absent executable', () => {
    expect(createElectronCodexExecutable(manifest, '/bundled').resolvedPath).toBe('/bundled/codex');
    expect(resolveCodexNativeBinaryPath).toHaveBeenLastCalledWith();
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce(undefined);
    expect(() => createElectronCodexExecutable(manifest, '/bundled')).toThrow('Bundled Codex executable unavailable');
    jest.mocked(resolveCodexNativeBinaryPath).mockReturnValueOnce('/global/codex');
    expect(() => createElectronCodexExecutable(manifest, '/bundled')).toThrow('outside the host bundle');
  });
});
