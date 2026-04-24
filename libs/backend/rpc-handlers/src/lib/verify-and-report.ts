/**
 * Shared RPC verification + Sentry drift reporting helper (TASK_2025_291 Wave C4b).
 *
 * Collapses the ~35-line verification / Sentry / dev-assertion block that was
 * duplicated across the three app-level RPC registration services (VS Code,
 * Electron, TUI) into a single helper. Platform is surfaced in the Sentry
 * payload so dashboard filters still work.
 */

import type { DependencyContainer, InjectionToken } from 'tsyringe';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  verifyRpcRegistration,
  assertRpcRegistration,
} from '@ptah-extension/vscode-core';

/** Minimal shape of SentryService surfaced here — avoids a direct type import cycle. */
interface SentryServiceLike {
  captureException(
    error: Error,
    context: { errorSource: string; extra?: Record<string, unknown> },
  ): void;
}

export type RpcRegistrationPlatform = 'vscode' | 'electron' | 'tui';

export interface VerifyAndReportRpcRegistrationOptions {
  /** The `RpcHandler` that owns the registered methods. */
  readonly rpcHandler: RpcHandler;
  /** App logger for error / drift reporting. */
  readonly logger: Logger;
  /** tsyringe container used to lazy-resolve Sentry (if registered). */
  readonly container: DependencyContainer;
  /** Sentry DI token (typed as tsyringe `InjectionToken<SentryService>`). */
  readonly sentryToken: InjectionToken<SentryServiceLike>;
  /** Platform label — surfaces on the Sentry event for dashboard filtering. */
  readonly platform: RpcRegistrationPlatform;
  /**
   * Methods excluded from the verification (methods that belong to another
   * platform — e.g. VS Code excludes Electron-only editor/file/workspace
   * methods; TUI excludes harness/git/terminal/etc.).
   */
  readonly excluded?: readonly string[];
  /**
   * When true (VS Code + Electron) and `NODE_ENV === 'development'`, call
   * `assertRpcRegistration` after reporting so registration drift throws
   * before the webview mounts. TUI passes `false` to keep boot permissive.
   * Defaults to `true`.
   */
  readonly assertInDevelopment?: boolean;
}

/**
 * Run `verifyRpcRegistration`, report drift to Sentry (if registered), and
 * optionally assert in development. Safe to call unconditionally — all error
 * paths swallow exceptions so registration drift never breaks activation.
 */
export function verifyAndReportRpcRegistration(
  options: VerifyAndReportRpcRegistrationOptions,
): void {
  const {
    rpcHandler,
    logger,
    container,
    sentryToken,
    platform,
    excluded,
    assertInDevelopment = true,
  } = options;

  const excludeList = excluded ? Array.from(excluded) : undefined;

  const verificationResult = verifyRpcRegistration(
    rpcHandler,
    logger,
    excludeList,
  );

  if (!verificationResult.valid) {
    const driftError = new Error(
      `Missing: ${verificationResult.missingHandlers.join(', ')}. ` +
        `Add handlers or remove from RpcMethodRegistry.`,
    );
    logger.error(
      `RPC registration incomplete: ${verificationResult.missingHandlers.length} methods missing`,
      driftError,
    );
    reportDriftToSentry(
      container,
      sentryToken,
      driftError,
      verificationResult.missingHandlers,
      platform,
    );
  }

  if (assertInDevelopment && process.env['NODE_ENV'] === 'development') {
    assertRpcRegistration(rpcHandler, logger, excludeList);
  }
}

/**
 * Lazy-resolve Sentry from the container and forward a drift event.
 * No-op when Sentry is not registered (tests, CI) or reporting throws
 * (never let observability break activation).
 */
function reportDriftToSentry(
  container: DependencyContainer,
  sentryToken: InjectionToken<SentryServiceLike>,
  error: Error,
  missingMethods: readonly string[],
  platform: RpcRegistrationPlatform,
): void {
  try {
    if (!container.isRegistered(sentryToken)) return;
    const sentry = container.resolve<SentryServiceLike>(sentryToken);
    sentry.captureException(error, {
      errorSource: 'rpc-registration-drift',
      extra: { missingMethods: Array.from(missingMethods), platform },
    });
  } catch {
    // Never let Sentry reporting break activation.
  }
}
