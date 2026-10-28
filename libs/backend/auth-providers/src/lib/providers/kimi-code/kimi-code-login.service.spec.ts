import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ProcessSpawnRequest,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import type { KimiCodeLoginState } from '@ptah-extension/shared';
import { createMockLogger, type MockLogger } from '@ptah-extension/shared/testing';
import { KimiCodeHomeResolver } from './kimi-code-home-resolver';
import {
  KimiCodeLoginService,
  extractHttpsUrl,
  extractUserCode,
  stripAnsi,
} from './kimi-code-login.service';
import type { KimiCodeAuthStatus } from './kimi-code-provider.types';

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

class FakeChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killed = false;
  readonly exitCode = null;
  readonly pid: number | undefined = 777;
  constructor(readonly whenSpawned: Promise<number | null> = Promise.resolve(777)) {
    super();
  }
  kill(): boolean {
    return true;
  }
}

function status(loggedIn: boolean): KimiCodeAuthStatus {
  return {
    cliDetected: true,
    loggedIn,
    stale: false,
    hasApiKey: false,
    credentialSource: loggedIn ? 'cli-login' : 'none',
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));
}

describe('KimiCodeLoginService', () => {
  let root: string;
  let home: KimiCodeHomeResolver;
  let logger: MockLogger;
  let child: FakeChild;
  let spawnProcess: jest.Mock<SpawnedProcessHandle, [ProcessSpawnRequest]>;
  let openExternal: jest.Mock<Promise<boolean>, [string]>;
  let getStatus: jest.Mock<Promise<KimiCodeAuthStatus>, []>;
  let clearCache: jest.Mock;
  let killTree: jest.Mock<Promise<void>, [number]>;
  let states: KimiCodeLoginState[];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'kimi-login-'));
    home = new KimiCodeHomeResolver(join(root, '.kimi-code'));
    logger = createMockLogger();
    child = new FakeChild();
    spawnProcess = jest.fn((_request: ProcessSpawnRequest) => child);
    openExternal = jest.fn(async (_url: string) => true);
    getStatus = jest.fn(async () => status(true));
    clearCache = jest.fn();
    killTree = jest.fn(async (_pid: number) => {
      child.emit('close', null, 'SIGKILL');
    });
    states = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function installKimi(): Promise<string> {
    await mkdir(home.binDir, { recursive: true });
    const binary = join(home.binDir, process.platform === 'win32' ? 'kimi.exe' : 'kimi');
    await writeFile(binary, '');
    return binary;
  }

  function service(
    options: {
      timeoutMs?: number;
      path?: string;
      readRegion?: () => Promise<'global' | 'mainland-cn'>;
    } = {},
  ) {
    return new KimiCodeLoginService({
      logger: asLogger(logger),
      spawner: { spawnProcess },
      userInteraction: { openExternal },
      kimiAuth: { getStatus, clearCache },
      store: { readRegion: options.readRegion ?? (async () => 'global') },
      home,
      environment: {
        PATH: options.path ?? join(root, 'empty-path'),
        ANTHROPIC_API_KEY: 'fake-host-key',
        HOME: root,
      },
      timeoutMs: options.timeoutMs,
      killTree,
    });
  }

  const record = (state: KimiCodeLoginState): void => {
    states.push(state);
  };

  it('reports not-installed without spawning when no kimi executable exists', async () => {
    const result = await service().start(record);
    expect(result).toMatchObject({ status: 'failed', errorCode: 'not-installed' });
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('finds kimi on PATH', async () => {
    const pathDir = join(root, 'path-bin');
    await mkdir(pathDir);
    const name = process.platform === 'win32' ? 'kimi.exe' : 'kimi';
    await writeFile(join(pathDir, name), '');
    await service({ path: pathDir }).start(record);
    expect(spawnProcess.mock.calls[0][0].command).toBe(join(pathDir, name));
  });

  it('runs kimi login with fixed argv, opens the verification URL and succeeds', async () => {
    const binary = await installKimi();
    const login = service();
    const started = await login.start(record);
    expect(started).toEqual({ status: 'starting' });

    const request = spawnProcess.mock.calls[0][0];
    expect(request.command).toBe(binary);
    expect(request.args).toEqual(['login', '--region', 'global']);
    expect(request.env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(request.env['NO_COLOR']).toBe('1');

    child.stdout.write('Please visit the following URL to finish authorization.\n');
    child.stdout.write(
      '\u001b[1mVerification URL: https://auth.kimi.ai/device?user_code=ABCD-1234.\u001b[0m\n',
    );
    child.stderr.write('Your code: ABCD-1234\n');
    await flush();

    expect(openExternal).toHaveBeenCalledWith(
      'https://auth.kimi.ai/device?user_code=ABCD-1234',
    );
    expect(states.at(-1)).toEqual({
      status: 'awaiting-browser',
      verificationUrl: 'https://auth.kimi.ai/device?user_code=ABCD-1234',
      userCode: 'ABCD-1234',
      browserOpened: true,
    });

    child.emit('close', 0, null);
    await flush();
    expect(clearCache).toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe('succeeded');
    expect(states.map((s) => s.status)).toContain('awaiting-browser');
  });

  it('treats an already-signed-in CLI (exit 0 at once) as success', async () => {
    await installKimi();
    await service().start(record);
    child.stdout.write('Logged in to managed:kimi-code.\n');
    child.emit('close', 0, null);
    await flush();
    expect(states.at(-1)?.status).toBe('succeeded');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('fails with no-credentials when exit 0 leaves no readable login', async () => {
    await installKimi();
    getStatus.mockResolvedValue(status(false));
    await service().start(record);
    child.emit('close', 0, null);
    await flush();
    expect(states.at(-1)).toMatchObject({ status: 'failed', errorCode: 'no-credentials' });
  });

  it('fails with exited on a non-zero exit, never echoing output', async () => {
    await installKimi();
    await service().start(record);
    child.stderr.write('Login failed: fake-secret-detail\n');
    child.emit('close', 1, null);
    await flush();
    expect(states.at(-1)).toMatchObject({ status: 'failed', errorCode: 'exited' });
    expect(JSON.stringify(states)).not.toContain('fake-secret-detail');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('fake-secret-detail');
  });

  it('maps a spawn ENOENT to not-installed', async () => {
    await installKimi();
    await service().start(record);
    child.emit('error', Object.assign(new Error('spawn kimi ENOENT'), { code: 'ENOENT' }));
    await flush();
    expect(states.at(-1)).toMatchObject({ status: 'failed', errorCode: 'not-installed' });
  });

  it('runs one sign-in at a time and cancels by killing the process tree', async () => {
    await installKimi();
    const login = service();
    await login.start(record);
    const second = await login.start(jest.fn());
    expect(second.status).toBe('starting');
    expect(spawnProcess).toHaveBeenCalledTimes(1);

    expect(login.cancel()).toBe(true);
    await flush();
    expect(killTree).toHaveBeenCalledWith(777);
    expect(states.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(login.cancel()).toBe(false);
  });

  it('cancel() while the executable is still being resolved prevents the spawn', async () => {
    await installKimi();
    const login = service();
    const started = login.start(record); // resolveExecutable is pending

    expect(login.cancel()).toBe(true);
    const result = await started;

    expect(result).toMatchObject({ status: 'cancelled' });
    expect(states.at(-1)).toMatchObject({ status: 'cancelled' });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
    expect(login.cancel()).toBe(false);
  });

  it('dispose() while the region is still being read prevents the spawn, and start() after it does nothing', async () => {
    await installKimi();
    let regionRequested: () => void = () => undefined;
    const regionPending = new Promise<void>((done) => {
      regionRequested = done;
    });
    let resolveRegion: (region: 'global') => void = () => undefined;
    const login = service({
      readRegion: () => {
        regionRequested();
        return new Promise((done) => {
          resolveRegion = done;
        });
      },
    });
    const started = login.start(record);
    await regionPending; // the executable was found; the region read waits

    login.dispose();
    resolveRegion('global');

    await expect(started).resolves.toMatchObject({ status: 'cancelled' });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();

    states = [];
    await expect(login.start(record)).resolves.toMatchObject({ status: 'cancelled' });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it('a cancelled sign-in never opens the browser for a late verification URL', async () => {
    await installKimi();
    const login = service();
    await login.start(record);
    // The kill is still in flight when the CLI prints its URL.
    killTree.mockImplementation(async () => undefined);
    expect(login.cancel()).toBe(true);
    child.stdout.write('Open https://auth.example.test/device to sign in\n');
    await flush();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('stops after the timeout', async () => {
    await installKimi();
    await service({ timeoutMs: 10 }).start(record);
    await new Promise((done) => setTimeout(done, 40));
    await flush();
    expect(killTree).toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });

  it('can start again after a finished sign-in', async () => {
    await installKimi();
    const login = service();
    await login.start(record);
    child.emit('close', 1, null);
    await flush();
    child = new FakeChild();
    await login.start(record);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });
});

describe('kimi login output parsing', () => {
  it('accepts only https URLs and strips trailing punctuation', () => {
    expect(extractHttpsUrl('Verification URL: https://auth.kimi.ai/x?y=1).')).toBe(
      'https://auth.kimi.ai/x?y=1',
    );
    expect(extractHttpsUrl('see http://evil.example.test/')).toBeUndefined();
    expect(extractHttpsUrl('nothing here')).toBeUndefined();
  });

  it('extracts upper-case device codes only', () => {
    expect(extractUserCode('User code: WXYZ-9876')).toBe('WXYZ-9876');
    expect(extractUserCode('enter the code please')).toBeUndefined();
    expect(extractUserCode('exit code 1')).toBeUndefined();
  });

  it('strips ANSI colour and hyperlink sequences', () => {
    expect(
      stripAnsi('\u001b[1mbold\u001b[0m \u001b]8;;https://x.test\u0007link\u001b]8;;\u0007'),
    ).toBe('bold link');
  });
});
