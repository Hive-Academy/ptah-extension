import { EventEmitter } from 'node:events';

const mockCrossSpawn = jest.fn();
const mockExecFile = jest.fn((...args: unknown[]) =>
  (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(
    null,
    '',
    '',
  ),
);

jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCrossSpawn(...args),
}));
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { getStackProfile } from '@ptah-extension/shared';
import { probeStackToolchain } from './toolchain-probe';

class HangingChild extends EventEmitter {
  readonly pid = 5150;
  readonly killed = false;
  readonly stdout = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn(),
  });
  readonly stderr = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn(),
  });
  readonly kill = jest.fn();
}

describe('probeStackToolchain process cleanup', () => {
  it('tree-kills a timed-out Windows toolchain wrapper', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      const child = new HangingChild();
      mockCrossSpawn.mockReturnValue(child);

      const result = probeStackToolchain(getStackProfile('node-ts'), {
        timeoutMs: 50,
      });
      jest.advanceTimersByTime(50);

      await expect(result).resolves.toMatchObject({ installed: false });
      await Promise.resolve();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledWith(
        expect.stringContaining('taskkill'),
        ['/pid', '5150', '/T', '/F'],
        expect.any(Function),
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('escalates to SIGKILL when a POSIX toolchain survives SIGTERM', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    const kill = jest.spyOn(process, 'kill').mockReturnValue(true);
    try {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      const child = new HangingChild();
      mockCrossSpawn.mockReturnValue(child);

      const result = probeStackToolchain(getStackProfile('node-ts'), {
        timeoutMs: 50,
      });
      jest.advanceTimersByTime(50);
      await expect(result).resolves.toMatchObject({ installed: false });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(kill).toHaveBeenCalledWith(-5150, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-5150, 0);
      expect(kill).toHaveBeenCalledWith(-5150, 'SIGKILL');
    } finally {
      jest.restoreAllMocks();
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });

  it('escalates to SIGKILL if toolchain probe leader exits but group descendants remain alive', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    const kill = jest
      .spyOn(process, 'kill')
      .mockImplementation((pid, signal) => {
        if (signal === 0) {
          if (pid === 5150) {
            throw new Error('ESRCH');
          }
          if (pid === -5150) {
            return true;
          }
        }
        return true;
      });
    try {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
      const child = new HangingChild();
      mockCrossSpawn.mockReturnValue(child);

      const result = probeStackToolchain(getStackProfile('node-ts'), {
        timeoutMs: 50,
      });
      jest.advanceTimersByTime(50);
      await expect(result).resolves.toMatchObject({ installed: false });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(kill).toHaveBeenCalledWith(-5150, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-5150, 0);
      expect(kill).toHaveBeenCalledWith(-5150, 'SIGKILL');
    } finally {
      jest.restoreAllMocks();
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true,
      });
      jest.useRealTimers();
    }
  });
});
