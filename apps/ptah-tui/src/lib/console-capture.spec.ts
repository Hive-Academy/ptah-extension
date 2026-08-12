import { installConsoleCapture } from './console-capture.js';

describe('installConsoleCapture', () => {
  const originalDebugEnv = process.env['PTAH_TUI_DEBUG'];
  const originalLogEnv = process.env['PTAH_TUI_LOG'];

  afterEach(() => {
    if (originalDebugEnv === undefined) {
      delete process.env['PTAH_TUI_DEBUG'];
    } else {
      process.env['PTAH_TUI_DEBUG'] = originalDebugEnv;
    }
    if (originalLogEnv === undefined) {
      delete process.env['PTAH_TUI_LOG'];
    } else {
      process.env['PTAH_TUI_LOG'] = originalLogEnv;
    }
    jest.restoreAllMocks();
  });

  it('swallows console.* writes while installed and restores them after', () => {
    delete process.env['PTAH_TUI_DEBUG'];
    delete process.env['PTAH_TUI_LOG'];

    const spy = jest.fn();
    const realLog = console.log;
    console.log = spy;

    const restore = installConsoleCapture();
    console.log('should be swallowed');
    console.error('also swallowed');
    expect(spy).not.toHaveBeenCalled();

    restore();
    console.log('visible again');
    expect(spy).toHaveBeenCalledWith('visible again');

    console.log = realLog;
  });

  /**
   * `console.*` patching alone left the Ink frame corrupted: `withEngine` and
   * several backend services write straight to `process.stderr`, which never
   * goes through `console`.
   */
  it('diverts direct process.stderr.write calls while installed', () => {
    delete process.env['PTAH_TUI_DEBUG'];
    delete process.env['PTAH_TUI_LOG'];

    const realWrite = process.stderr.write;
    const spy = jest.fn().mockReturnValue(true);
    process.stderr.write = spy as unknown as typeof process.stderr.write;

    const restore = installConsoleCapture();
    process.stderr.write('[ptah] withEngine: noisy bootstrap line\n');
    expect(spy).not.toHaveBeenCalled();

    restore();
    process.stderr.write = realWrite;
  });

  it('restores process.stderr.write on teardown', () => {
    delete process.env['PTAH_TUI_DEBUG'];
    delete process.env['PTAH_TUI_LOG'];

    const realWrite = process.stderr.write;
    const sentinel = jest
      .fn()
      .mockReturnValue(true) as unknown as typeof process.stderr.write;
    process.stderr.write = sentinel;

    const restore = installConsoleCapture();
    expect(process.stderr.write).not.toBe(sentinel);
    restore();
    expect(process.stderr.write).toBe(sentinel);

    process.stderr.write = realWrite;
  });

  it('reports diverted writes as flushed so awaited drains still settle', () => {
    delete process.env['PTAH_TUI_DEBUG'];
    delete process.env['PTAH_TUI_LOG'];

    const realWrite = process.stderr.write;
    process.stderr.write = jest
      .fn()
      .mockReturnValue(true) as unknown as typeof process.stderr.write;

    const restore = installConsoleCapture();
    const callback = jest.fn();
    const result = process.stderr.write('line\n', callback);

    expect(result).toBe(true);
    expect(callback).toHaveBeenCalledWith(null);

    restore();
    process.stderr.write = realWrite;
  });

  it('leaves process.stderr.write alone when PTAH_TUI_DEBUG=1', () => {
    process.env['PTAH_TUI_DEBUG'] = '1';

    const realWrite = process.stderr.write;
    const sentinel = jest
      .fn()
      .mockReturnValue(true) as unknown as typeof process.stderr.write;
    process.stderr.write = sentinel;

    const restore = installConsoleCapture();
    expect(process.stderr.write).toBe(sentinel);

    restore();
    process.stderr.write = realWrite;
  });

  it('passes through unchanged when PTAH_TUI_DEBUG=1', () => {
    process.env['PTAH_TUI_DEBUG'] = '1';

    const spy = jest.fn();
    const realLog = console.log;
    console.log = spy;

    const restore = installConsoleCapture();
    console.log('passthrough');
    expect(spy).toHaveBeenCalledWith('passthrough');

    restore();
    console.log = realLog;
  });
});
