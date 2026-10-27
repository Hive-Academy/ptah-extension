/**
 * RecentWorkspacesService — MRU ordering, dedupe, cap, serialised writes and
 * the `exists` hide policy (TASK_2026_721 plan component 2).
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IStateStorage,
} from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { RecentWorkspace } from '@ptah-extension/shared';

import { RecentWorkspacesService } from './recent-workspaces.service';

const KEY = RecentWorkspacesService.STORAGE_KEY;
const isWindows = process.platform === 'win32';
const root = isWindows ? 'D:\\repos' : '/repos';
const ws = (name: string) =>
  isWindows ? `${root}\\${name}` : `${root}/${name}`;

interface FakeStorage extends IStateStorage {
  values: Map<string, unknown>;
  update: jest.Mock<Promise<void>, [string, unknown]>;
  get: jest.Mock;
}

function fakeStorage(initial?: unknown): FakeStorage {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(KEY, initial);
  return {
    values,
    get: jest.fn((key: string) => values.get(key)),
    update: jest.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    keys: () => [...values.keys()],
  };
}

function build(storage: FakeStorage, exists: jest.Mock) {
  const logger = createMockLogger();
  const fileSystem = { exists } as unknown as IFileSystemProvider;
  const service = new RecentWorkspacesService(
    logger as unknown as Logger,
    storage,
    fileSystem,
  );
  return { service, logger };
}

const stored = (storage: FakeStorage) =>
  (storage.values.get(KEY) ?? []) as RecentWorkspace[];

describe('RecentWorkspacesService', () => {
  let clock = 1_700_000_000_000;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => ++clock);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('record', () => {
    it.each([['relative/path'], ['']])(
      'ignores the non-absolute path %p',
      async (path) => {
        const storage = fakeStorage();
        const { service } = build(storage, jest.fn());

        await service.record(path);

        expect(storage.update).not.toHaveBeenCalled();
      },
    );

    it('keeps the newest workspace first with its basename', async () => {
      const storage = fakeStorage();
      const { service } = build(storage, jest.fn().mockResolvedValue(true));

      await service.record(ws('alpha'));
      await service.record(ws('beta'));

      expect(stored(storage).map((e) => e.name)).toEqual(['beta', 'alpha']);
      expect(stored(storage)[0]).toEqual({
        path: ws('beta'),
        name: 'beta',
        lastOpenedAt: clock,
      });
    });

    it('dedupes separator and drive-letter variants of one workspace', async () => {
      const storage = fakeStorage();
      const { service } = build(storage, jest.fn().mockResolvedValue(true));
      const variant = isWindows ? 'd:/repos/alpha/' : '/repos/alpha/';

      await service.record(ws('alpha'));
      await service.record(ws('beta'));
      await service.record(variant);

      expect(stored(storage).map((e) => e.path)).toEqual([variant, ws('beta')]);
      expect(stored(storage)[0].name).toBe('alpha');
    });

    it('caps the list at 8 entries, dropping the oldest', async () => {
      const storage = fakeStorage();
      const { service } = build(storage, jest.fn().mockResolvedValue(true));

      for (let i = 0; i < 10; i++) {
        await service.record(ws(`p${i}`));
      }

      expect(stored(storage).map((e) => e.name)).toEqual([
        'p9',
        'p8',
        'p7',
        'p6',
        'p5',
        'p4',
        'p3',
        'p2',
      ]);
    });

    it('serialises concurrent records so neither is lost', async () => {
      const storage = fakeStorage();
      const values = storage.values;
      // A slow write: the second record must wait for the first to land.
      storage.update.mockImplementation(
        (key: string, value: unknown) =>
          new Promise<void>((resolve) =>
            setImmediate(() => {
              values.set(key, value);
              resolve();
            }),
          ),
      );
      const { service } = build(storage, jest.fn().mockResolvedValue(true));

      await Promise.all([
        service.record(ws('alpha')),
        service.record(ws('beta')),
      ]);

      expect(stored(storage).map((e) => e.name)).toEqual(['beta', 'alpha']);
    });

    it('rejects a failed write without blocking the next record', async () => {
      const storage = fakeStorage();
      const values = storage.values;
      storage.update
        .mockRejectedValueOnce(new Error('disk full'))
        .mockImplementation(async (key: string, value: unknown) => {
          values.set(key, value);
        });
      const { service } = build(storage, jest.fn().mockResolvedValue(true));

      await expect(service.record(ws('alpha'))).rejects.toThrow('disk full');
      await service.record(ws('beta'));

      expect(stored(storage).map((e) => e.name)).toEqual(['beta']);
    });
  });

  describe('list', () => {
    it('returns the stored list newest first when every path exists', async () => {
      const storage = fakeStorage();
      const exists = jest.fn().mockResolvedValue(true);
      const { service } = build(storage, exists);
      await service.record(ws('alpha'));
      await service.record(ws('beta'));
      storage.update.mockClear();

      const list = await service.list();

      expect(list.map((e) => e.name)).toEqual(['beta', 'alpha']);
      expect(exists).toHaveBeenCalledTimes(2);
      expect(storage.update).not.toHaveBeenCalled();
    });

    it('hides entries reported missing but keeps them in storage', async () => {
      const storage = fakeStorage();
      const exists = jest.fn(async (p: string) => p !== ws('alpha'));
      const { service } = build(storage, exists);
      await service.record(ws('alpha'));
      await service.record(ws('beta'));
      storage.update.mockClear();

      const list = await service.list();

      expect(list.map((e) => e.name)).toEqual(['beta']);
      // `exists` is also false for an offline drive: the entry must come back.
      expect(stored(storage).map((e) => e.name)).toEqual(['beta', 'alpha']);
      expect(storage.update).not.toHaveBeenCalled();
      exists.mockResolvedValue(true);
      await expect(service.list()).resolves.toHaveLength(2);
    });

    it('keeps an entry whose exists check times out', async () => {
      const storage = fakeStorage();
      const exists = jest.fn((p: string) =>
        p === ws('slow')
          ? new Promise<boolean>(() => {
              /* never settles */
            })
          : Promise.resolve(true),
      );
      const { service } = build(storage, exists);
      await service.record(ws('slow'));
      await service.record(ws('fast'));
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      const pending = service.list();
      await jest.advanceTimersByTimeAsync(
        RecentWorkspacesService.EXISTS_TIMEOUT_MS,
      );
      const list = await pending;

      expect(list.map((e) => e.name)).toEqual(['fast', 'slow']);
      expect(stored(storage)).toHaveLength(2);
    });

    it('keeps an entry whose exists check throws', async () => {
      const storage = fakeStorage();
      const exists = jest.fn((p: string) => {
        if (p === ws('broken')) throw new Error('EACCES');
        return Promise.resolve(true);
      });
      const { service } = build(storage, exists);
      await service.record(ws('broken'));

      const list = await service.list();

      expect(list.map((e) => e.name)).toEqual(['broken']);
    });

    it('returns [] and warns when the stored value is not an array', async () => {
      const storage = fakeStorage({ not: 'a list' });
      const { service, logger } = build(storage, jest.fn());

      await expect(service.list()).resolves.toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns [] and warns when storage cannot be read', async () => {
      const storage = fakeStorage();
      storage.get.mockImplementation(() => {
        throw new Error('corrupt db');
      });
      const { service, logger } = build(storage, jest.fn());

      await expect(service.list()).resolves.toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('drops invalid stored entries and keeps the valid ones', async () => {
      const valid = { path: ws('ok'), name: 'ok', lastOpenedAt: 5 };
      const storage = fakeStorage([
        valid,
        { path: '', name: 'x', lastOpenedAt: 1 },
        { path: ws('extra'), name: 'extra', lastOpenedAt: 2, pinned: true },
        'garbage',
      ]);
      const { service, logger } = build(
        storage,
        jest.fn().mockResolvedValue(true),
      );

      await expect(service.list()).resolves.toEqual([valid]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('dropped invalid stored entries'),
        { dropped: 3 },
      );
    });

    it('never logs a path above debug level', async () => {
      const storage = fakeStorage();
      const exists = jest.fn(async () => false);
      const { service, logger } = build(storage, exists);
      await service.record(ws('secret-project'));

      await service.list();

      const nonDebug = [
        ...logger.info.mock.calls,
        ...logger.warn.mock.calls,
        ...logger.error.mock.calls,
      ];
      expect(JSON.stringify(nonDebug)).not.toContain('secret-project');
    });
  });
});
