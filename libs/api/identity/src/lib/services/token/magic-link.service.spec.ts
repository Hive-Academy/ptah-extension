/**
 * Unit tests for MagicLinkService (TASK_2025_294 W1.B2.1).
 *
 * Scope: Passwordless magic-link tokens — real crypto round-trip with
 * frozen clock.
 * Coverage:
 *   - Token generation: 64-char hex (256-bit entropy via crypto.randomBytes).
 *   - Link URL uses FRONTEND_URL with /api/auth/verify path.
 *   - Round-trip: create → validateAndConsume resolves the email.
 *   - Single-use enforcement: second consume returns `token_already_used`
 *     (or the entry has been deleted — see note in test).
 *   - TTL expiry (default 2 minutes) via frozen clock.
 *   - Collision-safe: 100 consecutive tokens are unique.
 *   - Metadata: returnUrl and plan are round-tripped.
 *   - Error paths: token_not_found, token_expired.
 *
 * Real crypto is used end-to-end; we only mock the ConfigService.
 */
import type { ConfigService } from '@nestjs/config';
import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import { MagicLinkService } from './magic-link.service';

const DEFAULT_TTL_MS = 120_000;
const FRONTEND_URL = 'https://ptah.live';

// Minimal local shape — ConfigService.get has multiple generic overloads
// that conflict with a naive jest.Mocked<Pick<…>> declaration.
type MockConfig = { get: jest.Mock };

function createMockConfig(overrides: Record<string, unknown> = {}): MockConfig {
  const config = {
    FRONTEND_URL,
    ...overrides,
  } as Record<string, unknown>;

  return {
    get: jest.fn(<T>(key: string, defaultValue?: T): T => {
      if (Object.prototype.hasOwnProperty.call(config, key)) {
        return config[key] as T;
      }
      return defaultValue as T;
    }),
  };
}

function extractToken(url: string): string {
  const match = url.match(/[?&]token=([^&]+)/);
  if (!match) throw new Error(`No token in url: ${url}`);
  return match[1];
}

describe('MagicLinkService', () => {
  let service: MagicLinkService;
  let config: MockConfig;
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime('2026-04-24T12:00:00.000Z');
    config = createMockConfig();
    service = new MagicLinkService(config as unknown as ConfigService);
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllTimers();
  });

  describe('createMagicLink', () => {
    it('returns a URL whose token is 64-char lowercase hex (256-bit entropy)', async () => {
      const url = await service.createMagicLink('user@example.com');

      expect(url.startsWith(`${FRONTEND_URL}/api/auth/verify?token=`)).toBe(
        true,
      );

      const token = extractToken(url);
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens across 100 consecutive calls (collision-safe)', async () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(extractToken(await service.createMagicLink(`u${i}@x.com`)));
      }
      expect(tokens.size).toBe(100);
    });

    it('builds the URL using FRONTEND_URL from config', async () => {
      config = createMockConfig({ FRONTEND_URL: 'https://staging.ptah.live' });
      service = new MagicLinkService(config as unknown as ConfigService);

      const url = await service.createMagicLink('user@example.com');

      expect(url).toMatch(
        /^https:\/\/staging\.ptah\.live\/api\/auth\/verify\?token=[0-9a-f]{64}$/,
      );
    });

    it('falls back to the default FRONTEND_URL when not configured', async () => {
      config = createMockConfig({ FRONTEND_URL: undefined });
      service = new MagicLinkService(config as unknown as ConfigService);

      const url = await service.createMagicLink('user@example.com');

      expect(url.startsWith('https://ptah.live/api/auth/verify?token=')).toBe(
        true,
      );
    });
  });

  describe('validateAndConsume — round-trip', () => {
    it('resolves the email for a freshly issued token', async () => {
      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      const result = await service.validateAndConsume(token);

      expect(result).toEqual({
        valid: true,
        email: 'user@example.com',
        returnUrl: null,
        plan: null,
      });
    });

    it('round-trips optional returnUrl and plan metadata', async () => {
      const url = await service.createMagicLink('user@example.com', {
        returnUrl: 'https://ptah.live/billing',
        plan: 'pro-yearly',
      });
      const token = extractToken(url);

      const result = await service.validateAndConsume(token);

      expect(result.valid).toBe(true);
      expect(result.returnUrl).toBe('https://ptah.live/billing');
      expect(result.plan).toBe('pro-yearly');
    });
  });

  describe('validateAndConsume — single-use enforcement', () => {
    it('rejects the second consumption with token_not_found (single-use delete)', async () => {
      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      const first = await service.validateAndConsume(token);
      const second = await service.validateAndConsume(token);

      expect(first.valid).toBe(true);
      expect(second.valid).toBe(false);
      // After successful consumption the entry is deleted — second lookup
      // sees no entry (token_not_found), which is the intended replay
      // protection signal (stronger than token_already_used).
      expect(second.error).toBe('token_not_found');
    });
  });

  describe('validateAndConsume — error paths', () => {
    it('returns token_not_found for an unknown token', async () => {
      const result = await service.validateAndConsume(
        'a'.repeat(64) /* well-formed but never issued */,
      );
      expect(result).toEqual({ valid: false, error: 'token_not_found' });
    });

    it('returns token_not_found for an empty token', async () => {
      const result = await service.validateAndConsume('');
      expect(result).toEqual({ valid: false, error: 'token_not_found' });
    });
  });

  describe('TTL expiry (frozen clock)', () => {
    it('accepts consumption just before the 2-minute window closes', async () => {
      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      clock.advanceBy(DEFAULT_TTL_MS - 1);

      const result = await service.validateAndConsume(token);
      expect(result.valid).toBe(true);
    });

    it('rejects consumption after the 2-minute window closes (token_expired)', async () => {
      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      clock.advanceBy(DEFAULT_TTL_MS + 1);

      const result = await service.validateAndConsume(token);
      expect(result).toEqual({ valid: false, error: 'token_expired' });
    });

    it('deletes expired tokens so a retry sees token_not_found', async () => {
      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      clock.advanceBy(DEFAULT_TTL_MS + 1);
      expect((await service.validateAndConsume(token)).error).toBe(
        'token_expired',
      );

      // Expired entry is purged; next attempt is not-found.
      expect((await service.validateAndConsume(token)).error).toBe(
        'token_not_found',
      );
    });

    it('honours MAGIC_LINK_TTL_MS override from config', async () => {
      config = createMockConfig({ MAGIC_LINK_TTL_MS: 10_000 });
      service = new MagicLinkService(config as unknown as ConfigService);

      const url = await service.createMagicLink('user@example.com');
      const token = extractToken(url);

      clock.advanceBy(10_001);

      expect((await service.validateAndConsume(token)).error).toBe(
        'token_expired',
      );
    });
  });

  describe('getTokenCount', () => {
    it('reflects in-memory storage size after create / consume', async () => {
      expect(service.getTokenCount()).toBe(0);

      const url = await service.createMagicLink('user@example.com');
      expect(service.getTokenCount()).toBe(1);

      await service.validateAndConsume(extractToken(url));
      expect(service.getTokenCount()).toBe(0);
    });
  });
});
