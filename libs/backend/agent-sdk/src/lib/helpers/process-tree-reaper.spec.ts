import {
  PROCESS_TREE_KILL_GRACE_MS,
  killProcessTree,
} from './process-tree-reaper';

describe('killProcessTree POSIX escalation', () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(process, 'platform', {
      value: realPlatform,
      configurable: true,
    });
    jest.useRealTimers();
  });

  it('SIGKILLs a process group that remains alive for the full grace period', async () => {
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);

    const reaped = killProcessTree(8080);
    await jest.advanceTimersByTimeAsync(PROCESS_TREE_KILL_GRACE_MS);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8080, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-8080, 0);
    expect(kill).toHaveBeenCalledWith(-8080, 'SIGKILL');
  });

  it('does not SIGKILL a process that exits after SIGTERM', async () => {
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if ((pid === 8081 || pid === -8081) && signal === 0) {
          throw new Error('ESRCH');
        }
        return true;
      });

    const reaped = killProcessTree(8081);
    await jest.advanceTimersByTimeAsync(100);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8081, 'SIGTERM');
    expect(kill).not.toHaveBeenCalledWith(-8081, 'SIGKILL');
    expect(kill).not.toHaveBeenCalledWith(8081, 'SIGKILL');
  });

  it('escalates to SIGKILL if the leader has exited but descendants in the process group remain alive', async () => {
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if (signal === 0) {
          if (pid === 8082) {
            throw new Error('ESRCH');
          }
          if (pid === -8082) {
            return true;
          }
        }
        return true;
      });

    const reaped = killProcessTree(8082);
    await jest.advanceTimersByTimeAsync(PROCESS_TREE_KILL_GRACE_MS);
    await reaped;

    expect(kill).toHaveBeenCalledWith(-8082, 'SIGTERM');
    expect(kill).toHaveBeenCalledWith(-8082, 0);
    expect(kill).toHaveBeenCalledWith(-8082, 'SIGKILL');
  });
});
