import { EventEmitter } from 'node:events';

const mockSpawn = jest.fn();
const mockExecFile = jest.fn((...args: unknown[]) =>
  (args.at(-1) as (error: null, stdout: string, stderr: string) => void)(
    null,
    '',
    '',
  ),
);

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFile: (...args: unknown[]) => mockExecFile(...args),
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(() => 'win32'),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false),
}));

import { ClaudeCliPathResolver } from './claude-cli-path-resolver';

class HangingChild extends EventEmitter {
  readonly pid = 6161;
  readonly killed = false;
  readonly stdout = new EventEmitter();
  readonly kill = jest.fn();
}

describe('ClaudeCliPathResolver process cleanup', () => {
  it('bounds a wedged where.exe lookup and reaps its process tree', async () => {
    jest.useFakeTimers();
    try {
      const child = new HangingChild();
      mockSpawn.mockReturnValue(child);

      const result = new ClaudeCliPathResolver().resolve('claude');
      jest.advanceTimersByTime(30_000);

      await expect(result).resolves.toBeNull();
      await Promise.resolve();
      expect(mockSpawn).toHaveBeenCalledWith(
        'where',
        ['claude'],
        expect.objectContaining({ shell: false }),
      );
      expect(child.kill).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '6161', '/T', '/F'],
        expect.any(Function),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
