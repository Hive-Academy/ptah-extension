/**
 * Unit tests for VoiceSecretStore — vault-backed ElevenLabs API key storage.
 * Security invariants under test: ciphertext-only persistence, decrypt-null
 * degrades gracefully (auth/re-enter-key path), and plaintext is never
 * logged or returned by any getter.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IVoiceTokenVault } from '@ptah-extension/voice-contracts';
import { VoiceSecretStore } from './voice-secret-store';

const CIPHER_KEY = 'voice.elevenlabs.apiKeyCipher';
const PLAINTEXT = 'sk-super-secret-plaintext-value';

function makeLogger(): {
  logger: Logger;
  allCallsAsString: () => string;
} {
  const debug = jest.fn();
  const info = jest.fn();
  const warn = jest.fn();
  const error = jest.fn();
  return {
    logger: { debug, info, warn, error } as unknown as Logger,
    allCallsAsString: () =>
      JSON.stringify([
        ...debug.mock.calls,
        ...info.mock.calls,
        ...warn.mock.calls,
        ...error.mock.calls,
      ]),
  };
}

function makeWorkspace(
  store: Record<string, unknown> = {},
): IWorkspaceProvider {
  return {
    getConfiguration: jest.fn(
      (_section: string, key: string, defaultValue?: unknown) =>
        key in store ? store[key] : defaultValue,
    ),
    setConfiguration: jest.fn(
      async (_section: string, key: string, value: unknown) => {
        store[key] = value;
      },
    ),
    getWorkspaceFolders: () => [],
    getWorkspaceRoot: () => undefined,
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  } as unknown as IWorkspaceProvider;
}

/** Simple reversible fake vault: 'enc:<plaintext>' — never a real crypto op. */
function makeVault(
  overrides: Partial<IVoiceTokenVault> = {},
): IVoiceTokenVault {
  return {
    isEncryptionAvailable: () => true,
    encrypt: (plaintext: string) => `enc:${plaintext}`,
    decrypt: (ciphertext: string) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : null,
    ...overrides,
  };
}

describe('VoiceSecretStore', () => {
  describe('isConfigured', () => {
    it('is false when no ciphertext is stored', () => {
      const { logger } = makeLogger();
      const store = new VoiceSecretStore(logger, makeWorkspace(), makeVault());
      expect(store.isConfigured('elevenlabs')).toBe(false);
    });

    it('is true once a ciphertext is stored, without decrypting', () => {
      const { logger } = makeLogger();
      const vault = makeVault();
      const decryptSpy = jest.spyOn(vault, 'decrypt');
      const workspaceStore = { [CIPHER_KEY]: 'enc:whatever' };
      const store = new VoiceSecretStore(
        logger,
        makeWorkspace(workspaceStore),
        vault,
      );

      expect(store.isConfigured('elevenlabs')).toBe(true);
      expect(decryptSpy).not.toHaveBeenCalled();
    });
  });

  describe('setKey / getKey round trip', () => {
    it('persists ciphertext only under voice.elevenlabs.apiKeyCipher', async () => {
      const { logger } = makeLogger();
      const workspaceStore: Record<string, unknown> = {};
      const workspace = makeWorkspace(workspaceStore);
      const store = new VoiceSecretStore(logger, workspace, makeVault());

      await store.setKey('elevenlabs', PLAINTEXT);

      // Persisted value is whatever the vault's encrypt() returned — the store
      // never writes the plaintext argument directly to settings.
      expect(workspaceStore[CIPHER_KEY]).toBe(`enc:${PLAINTEXT}`);
      expect(String(workspaceStore[CIPHER_KEY])).not.toBe(PLAINTEXT);
    });

    it('getKey decrypts the stored ciphertext back to plaintext', async () => {
      const { logger } = makeLogger();
      const workspace = makeWorkspace();
      const store = new VoiceSecretStore(logger, workspace, makeVault());
      await store.setKey('elevenlabs', PLAINTEXT);

      expect(store.getKey('elevenlabs')).toBe(PLAINTEXT);
    });

    it('getKey returns null when nothing is configured', () => {
      const { logger } = makeLogger();
      const store = new VoiceSecretStore(logger, makeWorkspace(), makeVault());
      expect(store.getKey('elevenlabs')).toBeNull();
    });
  });

  describe('decrypt-null degradation (auth / re-enter-key path)', () => {
    it('getKey returns null when the vault fails to decrypt (corrupted/rotated key)', () => {
      const { logger } = makeLogger();
      const vault = makeVault({ decrypt: () => null });
      const workspace = makeWorkspace({ [CIPHER_KEY]: 'enc:something' });
      const store = new VoiceSecretStore(logger, workspace, vault);

      expect(store.getKey('elevenlabs')).toBeNull();
      // isConfigured still reports true — the UI can distinguish "configured but
      // needs re-entry" from "never configured".
      expect(store.isConfigured('elevenlabs')).toBe(true);
    });

    it('getKey returns null and logs a sanitized warning (no plaintext) when decrypt throws', () => {
      const { logger, allCallsAsString } = makeLogger();
      const vault = makeVault({
        decrypt: () => {
          throw new Error('vault unlock failed');
        },
      });
      const workspace = makeWorkspace({ [CIPHER_KEY]: 'enc:something' });
      const store = new VoiceSecretStore(logger, workspace, vault);

      expect(store.getKey('elevenlabs')).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      expect(allCallsAsString()).not.toContain(PLAINTEXT);
    });

    it('getKey returns null when no vault is registered on this runtime', () => {
      const { logger } = makeLogger();
      const workspace = makeWorkspace({ [CIPHER_KEY]: 'enc:something' });
      const store = new VoiceSecretStore(logger, workspace, null);

      expect(store.getKey('elevenlabs')).toBeNull();
    });
  });

  describe('clearKey / empty-string setKey', () => {
    it('setKey with an empty string clears the stored ciphertext', async () => {
      const { logger } = makeLogger();
      const workspaceStore: Record<string, unknown> = {
        [CIPHER_KEY]: 'enc:old',
      };
      const workspace = makeWorkspace(workspaceStore);
      const store = new VoiceSecretStore(logger, workspace, makeVault());

      await store.setKey('elevenlabs', '');

      expect(workspaceStore[CIPHER_KEY]).toBe('');
      expect(store.isConfigured('elevenlabs')).toBe(false);
    });

    it('clearKey writes an empty ciphertext directly', async () => {
      const { logger } = makeLogger();
      const workspaceStore: Record<string, unknown> = {
        [CIPHER_KEY]: 'enc:old',
      };
      const workspace = makeWorkspace(workspaceStore);
      const store = new VoiceSecretStore(logger, workspace, makeVault());

      await store.clearKey('elevenlabs');

      expect(workspaceStore[CIPHER_KEY]).toBe('');
    });
  });

  describe('failure modes', () => {
    it('setKey throws when no vault is registered on this runtime', async () => {
      const { logger } = makeLogger();
      const store = new VoiceSecretStore(logger, makeWorkspace(), null);
      await expect(store.setKey('elevenlabs', PLAINTEXT)).rejects.toThrow(
        /unavailable/i,
      );
    });

    it('setKey throws for a provider with no configured cipher key', async () => {
      const { logger } = makeLogger();
      const store = new VoiceSecretStore(logger, makeWorkspace(), makeVault());
      await expect(store.setKey('local', PLAINTEXT)).rejects.toThrow(
        /does not store an API key/i,
      );
    });
  });

  describe('plaintext-never-logged security regression', () => {
    it('never logs the plaintext across setKey / getKey / isConfigured', async () => {
      const { logger, allCallsAsString } = makeLogger();
      const workspace = makeWorkspace();
      const store = new VoiceSecretStore(logger, workspace, makeVault());

      await store.setKey('elevenlabs', PLAINTEXT);
      store.getKey('elevenlabs');
      store.isConfigured('elevenlabs');

      expect(allCallsAsString()).not.toContain(PLAINTEXT);
    });
  });
});
