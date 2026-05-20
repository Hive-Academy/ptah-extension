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

    await mgr.set('key', 'v1');
    expect(warnSpy).toHaveBeenCalled();

    writeSpy.mockRestore();

    await mgr.set('key', 'v2');
    expect(mgr.get<string>('key')).toBe('v2');
  });

  it('persist() logs but does not throw when writeFile fails', async () => {
    const mgr = new PtahFileSettingsManager({});

    const fsPromisesActual =
      jest.requireActual<typeof import('fs/promises')>('fs/promises');
    jest
      .spyOn(fsPromisesActual, 'writeFile')
      .mockRejectedValueOnce(new Error('disk-full') as never);

    await expect(mgr.set('key', 'fail-once')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
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
