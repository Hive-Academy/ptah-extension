import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killProcessTree, type ProcessSpawnRequest, type SpawnedProcessHandle } from '@ptah-extension/platform-core';
import { ClaudeAccountCommand, type ClaudeAccountCommandHost } from './claude-account-command';
import type { ClaudeAuthContext } from './claude-route-certifier';

// The command's tree kill must never reach a real process from a spec.
jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/platform-core')>('@ptah-extension/platform-core'),
  killProcessTree: jest.fn().mockResolvedValue(undefined),
}));

class Child extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 1234;
  readonly killed = false;
  readonly exitCode = null;
  constructor(readonly whenSpawned: Promise<number | null> = Promise.resolve(1234)) { super(); }
  kill(): boolean { return true; }
  finish(code: number | null, data = ''): void {
    if (data) this.stdout.write(data);
    this.emit('close', code, null);
  }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const SYSTEM_ROOT = 'C:\\Windows';

describe('ClaudeAccountCommand (account child owner)', () => {
  let children: Child[];
  let requests: ProcessSpawnRequest[];
  let stat: jest.Mock;
  let host: ClaudeAccountCommandHost;
  let command: ClaudeAccountCommand;
  const detector = { findExecutable: jest.fn() };
  const nextChild = (): Child => children[children.length - 1];
  const make = (platform: NodeJS.Platform = 'win32'): ClaudeAccountCommand => {
    host = { platform, env: () => ({ SYSTEMROOT: SYSTEM_ROOT, PATH: 'bin' }), tempDir: () => tmpdir(), stat };
    return new ClaudeAccountCommand(detector, { spawnProcess: request => {
      requests.push(request);
      const child = new Child(); children.push(child); return child;
    } }, host);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    children = []; requests = [];
    stat = jest.fn().mockResolvedValue({ size: 10, mtimeMs: 1 });
    detector.findExecutable.mockResolvedValue({ path: 'C:\\tools\\claude.exe', source: 'path' });
    command = make();
  });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.clearAllMocks(); jest.useRealTimers();
  });

  describe('queryRegistry', () => {
    it('runs absolute reg.exe with /reg:64 and returns stdout only after close', async () => {
      const pending = command.queryRegistry('HKLM\\SOFTWARE\\Policies', new AbortController().signal);
      await flush();
      expect(requests).toHaveLength(1);
      expect(requests[0].command).toBe('C:\\Windows\\System32\\reg.exe');
      expect(requests[0].args).toEqual(['query', 'HKLM\\SOFTWARE\\Policies', '/reg:64']);
      expect(requests[0].env['CLAUDE_CONFIG_DIR']).toBe(tmpdir());
      nextChild().stderr.write('private stderr text');
      nextChild().finish(0, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Vendor\r\n');
      await flush();
      const result = await pending;
      expect(result).toEqual({ exitCode: 0, stdout: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Vendor\r\n',
        terminated: true, timedOut: false, overflow: false });
      expect(JSON.stringify(result)).not.toContain('private');
    });

    it.each(['HKLM\\SOFTWARE /f', '/?', 'HKCR\\x', 'HKLM\\SOFTWARE\\a\u0000b'])('never spawns for argument %j', async path => {
      expect(await command.queryRegistry(path, new AbortController().signal))
        .toEqual({ exitCode: null, stdout: '', terminated: true, timedOut: false, overflow: false });
      expect(requests).toHaveLength(0);
    });

    it('never spawns off win32', async () => {
      command = make('linux');
      expect((await command.queryRegistry('HKLM\\SOFTWARE\\Policies', new AbortController().signal)).exitCode).toBeNull();
      expect(requests).toHaveLength(0);
    });

    it('kills after 5 s and reports unproved termination without close', async () => {
      const pending = command.queryRegistry('HKCU\\SOFTWARE\\Policies', new AbortController().signal);
      await flush(); jest.advanceTimersByTime(4_999); await flush();
      expect(killProcessTree).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1); await flush();
      expect(killProcessTree).toHaveBeenCalledWith(1234, 'SIGKILL');
      jest.advanceTimersByTime(2_000); await flush();
      expect(await pending).toEqual({ exitCode: null, stdout: '', terminated: false, timedOut: true, overflow: false });
    });

    it('treats only an observed close as termination proof after a kill', async () => {
      const pending = command.queryRegistry('HKCU\\SOFTWARE\\Policies', new AbortController().signal);
      await flush(); jest.advanceTimersByTime(5_000); await flush();
      nextChild().finish(1); await flush();
      expect(await pending).toEqual({ exitCode: null, stdout: '', terminated: true, timedOut: true, overflow: false });
    });

    it('bounds stdout at 64 KiB and discards it', async () => {
      const pending = command.queryRegistry('HKLM\\SOFTWARE', new AbortController().signal);
      await flush();
      nextChild().stdout.write('x'.repeat(65_537)); await flush();
      expect(killProcessTree).toHaveBeenCalled();
      nextChild().finish(0); await flush();
      expect(await pending).toEqual({ exitCode: null, stdout: '', terminated: true, timedOut: false, overflow: true });
    });
  });

  describe('certifyExecutable', () => {
    const version = async (output: string, signal = new AbortController().signal) => {
      const pending = command.certifyExecutable(signal);
      await flush();
      if (children.length > 0 && requests.length === children.length) nextChild().finish(0, output);
      await flush();
      return pending;
    };

    it('runs --version in the temp dir with the certified env and returns the fingerprint', async () => {
      const result = await version('2.1.310 (Claude Code)\n');
      expect(requests[0]).toMatchObject({ command: 'C:\\tools\\claude.exe', args: ['--version'], cwd: tmpdir() });
      expect(requests[0].env['CLAUDE_CONFIG_DIR']).toBe(tmpdir());
      expect(result).toEqual({ ok: true, terminated: true, executable: {
        command: 'C:\\tools\\claude.exe', prefixArgs: [], sdkExecutablePath: 'C:\\tools\\claude.exe',
        version: '2.1.310', fingerprint: { size: 10, mtimeMs: 1 } } });
    });

    it('reuses the cache for the same path and fingerprint (one spawn for two calls)', async () => {
      await version('2.1.310 (Claude Code)');
      const second = await command.certifyExecutable(new AbortController().signal);
      expect(second.ok).toBe(true);
      expect(requests).toHaveLength(1);
      expect(stat).toHaveBeenCalledTimes(3);
    });

    it('re-probes after an in-place update changes mtime', async () => {
      await version('2.1.310 (Claude Code)');
      stat.mockResolvedValue({ size: 10, mtimeMs: 2 });
      const second = await version('2.1.311 (Claude Code)');
      expect(requests).toHaveLength(2);
      expect(second).toMatchObject({ ok: true, executable: { version: '2.1.311', fingerprint: { mtimeMs: 2 } } });
    });

    it('refuses unsupported-store on stat ENOENT, spawns nothing and drops the cache', async () => {
      await version('2.1.310 (Claude Code)');
      stat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      expect(await command.certifyExecutable(new AbortController().signal))
        .toEqual({ ok: false, code: 'unsupported-store', terminated: true });
      expect(requests).toHaveLength(1);
      await version('2.1.310 (Claude Code)');
      expect(requests).toHaveLength(2);
    });

    it('refuses a build changed during the probe and builds below 2.1.301', async () => {
      stat.mockResolvedValueOnce({ size: 10, mtimeMs: 1 }).mockResolvedValueOnce({ size: 11, mtimeMs: 1 });
      expect(await version('2.1.310 (Claude Code)')).toEqual({ ok: false, code: 'identity-unproved', terminated: true });
      expect(await version('2.1.300 (Claude Code)')).toEqual({ ok: false, code: 'unsupported-store', terminated: true });
      expect(await version('not a version')).toEqual({ ok: false, code: 'identity-unproved', terminated: true });
    });

    it('refuses WSL and direct execution without cliJsPath, and uses Node prefix args with cliJsPath', async () => {
      detector.findExecutable.mockResolvedValueOnce({ path: 'wsl', source: 'wsl', isWSL: true });
      expect(await version('')).toEqual({ ok: false, code: 'unsupported-store', terminated: true });
      detector.findExecutable.mockResolvedValueOnce({ path: 'wrapper', source: 'path', useDirectExecution: true });
      expect(await version('')).toEqual({ ok: false, code: 'unsupported-store', terminated: true });
      expect(requests).toHaveLength(0);
      const cli = join(tmpdir(), 'fixture cli.js');
      detector.findExecutable.mockResolvedValueOnce({ path: 'wrapper', source: 'path', useDirectExecution: true, cliJsPath: cli });
      const result = await version('2.1.310 (Claude Code)');
      expect(requests[0].command).toBe(process.execPath);
      expect(requests[0].args).toEqual([cli, '--version']);
      expect(result).toMatchObject({ ok: true, executable: { prefixArgs: [cli], sdkExecutablePath: cli } });
    });

    it('includes a stalled discovery in the 10 s limit', async () => {
      detector.findExecutable.mockImplementationOnce(() => new Promise(() => { /* Deliberately unresolved detector. */ }));
      const pending = command.certifyExecutable(new AbortController().signal);
      await flush(); jest.advanceTimersByTime(10_000); await flush();
      expect(await pending).toEqual({ ok: false, code: 'timeout', terminated: true });
      expect(children).toHaveLength(0);
    });
  });

  describe('status and logout', () => {
    const dir = join(tmpdir(), 'ptah-account-fixture');
    const context = (): ClaudeAuthContext => ({
      canonicalDir: dir, cwd: dir, env: { CLAUDE_CONFIG_DIR: dir }, envDigest: 'digest',
      executable: { command: 'C:\\tools\\claude.exe', prefixArgs: [], sdkExecutablePath: 'C:\\tools\\claude.exe',
        version: '2.1.310', fingerprint: { size: 10, mtimeMs: 1 } },
      policy: { coverage: 'win32@2.1.310' } as ClaudeAuthContext['policy'],
    });
    const signedOut = () => JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', configDirectory: dir });

    it('parses exit 1 signed-out status with the context env and cwd', async () => {
      const pending = command.status(context(), new AbortController().signal);
      await flush();
      expect(requests[0]).toMatchObject({ command: 'C:\\tools\\claude.exe', args: ['auth', 'status', '--json'], cwd: dir,
        env: { CLAUDE_CONFIG_DIR: dir } });
      nextChild().finish(1, signedOut()); await flush();
      expect(await pending).toEqual({ status: { loggedIn: false }, terminated: true });
    });

    it('returns no status for overflowing output and unproved termination on timeout', async () => {
      const big = command.status(context(), new AbortController().signal);
      await flush(); nextChild().stdout.write('x'.repeat(16_385)); await flush(); nextChild().finish(0); await flush();
      expect(await big).toEqual({ status: null, terminated: true });
      const stalled = command.status(context(), new AbortController().signal);
      await flush(); jest.advanceTimersByTime(12_000); await flush();
      expect(await stalled).toEqual({ status: null, terminated: false });
    });

    it('cancels on abort and releases at once when the child never spawned', async () => {
      const controller = new AbortController();
      command = new ClaudeAccountCommand(detector, { spawnProcess: request => {
        requests.push(request); const child = new Child(Promise.resolve(null)); children.push(child); return child;
      } }, host);
      const pending = command.logout(context(), controller.signal);
      await flush(); controller.abort(); await flush();
      expect(await pending).toEqual({ exitCode: null, terminated: true });
      expect(killProcessTree).not.toHaveBeenCalled();
      expect(requests[0].args).toEqual(['auth', 'logout']);
    });

    it('reports the logout exit code after close', async () => {
      const pending = command.logout(context(), new AbortController().signal);
      await flush(); nextChild().finish(0, 'ignored output'); await flush();
      expect(await pending).toEqual({ exitCode: 0, terminated: true });
    });
  });
});
