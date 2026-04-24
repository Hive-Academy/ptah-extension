/**
 * CliStrategy — unit specs.
 *
 * The CLI strategy delegates entirely to `ClaudeCliDetector.performHealthCheck()`
 * and NEVER writes any auth env var. Tests cover:
 *   - Happy path: CLI available → configured=true with version/path details.
 *   - Auth-required negative path: CLI not available → configured=false with
 *     the documented install hint.
 *   - Tier env vars are cleared on success (native CLI handles tiers itself).
 *   - teardown() is a no-op.
 *
 * No retry / expiry logic exists in source — we do not invent any.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/auth/strategies/cli.strategy.ts`
 */

import 'reflect-metadata';

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { AuthEnv, ClaudeCliHealth } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { createMockSentryService } from '@ptah-extension/vscode-core/testing';

import { CliStrategy } from './cli.strategy';
import type { AuthConfigureContext } from '../auth-strategy.types';
import type { ClaudeCliDetector } from '../../detector/claude-cli-detector';
import type { ProviderModelsService } from '../../provider-models.service';

/**
 * Build a complete ClaudeCliHealth fixture — the interface requires
 * `platform` and `isWSL` in addition to the discriminated `available` flag.
 */
function makeHealth(overrides: Partial<ClaudeCliHealth> = {}): ClaudeCliHealth {
  return {
    available: false,
    platform: 'linux',
    isWSL: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/**
 * We only need `performHealthCheck` from the detector; keep the surface tight
 * so the spec documents exactly what it relies on.
 */
type DetectorSurface = Pick<ClaudeCliDetector, 'performHealthCheck'>;

function createMockDetector(
  health: ClaudeCliHealth,
): jest.Mocked<DetectorSurface> {
  return {
    performHealthCheck: jest
      .fn<Promise<ClaudeCliHealth>, []>()
      .mockResolvedValue(health),
  };
}

type ProviderModelsSurface = Pick<ProviderModelsService, 'clearAllTierEnvVars'>;

function createMockProviderModels(): jest.Mocked<ProviderModelsSurface> {
  return { clearAllTierEnvVars: jest.fn<void, []>() };
}

function makeContext(): AuthConfigureContext {
  const authEnv: AuthEnv = {};
  return { providerId: 'anthropic', authEnv };
}

interface Harness {
  strategy: CliStrategy;
  logger: MockLogger;
  detector: jest.Mocked<DetectorSurface>;
  providerModels: jest.Mocked<ProviderModelsSurface>;
}

function makeStrategy(health: ClaudeCliHealth): Harness {
  const logger = createMockLogger();
  const detector = createMockDetector(health);
  const providerModels = createMockProviderModels();
  const sentry = createMockSentryService();

  const strategy = new CliStrategy(
    asLogger(logger),
    detector as unknown as ClaudeCliDetector,
    providerModels as unknown as ProviderModelsService,
    sentry as unknown as SentryService,
  );

  return { strategy, logger, detector, providerModels };
}

describe('CliStrategy', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the documented strategy name', () => {
    const { strategy } = makeStrategy(makeHealth({ available: true }));
    expect(strategy.name).toBe('CliStrategy');
  });

  describe('configure() — happy path', () => {
    it('returns configured=true with CLI version and path when CLI is available', async () => {
      const { strategy, detector } = makeStrategy(
        makeHealth({
          available: true,
          path: '/usr/local/bin/claude',
          version: '1.2.3',
        }),
      );

      const result = await strategy.configure(makeContext());

      expect(detector.performHealthCheck).toHaveBeenCalledTimes(1);
      expect(result.configured).toBe(true);
      expect(result.details).toEqual([
        'Claude CLI v1.2.3 (credentials managed by CLI at /usr/local/bin/claude)',
      ]);
      expect(result.errorMessage).toBeUndefined();
    });

    it('clears tier env vars on success so the CLI resolves its own defaults', async () => {
      const { strategy, providerModels } = makeStrategy(
        makeHealth({
          available: true,
          path: '/usr/local/bin/claude',
          version: '1.2.3',
        }),
      );

      await strategy.configure(makeContext());

      expect(providerModels.clearAllTierEnvVars).toHaveBeenCalledTimes(1);
    });

    it('does NOT mutate the shared AuthEnv — the CLI owns credentials', async () => {
      const { strategy } = makeStrategy(
        makeHealth({
          available: true,
          path: '/usr/local/bin/claude',
          version: '1.2.3',
        }),
      );

      const ctx = makeContext();
      await strategy.configure(ctx);

      expect(ctx.authEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(ctx.authEnv.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(ctx.authEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });

    it("falls back to 'unknown' in the detail string when version is missing", async () => {
      const { strategy } = makeStrategy(
        makeHealth({
          available: true,
          path: '/usr/local/bin/claude',
        }),
      );

      const result = await strategy.configure(makeContext());

      // Source embeds `v${version ?? 'unknown'}` → "vunknown".
      expect(result.details[0]).toMatch(/Claude CLI vunknown/);
    });
  });

  describe('configure() — auth required (negative path)', () => {
    it('returns configured=false with the npm install hint when CLI is missing', async () => {
      const { strategy, providerModels } = makeStrategy(
        makeHealth({
          available: false,
          error: 'claude binary not on PATH',
        }),
      );

      const result = await strategy.configure(makeContext());

      expect(result.configured).toBe(false);
      expect(result.details).toEqual([]);
      expect(result.errorMessage).toBe(
        'Claude CLI is not installed. Install it with: npm install -g @anthropic-ai/claude-code',
      );
      // Tier env vars only get cleared on success — not on failure.
      expect(providerModels.clearAllTierEnvVars).not.toHaveBeenCalled();
    });

    it("uses 'not installed' in the warning log when detector returns no error string", async () => {
      const { strategy, logger } = makeStrategy(
        makeHealth({ available: false }),
      );

      await strategy.configure(makeContext());

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not installed'),
      );
    });
  });

  describe('teardown()', () => {
    it('resolves without touching the detector or tier env vars', async () => {
      const { strategy, detector, providerModels } = makeStrategy(
        makeHealth({
          available: true,
          path: '/usr/local/bin/claude',
          version: '1.2.3',
        }),
      );

      await expect(strategy.teardown()).resolves.toBeUndefined();

      expect(detector.performHealthCheck).not.toHaveBeenCalled();
      expect(providerModels.clearAllTierEnvVars).not.toHaveBeenCalled();
    });
  });
});
