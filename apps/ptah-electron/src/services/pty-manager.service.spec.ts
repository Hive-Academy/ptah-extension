/**
 * pty-manager.service.spec.ts
 *
 * The spawn-site assertions for the terminal sink: a disallowed `shell`
 * (TASK_2026_174) OR a `cwd` outside the caller-supplied authorized roots
 * (TASK_2026_191 F4) must be refused BEFORE node-pty's `spawn()` is ever
 * reached. `node-pty` is mocked so the assertion is against `pty.spawn`, the
 * real sink — not against the `IPtyHost` port (the RPC-boundary reject is
 * covered separately in `terminal-rpc.handlers.spec.ts`).
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
    expect(() =>
      service.create({
        cwd: '/ws/root',
        shell: 'rm',
        authorizedRoots: ['/ws/root'],
      }),
    ).toThrow('PtyManager: shell not permitted');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws and never calls pty.spawn for a shell that supplies a path separator', () => {
    expect(() =>
      service.create({
        cwd: '/ws/root',
        shell: '/tmp/evil/bash',
        authorizedRoots: ['/ws/root'],
      }),
    ).toThrow('PtyManager: shell not permitted');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns once when the supplied shell is allowlisted', () => {
    const result = service.create({
      cwd: '/ws/root',
      shell: ALLOWED_SHELL,
      authorizedRoots: ['/ws/root'],
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      ALLOWED_SHELL,
      [],
      expect.objectContaining({ cwd: '/ws/root' }),
    );
    expect(result).toEqual({ id: expect.any(String), pid: 4242 });
  });

  it('spawns once with the host default when no shell override is supplied', () => {
    const result = service.create({
      cwd: '/ws/root',
      authorizedRoots: ['/ws/root'],
    });

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

describe('PtyManagerService.create — cwd containment at the spawn site', () => {
  // AC-1 (TASK_2026_191 F4): the sink re-validates cwd against the authorized
  // roots handed DOWN the port, so a future second caller of IPtyHost.create
  // cannot inherit the shell guard yet spawn with an unbounded cwd. node-pty is
  // mocked so the assertion is against pty.spawn — the real sink — and the
  // service takes NO workspace-discovery dependency to do it.
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

  it('throws and never calls pty.spawn for a cwd outside the authorized roots', () => {
    expect(() =>
      service.create({
        cwd: '/etc',
        shell: ALLOWED_SHELL,
        authorizedRoots: ['/ws/root'],
      }),
    ).toThrow('PtyManager: cwd not permitted');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('throws and never calls pty.spawn when the authorized-root set is empty (fail-closed)', () => {
    expect(() =>
      service.create({
        cwd: '/ws/root',
        shell: ALLOWED_SHELL,
        authorizedRoots: [],
      }),
    ).toThrow('PtyManager: cwd not permitted');

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns once for a cwd inside an authorized root', () => {
    const result = service.create({
      cwd: '/ws/root/sub/dir',
      shell: ALLOWED_SHELL,
      authorizedRoots: ['/ws/root'],
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      ALLOWED_SHELL,
      [],
      expect.objectContaining({ cwd: '/ws/root/sub/dir' }),
    );
    expect(result).toEqual({ id: expect.any(String), pid: 4242 });
  });
});
