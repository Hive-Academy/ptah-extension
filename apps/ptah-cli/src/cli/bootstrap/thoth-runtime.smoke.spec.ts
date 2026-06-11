import { activateThoth, disposeThoth, type ThothRefs } from './thoth-runtime';

import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';

interface FakeLogger {
  info: jest.Mock;
  warn: jest.Mock;
}

function makeLogger(): FakeLogger {
  return { info: jest.fn(), warn: jest.fn() };
}

function makeOneshotContainer(openAndMigrate: jest.Mock, close: jest.Mock) {
  const sqliteConnection = {
    openAndMigrate,
    close,
    get isOpen(): boolean {
      return true;
    },
    get vecLoadDiagnostic() {
      return {
        ok: true,
        reason: 'loaded',
        processArch: process.arch,
        processPlatform: process.platform,
        electronVersion: '',
      };
    },
  };
  const registered = new Set<symbol>([PERSISTENCE_TOKENS.SQLITE_CONNECTION]);
  return {
    isRegistered: (token: symbol) => registered.has(token),
    resolve: (token: symbol) => {
      if (token === PERSISTENCE_TOKENS.SQLITE_CONNECTION) {
        return sqliteConnection;
      }
      throw new Error(`unexpected resolve: ${String(token)}`);
    },
  };
}

describe('Thoth interim smoke — oneshot activate + clean dispose', () => {
  it('oneshot opens + migrates the connection and exposes refs', async () => {
    const openAndMigrate = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn();
    const container = makeOneshotContainer(openAndMigrate, close);
    const logger = makeLogger();

    const refs = await activateThoth(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      container as any,
      'oneshot',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logger as any,
    );

    expect(openAndMigrate).toHaveBeenCalledTimes(1);
    expect(refs.sqliteConnection).not.toBeNull();
    expect(refs.memoryCurator).toBeNull();
    expect(refs.gateway).toBeNull();
  });

  it('disposeThoth closes sqlite last and resolves without hanging', async () => {
    const order: string[] = [];
    const close = jest.fn(() => {
      order.push('sqlite.close');
    });
    const refs: ThothRefs = {
      sqliteConnection: {
        close,
        get isOpen(): boolean {
          return true;
        },
      } as never,
      memoryCurator: {
        stop: jest.fn(() => order.push('memoryCurator.stop')),
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
      cronScheduler: { stop: jest.fn(() => order.push('cron.stop')) } as never,
      gateway: {
        stop: jest.fn(async () => {
          order.push('gateway.stop');
        }),
      } as never,
      chatBridge: {
        stop: jest.fn(() => order.push('chatBridge.stop')),
      } as never,
      embedderClient: {
        dispose: jest.fn(async () => {
          order.push('embedder.dispose');
        }),
      } as never,
      pushDisposables: [{ dispose: jest.fn(() => order.push('push.dispose')) }],
    };

    await disposeThoth(refs, makeLogger() as never);

    expect(order[0]).toBe('push.dispose');
    expect(order[1]).toBe('chatBridge.stop');
    expect(order[2]).toBe('gateway.stop');
    expect(order.indexOf('embedder.dispose')).toBeLessThan(
      order.indexOf('sqlite.close'),
    );
    expect(order[order.length - 1]).toBe('sqlite.close');
  });

  it('disposeThoth never throws even when a step fails', async () => {
    const refs: ThothRefs = {
      sqliteConnection: {
        close: jest.fn(() => {
          throw new Error('close boom');
        }),
        get isOpen(): boolean {
          return true;
        },
      } as never,
      memoryCurator: null,
      memoryTrigger: null,
      skillSynthesis: null,
      skillTrigger: null,
      cronScheduler: null,
      gateway: {
        stop: jest.fn(async () => {
          throw new Error('gateway boom');
        }),
      } as never,
      chatBridge: null,
      embedderClient: null,
      pushDisposables: [],
    };

    await expect(
      disposeThoth(refs, makeLogger() as never),
    ).resolves.toBeUndefined();
  });

  it('disposeThoth tolerates a fully-null refs object', async () => {
    const refs: ThothRefs = {
      sqliteConnection: null,
      memoryCurator: null,
      memoryTrigger: null,
      skillSynthesis: null,
      skillTrigger: null,
      cronScheduler: null,
      gateway: null,
      chatBridge: null,
      embedderClient: null,
      pushDisposables: [],
    };
    await expect(
      disposeThoth(refs, makeLogger() as never),
    ).resolves.toBeUndefined();
    await expect(
      disposeThoth(undefined, makeLogger() as never),
    ).resolves.toBeUndefined();
  });
});
