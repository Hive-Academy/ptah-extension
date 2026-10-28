import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger, type MockLogger } from '@ptah-extension/shared/testing';
import { KimiCodeAuthService } from './kimi-code-auth.service';
import { KimiCodeCredentialStore } from './kimi-code-credential-store';
import { KimiCodeHomeResolver } from './kimi-code-home-resolver';
import type { KimiCodeRefreshOutcome } from './kimi-code-oauth-refresher';
import { KimiCodeAuthUnavailableError } from './kimi-code-provider.types';

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

function tokenFile(suffix: string, expiresAt: number) {
  return {
    access_token: `fake-access-token-${suffix}`,
    refresh_token: `fake-refresh-token-${suffix}`,
    expires_at: expiresAt,
    scope: 'kimi-code',
    token_type: 'Bearer',
    expires_in: 900,
    unknown_cli_field: 'kept',
  };
}

describe('KimiCodeAuthService', () => {
  let root: string;
  let home: KimiCodeHomeResolver;
  let file: string;
  let logger: MockLogger;
  let now: number;
  let realClock: boolean;
  let storedKey: string | undefined;
  let refresh: jest.Mock<Promise<KimiCodeRefreshOutcome>, [string, string, string | undefined]>;
  let emitAuthFileChanged: jest.Mock;
  let service: KimiCodeAuthService;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'kimi-auth-'));
    home = new KimiCodeHomeResolver(join(root, '.kimi-code'));
    await mkdir(home.credentialsDir, { recursive: true });
    file = join(home.credentialsDir, 'kimi-code.json');
    logger = createMockLogger();
    now = NOW_MS;
    realClock = false;
    storedKey = undefined;
    refresh = jest.fn();
    emitAuthFileChanged = jest.fn();
    service = new KimiCodeAuthService({
      logger: asLogger(logger),
      authSecrets: {
        getProviderKey: jest.fn(async () => storedKey),
        hasProviderKey: jest.fn(async () => storedKey !== undefined),
      },
      events: { emitAuthFileChanged },
      home,
      refresher: { refresh },
      now: () => (realClock ? Date.now() : now),
    });
  });

  afterEach(() => {
    service.stopWatching();
    rmSync(root, { recursive: true, force: true });
  });

  async function writeLogin(body: unknown): Promise<void> {
    await writeFile(file, JSON.stringify(body));
  }

  async function readLogin(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  }

  function okRefresh(suffix: string): KimiCodeRefreshOutcome {
    return {
      kind: 'ok',
      tokens: {
        access_token: `fake-access-token-${suffix}`,
        refresh_token: `fake-refresh-token-${suffix}`,
        expires_in: 900,
      },
    };
  }

  it('serves a fresh CLI token without any network call', async () => {
    await writeLogin(tokenFile('1', NOW_S + 600));
    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-1',
    });
    expect(refresh).not.toHaveBeenCalled();
    await expect(service.getStatus()).resolves.toEqual({
      cliDetected: true,
      loggedIn: true,
      stale: false,
      hasApiKey: false,
      credentialSource: 'cli-login',
    });
  });

  it('refreshes an expiring token once for concurrent requests and writes it back', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockImplementation(async () => okRefresh('2'));

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.resolveRequestCredential()),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toBe('fake-refresh-token-1');
    for (const result of results) {
      expect(result).toEqual({ kind: 'oauth', accessToken: 'fake-access-token-2' });
    }
    await expect(readLogin()).resolves.toEqual({
      ...tokenFile('2', NOW_S + 900),
    });
  });

  it('uses a token the CLI refreshed while we waited for the lock', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    await service.getStatus(); // cache the expiring login
    await writeLogin(tokenFile('cli', NOW_S + 900));

    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-cli',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the CLI tokens when it rotated the file during our refresh', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockImplementation(async () => {
      await writeLogin(tokenFile('cli', NOW_S + 900));
      return okRefresh('ours');
    });

    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-cli',
    });
    expect((await readLogin())['access_token']).toBe('fake-access-token-cli');
  });

  it('marks a rejected login stale, falls back to the key, and never retries the same token', async () => {
    await writeLogin(tokenFile('1', NOW_S - 10));
    refresh.mockResolvedValue({ kind: 'rejected', status: 401 });
    storedKey = 'fake-kimi-key';

    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'apiKey',
      apiKey: 'fake-kimi-key',
    });
    await service.resolveRequestCredential();
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(service.getStatus()).resolves.toMatchObject({
      loggedIn: false,
      stale: true,
      credentialSource: 'api-key',
    });
  });

  it('adopts the disk login instead of going stale when a 401 follows another writer\'s rotation', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockImplementation(async () => {
      // The CLI rotated the pair after we read it; our token is consumed.
      await writeLogin(tokenFile('cli', NOW_S + 900));
      return { kind: 'rejected', status: 401 };
    });

    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-cli',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(service.getStatus()).resolves.toMatchObject({
      loggedIn: true,
      stale: false,
      credentialSource: 'cli-login',
    });
  });

  it('logs once, host names only, when the CLI API host differs from the Ptah endpoint (A5)', async () => {
    await writeLogin(tokenFile('1', NOW_S + 600));
    await writeFile(
      home.configFile,
      '[providers."managed:kimi-code"]\nbase_url = "https://api.example-cn.test/coding/v1"\n',
    );

    await service.resolveRequestCredential();
    await service.resolveRequestCredential();

    const hostWarnings = logger.warn.mock.calls.filter(([message]) =>
      String(message).includes('API host'),
    );
    expect(hostWarnings).toHaveLength(1);
    expect(String(hostWarnings[0][0])).toContain('api.example-cn.test');
    expect(String(hostWarnings[0][0])).toContain('api.kimi.ai');
  });

  it('a disk failure while refreshing falls back to the key instead of failing the request', async () => {
    await writeLogin(tokenFile('1', NOW_S - 10));
    storedKey = 'fake-kimi-key';
    const store = new KimiCodeCredentialStore(home, asLogger(logger), {
      now: () => now,
    });
    jest
      .spyOn(store, 'withRefreshLock')
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const withBrokenDisk = new KimiCodeAuthService({
      logger: asLogger(logger),
      authSecrets: {
        getProviderKey: jest.fn(async () => storedKey),
        hasProviderKey: jest.fn(async () => true),
      },
      events: { emitAuthFileChanged },
      home,
      store,
      refresher: { refresh },
      now: () => now,
    });

    await expect(withBrokenDisk.ensureFresh()).resolves.toBe(false);
    await expect(withBrokenDisk.resolveRequestCredential()).resolves.toEqual({
      kind: 'apiKey',
      apiKey: 'fake-kimi-key',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws the fixed stale message without a key', async () => {
    await writeLogin(tokenFile('1', NOW_S - 10));
    refresh.mockResolvedValue({ kind: 'rejected', status: 401 });

    const error = await service.resolveRequestCredential().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KimiCodeAuthUnavailableError);
    expect((error as KimiCodeAuthUnavailableError).reason).toBe('stale');
    expect(String((error as Error).message)).not.toContain('fake-');
  });

  it('throws signed-out with neither a CLI login nor a key', async () => {
    await expect(service.resolveRequestCredential()).rejects.toMatchObject({
      reason: 'signed-out',
    });
    await expect(service.isAuthenticated()).resolves.toBe(false);
  });

  it('keeps a still-valid token through a transient refresh failure', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockResolvedValue({ kind: 'transient', status: 503 });
    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-1',
    });
  });

  it('force-refreshes a token upstream rejected, and falls back to the key when that fails', async () => {
    await writeLogin(tokenFile('1', NOW_S + 600));
    refresh.mockResolvedValueOnce(okRefresh('2'));
    await expect(service.forceRefresh()).resolves.toBe(true);
    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-2',
    });

    storedKey = 'fake-kimi-key';
    refresh.mockResolvedValueOnce({ kind: 'transient', status: 500 });
    await expect(service.forceRefresh()).resolves.toBe(false);
    await expect(service.resolveRequestCredential()).resolves.toEqual({
      kind: 'apiKey',
      apiKey: 'fake-kimi-key',
    });
  });

  it('retains rotated tokens in memory when the write fails and retries later', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockImplementation(async () => {
      // Make the target a directory so the rename fails.
      rmSync(file);
      await mkdir(file);
      return okRefresh('2');
    });
    await service.ensureFresh();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be written'),
    );
  });

  it('refreshes with the retained refresh token while writes keep failing, then persists it', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    const store = new KimiCodeCredentialStore(home, asLogger(logger), {
      now: () => now,
    });
    const writeRotated = jest
      .spyOn(store, 'writeRotated')
      .mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    const retaining = new KimiCodeAuthService({
      logger: asLogger(logger),
      authSecrets: {
        getProviderKey: jest.fn(async () => undefined),
        hasProviderKey: jest.fn(async () => false),
      },
      events: { emitAuthFileChanged },
      home,
      store,
      refresher: { refresh },
      now: () => now,
    });
    refresh
      .mockResolvedValueOnce(okRefresh('2'))
      .mockResolvedValueOnce(okRefresh('3'));

    // R1 -> R2; the write fails, the old (readable) file still holds R1.
    await expect(retaining.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-2',
    });
    expect((await readLogin())['refresh_token']).toBe('fake-refresh-token-1');

    // The retained access token enters the refresh margin.
    now += 800_000;
    await expect(retaining.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-3',
    });
    // The second refresh used the retained R2, never the consumed R1.
    expect(refresh.mock.calls.map(([token]) => token)).toEqual([
      'fake-refresh-token-1',
      'fake-refresh-token-2',
    ]);
    // Every retry still replaces the original disk version (R1) and carries
    // the newest pair.
    const lastWrite = writeRotated.mock.calls[writeRotated.mock.calls.length - 1];
    expect(lastWrite[1]).toBe('fake-refresh-token-1');
    expect(lastWrite[2]).toMatchObject({
      access_token: 'fake-access-token-3',
      refresh_token: 'fake-refresh-token-3',
    });
    expect(writeRotated.mock.calls.length).toBeGreaterThanOrEqual(3);

    // The disk recovers: the next call persists the retained pair.
    writeRotated.mockRestore();
    now += 1_000;
    await retaining.ensureFresh();
    await expect(readLogin()).resolves.toMatchObject({
      access_token: 'fake-access-token-3',
      refresh_token: 'fake-refresh-token-3',
      unknown_cli_field: 'kept',
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('after an under-lock cas-lost, adopts the replacement login and never refreshes the abandoned pair', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    const store = new KimiCodeCredentialStore(home, asLogger(logger), {
      now: () => now,
    });
    const realWrite = store.writeRotated.bind(store);
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });
    jest
      .spyOn(store, 'writeRotated')
      // R1 -> R2 cannot be written; the retry at the next call fails too.
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy)
      // The retry under the lock finds a fresh `kimi login` on disk.
      .mockImplementationOnce(async (target, expected, next) => {
        await writeLogin(tokenFile('new', NOW_S + 800 + 900));
        return realWrite(target, expected, next);
      });
    const retaining = new KimiCodeAuthService({
      logger: asLogger(logger),
      authSecrets: {
        getProviderKey: jest.fn(async () => undefined),
        hasProviderKey: jest.fn(async () => false),
      },
      events: { emitAuthFileChanged },
      home,
      store,
      refresher: { refresh },
      now: () => now,
    });
    refresh.mockResolvedValueOnce(okRefresh('2'));

    await expect(retaining.ensureFresh()).resolves.toBe(true);
    // The retained R2 enters the refresh margin.
    now += 800_000;
    await expect(retaining.ensureFresh()).resolves.toBe(true);

    expect(refresh.mock.calls.map(([token]) => token)).toEqual([
      'fake-refresh-token-1',
    ]);
    await expect(retaining.resolveRequestCredential()).resolves.toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-token-new',
    });
    expect((await readLogin())['refresh_token']).toBe('fake-refresh-token-new');
    await expect(retaining.getStatus()).resolves.toMatchObject({
      loggedIn: true,
      stale: false,
    });
  });

  it('never logs a token value', async () => {
    await writeLogin(tokenFile('1', NOW_S + 60));
    refresh.mockResolvedValue(okRefresh('2'));
    await service.resolveRequestCredential();
    storedKey = 'fake-kimi-key';
    await service.forceRefresh();
    const logged = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('fake-');
  });

  describe('watcher', () => {
    beforeEach(() => {
      realClock = true;
    });

    async function waitFor(check: () => boolean, ms = 4_000): Promise<void> {
      const deadline = Date.now() + ms;
      while (!check() && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 50));
      }
    }

    it('emits once per external change and stops on stopWatching', async () => {
      service.startWatching();
      service.startWatching(); // idempotent
      await writeLogin(tokenFile('ext', NOW_S + 900));
      await waitFor(() => emitAuthFileChanged.mock.calls.length > 0);
      await new Promise((done) => setTimeout(done, 500));
      expect(emitAuthFileChanged).toHaveBeenCalledTimes(1);
      expect(emitAuthFileChanged).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'kimi-code' }),
      );

      service.stopWatching();
      emitAuthFileChanged.mockClear();
      await writeLogin(tokenFile('ext2', NOW_S + 900));
      await new Promise((done) => setTimeout(done, 600));
      expect(emitAuthFileChanged).not.toHaveBeenCalled();
    });

    it('does not emit for its own refresh write', async () => {
      await writeLogin(tokenFile('1', Math.floor(Date.now() / 1000) + 60));
      refresh.mockResolvedValue(okRefresh('2'));
      service.startWatching();
      await new Promise((done) => setTimeout(done, 100));
      await service.ensureFresh();
      await new Promise((done) => setTimeout(done, 700));
      expect(emitAuthFileChanged).not.toHaveBeenCalled();
    });
  });
});
