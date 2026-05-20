import { spawnSync } from 'child_process';
import * as path from 'path';

jest.mock('child_process', () => ({
  spawnSync: jest.fn(),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    readdirSync: jest.fn(),
  };
});

import * as fs from 'fs';

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockReaddirSync = fs.readdirSync as jest.MockedFunction<
  typeof fs.readdirSync
>;

describe('fixPath', () => {
  const originalPlatform = process.platform;
  const originalPath = process.env['PATH'];
  const originalShell = process.env['SHELL'];
  const originalHome = process.env['HOME'];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env['PATH'] = '/usr/bin';
    process.env['SHELL'] = '/bin/bash';
    process.env['HOME'] = '/tmp/ptah-e2e-test';
    mockSpawnSync.mockReturnValue({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 1,
      signal: null,
    } as unknown as ReturnType<typeof spawnSync>);
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
    mockReaddirSync.mockImplementation(() => {
      const err = new Error(
        "ENOENT: no such file or directory, scandir '/tmp/ptah-e2e-test/.nvm/versions/node'",
      ) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    let result = '';
    expect(() => {
      const { fixPath } = require('./fix-path');
      result = fixPath();
    }).not.toThrow();

    expect(result).not.toBe('');
    expect(result.length).toBeGreaterThan(0);
    expect(result.split(path.delimiter)).toContain('/usr/bin');
  });

  it('still includes fallback bin dirs when nvm scan fails', () => {
    mockReaddirSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const { fixPath } = require('./fix-path');
    const result = fixPath();
    const parts = result.split(path.delimiter);

    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain('/opt/homebrew/bin');
  });
});
