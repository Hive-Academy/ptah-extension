const mockExecFile = jest.fn(
  (...args: unknown[]) =>
    (args.at(-1) as (error: Error | null) => void)(null),
);

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import {
  PROCESS_TREE_KILL_GRACE_MS,
  killProcessTree,
} from './process-tree-reaper';

describe('killProcessTree', () => {
  const realPlatform = process.platform;
  const realSystemRoot = process.env['SystemRoot'];
  const realWindir = process.env['windir'];

  afterEach(() => {
    jest.restoreAllMocks();
    mockExecFile.mockClear();
    // Restored explicitly: these drive the Windows binary path, so leaving one
    // set would make a later test depend on the host that ran it.
    if (realSystemRoot === undefined) delete process.env['SystemRoot'];
    else process.env['SystemRoot'] = realSystemRoot;
    if (realWindir === undefined) delete process.env['windir'];
    else process.env['windir'] = realWindir;
    Object.defineProperty(process, 'platform', {
      value: realPlatform,
      configurable: true,
    });
    jest.useRealTimers();
  });

  it('uses taskkill /T /F on Windows, resolved under System32', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    process.env['SystemRoot'] = 'C:\\Windows';

    await killProcessTree(4242);

    // Absolute, so a writable directory earlier in PATH cannot interpose its
    // own taskkill.exe and receive a forced tree kill (S4036).
    expect(mockExecFile).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '4242', '/T', '/F'],
      expect.any(Function),
    );
  });

  it('falls back to the bare name when SystemRoot is unset', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    delete process.env['SystemRoot'];
    delete process.env['windir'];

    await killProcessTree(4242);

    expect(mockExecFile).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', '4242', '/T', '/F'],
      expect.any(Function),
    );
  });

  it('escalates a live POSIX process group after the grace period', async () => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);

    const reaped = killProcessTree(8080);
    await jest.advanceTimersByTimeAsync(PROCESS_TREE_KILL_GRACE_MS);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8080, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-8080, 0);
    expect(kill).toHaveBeenCalledWith(-8080, 'SIGKILL');
  });

  it('does not escalate when the POSIX process exits on SIGTERM', async () => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if (pid === -8081 && signal === 0) throw new Error('ESRCH');
        return true;
      });

    const reaped = killProcessTree(8081);
    await jest.advanceTimersByTimeAsync(100);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8081, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(-8081, 'SIGKILL');
    expect(kill).not.toHaveBeenCalledWith(8081, 'SIGKILL');
  });
  // Regression: the poll probed the LEADER, so a leader that exited while a
  // descendant survived read as "gone" and the descendant was never escalated.
  it('escalates when the leader exits but the group survives', async () => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        // The leader is gone; the group is not.
        if (pid === 8082 && signal === 0) throw new Error('ESRCH');
        return true;
      });

    const reaped = killProcessTree(8082);
    await jest.advanceTimersByTimeAsync(PROCESS_TREE_KILL_GRACE_MS);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8082, 'SIGKILL');
  });

  // EPERM means the group still exists but may not be signalled by this
  // process. Treating it as "already exited" would skip the escalation.
  it('keeps polling when the group probe fails with EPERM', async () => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    const eperm = Object.assign(new Error('operation not permitted'), {
      code: 'EPERM',
    });
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if (pid === -8083 && signal === 0) throw eperm;
        return true;
      });

    const reaped = killProcessTree(8083);
    await jest.advanceTimersByTimeAsync(PROCESS_TREE_KILL_GRACE_MS);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8083, 'SIGKILL');
  });
});
