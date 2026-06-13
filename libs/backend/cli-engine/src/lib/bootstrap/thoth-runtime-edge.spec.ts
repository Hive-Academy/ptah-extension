import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
import { CRON_TOKENS } from '@ptah-extension/cron-scheduler';
import { GATEWAY_TOKENS } from '@ptah-extension/messaging-gateway';
import { GATEWAY_CHAT_BRIDGE_TOKENS } from '@ptah-extension/gateway-chat-bridge';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';

import {
  activateThoth,
  disposeThoth,
  resetVecDiagnosticForTest,
  type ThothRefs,
} from './thoth-runtime';

const wireMock = jest.fn();

jest.mock('./wire-thoth-push-bridges.js', () => ({
  wireThothPushBridges: (...args: unknown[]) => wireMock(...args),
}));

function makeLogger() {
  return { info: jest.fn(), warn: jest.fn() };
}

function makeFullDoubles(
  overrides: {
    gatewayStartEnabled?: boolean;
  } = {},
) {
  const order: string[] = [];
  const gatewayEnabled = overrides.gatewayStartEnabled ?? true;
  return {
    order,
    sqliteConnection: {
      openAndMigrate: jest.fn(async () => {
        order.push('sqlite.open');
      }),
      close: jest.fn(() => order.push('sqlite.close')),
      isOpen: true,
      vecLoadDiagnostic: {
        ok: false,
        reason: 'not-found',
        electronVersion: '',
        processArch: process.arch,
        processPlatform: process.platform,
      },
      db: {},
    },
    embedderClient: {
      dispose: jest.fn(async () => order.push('embedder.dispose')),
    },
    memoryCurator: {
      start: jest.fn(() => order.push('memoryCurator.start')),
      stop: jest.fn(() => order.push('memoryCurator.stop')),
    },
    memoryTrigger: {
      start: jest.fn(() => order.push('memoryTrigger.start')),
      stop: jest.fn(() => order.push('memoryTrigger.stop')),
    },
    skillSynthesis: {
      start: jest.fn(async () => order.push('skillSynthesis.start')),
      stop: jest.fn(() => order.push('skillSynthesis.stop')),
    },
    skillTrigger: {
      start: jest.fn(() => order.push('skillTrigger.start')),
      stop: jest.fn(() => order.push('skillTrigger.stop')),
    },
    cronScheduler: {
      start: jest.fn(async () => order.push('cron.start')),
      stop: jest.fn(() => order.push('cron.stop')),
    },
    jobStore: { upsert: jest.fn() },
    handlerRegistry: { has: jest.fn(() => false), register: jest.fn() },
    gateway: {
      start: jest.fn(async () => {
        order.push('gateway.start');
        if (!gatewayEnabled) {
          order.push('gateway.start.noop');
        }
      }),
      stop: jest.fn(async () => order.push('gateway.stop')),
    },
    chatBridge: {
      start: jest.fn(() => order.push('chatBridge.start')),
      stop: jest.fn(() => order.push('chatBridge.stop')),
    },
    indexingControl: {
      getStatus: jest.fn(async () => ({ memoryEnabled: true })),
    },
    workspaceProvider: {
      getWorkspaceRoot: jest.fn(() => '/ws'),
      getConfiguration: jest.fn((_s: string, key: string, dflt: unknown) => {
        if (key === 'cron.enabled') return true;
        if (key === 'cron.maxConcurrentJobs') return 3;
        if (key === 'cron.catchupWindowMs') return 86_400_000;
        return dflt;
      }),
    },
    webviewManager: {},
  };
}

const ALL_TOKENS = new Set<symbol>([
  PERSISTENCE_TOKENS.SQLITE_CONNECTION,
  PERSISTENCE_TOKENS.EMBEDDER,
  MEMORY_TOKENS.MEMORY_CURATOR,
  MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
  MEMORY_TOKENS.INDEXING_CONTROL,
  SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
  SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
  CRON_TOKENS.CRON_SCHEDULER,
  CRON_TOKENS.CRON_JOB_STORE,
  CRON_TOKENS.CRON_HANDLER_REGISTRY,
  GATEWAY_TOKENS.GATEWAY_SERVICE,
  GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE,
  PLATFORM_TOKENS.WORKSPACE_PROVIDER,
  TOKENS.WEBVIEW_MANAGER,
]);

function makeContainer(
  doubles: ReturnType<typeof makeFullDoubles>,
  registered: Set<symbol>,
) {
  return {
    isRegistered: (token: symbol) => registered.has(token),
    resolve: (token: symbol) => {
      switch (token) {
        case PERSISTENCE_TOKENS.SQLITE_CONNECTION:
          return doubles.sqliteConnection;
        case PERSISTENCE_TOKENS.EMBEDDER:
          return doubles.embedderClient;
        case MEMORY_TOKENS.MEMORY_CURATOR:
          return doubles.memoryCurator;
        case MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE:
          return doubles.memoryTrigger;
        case MEMORY_TOKENS.INDEXING_CONTROL:
          return doubles.indexingControl;
        case SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE:
          return doubles.skillSynthesis;
        case SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE:
          return doubles.skillTrigger;
        case CRON_TOKENS.CRON_SCHEDULER:
          return doubles.cronScheduler;
        case CRON_TOKENS.CRON_JOB_STORE:
          return doubles.jobStore;
        case CRON_TOKENS.CRON_HANDLER_REGISTRY:
          return doubles.handlerRegistry;
        case GATEWAY_TOKENS.GATEWAY_SERVICE:
          return doubles.gateway;
        case GATEWAY_CHAT_BRIDGE_TOKENS.GATEWAY_CHAT_BRIDGE:
          return doubles.chatBridge;
        case PLATFORM_TOKENS.WORKSPACE_PROVIDER:
          return doubles.workspaceProvider;
        case TOKENS.WEBVIEW_MANAGER:
          return doubles.webviewManager;
        default:
          throw new Error(`unexpected resolve: ${String(token)}`);
      }
    },
  };
}

describe('thoth-runtime edge cases', () => {
  beforeEach(() => {
    wireMock.mockReset();
    wireMock.mockReturnValue([]);
    resetVecDiagnosticForTest();
  });

  describe('Tier: runtime + gateway enabled-flag=false (adapters internally a no-op)', () => {
    it('calls gateway.start() regardless of internal enabled-flag; adapters not live is the gateway service concern', async () => {
      const doubles = makeFullDoubles({ gatewayStartEnabled: false });
      const container = makeContainer(doubles, ALL_TOKENS);

      const refs = await activateThoth(
        container as never,
        'runtime',
        makeLogger() as never,
      );

      expect(doubles.gateway.start).toHaveBeenCalledTimes(1);
      expect(refs.gateway).not.toBeNull();
      expect(doubles.chatBridge.start).toHaveBeenCalledTimes(1);
      expect(refs.chatBridge).not.toBeNull();
    });
  });

  describe('Tier: oneshot with degraded subsystem (vec missing → BM25-only)', () => {
    it('oneshot completes and returns clean refs even when vecLoadDiagnostic.ok=false', async () => {
      const doubles = makeFullDoubles();
      doubles.sqliteConnection.vecLoadDiagnostic = {
        ok: false,
        reason: 'not-found',
        electronVersion: '',
        processArch: process.arch,
        processPlatform: process.platform,
      };
      const registered = new Set<symbol>([
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
        PERSISTENCE_TOKENS.EMBEDDER,
      ]);
      const container = makeContainer(doubles, registered);

      const refs = await activateThoth(
        container as never,
        'oneshot',
        makeLogger() as never,
      );

      expect(doubles.sqliteConnection.openAndMigrate).toHaveBeenCalledTimes(1);
      expect(refs.sqliteConnection).not.toBeNull();
      expect(refs.memoryCurator).toBeNull();
      expect(refs.gateway).toBeNull();
    });

    it('oneshot dispose after degraded-vec run closes sqlite and resolves without hanging', async () => {
      const doubles = makeFullDoubles();
      doubles.sqliteConnection.vecLoadDiagnostic = {
        ok: false,
        reason: 'not-found',
        electronVersion: '',
        processArch: process.arch,
        processPlatform: process.platform,
      };
      const registered = new Set<symbol>([
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      ]);
      const container = makeContainer(doubles, registered);

      const refs = await activateThoth(
        container as never,
        'oneshot',
        makeLogger() as never,
      );
      await expect(
        disposeThoth(refs, makeLogger() as never),
      ).resolves.toBeUndefined();
      expect(doubles.sqliteConnection.close).toHaveBeenCalledTimes(1);
    });

    it('warns (not throws) when vecLoadDiagnostic.ok=false on oneshot', async () => {
      const doubles = makeFullDoubles();
      doubles.sqliteConnection.vecLoadDiagnostic = {
        ok: false,
        reason: 'sqlite-vec binary missing',
        electronVersion: '',
        processArch: process.arch,
        processPlatform: process.platform,
      };
      const registered = new Set<symbol>([
        PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      ]);
      const container = makeContainer(doubles, registered);
      const logger = makeLogger();

      await activateThoth(container as never, 'oneshot', logger as never);

      const warnCalls = logger.warn.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(warnCalls.some((m) => m.includes('sqlite-vec'))).toBe(true);
    });
  });

  describe('Tier: runtime with SQLITE open failing (subset: cron skipped, gateway still starts)', () => {
    it('skips memory+cron when sqlite fails, but gateway still attempts to start', async () => {
      const doubles = makeFullDoubles();
      doubles.sqliteConnection.openAndMigrate = jest.fn(async () => {
        throw new Error('disk full');
      });
      const container = makeContainer(doubles, ALL_TOKENS);

      const refs = await activateThoth(
        container as never,
        'runtime',
        makeLogger() as never,
      );

      expect(refs.sqliteConnection).toBeNull();
      expect(refs.memoryCurator).toBeNull();
      expect(refs.cronScheduler).toBeNull();
      expect(doubles.gateway.start).toHaveBeenCalledTimes(1);
    });
  });

  describe('disposeThoth — mid-chain throw does not abort later steps', () => {
    it('continues through all dispose steps even when memoryCurator.stop throws', async () => {
      const order: string[] = [];
      const refs: ThothRefs = {
        sqliteConnection: {
          close: jest.fn(() => order.push('sqlite.close')),
          get isOpen() {
            return true;
          },
        } as never,
        memoryCurator: {
          stop: jest.fn(() => {
            throw new Error('curator.stop boom');
          }),
        } as never,
        memoryTrigger: {
          stop: jest.fn(() => order.push('memoryTrigger.stop')),
        } as never,
        skillSynthesis: {
          stop: jest.fn(() => order.push('skillSynthesis.stop')),
        } as never,
        skillTrigger: {
          stop: jest.fn(() => order.push('skillTrigger.stop')),
        } as never,
        cronScheduler: {
          stop: jest.fn(() => order.push('cron.stop')),
        } as never,
        gateway: {
          stop: jest.fn(async () => order.push('gateway.stop')),
        } as never,
        chatBridge: {
          stop: jest.fn(() => order.push('chatBridge.stop')),
        } as never,
        embedderClient: {
          dispose: jest.fn(async () => order.push('embedder.dispose')),
        } as never,
        pushDisposables: [],
      };

      await expect(
        disposeThoth(refs, makeLogger() as never),
      ).resolves.toBeUndefined();

      expect(order).toContain('memoryTrigger.stop');
      expect(order).toContain('skillSynthesis.stop');
      expect(order).toContain('cron.stop');
      expect(order).toContain('gateway.stop');
      expect(order).toContain('sqlite.close');
      expect(order[order.length - 1]).toBe('sqlite.close');
    });

    it('continues through all steps even when skillSynthesis.stop throws', async () => {
      const order: string[] = [];
      const refs: ThothRefs = {
        sqliteConnection: {
          close: jest.fn(() => order.push('sqlite.close')),
          get isOpen() {
            return true;
          },
        } as never,
        memoryCurator: {
          stop: jest.fn(() => order.push('memoryCurator.stop')),
        } as never,
        memoryTrigger: null,
        skillSynthesis: {
          stop: jest.fn(() => {
            throw new Error('synthesis.stop boom');
          }),
        } as never,
        skillTrigger: {
          stop: jest.fn(() => order.push('skillTrigger.stop')),
        } as never,
        cronScheduler: {
          stop: jest.fn(() => order.push('cron.stop')),
        } as never,
        gateway: null,
        chatBridge: null,
        embedderClient: {
          dispose: jest.fn(async () => order.push('embedder.dispose')),
        } as never,
        pushDisposables: [],
      };

      await expect(
        disposeThoth(refs, makeLogger() as never),
      ).resolves.toBeUndefined();

      expect(order).toContain('skillTrigger.stop');
      expect(order).toContain('cron.stop');
      expect(order).toContain('embedder.dispose');
      expect(order[order.length - 1]).toBe('sqlite.close');
    });

    it('continues through all steps even when chatBridge.stop throws', async () => {
      const order: string[] = [];
      const refs: ThothRefs = {
        sqliteConnection: {
          close: jest.fn(() => order.push('sqlite.close')),
          get isOpen() {
            return true;
          },
        } as never,
        memoryCurator: null,
        memoryTrigger: null,
        skillSynthesis: null,
        skillTrigger: null,
        cronScheduler: null,
        gateway: {
          stop: jest.fn(async () => order.push('gateway.stop')),
        } as never,
        chatBridge: {
          stop: jest.fn(() => {
            throw new Error('chatBridge.stop boom');
          }),
        } as never,
        embedderClient: null,
        pushDisposables: [],
      };

      await expect(
        disposeThoth(refs, makeLogger() as never),
      ).resolves.toBeUndefined();

      expect(order).toContain('gateway.stop');
      expect(order[order.length - 1]).toBe('sqlite.close');
    });

    it('continues through all steps even when embedderClient.dispose throws', async () => {
      const order: string[] = [];
      const refs: ThothRefs = {
        sqliteConnection: {
          close: jest.fn(() => order.push('sqlite.close')),
          get isOpen() {
            return true;
          },
        } as never,
        memoryCurator: null,
        memoryTrigger: null,
        skillSynthesis: null,
        skillTrigger: null,
        cronScheduler: null,
        gateway: null,
        chatBridge: null,
        embedderClient: {
          dispose: jest.fn(async () => {
            throw new Error('embedder.dispose boom');
          }),
        } as never,
        pushDisposables: [],
      };

      await expect(
        disposeThoth(refs, makeLogger() as never),
      ).resolves.toBeUndefined();
      expect(order).toContain('sqlite.close');
    });

    it('logs a warn for each failed dispose step', async () => {
      const refs: ThothRefs = {
        sqliteConnection: {
          close: jest.fn(() => {
            throw new Error('close boom');
          }),
          get isOpen() {
            return true;
          },
        } as never,
        memoryCurator: {
          stop: jest.fn(() => {
            throw new Error('curator boom');
          }),
        } as never,
        memoryTrigger: null,
        skillSynthesis: null,
        skillTrigger: null,
        cronScheduler: null,
        gateway: null,
        chatBridge: null,
        embedderClient: null,
        pushDisposables: [],
      };

      const logger = makeLogger();
      await disposeThoth(refs, logger as never);

      const warnMessages = logger.warn.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(warnMessages.some((m) => m.includes('memoryCurator.stop'))).toBe(
        true,
      );
      expect(
        warnMessages.some((m) => m.includes('sqliteConnection.close')),
      ).toBe(true);
    });
  });
});
