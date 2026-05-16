/**
 * OpenRouterAuthService Tests
 *
 * OpenRouter's auth surface is intentionally thin:
 *   1. Read API key from SecretStorage via IAuthSecretsService.getProviderKey
 *   2. Build Bearer + ranking headers for API calls
 *
 * These specs cover:
 * - Key presence detection (isAuthenticated)
 * - Key retrieval with whitespace trimming + empty-key normalization
 * - Header construction (Authorization + Content-Type + OpenRouter ranking headers)
 * - Distinct error surface (SdkError) with user-facing guidance when missing
 * - Key rotation path through SecretStorage
 *
 * NOTE: OpenRouterAuthService has NO outbound HTTP. Model-list fetching and
 * status-code handling (401/403/5xx) live in the translation proxy layer, not
 * in this auth service — the batch brief's mention of model-list parsing and
 * 401/403/5xx distinction does not apply to code that does not exist here.
 * See `openrouter-translation-proxy.ts` for that surface; it should have its
 * own dedicated spec. This file stays faithful to the service under test.
 */

import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import type { MockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { OpenRouterAuthService } from './openrouter-auth.service';
import { SdkError } from '../../errors';

const PROVIDER_ID = 'openrouter';

describe('OpenRouterAuthService', () => {
  let service: OpenRouterAuthService;
  let logger: ReturnType<typeof createMockLogger>;
  let authSecrets: MockAuthSecretsService;

  beforeEach(() => {
    logger = createMockLogger();
    authSecrets = createMockAuthSecretsService();
    service = new OpenRouterAuthService(
      logger as unknown as Logger,
      authSecrets,
    );
  });

  // ---------------------------------------------------------------------------
  // isAuthenticated
  // ---------------------------------------------------------------------------
  describe('isAuthenticated', () => {
    it('returns true when a non-empty key is stored for openrouter', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sk-or-v1-abcdef' },
      });
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

      await expect(service.isAuthenticated()).resolves.toBe(true);
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith(PROVIDER_ID);
    });

    it('returns false when no key is stored', async () => {
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });

    it('returns false when the stored key is whitespace-only', async () => {
      // setProviderKey trims internally; bypass by writing through the mock Map manually
      // via a fresh seed.
      authSecrets = createMockAuthSecretsService();
      // The seeded mock trims empty values on setProviderKey; simulate a corrupt
      // stored value by stubbing getProviderKey directly.
      authSecrets.getProviderKey.mockResolvedValue('   ');
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

      await expect(service.isAuthenticated()).resolves.toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getApiKey
  // ---------------------------------------------------------------------------
  describe('getApiKey', () => {
    it('returns the trimmed key when a non-empty value is stored', async () => {
      authSecrets.getProviderKey.mockResolvedValue('  sk-or-v1-trimme  ');
      await expect(service.getApiKey()).resolves.toBe('sk-or-v1-trimme');
    });

    it('returns null when no key is stored', async () => {
      await expect(service.getApiKey()).resolves.toBeNull();
    });

    it('returns null when the stored value is whitespace-only', async () => {
      authSecrets.getProviderKey.mockResolvedValue('\n\t  \n');
      await expect(service.getApiKey()).resolves.toBeNull();
    });

    it('scopes SecretStorage reads to the openrouter provider id', async () => {
      authSecrets.getProviderKey.mockResolvedValue('sk-or-v1-probe');
      await service.getApiKey();
      expect(authSecrets.getProviderKey).toHaveBeenCalledTimes(1);
      expect(authSecrets.getProviderKey).toHaveBeenCalledWith(PROVIDER_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // getHeaders
  // ---------------------------------------------------------------------------
  describe('getHeaders', () => {
    it('returns Bearer auth + OpenRouter ranking headers when a key is configured', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sk-or-v1-headers' },
      });
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

      const headers = await service.getHeaders();

      expect(headers).toEqual({
        Authorization: 'Bearer sk-or-v1-headers',
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ptah-extension.com',
        'X-Title': 'Ptah Extension',
      });
    });

    it('trims whitespace from stored keys before building the Authorization header', async () => {
      authSecrets.getProviderKey.mockResolvedValue('  sk-or-v1-padded  ');
      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer sk-or-v1-padded');
    });

    it('throws SdkError with user-facing guidance when no key is configured', async () => {
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
      await expect(service.getHeaders()).rejects.toThrow(
        /OpenRouter API key is not configured/i,
      );
      await expect(service.getHeaders()).rejects.toThrow(
        /Settings.*Authentication/i,
      );
    });

    it('throws SdkError when the stored key is whitespace-only', async () => {
      authSecrets.getProviderKey.mockResolvedValue('   \t  ');
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
    });

    it('never logs the full API key (security convention)', async () => {
      const secret = 'sk-or-v1-SENSITIVE-VALUE-do-not-log';
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: secret },
      });
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

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

      // But SHOULD log key length for observability
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`key length: ${secret.length}`),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Key rotation path
  // ---------------------------------------------------------------------------
  describe('key rotation via SecretStorage', () => {
    it('reflects updated keys on the next read (no internal cache layer)', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sk-or-v1-OLD' },
      });
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

      const firstHeaders = await service.getHeaders();
      expect(firstHeaders['Authorization']).toBe('Bearer sk-or-v1-OLD');

      // Rotate key in SecretStorage
      await authSecrets.setProviderKey(PROVIDER_ID, 'sk-or-v1-NEW');

      const secondHeaders = await service.getHeaders();
      expect(secondHeaders['Authorization']).toBe('Bearer sk-or-v1-NEW');
    });

    it('transitions from authenticated → unauthenticated when the key is deleted', async () => {
      authSecrets = createMockAuthSecretsService({
        providerKeys: { [PROVIDER_ID]: 'sk-or-v1-present' },
      });
      service = new OpenRouterAuthService(
        logger as unknown as Logger,
        authSecrets,
      );

      await expect(service.isAuthenticated()).resolves.toBe(true);

      await authSecrets.deleteProviderKey(PROVIDER_ID);

      await expect(service.isAuthenticated()).resolves.toBe(false);
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
    });
  });
});
