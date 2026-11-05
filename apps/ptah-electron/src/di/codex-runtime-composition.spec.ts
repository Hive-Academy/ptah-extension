import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  CODEX_RUNTIME_TOKENS,
  CodexSelectionSnapshot,
} from '@ptah-extension/codex-runtime';
import { CHAT_TOKENS } from '@ptah-extension/rpc-handlers';
import { SessionId } from '@ptah-extension/shared';
import {
  createElectronCodexDriverGate,
  createElectronCodexRouting,
  createElectronCodexScopeFactory,
} from './codex-runtime-composition';

const platforms = ['linux', 'darwin', 'win32'] as const;
const arches = ['arm64', 'x64'] as const;
const hosts = platforms.flatMap((platform) =>
  arches.flatMap((arch) =>
    [false, true].map((isPackaged) => ({ platform, arch, isPackaged })),
  ),
);

function snapshot(installedVersion: string) {
  return new CodexSelectionSnapshot({
    installedCandidates: async () => ['/installed'],
    bundledCandidate: async () => '/bundled',
    canonicalNativePath: async (path) => path,
    readVersion: async (path) =>
      path === '/installed'
        ? `codex-cli ${installedVersion}`
        : 'codex-cli 0.165.0',
  });
}

describe('Electron Codex runtime composition', () => {
  it('resolves the native driver coordinator when admitting a session', async () => {
    const child = container.createChildContainer();
    const driver = createElectronCodexDriverGate(child);
    const release = jest.fn();
    const admitNative = jest.fn(async () => ({ release }));
    child.register(CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR, {
      useValue: { admitNative },
    });
    const sessionId = SessionId.from('11111111-1111-4111-8111-111111111111');
    const context = { consumer: 'chat', kind: 'start' } as const;
    const lease = await driver.admit(sessionId, context);
    expect(admitNative).toHaveBeenCalledWith(sessionId, context);
    lease.release();
    expect(release).toHaveBeenCalledTimes(1);
    await child.dispose();
  });
  it.each(hosts)(
    'binds chat on $platform/$arch packaged=$isPackaged',
    async ({ platform, arch, isPackaged }) => {
      expect(
        createElectronCodexRouting({
          platform: { platform, arch },
          isPackaged,
          env: {},
        }).capabilities.nativeCodex,
      ).toBe(true);
      const parent = container.createChildContainer();
      const selected = snapshot('0.166.0');
      const scope = createElectronCodexScopeFactory({
        parent,
        isPackaged,
        platform: { platform, arch },
        env: {},
        ports: {
          selectionSnapshot: selected,
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
            setTimeout: () => ({ dispose: () => undefined }),
          },
          logger: {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
          usage: null,
        },
      })({ request: async () => 'decline' });
      try {
        expect(
          scope.container.resolve(CODEX_RUNTIME_TOKENS.Runtime),
        ).toBeDefined();
        expect(
          scope.container.resolve(CODEX_RUNTIME_TOKENS.SelectionSnapshot),
        ).toBe(selected);
      } finally {
        await scope.dispose();
        await parent.dispose();
      }
    },
  );

  it.each([
    ['0.166.0', 'installed'],
    ['0.164.0', 'bundled'],
  ])(
    'shares selected %s executable with each runtime scope',
    async (version, source) => {
      const selected = snapshot(version);
      const selection = await selected.selectForOpen();
      expect(selection.selected.source).toBe(source);
      const parent = container.createChildContainer();
      const ports = {
        selectionSnapshot: selected,
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
          setTimeout: () => ({ dispose: () => undefined }),
        },
        logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        },
        usage: null,
      };
      const scope = createElectronCodexScopeFactory({
        parent,
        ports,
        platform: { platform: 'linux', arch: 'arm64' },
        isPackaged: true,
        env: {},
      })({ request: async () => 'decline' });
      try {
        expect(
          scope.container.resolve(CODEX_RUNTIME_TOKENS.SelectionSnapshot),
        ).toBe(selected);
        expect(
          scope.container.resolve(CODEX_RUNTIME_TOKENS.ExecutableSource),
        ).toEqual(selection.selected);
        expect(ports.spawner.spawnProcess).not.toHaveBeenCalled();
      } finally {
        await scope.dispose();
        await parent.dispose();
      }
    },
  );

  it('switches an unsupported installed executable to the bundle once', async () => {
    const selected = snapshot('0.166.0');
    const first = (await selected.selectForOpen()).selected;
    const fallback = await selected.activateFallback(first, 'model/list');
    expect(fallback.source).toBe('bundled');
    expect(fallback.reason).toContain('model/list');
    await expect(
      selected.activateFallback(first, 'model/list'),
    ).rejects.toThrow();
  });
});
