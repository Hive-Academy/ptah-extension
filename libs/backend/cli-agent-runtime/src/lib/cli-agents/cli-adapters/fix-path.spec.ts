import * as path from 'path';
import type * as FixPathExports from './fix-path';

// Module-scope mocks the factories delegate to, so every fresh module
// registry (one per `loadModule`) shares the same spies.
const mockExecFile = jest.fn();
const mockSpawnSync = jest.fn();
const mockReaddirSync = jest.fn();

jest.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  };
});

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;

type FixPathModule = typeof FixPathExports;

/** A fresh copy of the module, so its run-once latch starts clear. */
function loadModule(): FixPathModule {
  let mod: FixPathModule | undefined;
  jest.isolateModules(() => {
    mod = require('./fix-path') as FixPathModule;
  });
  if (mod === undefined) throw new Error('fix-path did not load');
  return mod;
}

const mockStdinEnd = jest.fn();

/** Make the next execFile call answer with `stdout` (or an error). */
function answerShell(stdout: string, error: Error | null = null): void {
  mockExecFile.mockImplementation(
    (_file: string, _args: string[], _opts: object, cb: ExecFileCallback) => {
      setImmediate(() => cb(error, stdout, ''));
      return { stdin: { end: mockStdinEnd } };
    },
  );
}

describe('fixPath', () => {
  const originalPlatform = process.platform;
  const originalPath = process.env['PATH'];
  const originalShell = process.env['SHELL'];
  const originalHome = process.env['HOME'];

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env['PATH'] = '/usr/bin';
    process.env['SHELL'] = '/bin/bash';
    process.env['HOME'] = '/tmp/ptah-e2e-test';
    answerShell('', new Error('exit 1'));
    mockReaddirSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env['PATH'] = originalPath;
    if (originalShell === undefined) delete process.env['SHELL'];
    else process.env['SHELL'] = originalShell;
    if (originalHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = originalHome;
  });

  it('returns a non-empty PATH when nvm root directory does not exist (ENOENT)', () => {
    const { fixPath } = loadModule();
    let result = '';
    expect(() => {
      result = fixPath();
    }).not.toThrow();

    expect(result.length).toBeGreaterThan(0);
    expect(result.split(path.delimiter)).toContain('/usr/bin');
  });

  it('still includes fallback bin dirs when nvm scan fails', () => {
    const parts = loadModule().fixPath().split(path.delimiter);

    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain('/opt/homebrew/bin');
  });

  it('never probes the shell synchronously', () => {
    loadModule().fixPath();

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile.mock.calls[0][0]).toBe('/bin/bash');
  });

  it('prepends the login-shell PATH once the async probe answers', async () => {
    const shellPath = ['/home/u/.nvm/bin', '/usr/bin'].join(path.delimiter);
    answerShell(
      `noise\n__PTAH_PATH_MARKER__${shellPath}__PTAH_PATH_MARKER__\n`,
    );
    const { fixPath, fixPathReady } = loadModule();

    const immediate = fixPath();
    expect(immediate.split(path.delimiter)[0]).toBe('/usr/bin');

    const merged = (await fixPathReady()).split(path.delimiter);
    expect(merged[0]).toBe('/home/u/.nvm/bin');
    expect(merged.filter((dir) => dir === '/usr/bin')).toHaveLength(1);
    expect(process.env['PATH']).toBe(merged.join(path.delimiter));
  });

  it('closes the probe shell stdin at once so rc files that read it see EOF', () => {
    loadModule().fixPath();

    expect(mockStdinEnd).toHaveBeenCalledTimes(1);
  });

  it('runs the probe at most once per process', async () => {
    const { fixPath, fixPathReady } = loadModule();
    fixPath();
    fixPath();
    await fixPathReady();
    await fixPathReady();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('keeps the fallback PATH when the probe fails', async () => {
    const { fixPath, fixPathReady } = loadModule();
    fixPath();
    const parts = (await fixPathReady()).split(path.delimiter);

    expect(parts).toContain('/usr/bin');
    expect(parts).toContain('/usr/local/bin');
  });

  it('skips the probe without SHELL', async () => {
    delete process.env['SHELL'];
    const { fixPath, fixPathReady } = loadModule();
    fixPath();
    await fixPathReady();

    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('never starts the repair from fixPathReady alone (hosts that did not opt in)', async () => {
    const { fixPathReady } = loadModule();

    expect(await fixPathReady()).toBe('/usr/bin');
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(process.env['PATH']).toBe('/usr/bin');
  });

  it('is a no-op on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const { fixPath, fixPathReady } = loadModule();

    expect(fixPath()).toBe('/usr/bin');
    expect(await fixPathReady()).toBe('/usr/bin');
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
