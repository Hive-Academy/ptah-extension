/**
 * License Reactivity Binder
 *
 * Wires LicenseService events to premium subsystem bring-up / tear-down so
 * that when the user activates a pro/trial_pro license mid-session the MCP
 * server, CLI syncs, and FeatureGateService cache are refreshed without
 * requiring an app restart.
 *
 * Usage:
 *   const binder = bindLicenseReactivity({ container, logger, ... });
 *   // on app quit:
 *   binder.dispose();
 */

import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '../../logging';
import { TOKENS } from '../../di/tokens';
import type { LicenseService, LicenseStatus } from '../license.service';
import {
  bringUpPremiumSubsystems,
  tearDownPremiumSubsystems,
} from './premium-subsystems';

export interface LicenseReactivityOptions {
  container: DependencyContainer;
  logger: Logger;
  /**
   * Called after MCP starts (with port) or stops (with null).
   */
  onMcpPortChange?: (port: number | null) => void;
  /**
   * Optional toast/notification callback invoked after a successful transition.
   */
  notify?: (kind: 'verified' | 'expired') => void;
  /**
   * App-provided CLI skill sync callback (fire-and-forget).
   * If omitted, CLI skill sync is skipped during bring-up.
   */
  syncCliSkills?: () => void;
  /**
   * App-provided CLI agent sync callback (fire-and-forget).
   * If omitted, CLI agent sync is skipped during bring-up.
   */
  syncCliAgents?: () => void;
}

/**
 * Bind license events to premium subsystem lifecycle.
 *
 * - Subscribes to `license:verified` → bringUpPremiumSubsystems
 * - Subscribes to `license:expired`  → tearDownPremiumSubsystems
 * - Performs an **initial dispatch** at bind time based on current license
 *   state so the stale-snapshot problem is eliminated on app startup.
 *
 * Returns a disposable. The caller MUST call `.dispose()` on app quit / extension
 * deactivate to prevent listener leaks.
 */
export function bindLicenseReactivity(opts: LicenseReactivityOptions): {
  dispose: () => void;
} {
  const { container, logger } = opts;

  const deps = {
    container: opts.container,
    logger: opts.logger,
    onMcpPortChange: opts.onMcpPortChange,
    notify: opts.notify,
    syncCliSkills: opts.syncCliSkills,
    syncCliAgents: opts.syncCliAgents,
  };

  let licenseService: LicenseService;
  try {
    licenseService = container.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);
  } catch (resolveError: unknown) {
    logger.warn(
      '[LicenseReactivityBinder] Could not resolve LicenseService — binder is a no-op',
      {
        error:
          resolveError instanceof Error
            ? resolveError.message
            : String(resolveError),
      },
    );
    return { dispose: () => undefined };
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  const onVerified = (_status: LicenseStatus): void => {
    logger.info(
      '[LicenseReactivityBinder] license:verified — bringing up premium subsystems',
    );
    bringUpPremiumSubsystems(deps).catch((err: unknown) => {
      logger.warn(
        '[LicenseReactivityBinder] bringUpPremiumSubsystems threw (non-fatal)',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
  };

  const onExpired = (_status: LicenseStatus): void => {
    logger.info(
      '[LicenseReactivityBinder] license:expired — tearing down premium subsystems',
    );
    tearDownPremiumSubsystems(deps).catch((err: unknown) => {
      logger.warn(
        '[LicenseReactivityBinder] tearDownPremiumSubsystems threw (non-fatal)',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    });
  };

  licenseService.on('license:verified', onVerified);
  licenseService.on('license:expired', onExpired);

  // -------------------------------------------------------------------------
  // Initial dispatch — eliminates the stale-snapshot race at startup.
  // -------------------------------------------------------------------------
  // Perform verification asynchronously so we don't block the caller. Wrap in
  // try/catch so a verification failure at startup never crashes activation.
  (async () => {
    try {
      const status = await licenseService.verifyLicense();
      const isPremium =
        status.valid &&
        (status.tier === 'pro' ||
          status.tier === 'trial_pro' ||
          status.plan?.isPremium === true);

      if (isPremium) {
        logger.debug(
          '[LicenseReactivityBinder] Initial state: premium — bringing up subsystems',
        );
        await bringUpPremiumSubsystems(deps);
      } else {
        logger.debug(
          '[LicenseReactivityBinder] Initial state: non-premium — tearing down subsystems',
        );
        await tearDownPremiumSubsystems(deps);
      }
    } catch (err: unknown) {
      logger.warn(
        '[LicenseReactivityBinder] Initial license dispatch failed (non-fatal)',
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  })();

  // -------------------------------------------------------------------------
  // Disposable
  // -------------------------------------------------------------------------
  return {
    dispose: () => {
      try {
        licenseService.off('license:verified', onVerified);
        licenseService.off('license:expired', onExpired);
        logger.debug(
          '[LicenseReactivityBinder] License event listeners removed',
        );
      } catch (disposeError: unknown) {
        // Non-fatal — process is shutting down anyway
        logger.warn('[LicenseReactivityBinder] dispose error (non-fatal)', {
          error:
            disposeError instanceof Error
              ? disposeError.message
              : String(disposeError),
        });
      }
    },
  };
}
