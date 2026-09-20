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

import { ProcessStartTimeProbe } from './process-start-time.probe';

class HangingChild extends EventEmitter {
  readonly pid = 7171;
  readonly killed = false;
  readonly stdout = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn(),
  });
  readonly kill = jest.fn();
}

describe('ProcessStartTimeProbe process cleanup', () => {
  it('bounds a wedged OS probe and reaps its process tree', async () => {
    jest.useFakeTimers();
    const realPlatform = process.platform;
    try {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      const child = new HangingChild();
      mockCrossSpawn.mockReturnValue(child);

      const result = new ProcessStartTimeProbe({ platform: 'win32' }).probe([
        42,
      ]);
      jest.advanceTimersByTime(30_000);

      await expect(result).resolves.toEqual(new Map());
      await Promise.resolve();
      expect(child.kill).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '7171', '/T', '/F'],
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
});
