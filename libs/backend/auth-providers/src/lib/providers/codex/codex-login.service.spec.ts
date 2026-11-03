import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ProcessSpawnRequest, SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type { CodexLoginState } from '@ptah-extension/shared';
import { CodexLoginService, extractSignInUrl, validateSignInUrl } from './codex-login.service';

class FakeChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killed = false;
  readonly exitCode = null;
  readonly pid = 777;
  whenSpawned: Promise<number | null> = Promise.resolve(777);
  kill = jest.fn(() => true);
}

const selection = { selected: { path: '/selected/codex', source: 'bundled' as const, version: '0.165.0', reason: 'test' } };
const tick = async (): Promise<void> => { for (let i = 0; i < 3; i++) await new Promise<void>(resolve => setImmediate(resolve)); };

describe('CodexLoginService', () => {
  let child: FakeChild;
  let requests: ProcessSpawnRequest[];
  let states: CodexLoginState[];
  let logs: string[];
  let openExternal: jest.Mock<Promise<boolean>, [string]>;
  let killTree: jest.Mock<Promise<void>, [number]>;
  let choose: jest.Mock<Promise<typeof selection>, []>;
  let login: CodexLoginService;

  beforeEach(() => {
    child = new FakeChild();
    requests = []; states = []; logs = [];
    openExternal = jest.fn<Promise<boolean>, [string]>(async () => true);
    killTree = jest.fn<Promise<void>, [number]>(async () => undefined);
    choose = jest.fn(async () => selection);
    login = new CodexLoginService({
      selection: choose,
      codexAuth: { clearCache: jest.fn(), getSignInOutcome: jest.fn(async () => 'signed-in' as const) },
      spawner: { spawnProcess: request => { requests.push(request); return child; } },
      userInteraction: { openExternal },
      logger: { info: message => { logs.push(message); }, warn: message => { logs.push(message); } },
      environment: { ANTHROPIC_API_KEY: 'secret', BROWSER: 'host-browser', CODEX_HOME: '/test/home' },
      platform: 'linux', fileExists: async path => path === '/usr/bin/true', killTree,
    });
  });

  it('spawns selected binary with fixed arguments and a clean environment', async () => {
    expect((await login.start({}, state => states.push(state))).status).toBe('running');
    expect(requests[0].command).toBe('/selected/codex');
    expect(requests[0].args).toEqual(['login']);
    expect(requests[0].env['BROWSER']).toBe('/usr/bin/true');
    expect(requests[0].env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(requests[0].env['CODEX_HOME']).toBe('/test/home');
    await login.dispose();
  });

  it.each(['browser', 'device'] as const)('opens a synthetic sign-in URL once in %s mode', async mode => {
    await login.start({ mode }, state => states.push(state));
    expect(requests[0].args).toEqual(mode === 'device' ? ['login', '--device-auth'] : ['login']);
    child.stdout.write('Starting local login server on http://localhost:1455.\n');
    child.stdout.write('If your browser did not open, navigate to this URL to authenticate:\n');
    child.stderr.write('https://auth.example.test/oauth/authorize?x=1\nABCD-12345\n');
    await tick();
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ status: 'awaiting-user', browserOpened: true, userCode: 'ABCD-12345' });
    expect(JSON.stringify(states)).not.toContain('Starting local login server');
    expect(logs.join(' ')).not.toContain('https://');
    await login.dispose();
  });

  it('rejects unsafe and oversized URL candidates, then takes the first valid URL', () => {
    expect(validateSignInUrl('http://host.test')).toBeUndefined();
    expect(validateSignInUrl('https://user:pw@host.test')).toBeUndefined();
    expect(validateSignInUrl('https://host.test/' + 'a'.repeat(4097))).toBeUndefined();
    expect(extractSignInUrl('https://user:pw@host.test/x https://auth.example.test/ok'))
      .toBe('https://auth.example.test/ok');
    expect(extractSignInUrl('https://host.test/' + 'a'.repeat(4097) + ' https://auth.example.test/ok'))
      .toBe('https://auth.example.test/ok');
  });

  it('keeps awaiting user when browser open throws', async () => {
    openExternal.mockRejectedValueOnce(new Error('private output'));
    await login.start({}, state => states.push(state));
    child.stdout.write('https://auth.example.test/ok\n');
    await tick();
    expect(states.at(-1)).toMatchObject({ status: 'awaiting-user', browserOpened: false });
    expect(logs.join(' ')).not.toContain('private output');
    await login.dispose();
  });

  it('stays running without an HTTPS URL and records a false browser result', async () => {
    await login.start({}, state => states.push(state));
    child.stdout.write('Starting local login server on http://localhost:1455.\n');
    await tick();
    expect(states.at(-1)?.status).toBe('running');
    expect(openExternal).not.toHaveBeenCalled();
    openExternal.mockResolvedValueOnce(false);
    child.stderr.write('https://auth.example.test/ok\n');
    await tick();
    expect(states.at(-1)).toMatchObject({ status: 'awaiting-user', browserOpened: false });
    await login.dispose();
  });

  it('maps process exit to fixed failure copy without leaking output', async () => {
    await login.start({}, state => states.push(state));
    child.stdout.write('secret token in output\n');
    child.emit('close', 1, null);
    await tick();
    expect(states.at(-1)).toMatchObject({ status: 'failed', errorCode: 'exited', exitCode: 1 });
    expect(JSON.stringify(states) + logs.join(' ')).not.toContain('secret token');
  });

  it('does not retry a different executable when selection fails', async () => {
    choose.mockRejectedValueOnce(new Error('selection unavailable'));
    expect(await login.start({}, state => states.push(state))).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(requests).toHaveLength(0);
    expect(logs.join(' ')).not.toContain('selection unavailable');
  });

  it('returns cancelled if cancellation lands in the PID resolution tick', async () => {
    let resolvePid!: (pid: number | null) => void;
    child.whenSpawned = new Promise(resolve => { resolvePid = resolve; });
    const start = login.start({}, state => states.push(state));
    await tick();
    resolvePid(777);
    login.cancel();
    expect((await start).status).toBe('cancelled');
    expect(states.at(-1)?.status).toBe('cancelled');
    expect(states.filter(state => state.status === 'cancelled')).toHaveLength(1);
    expect(states.findIndex(state => state.status === 'running')).toBe(-1);
  });

  it('disposes during selection without spawning', async () => {
    let resolveSelection!: (value: typeof selection) => void;
    choose.mockReturnValueOnce(new Promise(resolve => { resolveSelection = resolve; }));
    const start = login.start({}, state => states.push(state));
    await login.dispose();
    resolveSelection(selection);
    expect((await start).status).toBe('cancelled');
    expect(requests).toHaveLength(0);
    expect(states.filter(state => state.status === 'cancelled')).toHaveLength(1);
  });

  it('disposes a running child once even if killTree rejects and close follows', async () => {
    killTree.mockRejectedValueOnce(new Error('kill failed'));
    await login.start({}, state => states.push(state));
    await expect(login.dispose()).resolves.toBeUndefined();
    child.emit('close', 1, null);
    expect(killTree).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(states.filter(state => state.status === 'cancelled')).toHaveLength(1);
    expect(login.isActive()).toBe(false);
    expect((await login.start({}, state => states.push(state))).status).toBe('cancelled');
    expect(requests).toHaveLength(1);
  });
});
