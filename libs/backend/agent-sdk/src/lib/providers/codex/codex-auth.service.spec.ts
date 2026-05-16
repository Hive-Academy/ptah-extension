/**
 * CodexAuthService Tests
 *
 * Covers:
 * - API key resolution (snake_case + SCREAMING_CASE fallback)
 * - OAuth access token resolution
 * - API endpoint selection (explicit override, ApiKey mode, OAuth with/without user endpoint)
 * - Header construction and error surface when unauthenticated
 * - Token staleness detection with frozen clock
 * - 5-second disk read cache behavior + clearCache/ensureTokensFresh invalidation
 * - getTokenStatus for UI warning badge rendering
 */

import 'reflect-metadata';
import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { MockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { CodexAuthService } from './codex-auth.service';
import type { CodexAuthFile } from './codex-provider.types';
import { SdkError } from '../../errors';

// -----------------------------------------------------------------------------
// node:fs/promises mock — codex-auth reads ~/.codex/auth.json directly.
// This is an APPROVED EXCEPTION per the service's own file header: no
// platform abstraction is used for the auth file read.
// -----------------------------------------------------------------------------

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function enoent(path = '~/.codex/auth.json'): NodeJS.ErrnoException {
  const err = new Error(
    `ENOENT: no such file or directory, open '${path}'`,
  ) as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function seedAuthFile(auth: CodexAuthFile): void {
  // Cast to `never` — readFile has overloads; the mock is used in string mode.
  mockedReadFile.mockResolvedValue(JSON.stringify(auth) as never);
}

function seedAuthFileSequence(...files: Array<CodexAuthFile | Error>): void {
  mockedReadFile.mockReset();
  for (const entry of files) {
    if (entry instanceof Error) {
      mockedReadFile.mockRejectedValueOnce(entry);
    } else {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify(entry) as never);
    }
  }
}

// Frozen time anchor matching the ~1 hour OAuth token window.
const ANCHOR = '2026-04-24T12:00:00.000Z';

function isoMinutesAgo(minutes: number, nowMs: number): string {
  return new Date(nowMs - minutes * 60 * 1000).toISOString();
}

// -----------------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------------

describe('CodexAuthService', () => {
  let service: CodexAuthService;
  let logger: ReturnType<typeof createMockLogger>;
  let workspaceProvider: MockWorkspaceProvider;
  let clock: FrozenClock;

  beforeEach(() => {
    mockedReadFile.mockReset();
    logger = createMockLogger();
    workspaceProvider = createMockWorkspaceProvider();
    clock = freezeTime(ANCHOR);
    service = new CodexAuthService(
      logger as unknown as Logger,
      workspaceProvider,
    );
  });

  afterEach(() => {
    clock.restore();
  });

  // ---------------------------------------------------------------------------
  // isAuthenticated
  // ---------------------------------------------------------------------------
  describe('isAuthenticated', () => {
    it('returns true when openai_api_key (snake_case) is present', async () => {
      seedAuthFile({ openai_api_key: 'sk-live-abcd' });
      await expect(service.isAuthenticated()).resolves.toBe(true);
    });

    it('returns true when OPENAI_API_KEY (legacy SCREAMING_CASE) is present', async () => {
      seedAuthFile({ OPENAI_API_KEY: 'sk-legacy-zzz' });
      await expect(service.isAuthenticated()).resolves.toBe(true);
    });

    it('returns true when OAuth access_token is present without api key', async () => {
      seedAuthFile({
        auth_mode: 'Chatgpt',
        tokens: { access_token: 'oauth-access' },
        last_refresh: ANCHOR,
      });
      await expect(service.isAuthenticated()).resolves.toBe(true);
    });

    it('returns false when auth file has neither API key nor access_token', async () => {
      seedAuthFile({ auth_mode: 'ApiKey', tokens: {} });
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });

    it('returns false when auth file is missing (ENOENT)', async () => {
      mockedReadFile.mockRejectedValue(enoent());
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });

    it('returns false when auth file is invalid JSON', async () => {
      mockedReadFile.mockResolvedValue('not-json{' as never);
      await expect(service.isAuthenticated()).resolves.toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getHeaders
  // ---------------------------------------------------------------------------
  describe('getHeaders', () => {
    it('uses API key as Bearer token when present', async () => {
      seedAuthFile({ openai_api_key: 'sk-live-abcd' });
      const headers = await service.getHeaders();
      expect(headers).toEqual({
        Authorization: 'Bearer sk-live-abcd',
        'Content-Type': 'application/json',
      });
    });

    it('prefers API key over OAuth token when both are present', async () => {
      seedAuthFile({
        openai_api_key: 'sk-live-abcd',
        tokens: { access_token: 'should-not-be-used' },
        last_refresh: ANCHOR,
      });
      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer sk-live-abcd');
    });

    it('uses OAuth access_token when no API key is present', async () => {
      seedAuthFile({
        auth_mode: 'Chatgpt',
        tokens: { access_token: 'oauth-access' },
        last_refresh: ANCHOR,
      });
      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer oauth-access');
    });

    it('throws SdkError with codex login guidance when unauthenticated', async () => {
      mockedReadFile.mockRejectedValue(enoent());
      await expect(service.getHeaders()).rejects.toBeInstanceOf(SdkError);
      await expect(service.getHeaders()).rejects.toThrow(/codex login/i);
    });

    it('warns but still returns a stale OAuth token (let API reject it)', async () => {
      seedAuthFile({
        auth_mode: 'Chatgpt',
        tokens: { access_token: 'oauth-stale' },
        last_refresh: isoMinutesAgo(90, clock.now),
      });

      const headers = await service.getHeaders();
      expect(headers['Authorization']).toBe('Bearer oauth-stale');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('OAuth token may be expired'),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getApiEndpoint
  // ---------------------------------------------------------------------------
  describe('getApiEndpoint', () => {
    it('returns explicit api_base_url from auth file when set', async () => {
      seedAuthFile({
        openai_api_key: 'sk-live-abcd',
        api_base_url: 'https://proxy.example.com/v1',
      });
      // Prime cache (getApiEndpoint is synchronous and reads from cachedAuth)
      await service.isAuthenticated();
      expect(service.getApiEndpoint()).toBe('https://proxy.example.com/v1');
    });

    it('returns OpenAI public API endpoint for ApiKey mode', async () => {
      seedAuthFile({ auth_mode: 'ApiKey', openai_api_key: 'sk-live' });
      await service.isAuthenticated();
      expect(service.getApiEndpoint()).toBe('https://api.openai.com/v1');
    });

    it('returns OpenAI public API endpoint when only api key is present (auth_mode absent)', async () => {
      seedAuthFile({ openai_api_key: 'sk-live' });
      await service.isAuthenticated();
      expect(service.getApiEndpoint()).toBe('https://api.openai.com/v1');
    });

    it('returns user-configured OAuth endpoint when settings provide one', async () => {
      workspaceProvider.__state.config.set(
        'ptah.provider.openai-codex.oauthApiEndpoint',
        'https://my-proxy.example.com/codex',
      );
      seedAuthFile({
        auth_mode: 'Chatgpt',
        tokens: { access_token: 'oauth-access' },
        last_refresh: ANCHOR,
      });
      await service.isAuthenticated();
      expect(service.getApiEndpoint()).toBe(
        'https://my-proxy.example.com/codex',
      );
    });

    it('falls back to ChatGPT backend default for OAuth when no user endpoint', async () => {
      seedAuthFile({
        auth_mode: 'Chatgpt',
        tokens: { access_token: 'oauth-access' },
        last_refresh: ANCHOR,
      });
      await service.isAuthenticated();
      expect(service.getApiEndpoint()).toBe(
        'https://chatgpt.com/backend-api/codex',
      );
    });

    it('defaults to OAuth endpoint when no auth file has been read yet', () => {
      // No isAuthenticated() call → cachedAuth is null
      expect(service.getApiEndpoint()).toBe(
        'https://chatgpt.com/backend-api/codex',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getTokenStatus
  // ---------------------------------------------------------------------------
  describe('getTokenStatus', () => {
    it('reports authenticated + fresh for API key mode (never expires)', async () => {
      seedAuthFile({ openai_api_key: 'sk-live' });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: true,
        stale: false,
      });
    });

    it('reports authenticated + fresh for recently refreshed OAuth token', async () => {
      seedAuthFile({
        tokens: { access_token: 'oauth' },
        last_refresh: isoMinutesAgo(10, clock.now),
      });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: true,
        stale: false,
      });
    });

    it('reports authenticated + stale when OAuth token exceeds 50min window', async () => {
      seedAuthFile({
        tokens: { access_token: 'oauth' },
        last_refresh: isoMinutesAgo(55, clock.now),
      });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: true,
        stale: true,
      });
    });

    it('reports authenticated + stale when last_refresh is missing', async () => {
      seedAuthFile({ tokens: { access_token: 'oauth' } });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: true,
        stale: true,
      });
    });

    it('reports authenticated + stale when last_refresh is unparseable', async () => {
      seedAuthFile({
        tokens: { access_token: 'oauth' },
        last_refresh: 'not-a-date',
      });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: true,
        stale: true,
      });
    });

    it('reports unauthenticated when auth file is missing', async () => {
      mockedReadFile.mockRejectedValue(enoent());
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: false,
        stale: false,
      });
    });

    it('reports unauthenticated when no api key and no access_token', async () => {
      seedAuthFile({ auth_mode: 'ApiKey', tokens: {} });
      await expect(service.getTokenStatus()).resolves.toEqual({
        authenticated: false,
        stale: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ensureTokensFresh
  // ---------------------------------------------------------------------------
  describe('ensureTokensFresh', () => {
    it('returns true for API key (always fresh)', async () => {
      seedAuthFile({ openai_api_key: 'sk-live' });
      await expect(service.ensureTokensFresh()).resolves.toBe(true);
    });

    it('returns true for fresh OAuth token', async () => {
      seedAuthFile({
        tokens: { access_token: 'oauth' },
        last_refresh: isoMinutesAgo(5, clock.now),
      });
      await expect(service.ensureTokensFresh()).resolves.toBe(true);
    });

    it('returns false for stale OAuth token and warns user to re-login', async () => {
      seedAuthFile({
        tokens: { access_token: 'oauth' },
        last_refresh: isoMinutesAgo(120, clock.now),
      });
      await expect(service.ensureTokensFresh()).resolves.toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('`codex login`'),
      );
    });

    it('returns false when auth file is missing', async () => {
      mockedReadFile.mockRejectedValue(enoent());
      await expect(service.ensureTokensFresh()).resolves.toBe(false);
    });

    it('returns false and logs error when readFile throws a non-ENOENT error', async () => {
      const readError = new Error('disk exploded') as NodeJS.ErrnoException;
      readError.code = 'EACCES';
      mockedReadFile.mockRejectedValue(readError);
      await expect(service.ensureTokensFresh()).resolves.toBe(false);
      // Either the warn (from readAuthFile) or error path fires — both indicate the failure surfaced.
      const surfaced =
        (logger.warn as jest.Mock).mock.calls.length > 0 ||
        (logger.error as jest.Mock).mock.calls.length > 0;
      expect(surfaced).toBe(true);
    });

    it('bypasses the cache by forcing a fresh read from disk', async () => {
      // First call primes cache
      seedAuthFileSequence(
        { openai_api_key: 'sk-first' },
        { openai_api_key: 'sk-second' },
      );
      await service.isAuthenticated(); // reads 1st
      // Without ensureTokensFresh, next isAuthenticated would hit cache within 5s.
      await service.ensureTokensFresh(); // should force 2nd read
      // 2 actual reads observed
      expect(mockedReadFile).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache behavior (5s TTL)
  // ---------------------------------------------------------------------------
  describe('cache / clearCache', () => {
    it('re-uses cached auth file within 5 seconds', async () => {
      seedAuthFile({ openai_api_key: 'sk-live' });
      await service.isAuthenticated();
      await service.isAuthenticated();
      clock.advanceBy(4_000);
      await service.isAuthenticated();
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
    });

    it('re-reads from disk after 5s TTL expires', async () => {
      seedAuthFileSequence(
        { openai_api_key: 'sk-first' },
        { openai_api_key: 'sk-second' },
      );
      await service.isAuthenticated();
      clock.advanceBy(5_001);
      await service.isAuthenticated();
      expect(mockedReadFile).toHaveBeenCalledTimes(2);
    });

    it('clearCache() forces next read to hit disk (key rotation path)', async () => {
      seedAuthFileSequence(
        { openai_api_key: 'sk-rotated-old' },
        { openai_api_key: 'sk-rotated-new' },
      );

      await service.isAuthenticated();
      const firstHeaders = await service.getHeaders();
      expect(firstHeaders['Authorization']).toBe('Bearer sk-rotated-old');

      // Simulate external key rotation
      service.clearCache();

      const secondHeaders = await service.getHeaders();
      expect(secondHeaders['Authorization']).toBe('Bearer sk-rotated-new');
      expect(mockedReadFile).toHaveBeenCalledTimes(2);
    });

    it('clearCache() resets to read fresh data even when inside the 5s TTL', async () => {
      seedAuthFileSequence(
        { openai_api_key: 'sk-first' },
        { openai_api_key: 'sk-second' },
      );
      await service.isAuthenticated();
      clock.advanceBy(1_000); // still well inside TTL
      service.clearCache();
      await service.isAuthenticated();
      expect(mockedReadFile).toHaveBeenCalledTimes(2);
    });

    it('drops the cache automatically when readFile fails after a prior success', async () => {
      seedAuthFileSequence({ openai_api_key: 'sk-first' }, enoent(), {
        openai_api_key: 'sk-second',
      });

      await service.isAuthenticated(); // fills cache
      clock.advanceBy(5_001); // invalidate TTL
      await service.isAuthenticated(); // ENOENT → cache cleared
      clock.advanceBy(100); // well inside any new TTL window
      const headers = await service.getHeaders(); // must re-read, can't serve ENOENT
      expect(headers['Authorization']).toBe('Bearer sk-second');
      expect(mockedReadFile).toHaveBeenCalledTimes(3);
    });
  });
});
