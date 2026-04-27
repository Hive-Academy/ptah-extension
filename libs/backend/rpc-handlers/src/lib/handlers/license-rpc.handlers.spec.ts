/**
 * LicenseRpcHandlers — unit specs (TASK_2025_294 W2.B1.3).
 *
 * Surface under test: three RPC methods (`license:getStatus`, `license:setKey`,
 * `license:clearKey`) and their shared mapping logic
 * (`mapLicenseStatusToResponse`).
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires all three methods into the mock
 *     RpcHandler — this is the surface the app layer relies on.
 *   - getStatus: successful verify path maps tier/premium/community flags from
 *     `LicenseStatus` correctly. On verify error, the fallback MUST consult
 *     cached status: Community (or missing cache) → Community response,
 *     previously-Pro → expired response. This prevents transient 500s from
 *     locking free-tier users out.
 *   - setKey: rejects missing/non-string keys, rejects bad format, rejects
 *     server verify=false, and on success schedules a delayed reloadWindow()
 *     via `IPlatformCommands`.
 *   - clearKey: calls `licenseService.clearLicenseKey()` and also schedules
 *     reloadWindow().
 *   - reason mapping: backend 'revoked' → frontend 'expired', 'not_found' →
 *     'no_license', 'trial_ended' → 'trial_ended' (TASK_2025_126).
 *
 * Mocking posture:
 *   - Direct constructor injection (no tsyringe container).
 *   - `jest.Mocked<Pick<T, 'method'>>` for narrow surfaces.
 *   - `createMockRpcHandler` from @ptah-extension/vscode-core/testing runs real
 *     register/handleMessage wiring so we can drive methods end-to-end.
 *   - Fake timers for the reload-window scheduling path.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/license-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type {
  Logger,
  LicenseService,
  LicenseStatus,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { IPlatformCommands } from '@ptah-extension/platform-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { LicenseRpcHandlers } from './license-rpc.handlers';

// ---------------------------------------------------------------------------
// Dependency factories
// ---------------------------------------------------------------------------

type MockLicenseService = jest.Mocked<
  Pick<
    LicenseService,
    'verifyLicense' | 'getCachedStatus' | 'setLicenseKey' | 'clearLicenseKey'
  >
>;

function createMockLicenseService(): MockLicenseService {
  return {
    verifyLicense: jest.fn(),
    getCachedStatus: jest.fn(),
    setLicenseKey: jest.fn(),
    clearLicenseKey: jest.fn(),
  };
}

type MockPlatformCommands = jest.Mocked<
  Pick<IPlatformCommands, 'reloadWindow' | 'openTerminal'>
>;

function createMockPlatformCommands(): MockPlatformCommands {
  return {
    reloadWindow: jest.fn(),
    openTerminal: jest.fn(),
  };
}

function makeLicenseStatus(
  overrides: Partial<LicenseStatus> = {},
): LicenseStatus {
  return {
    valid: true,
    tier: 'community',
    ...overrides,
  } as LicenseStatus;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: LicenseRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  licenseService: MockLicenseService;
  platformCommands: MockPlatformCommands;
  sentry: MockSentryService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const licenseService = createMockLicenseService();
  const platformCommands = createMockPlatformCommands();
  const sentry = createMockSentryService();

  const handlers = new LicenseRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    licenseService as unknown as LicenseService,
    platformCommands as unknown as IPlatformCommands,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    licenseService,
    platformCommands,
    sentry,
  };
}

/** Drive an RPC method by name through the MockRpcHandler wiring. */
async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LicenseRpcHandlers', () => {
  describe('register()', () => {
    it('registers all three license RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();
      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        ['license:clearKey', 'license:getStatus', 'license:setKey'].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // license:getStatus
  // -------------------------------------------------------------------------

  describe('license:getStatus', () => {
    it('maps a Community tier license to isCommunity=true, isPremium=false', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockResolvedValue(
        makeLicenseStatus({ valid: true, tier: 'community' }),
      );
      h.handlers.register();

      const result = await call<{
        tier: string;
        isPremium: boolean;
        isCommunity: boolean;
        trialActive: boolean;
      }>(h, 'license:getStatus');

      expect(result.tier).toBe('community');
      expect(result.isPremium).toBe(false);
      expect(result.isCommunity).toBe(true);
      expect(result.trialActive).toBe(false);
    });

    it('maps Pro tier to isPremium=true and forwards plan details', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockResolvedValue(
        makeLicenseStatus({
          valid: true,
          tier: 'pro',
          daysRemaining: 42,
          plan: {
            name: 'Pro',
            description: 'Pro plan',
            features: ['enhanced_prompts'],
            expiresAfterDays: 365,
            isPremium: true,
          },
        }),
      );
      h.handlers.register();

      const result = await call<{
        isPremium: boolean;
        isCommunity: boolean;
        daysRemaining: number | null;
        plan?: { name: string; features: string[] };
      }>(h, 'license:getStatus');

      expect(result.isPremium).toBe(true);
      expect(result.isCommunity).toBe(false);
      expect(result.daysRemaining).toBe(42);
      expect(result.plan?.name).toBe('Pro');
      expect(result.plan?.features).toEqual(['enhanced_prompts']);
    });

    it('maps trial_pro to isPremium=true and trialActive=true', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockResolvedValue(
        makeLicenseStatus({
          tier: 'trial_pro',
          trialDaysRemaining: 5,
        }),
      );
      h.handlers.register();

      const result = await call<{
        isPremium: boolean;
        trialActive: boolean;
        trialDaysRemaining: number | null;
      }>(h, 'license:getStatus');

      expect(result.isPremium).toBe(true);
      expect(result.trialActive).toBe(true);
      expect(result.trialDaysRemaining).toBe(5);
    });

    it.each([
      ['expired', 'expired'],
      ['revoked', 'expired'],
      ['trial_ended', 'trial_ended'],
      ['not_found', 'no_license'],
    ] as const)(
      'maps backend reason "%s" to frontend "%s"',
      async (backendReason, frontendReason) => {
        const h = makeHarness();
        h.licenseService.verifyLicense.mockResolvedValue(
          makeLicenseStatus({
            valid: false,
            tier: 'expired',
            reason: backendReason,
          }),
        );
        h.handlers.register();

        const result = await call<{
          reason?: 'expired' | 'trial_ended' | 'no_license';
        }>(h, 'license:getStatus');

        expect(result.reason).toBe(frontendReason);
      },
    );

    it('forwards user profile data when present', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockResolvedValue(
        makeLicenseStatus({
          user: {
            email: 'user@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
          },
        }),
      );
      h.handlers.register();

      const result = await call<{
        user?: {
          email: string;
          firstName: string | null;
          lastName: string | null;
        };
      }>(h, 'license:getStatus');

      expect(result.user).toEqual({
        email: 'user@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
    });

    it('falls back to Community on verify error with no cached status (free-tier users)', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockRejectedValue(new Error('network'));
      h.licenseService.getCachedStatus.mockReturnValue(null);
      h.handlers.register();

      const result = await call<{
        valid: boolean;
        tier: string;
        isCommunity: boolean;
      }>(h, 'license:getStatus');

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('community');
      expect(result.isCommunity).toBe(true);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('falls back to Community on verify error when cached status was Community', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockRejectedValue(new Error('network'));
      h.licenseService.getCachedStatus.mockReturnValue(
        makeLicenseStatus({ tier: 'community' }),
      );
      h.handlers.register();

      const result = await call<{ tier: string; valid: boolean }>(
        h,
        'license:getStatus',
      );

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(true);
    });

    it('falls back to expired on verify error when cached status was Pro', async () => {
      const h = makeHarness();
      h.licenseService.verifyLicense.mockRejectedValue(new Error('network'));
      h.licenseService.getCachedStatus.mockReturnValue(
        makeLicenseStatus({ tier: 'pro' }),
      );
      h.handlers.register();

      const result = await call<{ tier: string; valid: boolean }>(
        h,
        'license:getStatus',
      );

      expect(result.tier).toBe('expired');
      expect(result.valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // license:setKey
  // -------------------------------------------------------------------------

  describe('license:setKey', () => {
    const VALID_KEY = `ptah_lic_${'a'.repeat(64)}`;

    it('rejects a missing license key', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:setKey',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/required/i);
      expect(h.licenseService.setLicenseKey).not.toHaveBeenCalled();
    });

    it('rejects non-string license keys', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:setKey',
        { licenseKey: 12345 },
      );

      expect(result.success).toBe(false);
      expect(h.licenseService.setLicenseKey).not.toHaveBeenCalled();
    });

    it.each([
      'ptah_lic_', // missing hex tail
      'ptah_lic_Z' + 'a'.repeat(63), // bad hex char
      `ptah_lic_${'a'.repeat(63)}`, // one too short
      `ptah_lic_${'a'.repeat(65)}`, // one too long
      `PTAH_LIC_${'a'.repeat(64)}`, // wrong prefix case
    ])('rejects malformed key "%s"', async (badKey) => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:setKey',
        { licenseKey: badKey },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/format/i);
      expect(h.licenseService.setLicenseKey).not.toHaveBeenCalled();
    });

    it('stores and verifies a well-formed key; schedules reload on success', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        h.licenseService.setLicenseKey.mockResolvedValue(undefined);
        h.licenseService.verifyLicense.mockResolvedValue(
          makeLicenseStatus({
            valid: true,
            tier: 'pro',
            plan: {
              name: 'Pro',
              description: 'Pro plan',
              features: [],
              expiresAfterDays: 365,
              isPremium: true,
            },
          }),
        );
        h.handlers.register();

        const result = await call<{
          success: boolean;
          tier?: string;
          plan?: { name: string };
        }>(h, 'license:setKey', { licenseKey: VALID_KEY });

        expect(result.success).toBe(true);
        expect(result.tier).toBe('pro');
        expect(result.plan?.name).toBe('Pro');
        expect(h.licenseService.setLicenseKey).toHaveBeenCalledWith(VALID_KEY);

        // reloadWindow is deferred 1500ms so the RPC response reaches the UI first
        expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1500);
        expect(h.platformCommands.reloadWindow).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('returns failure with reason-suffix when verify returns valid=false', async () => {
      const h = makeHarness();
      h.licenseService.setLicenseKey.mockResolvedValue(undefined);
      h.licenseService.verifyLicense.mockResolvedValue(
        makeLicenseStatus({
          valid: false,
          tier: 'expired',
          reason: 'revoked',
        }),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:setKey',
        { licenseKey: VALID_KEY },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/verification failed/i);
      expect(result.error).toMatch(/revoked/);
      expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
    });

    it('captures storage exceptions to Sentry and returns error message', async () => {
      const h = makeHarness();
      h.licenseService.setLicenseKey.mockRejectedValue(
        new Error('keychain locked'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:setKey',
        { licenseKey: VALID_KEY },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('keychain locked');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // license:clearKey
  // -------------------------------------------------------------------------

  describe('license:clearKey', () => {
    it('clears the key and schedules a window reload', async () => {
      jest.useFakeTimers();
      try {
        const h = makeHarness();
        h.licenseService.clearLicenseKey.mockResolvedValue(undefined);
        h.handlers.register();

        const result = await call<{ success: boolean }>(h, 'license:clearKey');

        expect(result.success).toBe(true);
        expect(h.licenseService.clearLicenseKey).toHaveBeenCalledTimes(1);

        expect(h.platformCommands.reloadWindow).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1500);
        expect(h.platformCommands.reloadWindow).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('captures clear failures to Sentry and returns error', async () => {
      const h = makeHarness();
      h.licenseService.clearLicenseKey.mockRejectedValue(new Error('kaboom'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'license:clearKey',
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('kaboom');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
