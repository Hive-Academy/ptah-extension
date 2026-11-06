import { TOKENS, type Logger, type SentryService } from '@ptah-extension/vscode-core';
import { reportBootFailure, type BootProcessEvents } from './boot-trace';

/** The slice of the tsyringe container the guard needs. */
export interface GuardServiceSource {
  isRegistered(token: symbol): boolean;
  resolve<T>(token: symbol): T;
}

/**
 * Install the post-boot guard from the boot container. Runs after the boot
 * handlers are gone, so it must never throw: a throw here would itself become
 * the native modal this guard exists to prevent.
 */
export function installMainProcessErrorGuardFrom(
  container: GuardServiceSource | null,
  events: BootProcessEvents = process,
): (() => void) | null {
  try {
    if (
      container === null ||
      !container.isRegistered(TOKENS.LOGGER) ||
      !container.isRegistered(TOKENS.SENTRY_SERVICE)
    ) {
      reportBootFailure(
        'Post-boot error guard not installed',
        new Error('Logger or SentryService is not registered'),
      );
      return null;
    }
    return installMainProcessErrorGuard(
      container.resolve<Logger>(TOKENS.LOGGER),
      container.resolve<SentryService>(TOKENS.SENTRY_SERVICE),
      events,
    );
  } catch (error: unknown) {
    // degradation-audit: reported - written to stderr; a throw here would raise the native modal.
    reportBootFailure('Post-boot error guard install failed', error);
    return null;
  }
}

/** Keep recoverable errors visible without Electron's blocking native dialog. */
export function installMainProcessErrorGuard(
  logger: Pick<Logger, 'error'>,
  sentry: Pick<SentryService, 'captureException'>,
  events: BootProcessEvents = process,
): () => void {
  const report = (kind: string, value: unknown): void => {
    const error = value instanceof Error ? value : new Error(String(value));
    try {
      logger.error(`[Ptah Electron] ${kind} after boot`, error);
    } catch (logError: unknown) {
      reportBootFailure('Post-boot error logging failed', logError);
      reportBootFailure(kind, error);
    }
    try {
      sentry.captureException(error, { errorSource: `electron-main-${kind}` });
    } catch (captureError: unknown) {
      reportBootFailure('Post-boot Sentry capture failed', captureError);
    }
  };
  const onException = (error: unknown): void => report('uncaughtException', error);
  const onRejection = (reason: unknown): void => report('unhandledRejection', reason);
  events.on('uncaughtException', onException);
  events.on('unhandledRejection', onRejection);
  return () => {
    events.off('uncaughtException', onException);
    events.off('unhandledRejection', onRejection);
  };
}
