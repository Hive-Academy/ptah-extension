/**
 * SakanaAuthService Tests
 *
 * Sakana's auth surface is intentionally thin (mirrors OpenRouter):
 *   1. Read API key from SecretStorage via IAuthSecretsService.getProviderKey
 *   2. Build Bearer + Content-Type headers for API calls
 *
 * These specs cover key presence detection, key retrieval with whitespace
 * trimming + empty-key normalization, header construction, the SdkError surface
 * when missing, and the security convention (never log the key).
 */

import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import type { MockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { SakanaAuthService } from './sakana-auth.service';
import { SdkError } from '@ptah-extension/agent-sdk';

const PROVIDER_ID = 'sakana';

describe('SakanaAuthService', () => {
  let service: SakanaAuthService;
  let logger: ReturnType<typeof createMockLogger>;
  let authSecrets: MockAuthSecretsService;

  beforeEach(() => {
    logger = createMockLogger();
    authSecrets = createMockAuthSecretsService();
    service = new SakanaAuthService(logger as unknown as Logger, authSecrets);
  });

  describe('isAuthenticated', () => {
    it('returns true when a non-empty key is stored for sakana', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sakana-key-abcdef' },
      });
      service = new SakanaAuthService(logger as unknown as Logger, authSecrets);

      await expect(service.isAuthenticated()).resolves.toBe(true);
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith(PROVIDER_ID);
    });

    it('returns false when no key is stored', async () => {
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });

    it('returns false when the stored key is whitespace-only', async () => {
      authSecrets.getProviderKey.mockResolvedValue('   ');
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });
  });

  describe('getApiKey', () => {
    it('returns the trimmed key when a non-empty value is stored', async () => {
      authSecrets.getProviderKey.mockResolvedValue('  sakana-trimme  ');
      await expect(service.getApiKey()).resolves.toBe('sakana-trimme');
    });

    it('returns null when no key is stored', async () => {
      await expect(service.getApiKey()).resolves.toBeNull();
    });

    it('returns null when the stored value is whitespace-only', async () => {
      authSecrets.getProviderKey.mockResolvedValue('\n\t  \n');
      await expect(service.getApiKey()).resolves.toBeNull();
    });

    it('scopes SecretStorage reads to the sakana provider id', async () => {
      authSecrets.getProviderKey.mockResolvedValue('sakana-probe');
      await service.getApiKey();
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith(PROVIDER_ID);
    });
  });

  describe('getHeaders', () => {
    it('returns Bearer auth + Content-Type (no ranking headers) when a key is configured', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sakana-headers' },
      });
      service = new SakanaAuthService(logger as unknown as Logger, authSecrets);

      const headers = await service.getHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer sakana-headers',
        'Content-Type': 'application/json',
      });
    });

    it('trims whitespace from stored keys before building the Authorization header', async () => {
      authSecrets.getProviderKey.mockResolvedValue('  sakana-padded  ');
      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer sakana-padded');
    });

    it('throws SdkError with user-facing guidance when no key is configured', async () => {
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
      await expect(service.getHeaders()).rejects.toThrow(
        /Sakana API key is not configured/i,
      );
      await expect(service.getHeaders()).rejects.toThrow(
        /Settings.*Authentication/i,
      );
    });

    it('never logs the full API key (security convention)', async () => {
      const secret = 'sakana-SENSITIVE-VALUE-do-not-log';
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: secret },
      });
      service = new SakanaAuthService(logger as unknown as Logger, authSecrets);

      await service.getHeaders();

      const allLogCalls = [
        ...(logger.debug as jest.Mock).mock.calls,
        ...(logger.info as jest.Mock).mock.calls,
        ...(logger.warn as jest.Mock).mock.calls,
        ...(logger.error as jest.Mock).mock.calls,
      ].flat();
      for (const arg of allLogCalls) {
        expect(String(arg)).not.toContain(secret);
      }

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`key length: ${secret.length}`),
      );
    });
  });
});
