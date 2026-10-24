import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import type { SpawnedProcessHandle } from '@ptah-extension/platform-core';
import type {
  CodexExecutableSource,
  IProcessSpawner,
} from './codex-runtime-ports';
import type { CodexExecutionProfile } from './codex-runtime.types';
import type { CodexBinaryIdentity } from './codex-protocol-manifest';
import {
  CodexAppServerProcess,
  CodexHomeMismatchError,
} from './codex-app-server-process';

class FakeChild extends EventEmitter implements SpawnedProcessHandle {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly frames: Record<string, unknown>[] = [];
  blockWrites = false;
  readonly stdin = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      const frame: Record<string, unknown> = JSON.parse(chunk.toString());
      this.frames.push(frame);
      if (!this.blockWrites) done();
    },
  });
  readonly whenSpawned = Promise.resolve(42);
  readonly pid = 42;
  killed = false;
  exitCode: number | null = null;
  readonly kill = jest.fn(() => {
    this.killed = true;
    return true;
  });
  send(value: unknown): void {
    this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  }
  finish(): void {
    this.exitCode = 0;
    this.emit('close', 0, null);
  }
}

const executable: CodexExecutableSource = {
  resolvedPath: '/bin/codex',
  expectedManifestRow: {
    platform: 'test',
    arch: 'test',
    pinnedVersion: '0.155.1',
    version: 'codex-cli 0.155.1',
    binarySha256: 'a'.repeat(64),
    schemaSha256: 'b'.repeat(64),
  },
};
const binary: CodexBinaryIdentity = {
  executablePath: '/bin/codex',
  platform: 'test',
  arch: 'test',
  versionOutput: 'codex-cli 0.155.1',
  sha256: 'a'.repeat(64),
};
const profile: CodexExecutionProfile = {
  contextId: 'context',
  consumer: 'chat',
  normalizedHome: '/isolated/home',
  providerId: 'codex',
  workspaceId: 'workspace',
  cwd: '/work',
  model: 'model',
  permissionLevel: 'ask',
  approvalPolicy: {
    granular: {
      sandbox_approval: true,
      rules: true,
      skill_approval: true,
      request_permissions: true,
      mcp_elicitations: true,
    },
  },
  sandboxPolicy: { mode: 'read-only', networkAccess: false, writableRoots: [] },
  experimentalApi: true,
  instructionSources: [],
  mcpServers: [],
  attachments: [],
  profileFingerprint: 'fingerprint',
};
const initializeResult = {
  codexHome: '/isolated/home',
  platformFamily: 'unix',
  platformOs: 'linux',
  userAgent: 'test',
};
const ids = { threadId: 'thread', turnId: 'turn' };
const approval = {
  id: 'approval',
  method: 'item/fileChange/requestApproval',
  params: { ...ids, itemId: 'item', startedAtMs: 1 },
};

describe('CodexAppServerProcess', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );
  let child: FakeChild;
  let spawner: IProcessSpawner;
  let runtime: CodexAppServerProcess;
  let onNotification: jest.Mock;
  let onRequest: jest.Mock<Promise<unknown>, [unknown, AbortSignal]>;

  beforeEach(() => {
    jest.useFakeTimers();
    child = new FakeChild();
    spawner = { spawnProcess: jest.fn(() => child) };
    onNotification = jest.fn();
    onRequest = jest.fn<Promise<unknown>, [unknown, AbortSignal]>(async () => ({
      decision: 'decline',
    }));
    runtime = new CodexAppServerProcess(spawner, executable, binary, profile, {
      onNotification,
      onRequest,
    });
  });
  afterEach(async () => {
    const closing = runtime.close();
    child.finish();
    await closing;
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (platformDescriptor)
      Object.defineProperty(process, 'platform', platformDescriptor);
  });
  async function start(): Promise<void> {
    const starting = runtime.start();
    child.send({ id: 1, result: initializeResult });
    await starting;
  }
  async function flush(): Promise<void> {
    await jest.advanceTimersByTimeAsync(0);
  }

  it('pins before spawning and initializes once with isolated child env and granular capability', async () => {
    const home = process.env['CODEX_HOME'];
    const starting = runtime.start();
    expect(runtime.start()).toBe(starting);
    child.send({ id: 1, result: initializeResult });
    await starting;
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(1);
    expect(spawner.spawnProcess).toHaveBeenCalledWith({
      command: executable.resolvedPath,
      args: ['app-server'],
      cwd: '/work',
      env: expect.objectContaining({ CODEX_HOME: '/isolated/home' }),
      launchGuard: {
        fileContents: [
          { path: executable.resolvedPath, sha256: binary.sha256 },
        ],
      },
    });
    expect(process.env['CODEX_HOME']).toBe(home);
    expect(child.frames).toEqual([
      {
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'ptah', version: '1' },
          capabilities: { experimentalApi: true },
        },
      },
      { method: 'initialized' },
    ]);
  });

  it.each(['linux', 'win32'] as const)(
    'inherits only allowlisted host variables on %s',
    async (platform) => {
      Object.defineProperty(process, 'platform', { value: platform });
      const allowed = {
        PATH: '/bin',
        PATHEXT: '.EXE',
        SYSTEMROOT: 'C:\\Windows',
        WINDIR: 'C:\\Windows',
        COMSPEC: 'cmd.exe',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'C',
        HOME: '/host/home',
        USERPROFILE: 'C:\\Users\\host',
        TMP: '/tmp',
        TEMP: '/temp',
        TMPDIR: '/tmpdir',
      };
      const hostEnv = {
        ...allowed,
        CODEX_HOME: '/host/codex',
        ANTHROPIC_AUTH_TOKEN: 'host-secret',
        ANTHROPIC_BASE_URL: 'host-proxy',
        OPENAI_API_KEY: 'host-secret',
        CODEX_API_KEY: 'host-secret',
        GITHUB_TOKEN: 'host-secret',
        PTAH_INTERNAL: 'host-private',
        OTHER_SECRET: 'host-secret',
        OTHER_KEY: 'host-secret',
        LC_SECRET: 'host-secret',
        HTTPS_PROXY: 'host-proxy',
        NODE_OPTIONS: 'host-options',
        APPDATA: 'host-appdata',
      };
      jest.replaceProperty(process, 'env', hostEnv);
      await start();
      expect(spawner.spawnProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { ...allowed, CODEX_HOME: profile.normalizedHome },
        }),
      );
      expect(process.env).toBe(hostEnv);
      expect(process.env['CODEX_HOME']).toBe('/host/codex');
    },
  );

  it('normalizes Windows case variants and excludes mixed-case secrets and home overrides', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    jest.replaceProperty(process, 'env', {
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ComSpec: 'cmd.exe',
      Temp: 'C:\\Temp',
      lc_all: 'C',
      codex_home: '/host/codex',
      Codex_Home: '/other/codex',
      Anthropic_Auth_Token: 'secret',
      OpenAI_API_Key: 'secret',
      Codex_Api_Key: 'secret',
      Github_Token: 'secret',
      Ptah_Internal: 'secret',
    });
    await start();
    expect(spawner.spawnProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          PATH: 'C:\\bin',
          SYSTEMROOT: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
          COMSPEC: 'cmd.exe',
          TEMP: 'C:\\Temp',
          LC_ALL: 'C',
          CODEX_HOME: profile.normalizedHome,
        },
      }),
    );
  });

  it('refuses mismatched identity without spawning or handshaking', async () => {
    runtime = new CodexAppServerProcess(
      spawner,
      executable,
      { ...binary, sha256: 'c'.repeat(64) },
      profile,
      { onNotification, onRequest },
    );
    await expect(runtime.start()).rejects.toThrow('initialization failed');
    expect(spawner.spawnProcess).not.toHaveBeenCalled();
  });

  it('exposes the verified home only after a successful handshake', async () => {
    expect(runtime.verifiedCodexHome).toBeUndefined();
    const starting = runtime.start();
    child.send({
      id: 1,
      result: { ...initializeResult, codexHome: '/isolated/other/../home/' },
    });
    await starting;
    expect(runtime.verifiedCodexHome).toBe(profile.normalizedHome);
  });

  it('rejects a different home with a sanitized typed error and closes the child', async () => {
    const rejected = expect(runtime.start()).rejects.toBeInstanceOf(
      CodexHomeMismatchError,
    );
    child.send({
      id: 1,
      result: { ...initializeResult, codexHome: '/other-user/private' },
    });
    await rejected;
    expect(runtime.verifiedCodexHome).toBeUndefined();
    expect(child.stdin.writableEnded).toBe(true);
    expect(child.frames).toHaveLength(1);
    child.finish();
    await runtime.close();
    await expect(runtime.start()).rejects.toThrow(
      'Codex home verification failed',
    );
  });

  it('compares Windows home echoes without case or separator differences', async () => {
    runtime = new CodexAppServerProcess(
      spawner,
      {
        ...executable,
        expectedManifestRow: {
          ...executable.expectedManifestRow,
          platform: 'win32',
        },
      },
      { ...binary, platform: 'win32' },
      { ...profile, normalizedHome: 'C:\\Users\\Account\\.codex' },
      { onNotification, onRequest },
    );
    const starting = runtime.start();
    child.send({
      id: 1,
      result: { ...initializeResult, codexHome: 'c:/users/account/.codex/' },
    });
    await starting;
    expect(runtime.verifiedCodexHome).toBe('C:\\Users\\Account\\.codex');
  });

  it('decodes UTF-8 split at every byte and multiple frames per chunk', async () => {
    await start();
    const frame = {
      method: 'item/agentMessage/delta',
      params: { ...ids, itemId: 'item', delta: 'Hello 🌍 مرحبا' },
    };
    const bytes = Buffer.from(JSON.stringify(frame) + '\n');
    for (const byte of bytes) child.stdout.emit('data', Buffer.from([byte]));
    child.stdout.emit('data', Buffer.concat([bytes, bytes]));
    expect(onNotification).toHaveBeenCalledTimes(3);
    expect(onNotification).toHaveBeenLastCalledWith(frame);
  });

  it.each([
    'oversize',
    'malformed',
    'invalid-utf8',
    'unknown-method',
    'invalid-result',
    'unknown-id',
    'wrong-direction',
  ])('fails closed before dispatch for %s', async (kind) => {
    await start();
    const pending = runtime.request('turn/interrupt', ids);
    const rejected = expect(pending).rejects.toThrow('invalid protocol frame');
    if (kind === 'oversize')
      child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1, 65));
    if (kind === 'malformed')
      child.stdout.emit('data', Buffer.from('secret-invalid-json\n'));
    if (kind === 'invalid-utf8')
      child.stdout.emit('data', Buffer.from([0xff, 10]));
    if (kind === 'unknown-method') child.send({ method: 'secret/unknown' });
    if (kind === 'invalid-result')
      child.send({ id: 2, result: { secret: 'credential' } });
    if (kind === 'unknown-id') child.send({ id: 99, result: {} });
    if (kind === 'wrong-direction')
      child.send({ id: 9, method: 'turn/interrupt', params: ids });
    await rejected;
    expect(onNotification).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
    expect(child.stdin.writableEnded).toBe(true);
  });

  it('times out the handshake at ten seconds and never retries', async () => {
    const rejected = expect(runtime.start()).rejects.toThrow('timed out');
    jest.advanceTimersByTime(10_000);
    await rejected;
    expect(child.frames).toHaveLength(1);
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(1);
  });

  it('times out ordinary requests at thirty seconds and rejects every pending request', async () => {
    await start();
    const first = expect(
      runtime.request('turn/interrupt', ids),
    ).rejects.toThrow('timed out');
    const second = expect(
      runtime.request('thread/compact/start', { threadId: 'thread' }),
    ).rejects.toThrow('timed out');
    jest.advanceTimersByTime(30_000);
    await Promise.all([first, second]);
    expect(child.frames).toHaveLength(4);
  });

  it('rejects a crash mid-request without exposing process error text', async () => {
    await start();
    const rejected = expect(
      runtime.request('turn/interrupt', ids),
    ).rejects.toThrow('Codex process failed');
    child.emit('error', new Error('secret credential'));
    await rejected;
    const closing = runtime.close();
    child.emit('exit', 1, null);
    child.finish();
    await closing;
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
  });

  it('correlates out of order responses and sanitizes remote errors', async () => {
    await start();
    const first = runtime.request('turn/interrupt', ids);
    const second = runtime.request('turn/interrupt', ids);
    const rejected = expect(first).rejects.toThrow(/^Codex request rejected$/);
    child.send({ id: 3, result: {} });
    child.send({
      id: 2,
      error: { code: -1, message: 'secret', data: { token: 'credential' } },
    });
    await expect(second).resolves.toEqual({});
    await rejected;
  });

  it('bounds the request map without sending the excess request', async () => {
    await start();
    const requests = Array.from({ length: 128 }, () =>
      runtime.request('turn/interrupt', ids).catch(() => undefined),
    );
    await expect(runtime.request('turn/interrupt', ids)).rejects.toThrow(
      'limit reached',
    );
    expect(child.frames).toHaveLength(130);
    void runtime.close();
    await Promise.all(requests);
  });

  it('bounds queued writes when the pipe is blocked', async () => {
    await start();
    child.blockWrites = true;
    const requests = Array.from({ length: 5 }, () =>
      runtime
        .request('turn/steer', {
          threadId: 'thread',
          expectedTurnId: 'x'.repeat(900_000),
          input: [],
        })
        .catch((error: unknown) => error),
    );
    const results = await Promise.all(requests);
    expect(
      results.every(
        (result) =>
          result instanceof Error &&
          result.message === 'Codex request write failed',
      ),
    ).toBe(true);
    expect(child.stdin.writableLength).toBeLessThan(4 * 1024 * 1024);
  });

  it('validates server requests and responses and uses the five minute approval deadline', async () => {
    await start();
    onRequest.mockImplementation(() => new Promise(() => undefined));
    child.send(approval);
    await flush();
    const signal = onRequest.mock.calls[0][1];
    jest.advanceTimersByTime(299_999);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect(child.stdin.writableEnded).toBe(true);
  });

  it('sends a validated approval response and cancels its timer', async () => {
    await start();
    child.send(approval);
    await flush();
    expect(child.frames.at(-1)).toEqual({
      id: 'approval',
      result: { decision: 'decline' },
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not send invalid approval output or a late response after close', async () => {
    await start();
    let answer: ((value: unknown) => void) | undefined;
    onRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    child.send(approval);
    await flush();
    void runtime.close();
    expect(onRequest.mock.calls[0][1].aborted).toBe(true);
    answer?.({ decision: 'accept' });
    await flush();
    expect(child.frames).toHaveLength(2);
  });

  it('fails closed on invalid approval handler results', async () => {
    await start();
    onRequest.mockResolvedValue({ decision: 'secret-invalid' });
    child.send(approval);
    await flush();
    expect(child.frames).toHaveLength(2);
    expect(child.stdin.writableEnded).toBe(true);
  });

  it('double close stops sends, waits one second, kills once and awaits stdio close', async () => {
    await start();
    const closing = runtime.close();
    expect(runtime.close()).toBe(closing);
    expect(runtime.dispose()).toBe(closing);
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await expect(runtime.request('turn/interrupt', ids)).rejects.toThrow(
      'closed',
    );
    jest.advanceTimersByTime(999);
    expect(child.kill).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    child.emit('exit', 0, null);
    await flush();
    expect(settled).toBe(false);
    child.finish();
    await closing;
    expect(settled).toBe(true);
  });

  it('delivers terminal-before-exit without treating the terminal notification as child exit', async () => {
    await start();
    const terminal = {
      method: 'turn/completed',
      params: {
        threadId: 'thread',
        turn: { id: 'turn', items: [], status: 'completed' },
      },
    };
    child.send(terminal);
    expect(onNotification).toHaveBeenCalledWith(terminal);
    expect(child.stdin.writableEnded).toBe(false);
    child.emit('exit', 0, null);
    expect(child.stdin.writableEnded).toBe(true);
    child.finish();
    await runtime.close();
  });

  it('aborts active generations and refuses pre-aborted starts', async () => {
    const controller = new AbortController();
    const starting = runtime.start(controller.signal);
    child.send({ id: 1, result: initializeResult });
    await starting;
    controller.abort();
    expect(child.stdin.writableEnded).toBe(true);
    const other = new CodexAppServerProcess(
      spawner,
      executable,
      binary,
      profile,
      { onNotification, onRequest },
    );
    await expect(other.start(controller.signal)).rejects.toThrow(
      'initialization failed',
    );
    expect(spawner.spawnProcess).toHaveBeenCalledTimes(1);
  });
});
