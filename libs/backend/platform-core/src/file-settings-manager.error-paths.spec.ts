import 'reflect-metadata';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

const mockTestHome = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-file-settings-errpaths-'),
);

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockTestHome,
  };
});

let watchFactory:
  | ((
      target: string,
      options: unknown,
      cb?: (eventType: string, filename: string | Buffer | null) => void,
    ) => fs.FSWatcher)
  | null = null;

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    watch: jest.fn(
      (
        target: string,
        optionsOrCb?:
          | unknown
          | ((eventType: string, filename: string | Buffer | null) => void),
        maybeCb?: (eventType: string, filename: string | Buffer | null) => void,
      ): fs.FSWatcher => {
        const cb =
          typeof optionsOrCb === 'function'
            ? (optionsOrCb as (
                eventType: string,
                filename: string | Buffer | null,
              ) => void)
            : maybeCb;
        const options = typeof optionsOrCb === 'function' ? {} : optionsOrCb;
        if (watchFactory) {
          return watchFactory(target, options, cb);
        }
        return actual.watch(
          target,
          options as fs.WatchOptions,
          cb as (eventType: string, filename: string | Buffer | null) => void,
        );
      },
    ),
  };
});

afterAll(() => {
  try {
    fs.rmSync(mockTestHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

import { PtahFileSettingsManager } from './file-settings-manager';
import { SettingsPersistError } from './file-settings-errors';

const PTAH_DIR = path.join(mockTestHome, '.ptah');
const SETTINGS_PATH = path.join(PTAH_DIR, 'settings.json');

function cleanPtahDir(): void {
  if (fs.existsSync(PTAH_DIR)) {
    fs.rmSync(PTAH_DIR, { recursive: true, force: true });
  }
}

function makeMockWatcher(capture?: (e: EventEmitter) => void): fs.FSWatcher {
  const emitter = new EventEmitter() as unknown as fs.FSWatcher;
  (emitter as unknown as { close: () => void }).close = jest.fn();
  capture?.(emitter as unknown as EventEmitter);
  return emitter;
}

describe('PtahFileSettingsManager — error-path branch coverage', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    cleanPtahDir();
    watchFactory = null;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    watchFactory = null;
    jest.restoreAllMocks();
  });

  it('enableCrossProcessWatch() is idempotent — second call returns a disposable without re-init', () => {
    const mgr = new PtahFileSettingsManager({});
    const handle1 = mgr.enableCrossProcessWatch();
    const handle2 = mgr.enableCrossProcessWatch();
    expect(handle2).toBeDefined();
    expect(typeof handle2.dispose).toBe('function');
    handle1.dispose();
    handle2.dispose();
    expect(() => mgr.disposeCrossProcessWatch()).not.toThrow();
  });

  it('disposeCrossProcessWatch() is safe to call when never enabled', () => {
    const mgr = new PtahFileSettingsManager({});
    expect(() => mgr.disposeCrossProcessWatch()).not.toThrow();
    expect(() => mgr.disposeCrossProcessWatch()).not.toThrow();
  });

  it('set() recovers when a prior persist() in the chain rejected', async () => {
    const mgr = new PtahFileSettingsManager({});

    const fsPromises =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    const writeSpy = jest
      .spyOn(fsPromises, 'writeFile')
      .mockRejectedValueOnce(new Error('boom') as never);

    await expect(mgr.set('key', 'v1')).rejects.toBeInstanceOf(
      SettingsPersistError,
    );
    expect(warnSpy).toHaveBeenCalled();

    writeSpy.mockRestore();

    await mgr.set('key', 'v2');
    expect(mgr.get<string>('key')).toBe('v2');
  });

  it('persist() logs and rejects with SettingsPersistError when writeFile fails', async () => {
    const mgr = new PtahFileSettingsManager({});

    const fsPromisesActual =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    jest
      .spyOn(fsPromisesActual, 'writeFile')
      .mockRejectedValueOnce(new Error('disk-full') as never);

    await expect(mgr.set('key', 'fail-once')).rejects.toBeInstanceOf(
      SettingsPersistError,
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  describe('failed write (TASK_2026_553)', () => {
    function failNextWrite(code: string, message: string): jest.SpyInstance {
      const fsPromisesActual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
      const err = new Error(message) as NodeJS.ErrnoException;
      err.code = code;
      return jest
        .spyOn(fsPromisesActual, 'writeFile')
        .mockRejectedValueOnce(err as never);
    }

    it('carries only the fs code and fixed text, never the value', async () => {
      const mgr = new PtahFileSettingsManager({});
      failNextWrite('EACCES', 'EACCES: permission denied, open settings.json.tmp');

      const rejection = await mgr
        .set('provider.cursor.apiKey', 'sk-secret-value')
        .then(
          () => undefined,
          (e: unknown) => e,
        );

      expect(rejection).toBeInstanceOf(SettingsPersistError);
      const persistError = rejection as SettingsPersistError;
      expect(persistError.code).toBe('EACCES');
      expect(persistError.name).toBe('SettingsPersistError');
      expect(persistError.message).toBe(
        'Settings could not be saved to disk (EACCES)',
      );
      expect(persistError.message).not.toContain('sk-secret-value');
      expect(persistError.message).not.toContain('settings.json');
    });

    it('uses UNKNOWN when the failure has no fs code', async () => {
      const mgr = new PtahFileSettingsManager({});
      const fsPromisesActual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
      jest
        .spyOn(fsPromisesActual, 'rename')
        .mockRejectedValueOnce(new Error('opaque') as never);

      await expect(mgr.set('key', 'v')).rejects.toMatchObject({
        code: 'UNKNOWN',
      });
    });

    function lockError(code: string): NodeJS.ErrnoException {
      const err = new Error(`${code}: target locked`) as NodeJS.ErrnoException;
      err.code = code;
      return err;
    }

    it('rejects and removes its temp file when the rename stays locked', async () => {
      const mgr = new PtahFileSettingsManager({});
      const fsPromisesActual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
      const renameSpy = jest
        .spyOn(fsPromisesActual, 'rename')
        .mockRejectedValue(lockError('EPERM') as never);

      await expect(mgr.set('key', 'v')).rejects.toMatchObject({
        code: 'EPERM',
      });
      // One attempt plus the bounded retries.
      expect(renameSpy).toHaveBeenCalledTimes(4);

      const stranded = fs
        .readdirSync(PTAH_DIR)
        .filter((name) => name.endsWith('.tmp'));
      expect(stranded).toEqual([]);
    });

    it('retries a transiently locked rename and then saves', async () => {
      const mgr = new PtahFileSettingsManager({});
      const fsPromisesActual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
      jest
        .spyOn(fsPromisesActual, 'rename')
        .mockRejectedValueOnce(lockError('EBUSY') as never);

      await expect(mgr.set('key', 'v')).resolves.toBeUndefined();
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as {
        key?: string;
      };
      expect(onDisk.key).toBe('v');
    });

    it('does not retry a rename that fails with a non-transient code', async () => {
      const mgr = new PtahFileSettingsManager({});
      const fsPromisesActual =
        jest.requireActual<typeof import('fs/promises')>('fs/promises');
      const renameSpy = jest
        .spyOn(fsPromisesActual, 'rename')
        .mockRejectedValue(lockError('ENOSPC') as never);

      await expect(mgr.set('key', 'v')).rejects.toMatchObject({
        code: 'ENOSPC',
      });
      expect(renameSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves the previous value unchanged in memory and on disk', async () => {
      const mgr = new PtahFileSettingsManager({});
      await mgr.set('key', 'before');

      failNextWrite('ENOSPC', 'ENOSPC: no space left on device');
      await expect(mgr.set('key', 'after')).rejects.toBeInstanceOf(
        SettingsPersistError,
      );

      expect(mgr.get<string>('key')).toBe('before');
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as {
        key?: string;
      };
      expect(onDisk.key).toBe('before');
    });

    it('removes a key that did not exist before the failed write', async () => {
      const mgr = new PtahFileSettingsManager({ fresh: 'default' });

      failNextWrite('EBUSY', 'EBUSY: resource busy or locked');
      await expect(mgr.set('fresh', 'user-value')).rejects.toBeInstanceOf(
        SettingsPersistError,
      );

      expect(mgr.get<string>('fresh')).toBe('default');
    });

    it('accepts the next set() after a failure and persists it', async () => {
      const mgr = new PtahFileSettingsManager({});

      failNextWrite('EBUSY', 'EBUSY: resource busy or locked');
      await expect(mgr.set('key', 'v1')).rejects.toBeInstanceOf(
        SettingsPersistError,
      );

      await expect(mgr.set('key', 'v2')).resolves.toBeUndefined();
      expect(mgr.get<string>('key')).toBe('v2');
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as {
        key?: string;
      };
      expect(onDisk.key).toBe('v2');
    });

    it('does not call listeners on failure and calls them on the next success', async () => {
      const mgr = new PtahFileSettingsManager({});
      const listener = jest.fn();
      mgr.watch('key', listener);

      failNextWrite('EACCES', 'EACCES: permission denied');
      await expect(mgr.set('key', 'v1')).rejects.toBeInstanceOf(
        SettingsPersistError,
      );
      expect(listener).not.toHaveBeenCalled();

      await mgr.set('key', 'v2');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('v2');
    });

    it('does not roll back a later set() on the same key queued behind the failed write', async () => {
      const mgr = new PtahFileSettingsManager({});
      await mgr.set('key', 'original');

      failNextWrite('EBUSY', 'EBUSY: resource busy or locked');
      const first = mgr.set('key', 'first');
      const second = mgr.set('key', 'second');

      await expect(first).rejects.toBeInstanceOf(SettingsPersistError);
      await expect(second).resolves.toBeUndefined();

      expect(mgr.get<string>('key')).toBe('second');
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as {
        key?: string;
      };
      expect(onDisk.key).toBe('second');
    });

    it('does not roll back a later set() of the identical value queued behind the failed write', async () => {
      const mgr = new PtahFileSettingsManager({});
      await mgr.set('key', 'original');
      const listener = jest.fn();
      mgr.watch('key', listener);

      failNextWrite('EBUSY', 'EBUSY: resource busy or locked');
      const first = mgr.set('key', true);
      const second = mgr.set('key', true);

      await expect(first).rejects.toBeInstanceOf(SettingsPersistError);
      await expect(second).resolves.toBeUndefined();

      // The second call was told it saved, so memory and disk must hold its value.
      expect(mgr.get<boolean>('key')).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as {
        key?: unknown;
      };
      expect(onDisk.key).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(true);
    });

    it('flushSync() keeps swallowing write errors', () => {
      const mgr = new PtahFileSettingsManager({});
      const fsMocked = jest.requireMock<typeof import('fs')>('fs');
      jest.spyOn(fsMocked, 'writeFileSync').mockImplementationOnce(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => mgr.flushSync()).not.toThrow();
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('stale temp-file sweep on load', () => {
    const OTHER_PID = process.pid + 1;
    const ELEVEN_MINUTES_S = 11 * 60;

    function writeTemp(name: string, ageSeconds: number): string {
      const full = path.join(PTAH_DIR, name);
      fs.writeFileSync(full, '{}', 'utf-8');
      if (ageSeconds > 0) {
        const past = Date.now() / 1000 - ageSeconds;
        fs.utimesSync(full, past, past);
      }
      return full;
    }

    beforeEach(() => {
      fs.mkdirSync(PTAH_DIR, { recursive: true });
    });

    it("removes another process's temp file older than the stale age", () => {
      const stale = writeTemp(`settings.json.${OTHER_PID}.3.tmp`, ELEVEN_MINUTES_S);

      new PtahFileSettingsManager({});

      expect(fs.existsSync(stale)).toBe(false);
    });

    it("keeps another process's recent temp file (an in-flight write)", () => {
      const fresh = writeTemp(`settings.json.${OTHER_PID}.4.tmp`, 0);

      new PtahFileSettingsManager({});

      expect(fs.existsSync(fresh)).toBe(true);
    });

    it("never removes the current process's temp files, however old", () => {
      const own = writeTemp(`settings.json.${process.pid}.1.tmp`, ELEVEN_MINUTES_S);

      new PtahFileSettingsManager({});

      expect(fs.existsSync(own)).toBe(true);
    });

    it('leaves files that do not match the temp pattern', () => {
      const others = [
        writeTemp('settings.json.flush.tmp', ELEVEN_MINUTES_S),
        writeTemp('other.json.123.1.tmp', ELEVEN_MINUTES_S),
        writeTemp('settings.json.bak', ELEVEN_MINUTES_S),
      ];

      new PtahFileSettingsManager({});

      for (const file of others) {
        expect(fs.existsSync(file)).toBe(true);
      }
    });

    it('still loads settings.json after sweeping', () => {
      fs.writeFileSync(SETTINGS_PATH, '{"a":{"b":1}}', 'utf-8');
      writeTemp(`settings.json.${OTHER_PID}.9.tmp`, ELEVEN_MINUTES_S);

      const mgr = new PtahFileSettingsManager({});

      expect(mgr.get<number>('a.b')).toBe(1);
    });
  });

  it('watcher error event triggers retry with exponential backoff', async () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, '{}', 'utf-8');

    let createCount = 0;
    watchFactory = () => {
      createCount += 1;
      const errorOnce = createCount <= 2;
      return makeMockWatcher((emitter) => {
        if (errorOnce) {
          setTimeout(() => emitter.emit('error', new Error('forced-error')), 5);
        }
      });
    };

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(createCount).toBeGreaterThanOrEqual(2);
    const errorWarnings = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('fs.watch error on'));
    expect(errorWarnings.length).toBeGreaterThanOrEqual(1);

    mgr.disposeCrossProcessWatch();
  }, 10000);

  it('startDirectoryWatchForFile catch-block logs when fs.watch throws synchronously', () => {
    watchFactory = () => {
      throw new Error('synchronous-watch-failure');
    };

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    const matched = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .some((m) => m.includes('Unable to start fs.watch'));
    expect(matched).toBe(true);

    mgr.disposeCrossProcessWatch();
  });

  it('handleFileRename re-establishes watch after a rename event', async () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, '{}', 'utf-8');

    const emitters: EventEmitter[] = [];
    watchFactory = () => makeMockWatcher((emitter) => emitters.push(emitter));

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    const firstEmitter = emitters[0];
    expect(firstEmitter).toBeDefined();
    firstEmitter.emit('rename');

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(emitters.length).toBeGreaterThanOrEqual(2);

    mgr.disposeCrossProcessWatch();
  });

  it('handleFileRename ignores rename events while a re-establish is already pending', async () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, '{}', 'utf-8');

    const emitters: EventEmitter[] = [];
    watchFactory = () => makeMockWatcher((emitter) => emitters.push(emitter));

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    const firstEmitter = emitters[0];
    firstEmitter.emit('rename');
    firstEmitter.emit('rename');
    firstEmitter.emit('rename');

    await new Promise((resolve) => setTimeout(resolve, 150));

    mgr.disposeCrossProcessWatch();
  });

  it('file-watch error handler invokes handleWatcherError and logs', async () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, '{}', 'utf-8');

    let watchCount = 0;
    watchFactory = () => {
      watchCount += 1;
      return makeMockWatcher((emitter) => {
        if (watchCount === 1) {
          setImmediate(() =>
            emitter.emit('error', new Error('first-watch-error')),
          );
        }
      });
    };

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    await new Promise((resolve) => setTimeout(resolve, 300));

    const fileWatchWarn = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .some((m) => m.includes('fs.watch error on'));
    expect(fileWatchWarn).toBe(true);

    mgr.disposeCrossProcessWatch();
  });

  it('tryStartFileWatch logs unexpected (non-ENOENT) errors', () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, '{}', 'utf-8');

    let firstCall = true;
    watchFactory = () => {
      if (firstCall) {
        firstCall = false;
        throw new Error('EPERM: permission denied');
      }
      return makeMockWatcher();
    };

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    const fileWatchWarn = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('fs.watch(file) failed unexpectedly'));
    expect(fileWatchWarn).toBeDefined();

    mgr.disposeCrossProcessWatch();
  });

  it('directory watcher filters out null filename and handles Buffer filename', async () => {
    let dirCallback:
      | ((eventType: string, filename: string | Buffer | null) => void)
      | undefined;

    let firstCall = true;
    watchFactory = (_target, _options, cb) => {
      if (firstCall) {
        firstCall = false;
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (cb) {
        dirCallback = cb;
      }
      return makeMockWatcher();
    };

    fs.mkdirSync(PTAH_DIR, { recursive: true });

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    expect(dirCallback).toBeDefined();
    dirCallback?.('change', null);
    dirCallback?.('change', 'unrelated.json');

    await new Promise((resolve) => setTimeout(resolve, 100));

    mgr.disposeCrossProcessWatch();
  });

  it('directory watcher matching filename triggers transition to file-watch', async () => {
    fs.mkdirSync(PTAH_DIR, { recursive: true });

    let dirCallback:
      | ((eventType: string, filename: string | Buffer | null) => void)
      | undefined;

    let calls = 0;
    watchFactory = (_target, _options, cb) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (calls === 2 && cb) {
        dirCallback = cb;
      }
      return makeMockWatcher();
    };

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    fs.writeFileSync(SETTINGS_PATH, '{"a":1}', 'utf-8');
    dirCallback?.('rename', Buffer.from('settings.json'));

    await new Promise((resolve) => setTimeout(resolve, 200));

    mgr.disposeCrossProcessWatch();
  });

  it('directory-watch error event triggers handleWatcherError path', async () => {
    let calls = 0;
    watchFactory = () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      return makeMockWatcher((emitter) => {
        setImmediate(() => emitter.emit('error', new Error('dir-watch-error')));
      });
    };

    fs.mkdirSync(PTAH_DIR, { recursive: true });

    const mgr = new PtahFileSettingsManager({});
    mgr.enableCrossProcessWatch();

    await new Promise((resolve) => setTimeout(resolve, 200));

    const dirError = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .some((m) => m.includes('fs.watch error on'));
    expect(dirError).toBe(true);

    mgr.disposeCrossProcessWatch();
  });
});
