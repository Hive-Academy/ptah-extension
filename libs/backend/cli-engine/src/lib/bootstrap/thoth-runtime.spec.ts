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

interface FakeLogger {
  info: jest.Mock;
  warn: jest.Mock;
}

function makeLogger(): FakeLogger {
  return { info: jest.fn(), warn: jest.fn() };
}

interface RuntimeDoubles {
  order: string[];
  sqliteConnection: {
    openAndMigrate: jest.Mock;
    close: jest.Mock;
    isOpen: boolean;
    vecLoadDiagnostic: unknown;
    db: unknown;
  };
  embedderClient: { dispose: jest.Mock };
  memoryCurator: { start: jest.Mock; stop: jest.Mock };
  memoryTrigger: { start: jest.Mock; stop: jest.Mock };
  skillSynthesis: { start: jest.Mock; stop: jest.Mock };
  skillTrigger: { start: jest.Mock; stop: jest.Mock };
  cronScheduler: { start: jest.Mock; stop: jest.Mock };
  jobStore: { upsert: jest.Mock };
  handlerRegistry: { has: jest.Mock; register: jest.Mock };
  gateway: { start: jest.Mock; stop: jest.Mock };
  chatBridge: { start: jest.Mock; stop: jest.Mock };
  indexingControl: { getStatus: jest.Mock };
  workspaceProvider: {
    getWorkspaceRoot: jest.Mock;
    getConfiguration: jest.Mock;
  };
  webviewManager: object;
}

function makeRuntimeDoubles(
  opts: { memoryEnabled?: boolean } = {},
): RuntimeDoubles {
  const order: string[] = [];
  const memoryEnabled = opts.memoryEnabled ?? true;
  return {
    order,
    sqliteConnection: {
      openAndMigrate: jest.fn(async () => {
        order.push('sqlite.open');
      }),
      close: jest.fn(() => order.push('sqlite.close')),
      isOpen: true,
      vecLoadDiagnostic: {
        ok: true,
        reason: 'loaded',
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
      start: jest.fn(async () => order.push('gateway.start')),
      stop: jest.fn(async () => order.push('gateway.stop')),
    },
    chatBridge: {
      start: jest.fn(() => order.push('chatBridge.start')),
      stop: jest.fn(() => order.push('chatBridge.stop')),
    },
    indexingControl: {
      getStatus: jest.fn(async () => ({ memoryEnabled })),
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

function makeRuntimeContainer(
  doubles: RuntimeDoubles,
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

const ALL_RUNTIME_TOKENS = new Set<symbol>([
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

describe('activateThoth — runtime tier', () => {
  beforeEach(() => {
    wireMock.mockReset();
    wireMock.mockReturnValue([]);
    resetVecDiagnosticForTest();
  });

  it('opens sqlite then starts every long-running subsystem in order', async () => {
    const doubles = makeRuntimeDoubles();
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    expect(doubles.sqliteConnection.openAndMigrate).toHaveBeenCalledTimes(1);
    expect(doubles.memoryCurator.start).toHaveBeenCalledTimes(1);
    expect(doubles.memoryTrigger.start).toHaveBeenCalledTimes(1);
    expect(doubles.skillSynthesis.start).toHaveBeenCalledTimes(1);
    expect(doubles.skillTrigger.start).toHaveBeenCalledTimes(1);
    expect(doubles.cronScheduler.start).toHaveBeenCalledTimes(1);
    expect(doubles.gateway.start).toHaveBeenCalledTimes(1);
    expect(doubles.chatBridge.start).toHaveBeenCalledTimes(1);

    expect(doubles.order.indexOf('sqlite.open')).toBeLessThan(
      doubles.order.indexOf('memoryCurator.start'),
    );
    expect(doubles.order.indexOf('memoryCurator.start')).toBeLessThan(
      doubles.order.indexOf('skillSynthesis.start'),
    );
    expect(doubles.order.indexOf('skillSynthesis.start')).toBeLessThan(
      doubles.order.indexOf('cron.start'),
    );
    expect(doubles.order.indexOf('cron.start')).toBeLessThan(
      doubles.order.indexOf('gateway.start'),
    );
    expect(doubles.order.indexOf('gateway.start')).toBeLessThan(
      doubles.order.indexOf('chatBridge.start'),
    );

    expect(refs.memoryCurator).not.toBeNull();
    expect(refs.gateway).not.toBeNull();
    expect(refs.chatBridge).not.toBeNull();
  });

  it('upserts the daily-backup job and registers its handler exactly once', async () => {
    const doubles = makeRuntimeDoubles();
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    await activateThoth(container as never, 'runtime', makeLogger() as never);

    expect(doubles.handlerRegistry.register).toHaveBeenCalledTimes(1);
    expect(doubles.handlerRegistry.register.mock.calls[0]?.[0]).toBe(
      'backup:daily',
    );
    expect(doubles.jobStore.upsert).toHaveBeenCalledTimes(1);
    expect(doubles.jobStore.upsert.mock.calls[0]?.[0]).toMatchObject({
      id: '@ptah/daily-backup',
      prompt: 'handler:backup:daily',
      enabled: true,
    });
  });

  it('does not re-register the backup handler when one already exists', async () => {
    const doubles = makeRuntimeDoubles();
    doubles.handlerRegistry.has = jest.fn(() => true);
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    await activateThoth(container as never, 'runtime', makeLogger() as never);

    expect(doubles.handlerRegistry.register).not.toHaveBeenCalled();
    expect(doubles.jobStore.upsert).toHaveBeenCalledTimes(1);
  });

  it('starts the cron loop with settings drawn from cron.* configuration keys', async () => {
    const doubles = makeRuntimeDoubles();
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    await activateThoth(container as never, 'runtime', makeLogger() as never);

    expect(doubles.cronScheduler.start).toHaveBeenCalledWith({
      enabled: true,
      maxConcurrentJobs: 3,
      catchupWindowMs: 86_400_000,
    });
  });

  it('skips memory start when IndexingControl reports memory disabled', async () => {
    const doubles = makeRuntimeDoubles({ memoryEnabled: false });
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    expect(doubles.indexingControl.getStatus).toHaveBeenCalledWith('/ws');
    expect(doubles.memoryCurator.start).not.toHaveBeenCalled();
    expect(refs.memoryCurator).toBeNull();
    expect(doubles.memoryTrigger.start).not.toHaveBeenCalled();
    expect(refs.memoryTrigger).toBeNull();
  });

  it('wires the chat bridge only after the gateway started', async () => {
    const doubles = makeRuntimeDoubles();
    const registered = new Set(ALL_RUNTIME_TOKENS);
    registered.delete(GATEWAY_TOKENS.GATEWAY_SERVICE);
    const container = makeRuntimeContainer(doubles, registered);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    expect(doubles.gateway.start).not.toHaveBeenCalled();
    expect(doubles.chatBridge.start).not.toHaveBeenCalled();
    expect(refs.chatBridge).toBeNull();
  });

  it('wires push-event bridges and stashes the returned disposables', async () => {
    const disposable = { dispose: jest.fn() };
    wireMock.mockReturnValue([disposable]);
    const doubles = makeRuntimeDoubles();
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    expect(wireMock).toHaveBeenCalledTimes(1);
    expect(wireMock.mock.calls[0]?.[0]).toBe(container);
    expect(wireMock.mock.calls[0]?.[1]).toBe(doubles.webviewManager);
    expect(refs.pushDisposables).toEqual([disposable]);
  });

  it('runtime activation remains a clean LIFO teardown', async () => {
    const doubles = makeRuntimeDoubles();
    const disposable = { dispose: jest.fn(() => doubles.order.push('push')) };
    wireMock.mockReturnValue([disposable]);
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    doubles.order.length = 0;
    await disposeThoth(refs, makeLogger() as never);

    expect(doubles.order[0]).toBe('push');
    expect(doubles.order[1]).toBe('chatBridge.stop');
    expect(doubles.order[2]).toBe('gateway.stop');
    expect(doubles.order.indexOf('cron.stop')).toBeLessThan(
      doubles.order.indexOf('skillTrigger.stop'),
    );
    expect(doubles.order.indexOf('push')).toBeLessThan(
      doubles.order.indexOf('memoryCurator.stop'),
    );
    expect(doubles.order.indexOf('embedder.dispose')).toBeLessThan(
      doubles.order.indexOf('sqlite.close'),
    );
    expect(doubles.order[doubles.order.length - 1]).toBe('sqlite.close');
  });

  it('does not start any subsystem when sqlite open fails', async () => {
    const doubles = makeRuntimeDoubles();
    doubles.sqliteConnection.openAndMigrate = jest.fn(async () => {
      throw new Error('open boom');
    });
    const container = makeRuntimeContainer(doubles, ALL_RUNTIME_TOKENS);

    const refs = await activateThoth(
      container as never,
      'runtime',
      makeLogger() as never,
    );

    expect(refs.sqliteConnection).toBeNull();
    expect(doubles.memoryCurator.start).not.toHaveBeenCalled();
    expect(doubles.cronScheduler.start).not.toHaveBeenCalled();
    expect(doubles.gateway.start).toHaveBeenCalledTimes(1);
  });
});

describe('activateThoth — runtime tier with a bare container', () => {
  beforeEach(() => {
    wireMock.mockReset();
    wireMock.mockReturnValue([]);
    resetVecDiagnosticForTest();
  });

  it('tolerates a container that registers nothing and returns null refs', async () => {
    const empty = {
      isRegistered: () => false,
      resolve: () => {
        throw new Error('nothing registered');
      },
    };

    const refs = await activateThoth(
      empty as never,
      'runtime',
      makeLogger() as never,
    );

    expect(refs.sqliteConnection).toBeNull();
    expect(refs.memoryCurator).toBeNull();
    expect(refs.gateway).toBeNull();
    expect(refs.chatBridge).toBeNull();
    await expect(
      disposeThoth(refs, makeLogger() as never),
    ).resolves.toBeUndefined();
  });
});
