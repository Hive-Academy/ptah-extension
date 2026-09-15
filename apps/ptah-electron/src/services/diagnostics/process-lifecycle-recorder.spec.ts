import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CONSOLE_LINES_PER_WINDOW,
  CONSOLE_MAX_BYTES,
  CONSOLE_WINDOW_MS,
  ProcessLifecycleRecorder,
  pruneCrashDumps,
  startLocalCrashReporter,
  truncateUtf8,
  type LifecycleLogger,
} from './process-lifecycle-recorder';
import { HANG_LOG_FILE_NAME } from '@ptah-extension/vscode-core';

/**
 * Fake `app` / `BrowserWindow` / `webContents` emitters. The recorder only
 * subscribes, so an `EventEmitter` with the right event names is the whole
 * Electron surface it touches. Every event must produce exactly one log line
 * (INV-8, AC-6's unit-level half).
 */

class FakeWindow extends EventEmitter {
  readonly webContents = new EventEmitter();
  constructor(readonly id: number) {
    super();
  }
}

function createLogger(): jest.Mocked<LifecycleLogger> {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

type AnyApp = Parameters<ProcessLifecycleRecorder['install']>[0];
type AnyWindow = Parameters<ProcessLifecycleRecorder['attachWindow']>[0];

function readHangLog(logsDir: string): Record<string, unknown>[] {
  const file = path.join(logsDir, HANG_LOG_FILE_NAME);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function consoleMessage(level: string, message = 'boom') {
  return { level, message, lineNumber: 7, sourceId: 'app://main.js' };
}

describe('ProcessLifecycleRecorder', () => {
  let logsDir: string;
  let logger: jest.Mocked<LifecycleLogger>;
  let app: EventEmitter;
  let recorder: ProcessLifecycleRecorder;

  beforeEach(() => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-lifecycle-'));
    logger = createLogger();
    app = new EventEmitter();
    recorder = new ProcessLifecycleRecorder({
      logsPath: logsDir,
      getLogger: () => logger,
    });
    recorder.install(app as unknown as AnyApp);
  });

  afterEach(() => {
    recorder.dispose();
    jest.useRealTimers();
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it('records child-process-gone to the logger and the hang log', () => {
    app.emit(
      'child-process-gone',
      {},
      {
        type: 'Utility',
        reason: 'crashed',
        exitCode: -1073741819,
        serviceName: 'node.mojom.NodeService',
        name: 'integrity-worker',
      },
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[process-lifecycle] child-process-gone',
      expect.objectContaining({
        type: 'Utility',
        reason: 'crashed',
        exitCode: -1073741819,
        name: 'integrity-worker',
      }),
    );
    const lines = readHangLog(logsDir);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source: 'process-lifecycle',
      event: 'child-process-gone',
      reason: 'crashed',
    });
  });

  it('records render-process-gone once, from the app event', () => {
    const window = new FakeWindow(1);
    app.emit('browser-window-created', {}, window);
    app.emit(
      'render-process-gone',
      {},
      { id: 42, getURL: () => 'file:///renderer/index.html' },
      { reason: 'oom', exitCode: 3 },
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[process-lifecycle] render-process-gone',
      {
        webContentsId: 42,
        url: 'file:///renderer/index.html',
        reason: 'oom',
        exitCode: 3,
      },
    );
    expect(readHangLog(logsDir)).toHaveLength(1);
  });

  it('still records a renderer death when the WebContents is destroyed', () => {
    app.emit(
      'render-process-gone',
      {},
      {
        id: 9,
        getURL: () => {
          throw new Error('Object has been destroyed');
        },
      },
      { reason: 'crashed', exitCode: 1 },
    );

    expect(readHangLog(logsDir)[0]).toMatchObject({
      reason: 'crashed',
      url: expect.stringContaining('Object has been destroyed'),
    });
  });

  it('records unresponsive and responsive with the measured duration', () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const window = new FakeWindow(3);
    app.emit('browser-window-created', {}, window);

    window.emit('unresponsive');
    jest.setSystemTime(1_000_000 + 7_250);
    window.emit('responsive');

    expect(logger.warn).toHaveBeenCalledWith(
      '[process-lifecycle] window-unresponsive',
      { windowId: 3 },
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[process-lifecycle] window-responsive',
      { windowId: 3, unresponsiveForMs: 7_250 },
    );
    expect(readHangLog(logsDir).map((l) => l['event'])).toEqual([
      'window-unresponsive',
      'window-responsive',
    ]);
  });

  it('attaches each window once even when attached twice', () => {
    const window = new FakeWindow(5);
    app.emit('browser-window-created', {}, window);
    recorder.attachWindow(window as unknown as AnyWindow);

    window.emit('unresponsive');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('forwards renderer warning and error console lines only', () => {
    const window = new FakeWindow(2);
    app.emit('browser-window-created', {}, window);

    window.webContents.emit('console-message', consoleMessage('info'));
    window.webContents.emit('console-message', consoleMessage('debug'));
    window.webContents.emit('console-message', consoleMessage('warning', 'w'));
    window.webContents.emit('console-message', consoleMessage('error', 'e'));

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('[renderer] console.warning', {
      windowId: 2,
      message: 'w',
      source: 'app://main.js:7',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('[renderer] console.error', {
      windowId: 2,
      message: 'e',
      source: 'app://main.js:7',
    });
    // Console lines are not lifecycle events and do not touch the hang log.
    expect(readHangLog(logsDir)).toEqual([]);
  });

  it('rate-limits console forwarding and emits one suppressed line at window end', () => {
    jest.useFakeTimers({ now: 5_000_000 });
    const window = new FakeWindow(1);
    app.emit('browser-window-created', {}, window);

    const total = CONSOLE_LINES_PER_WINDOW + 13;
    for (let i = 0; i < total; i++) {
      window.webContents.emit('console-message', consoleMessage('error', `${i}`));
    }
    expect(logger.error).toHaveBeenCalledTimes(CONSOLE_LINES_PER_WINDOW);
    expect(logger.warn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(CONSOLE_WINDOW_MS);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[renderer] console lines suppressed',
      {
        suppressed: 13,
        windowMs: CONSOLE_WINDOW_MS,
        limit: CONSOLE_LINES_PER_WINDOW,
      },
    );

    // A fresh window forwards again.
    window.webContents.emit('console-message', consoleMessage('error', 'next'));
    expect(logger.error).toHaveBeenCalledTimes(CONSOLE_LINES_PER_WINDOW + 1);
  });

  it('truncates a forwarded console message to 2 KB', () => {
    const window = new FakeWindow(1);
    app.emit('browser-window-created', {}, window);

    window.webContents.emit(
      'console-message',
      consoleMessage('error', 'é'.repeat(5_000)),
    );

    const context = logger.error.mock.calls[0][1] as { message: string };
    expect(Buffer.byteLength(context.message)).toBeLessThanOrEqual(
      CONSOLE_MAX_BYTES,
    );
    expect(context.message).toMatch(/truncated\]$/);
    expect(context.message).not.toContain('�');
  });

  it('falls back to console when no logger exists yet, and still appends the hang log', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      /* silenced for the test */
    });
    const early = new ProcessLifecycleRecorder({
      logsPath: logsDir,
      getLogger: () => null,
    });
    const earlyApp = new EventEmitter();
    early.install(earlyApp as unknown as AnyApp);

    earlyApp.emit(
      'child-process-gone',
      {},
      { type: 'GPU', reason: 'killed', exitCode: 9 },
    );

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[process-lifecycle] child-process-gone'),
    );
    expect(readHangLog(logsDir)).toHaveLength(1);
    errorSpy.mockRestore();
    early.dispose();
  });

  it('rotates the hang log to .1 once it reaches the cap, honouring the shared rule', () => {
    const capped = new ProcessLifecycleRecorder({
      logsPath: logsDir,
      getLogger: () => logger,
      hangLogMaxBytes: 256,
    });
    const cappedApp = new EventEmitter();
    capped.install(cappedApp as unknown as AnyApp);
    const hangLog = path.join(logsDir, HANG_LOG_FILE_NAME);

    for (let i = 0; i < 6; i++) {
      cappedApp.emit(
        'child-process-gone',
        {},
        { type: 'Utility', reason: 'crashed', exitCode: i },
      );
    }

    expect(fs.existsSync(`${hangLog}.1`)).toBe(true);
    // The live file never grows past the cap plus the one line that tipped it.
    const oneLine = fs.readFileSync(hangLog, 'utf8').split('\n')[0].length + 1;
    expect(fs.statSync(hangLog).size).toBeLessThan(256 + oneLine);
    const all = [
      ...fs.readFileSync(`${hangLog}.1`, 'utf8').split('\n'),
      ...fs.readFileSync(hangLog, 'utf8').split('\n'),
    ].filter((l) => l.length > 0);
    // Only one generation is kept, so older lines may be gone — but the newest
    // record always lands in the live file.
    expect(JSON.parse(all[all.length - 1])).toMatchObject({ exitCode: 5 });
    capped.dispose();
  });

  it('does not throw when the hang log cannot be written', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* silenced for the test */
    });
    const blocker = path.join(logsDir, 'blocker');
    fs.writeFileSync(blocker, 'a file, not a directory');
    const blocked = new ProcessLifecycleRecorder({
      logsPath: path.join(blocker, 'logs'),
      getLogger: () => logger,
    });
    const blockedApp = new EventEmitter();
    blocked.install(blockedApp as unknown as AnyApp);

    expect(() =>
      blockedApp.emit(
        'child-process-gone',
        {},
        { type: 'Utility', reason: 'oom', exitCode: 1 },
      ),
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('startLocalCrashReporter', () => {
  it('starts Crashpad with uploads disabled', () => {
    const start = jest.fn();
    expect(startLocalCrashReporter({ start })).toBe(true);
    expect(start).toHaveBeenCalledWith({ uploadToServer: false });
  });

  it('reports false instead of throwing when start fails', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      /* silenced for the test */
    });
    const start = jest.fn(() => {
      throw new Error('already started');
    });
    expect(startLocalCrashReporter({ start })).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('pruneCrashDumps', () => {
  let dumpsDir: string;

  beforeEach(() => {
    dumpsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-crashdumps-'));
  });

  afterEach(() => {
    fs.rmSync(dumpsDir, { recursive: true, force: true });
  });

  function writeDump(relative: string, ageSeconds: number): string {
    const file = path.join(dumpsDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'MDMP');
    const at = new Date(Date.now() - ageSeconds * 1_000);
    fs.utimesSync(file, at, at);
    return file;
  }

  it('keeps the newest 5 dumps across Crashpad subdirectories', async () => {
    const files = [
      writeDump('reports/a.dmp', 10),
      writeDump('reports/b.dmp', 20),
      writeDump('completed/c.dmp', 30),
      writeDump('pending/d.dmp', 40),
      writeDump('reports/e.dmp', 50),
      writeDump('reports/f.dmp', 60),
      writeDump('completed/g.DMP', 70),
    ];
    const settings = path.join(dumpsDir, 'settings.dat');
    fs.writeFileSync(settings, 'keep me');

    const removed = await pruneCrashDumps(dumpsDir);

    expect(removed).toBe(2);
    expect(files.map((f) => fs.existsSync(f))).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(fs.existsSync(settings)).toBe(true);
  });

  it('resolves 0 for a directory that does not exist yet', async () => {
    await expect(
      pruneCrashDumps(path.join(dumpsDir, 'never-crashed')),
    ).resolves.toBe(0);
  });
});

describe('truncateUtf8', () => {
  it('returns short text unchanged', () => {
    expect(truncateUtf8('hello', 2_048)).toBe('hello');
  });
});
