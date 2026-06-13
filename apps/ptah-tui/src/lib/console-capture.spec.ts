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
