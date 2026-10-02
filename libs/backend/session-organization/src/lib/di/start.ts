/**
 * Host-activation entry point for session organization capture.
 *
 * Same guarantees as `task-specs/src/lib/di/start-index.ts`:
 *  1. **Never abort activation.** Every failure — the lib was not registered
 *     (no SQLite connection), a dependency does not resolve, or a
 *     subscription throws — is swallowed into ONE `IOutputChannel` line. A
 *     host without organization storage degrades to "no capture", never to
 *     "the extension failed to activate".
 *  2. **Never block startup.** `start()` only subscribes host-wide; nothing is
 *     awaited.
 *
 * The capture handlers drop events while the connection is not open yet
 * (lane L8) and defer deletes until it opens, so this may run before
 * `openAndMigrate`.
 */
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IDisposable,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import { SessionOrganizationCaptureService } from '../session-organization-capture.service';

const LOG_PREFIX = '[SessionOrganization]';

/** Returned whenever there is nothing to release. */
const NOOP_DISPOSABLE: IDisposable = { dispose: () => undefined };

/**
 * Start the host-wide capture subscriptions.
 *
 * @returns a disposable that releases them. Hosts may ignore it — the
 *   subscriptions are host-lifetime by design.
 */
export function startSessionOrganization(
  container: DependencyContainer,
): IDisposable {
  if (!container.isRegistered(SessionOrganizationCaptureService, true)) {
    report(
      container,
      'capture not started: the capture service is not registered in this container',
    );
    return NOOP_DISPOSABLE;
  }
  try {
    const capture = container.resolve(SessionOrganizationCaptureService);
    capture.start();
    return { dispose: () => disposeCapture(container, capture) };
  } catch (error: unknown) {
    report(container, `capture not started (non-fatal): ${describe(error)}`);
    return NOOP_DISPOSABLE;
  }
}

/** Release the subscriptions; a failure is reported, never thrown into host shutdown. */
function disposeCapture(
  container: DependencyContainer,
  capture: SessionOrganizationCaptureService,
): void {
  try {
    capture.dispose();
  } catch (error: unknown) {
    report(container, `capture dispose failed (non-fatal): ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write one line to the output channel, if the host has one. Never throws. */
function report(container: DependencyContainer, message: string): void {
  if (!container.isRegistered(PLATFORM_TOKENS.OUTPUT_CHANNEL, true)) return;
  try {
    container
      .resolve<IOutputChannel>(PLATFORM_TOKENS.OUTPUT_CHANNEL)
      .appendLine(`${LOG_PREFIX} ${message}`);
  } catch {
    // degradation-audit: optional-capability - this is the failure reporter
    // itself; with no working output channel there is nowhere left to report
    // to, and start must never abort host activation.
  }
}
