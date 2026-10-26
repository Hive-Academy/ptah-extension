import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClaudeCertifiedExecutable } from '@ptah-extension/auth-providers-tokens';
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
  readonly pid = 4321;
  readonly killed = false;
  readonly exitCode = null;
  constructor(readonly whenSpawned: Promise<number | null> = Promise.resolve(4321)) { super(); }
  kill(): boolean { return true; }
  finish(code: number | null, data = ''): void {
    if (data) this.stdout.write(data);
    this.emit('close', code, null);
  }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const TEMP = '/tmp/ptah-fake';
const EXECUTABLE: ClaudeCertifiedExecutable = Object.freeze({
  command: '/usr/bin/node',
  prefixArgs: Object.freeze(['/opt/claude/cli.js']),
  sdkExecutablePath: '/opt/claude/cli.js',
  version: '2.1.310',
  fingerprint: Object.freeze({ size: 10, mtimeMs: 1 }),
});
const SIGNED_IN = JSON.stringify({
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', configDirectory: '/home/u/.claude',
  email: 'person@example.com', orgName: 'Example Org', subscriptionType: 'max',
});
const SIGNED_OUT = JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', configDirectory: '/home/u/.claude' });

describe('ClaudeAccountCommand.ambientStatus', () => {
  let children: Child[];
  let requests: ProcessSpawnRequest[];
  let command: ClaudeAccountCommand;
  /** PID promise for the next spawned child; a spec may defer it past the kill grace. */
  let nextWhenSpawned: Promise<number | null> | undefined;
  const env = Object.freeze({ PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/home/u/.claude' });
  const child = (): Child => children[children.length - 1];

  beforeEach(() => {
    jest.useFakeTimers();
    children = []; requests = []; nextWhenSpawned = undefined;
    const host: ClaudeAccountCommandHost = {
      platform: 'linux', env: () => ({ PATH: '/usr/bin' }), tempDir: () => TEMP,
      stat: jest.fn().mockResolvedValue({ size: 10, mtimeMs: 1 }),
    };
    command = new ClaudeAccountCommand({ findExecutable: jest.fn() }, { spawnProcess: request => {
      requests.push(request);
      const spawned = new Child(nextWhenSpawned); children.push(spawned); return spawned;
    } }, host);
  });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.clearAllMocks(); jest.useRealTimers();
  });

  const probe = (signal = new AbortController().signal) => command.ambientStatus({ executable: EXECUTABLE, env, signal });

  it('spawns auth status with the passed env, the temp cwd and no launch guard', async () => {
    const pending = probe();
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0].command).toBe('/usr/bin/node');
    expect(requests[0].args).toEqual(['/opt/claude/cli.js', 'auth', 'status', '--json']);
    expect(requests[0].env).toBe(env);
    expect(requests[0].cwd).toBe(TEMP);
    expect(requests[0].launchGuard).toBeUndefined();
    child().finish(0, SIGNED_IN); await flush();
    await pending;
  });

  it('parses a signed-in status (exit 0) and returns no output text', async () => {
    const pending = probe();
    await flush(); child().finish(0, SIGNED_IN); await flush();
    const result = await pending;
    expect(result.status?.loggedIn).toBe(true);
    expect(result).toMatchObject({ terminated: true, timedOut: false });
    expect(result.closeReceipt).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('person@example.com');
    expect(JSON.stringify(result)).not.toContain('Example Org');
    expect(JSON.stringify(result)).not.toContain('.claude');
  });

  it('parses a signed-out status (exit 1, authMethod none)', async () => {
    const pending = probe();
    await flush(); child().finish(1, SIGNED_OUT); await flush();
    expect(await pending).toEqual({ status: { loggedIn: false }, terminated: true, timedOut: false });
  });

  it('returns a null status for unreadable output', async () => {
    const pending = probe();
    await flush(); child().finish(0, 'not json at all'); await flush();
    expect(await pending).toEqual({ status: null, terminated: true, timedOut: false });
  });

  it('reports timedOut after the 10 s status limit and hands out the close receipt', async () => {
    const pending = probe();
    await flush(); jest.advanceTimersByTime(10_000); await flush();
    expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
    jest.advanceTimersByTime(2_000); await flush();
    const result = await pending;
    expect(result).toEqual({ status: null, terminated: false, timedOut: true, closeReceipt: expect.anything() });
    child().finish(null); await flush();
    expect(result.closeReceipt?.closed).toBe(true);
  });

  it('still requests the tree kill when the PID arrives after the kill grace (unclosed receipt)', async () => {
    let reportPid: (pid: number | null) => void = () => undefined;
    nextWhenSpawned = new Promise(resolve => { reportPid = resolve; });
    const pending = probe();
    await flush(); jest.advanceTimersByTime(10_000); await flush();
    jest.advanceTimersByTime(2_000); await flush();
    const result = await pending;
    expect(result.closeReceipt?.closed).toBe(false);
    expect(killProcessTree).not.toHaveBeenCalled();
    reportPid(4321); await flush();
    expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
    child().finish(null); await flush();
    expect(result.closeReceipt?.closed).toBe(true);
  });

  it('requests no tree kill when the child closed before a late PID arrives', async () => {
    let reportPid: (pid: number | null) => void = () => undefined;
    nextWhenSpawned = new Promise(resolve => { reportPid = resolve; });
    const pending = probe();
    await flush(); jest.advanceTimersByTime(10_000); await flush();
    child().finish(null); await flush();
    const result = await pending;
    expect(result).toEqual({ status: null, terminated: true, timedOut: true });
    reportPid(4321); await flush();
    expect(killProcessTree).not.toHaveBeenCalled();
  });

  describe('late PID after the kill grace', () => {
    let reportPid: (pid: number | null) => void;
    const timedOutWithDeferredPid = async () => {
      reportPid = () => undefined;
      nextWhenSpawned = new Promise(resolve => { reportPid = resolve; });
      const pending = probe();
      await flush(); jest.advanceTimersByTime(12_000); await flush();
      return pending;
    };

    it('requests no tree kill when the receipt was disposed and the child then closed', async () => {
      const result = await timedOutWithDeferredPid();
      result.closeReceipt?.dispose();
      child().finish(null); await flush();
      reportPid(4321); await flush();
      expect(killProcessTree).not.toHaveBeenCalled();
    });

    it('still requests one tree kill when the receipt was disposed and the child is still open', async () => {
      const result = await timedOutWithDeferredPid();
      result.closeReceipt?.dispose();
      reportPid(4321); await flush();
      expect(killProcessTree).toHaveBeenCalledTimes(1);
      expect(killProcessTree).toHaveBeenCalledWith(4321, 'SIGKILL');
      child().finish(null); await flush();
    });

    it('requests no tree kill when the receipt saw the close before the PID', async () => {
      const result = await timedOutWithDeferredPid();
      child().finish(null); await flush();
      expect(result.closeReceipt?.closed).toBe(true);
      reportPid(4321); await flush();
      expect(killProcessTree).not.toHaveBeenCalled();
    });

    it('closes the receipt without a kill when the child never spawned', async () => {
      const result = await timedOutWithDeferredPid();
      reportPid(null); await flush();
      expect(result.closeReceipt?.closed).toBe(true);
      expect(killProcessTree).not.toHaveBeenCalled();
    });
  });

  it('never parses after an abort', async () => {
    const controller = new AbortController();
    const pending = probe(controller.signal);
    await flush(); controller.abort(); await flush();
    child().finish(0, SIGNED_IN); await flush();
    const result = await pending;
    expect(result.status).toBeNull();
    expect(result.timedOut).toBe(false);
  });

  it('leaves status() refusing without a reserved route', async () => {
    const context: ClaudeAuthContext = {
      canonicalDir: '/home/u/.claude', cwd: TEMP, executable: EXECUTABLE, env, envDigest: 'digest',
      policy: { coverage: 'c', managedFile: 'absent', managedDropIn: 'absent', registry: 'not-applicable', remoteSignals: 'absent' },
    };
    expect(await command.status(context, new AbortController().signal))
      .toEqual({ status: null, terminated: true, routeChanged: true });
    expect(requests).toHaveLength(0);
  });
});
