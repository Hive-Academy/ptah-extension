/**
 * pty-manager.service.spec.ts
 *
 * The AC-2 spawn-site assertion for TASK_2026_174: a disallowed `shell` must be
 * refused BEFORE node-pty's `spawn()` is ever reached. `node-pty` is mocked so
 * the assertion is against `pty.spawn`, the real sink — not against the
 * `IPtyHost` port (the RPC-boundary reject is covered separately in
 * `terminal-rpc.handlers.spec.ts`).
 *
 * Only `create()` is exercised here; the rest of PtyManagerService is covered
 * by the (skipped) e2e suite. `shell` values are chosen against the host
 * `process.platform` so the assertions are OS-independent.
 */
import * as pty from 'node-pty';
import type { Logger } from '@ptah-extension/vscode-core';

import { PtyManagerService } from './pty-manager.service';

jest.mock('node-pty');

const mockSpawn = pty.spawn as jest.Mock;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

const ALLOWED_SHELL = process.platform === 'win32' ? 'cmd.exe' : 'bash';

describe('PtyManagerService.create — shell allowlist at the spawn site', () => {
  let service: PtyManagerService;

  beforeEach(() => {
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue({
      pid: 4242,
      onData: jest.fn(),
      onExit: jest.fn(),
      write: jest.fn(),
      resize: jest.fn(),
      kill: jest.fn(),
    });
    service = new PtyManagerService(makeLogger());
  });

  it('throws and never calls pty.spawn for a shell outside the allowlist', () => {
    expect(() => service.create({ cwd: '/ws/root', shell: 'rm' })).toThrow(
      'PtyManager: shell not permitted',
    );

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws and never calls pty.spawn for a shell that supplies a path separator', () => {
    expect(() =>
      service.create({ cwd: '/ws/root', shell: '/tmp/evil/bash' }),
    ).toThrow('PtyManager: shell not permitted');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns once when the supplied shell is allowlisted', () => {
    const result = service.create({ cwd: '/ws/root', shell: ALLOWED_SHELL });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      ALLOWED_SHELL,
      [],
      expect.objectContaining({ cwd: '/ws/root' }),
    );
    expect(result).toEqual({ id: expect.any(String), pid: 4242 });
  });

  it('spawns once with the host default when no shell override is supplied', () => {
    const result = service.create({ cwd: '/ws/root' });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    // The host default (COMSPEC / SHELL, a full path) is trusted and is NOT
    // run through the allowlist, so it reaches spawn even though it contains a
    // separator.
    const [spawnedShell, args] = mockSpawn.mock.calls[0];
    expect(typeof spawnedShell).toBe('string');
    expect(spawnedShell.length).toBeGreaterThan(0);
    expect(args).toEqual([]);
    expect(result).toEqual({ id: expect.any(String), pid: 4242 });
  });
});
