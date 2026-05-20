/**
 * Gateway cipher round-trip — behavioral test.
 *
 * Verifies that the full setToken → persist → decryptToken pipeline works
 * end-to-end using:
 *   - A real SecretsFileStore backed by a temp directory
 *   - A real GatewaySettings wired to a real FileSettingsStore
 *   - A real ITokenVault (AES-256-GCM, no Electron dep)
 *   - A second GatewayService instance that reads from the same store
 *
 * Sanity check: changing `setToken` to store `cipher.slice(1)` must make
 * the round-trip assertion fail.
 */

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GatewayService } from './gateway.service';
import type { GrammyTelegramAdapter } from './adapters/telegram/grammy.adapter';
import type { DiscordAdapter } from './adapters/discord/discord.adapter';
import type { BoltSlackAdapter } from './adapters/slack/bolt.adapter';
import type { FfmpegDecoder } from './voice/ffmpeg-decoder';
import type { WhisperTranscriber } from './voice/whisper-transcriber';
import type { BindingStore } from './binding.store';
import type { MessageStore } from './message.store';
import type { ITokenVault } from './token-vault.interface';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import {
  SecretsFileStore,
  GatewaySettings,
} from '@ptah-extension/settings-core';
import type { ISettingsStore } from '@ptah-extension/settings-core';
import type { IDisposable } from '@ptah-extension/platform-core';

// ---------------------------------------------------------------------------
// Real ITokenVault — AES-256-GCM with a fixed test key.
// No Electron safeStorage dependency.
// ---------------------------------------------------------------------------

const VAULT_PREFIX = 'gcm:';

class TestTokenVault implements ITokenVault {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('key must be 32 bytes');
    this.key = key;
  }

  isEncryptionAvailable(): boolean {
    return true;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      'gcm',
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(ciphertext: string): string | null {
    if (!ciphertext || !ciphertext.startsWith(VAULT_PREFIX)) return null;
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 4) return null;
      const [, iv64, tag64, ct64] = parts;
      const iv = Buffer.from(iv64, 'base64');
      const tag = Buffer.from(tag64, 'base64');
      const ct = Buffer.from(ct64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function createWorkspace(): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(),
    setConfiguration: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function createBindingStore(): jest.Mocked<BindingStore> {
  return {
    findById: jest.fn(),
    findByExternal: jest.fn(),
    list: jest.fn(),
    upsertPending: jest.fn(),
    approve: jest.fn(),
    setStatus: jest.fn(),
    touch: jest.fn(),
  } as unknown as jest.Mocked<BindingStore>;
}

function createMessageStore(): jest.Mocked<MessageStore> {
  return {
    insert: jest.fn(),
    list: jest.fn(),
    listVoicePathsOlderThan: jest.fn(),
  } as unknown as jest.Mocked<MessageStore>;
}

// ---------------------------------------------------------------------------
// Minimal ISettingsStore that delegates secret I/O to SecretsFileStore.
// Global settings are in-memory only (not needed for gateway cipher tests).
// ---------------------------------------------------------------------------

function makeSecretsStore(
  secretsFileStore: SecretsFileStore,
  masterKeyProvider: IMasterKeyProvider,
): ISettingsStore {
  const globalData: Record<string, unknown> = {};

  return {
    readGlobal<T>(key: string): T | undefined {
      return globalData[key] as T | undefined;
    },
    async writeGlobal<T>(key: string, value: T): Promise<void> {
      globalData[key] = value;
    },
    async readSecret(key: string): Promise<string | undefined> {
      const mk = await masterKeyProvider.getMasterKey();
      return secretsFileStore.read(key, mk);
    },
    async writeSecret(key: string, ciphertext: string): Promise<void> {
      const mk = await masterKeyProvider.getMasterKey();
      await secretsFileStore.write(key, ciphertext, mk);
    },
    async deleteSecret(key: string): Promise<void> {
      await secretsFileStore.delete(key);
    },
    watchGlobal(_key: string, _cb: (value: unknown) => void): IDisposable {
      return { dispose: jest.fn() };
    },
    watchSecret(_key: string, _cb: () => void): IDisposable {
      return { dispose: jest.fn() };
    },
    flushSync: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Build a GatewayService wired to a real SecretsFileStore in ptahDir.
// ---------------------------------------------------------------------------

function buildServiceWithRealStore(
  ptahDir: string,
  vaultKey: Buffer,
  masterKey: Buffer,
): { service: GatewayService; gatewaySettings: GatewaySettings } {
  const vault = new TestTokenVault(vaultKey);

  const masterKeyProvider: IMasterKeyProvider = {
    getMasterKey: async () => masterKey,
  };

  const secretsFileStore = new SecretsFileStore(ptahDir);
  const store = makeSecretsStore(secretsFileStore, masterKeyProvider);
  const gatewaySettings = new GatewaySettings(store);

  const service = new GatewayService(
    createLogger(),
    createWorkspace(),
    vault,
    createBindingStore(),
    createMessageStore(),
    {} as unknown as GrammyTelegramAdapter,
    {} as unknown as DiscordAdapter,
    {} as unknown as BoltSlackAdapter,
    {} as unknown as FfmpegDecoder,
    { configure: jest.fn() } as unknown as WhisperTranscriber,
    gatewaySettings,
  );

  return { service, gatewaySettings };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GatewayService cipher round-trip (behavioral)', () => {
  let tmpDir: string;
  const vaultKey = crypto.randomBytes(32);
  const masterKey = crypto.randomBytes(32);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-gw-cipher-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('telegram: setToken round-trips — decryptToken returns the original plaintext via a fresh instance', async () => {
    // --- Arrange: write side ---
    const { service: writer } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    const plainToken = 'xoxb-real-secret-telegram-123';

    // --- Act: persist ---
    await writer.setToken({ platform: 'telegram', token: plainToken });

    // --- Arrange: read side (fresh instances, no shared in-memory state) ---
    const { service: reader } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );

    // Call decryptToken via the test seam: maybeStartTelegram → decryptToken.
    // We inject a fake adapter that records the token it was started with.
    let capturedToken: string | undefined;
    const fakeAdapter = {
      platform: 'telegram' as const,
      start: jest.fn(async (token: string) => {
        capturedToken = token;
      }),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      sendMessage: jest.fn(),
      editMessage: jest.fn(),
      on: jest.fn(),
    };
    reader.configureForTest({ telegram: fakeAdapter });

    // Force-start telegram (bypasses enabled flag).
    await reader.startPlatform('telegram');

    // --- Assert ---
    expect(capturedToken).toBe(plainToken);
  });

  it('discord: setToken round-trips', async () => {
    const { service: writer } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    const plainToken = 'discord-bot-token-999';

    await writer.setToken({ platform: 'discord', token: plainToken });

    const { service: reader } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    let capturedToken: string | undefined;
    const fakeAdapter = {
      platform: 'discord' as const,
      start: jest.fn(async (token: string) => {
        capturedToken = token;
      }),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      sendMessage: jest.fn(),
      editMessage: jest.fn(),
      on: jest.fn(),
      configure: jest.fn(),
    };
    reader.configureForTest({ discord: fakeAdapter });
    await reader.startPlatform('discord');

    expect(capturedToken).toBe(plainToken);
  });

  it('slack: setToken round-trips both botToken and appToken', async () => {
    const { service: writer } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    const botToken = 'xoxb-slack-bot-token';
    const appToken = 'xapp-slack-app-token';

    await writer.setToken({
      platform: 'slack',
      token: botToken,
      slackAppToken: appToken,
    });

    const { service: reader } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    let capturedBotToken: string | undefined;
    let capturedAppToken: string | undefined;
    const fakeAdapter = {
      platform: 'slack' as const,
      start: jest.fn(async (token: string, opts: { appToken: string }) => {
        capturedBotToken = token;
        capturedAppToken = opts.appToken;
      }),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      sendMessage: jest.fn(),
      editMessage: jest.fn(),
      on: jest.fn(),
      configure: jest.fn(),
    };
    reader.configureForTest({ slack: fakeAdapter });
    await reader.startPlatform('slack');

    expect(capturedBotToken).toBe(botToken);
    expect(capturedAppToken).toBe(appToken);
  });

  it('using a different vault key (wrong key) causes the round-trip to fail (decrypt returns null → adapter.start not called)', async () => {
    const { service: writer } = buildServiceWithRealStore(
      tmpDir,
      vaultKey,
      masterKey,
    );
    await writer.setToken({ platform: 'telegram', token: 'secret-token' });

    const wrongVaultKey = crypto.randomBytes(32);
    const { service: reader } = buildServiceWithRealStore(
      tmpDir,
      wrongVaultKey,
      masterKey,
    );

    let startCalled = false;
    const fakeAdapter = {
      platform: 'telegram' as const,
      start: jest.fn(async () => {
        startCalled = true;
      }),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(false),
      sendMessage: jest.fn(),
      editMessage: jest.fn(),
      on: jest.fn(),
    };
    reader.configureForTest({ telegram: fakeAdapter });
    await reader.startPlatform('telegram');

    // Wrong vault key: decrypt returns null → token is null → adapter.start is not called.
    expect(startCalled).toBe(false);
  });
});
