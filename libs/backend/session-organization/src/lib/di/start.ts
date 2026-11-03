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
import type { InjectionToken } from 'tsyringe';
import { SessionOrganizationCaptureService } from '../session-organization-capture.service';
import { SessionAutoLinkService } from '../session-auto-link.service';
import { SessionTodoProgressService } from '../session-todo-progress.service';

const LOG_PREFIX = '[SessionOrganization]';

/** Returned whenever there is nothing to release. */
const NOOP_DISPOSABLE: IDisposable = { dispose: () => undefined };

/** A host-wide subscriber this entry point starts. */
interface Startable {
  start(): void;
  dispose(): void;
}

/** Started in this order, disposed in reverse. */
const PARTS: ReadonlyArray<{
  name: string;
  token: InjectionToken<Startable>;
}> = [
  { name: 'capture', token: SessionOrganizationCaptureService },
  { name: 'auto-link', token: SessionAutoLinkService },
  { name: 'todo progress', token: SessionTodoProgressService },
];

/**
 * Start the host-wide subscriptions: capture, then auto-link, then todo
 * progress. A part that is not registered or fails to start is reported in
 * one line; the others still start.
 *
 * @returns a disposable that releases the started parts in reverse order.
 *   Hosts may ignore it — the subscriptions are host-lifetime by design.
 */
export function startSessionOrganization(
  container: DependencyContainer,
): IDisposable {
  const started: Array<{ name: string; part: Startable }> = [];
  for (const { name, token } of PARTS) {
    if (!container.isRegistered(token, true)) {
      report(
        container,
        `${name} not started: its service is not registered in this container`,
      );
      continue;
    }
    try {
      const part = container.resolve(token);
      part.start();
      started.push({ name, part });
    } catch (error: unknown) {
      report(container, `${name} not started (non-fatal): ${describe(error)}`);
    }
  }
  if (started.length === 0) return NOOP_DISPOSABLE;
  return { dispose: () => disposeAll(container, started) };
}

/** Release in reverse start order; a failure is reported, never thrown. */
function disposeAll(
  container: DependencyContainer,
  started: ReadonlyArray<{ name: string; part: Startable }>,
): void {
  for (const { name, part } of [...started].reverse()) {
    try {
      part.dispose();
    } catch (error: unknown) {
      report(container, `${name} dispose failed (non-fatal): ${describe(error)}`);
    }
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
