/**
 * Electron wiring for the out-of-main workspace watch host (TASK_2026_437 C8).
 *
 * - {@link ElectronWorkspaceWatchHostFactory} forks the bundled
 *   `workspace-watch-host.mjs` as a `utilityProcess` through the same
 *   `ElectronUtilityWorkerProcess` the integrity, embedder and voice workers
 *   use. `ElectronWorkspaceWatcher` (platform-electron) supervises it.
 * - {@link resolveWorkspaceWatchHostPath} puts the bundle beside `main.mjs`,
 *   derived from `__dirname` exactly as `phase-2-libraries.ts` derives
 *   `integrity-worker.mjs`. The `build-workspace-watch-host` target produces it.
 * - {@link createElectronWorkspaceWatcherOptions} picks the host (see the
 *   `PTAH_WATCH_HOST` flag below) and binds the adapter's log and degradation
 *   sinks to this container, resolved per call because phase 0 registers the
 *   adapter before either service exists.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import type { DependencyContainer } from 'tsyringe';

import type {
  WorkspaceWatchHostForker,
  WorkspaceWatchHostProcess,
  WorkspaceWatcherDegradation,
  WorkspaceWatcherDiagnostic,
} from '@ptah-extension/platform-core';
import {
  createInProcessWorkspaceWatchHostForker,
  type ElectronWorkspaceWatcherOptions,
} from '@ptah-extension/platform-electron';
import {
  TOKENS,
  type DegradationReporter,
  type Logger,
} from '@ptah-extension/vscode-core';

import { ElectronUtilityWorkerProcess } from './electron-utility-worker-process';

/** The bundle `build-workspace-watch-host` writes next to `main.mjs`. */
export const WORKSPACE_WATCH_HOST_BUNDLE = 'workspace-watch-host.mjs';

/** The label Electron shows for the host process. */
export const WORKSPACE_WATCH_HOST_SERVICE_NAME = 'ptah-workspace-watch-host';

/**
 * `<dir of main.mjs>/workspace-watch-host.mjs`, falling back to `~/.ptah` when
 * no `__dirname` is defined — the integrity worker's resolution, unchanged.
 */
export function resolveWorkspaceWatchHostPath(
  dirname: string | undefined = (globalThis as { __dirname?: string })
    .__dirname,
): string {
  return path.join(
    dirname ?? path.join(os.homedir(), '.ptah'),
    WORKSPACE_WATCH_HOST_BUNDLE,
  );
}

export class ElectronWorkspaceWatchHostFactory implements WorkspaceWatchHostForker {
  constructor(private readonly hostPath: string) {}

  fork(): WorkspaceWatchHostProcess {
    return ElectronUtilityWorkerProcess.fork(
      this.hostPath,
      WORKSPACE_WATCH_HOST_SERVICE_NAME,
    );
  }
}

/**
 * Chooses where the watch host runs.
 *
 * `PTAH_WATCH_HOST=0` — FIELD-RECOVERY HATCH, not a feature flag. It runs the
 * same host core over `@parcel/watcher` inside the main process, giving up the
 * isolation the host exists for. Consumer: Electron users whose packaged app
 * cannot load `workspace-watch-host.mjs` or its native binding from
 * `app.asar.unpacked` (assumption A2 faults). Delete this branch, and
 * `createInProcessWorkspaceWatchHostForker` with it, once one release has
 * shipped with no `electron.workspace-watcher.host-degraded` reports.
 *
 * Selecting the hatch writes one info line, so every session it is active
 * shows it in the startup log — a flag left set after the fault is fixed is
 * otherwise invisible.
 */
export function selectWorkspaceWatchHostForker(
  env: Readonly<Record<string, string | undefined>>,
  hostPath: string,
  onDiagnostic?: (diagnostic: WorkspaceWatcherDiagnostic) => void,
): WorkspaceWatchHostForker {
  if (env['PTAH_WATCH_HOST'] === '0') {
    onDiagnostic?.({
      level: 'info',
      message:
        '[WorkspaceWatcher] PTAH_WATCH_HOST=0: watch host runs in the main process (field-recovery hatch; unset it once the packaged host loads)',
    });
    return createInProcessWorkspaceWatchHostForker({ env });
  }
  return new ElectronWorkspaceWatchHostFactory(hostPath);
}

/**
 * The adapter options phase 0 hands to `registerPlatformElectronServices`.
 *
 * `TOKENS.LOGGER` is registered a few lines after the platform services and
 * `TOKENS.DEGRADATION_REPORTER` in phase 1, so both are looked up behind
 * `isRegistered` at the moment a line or a report is produced. A sink that is
 * not there yet falls back to the console for the log and is skipped for the
 * report.
 */
export function createElectronWorkspaceWatcherOptions(
  container: DependencyContainer,
  env: Readonly<Record<string, string | undefined>> = process.env,
  hostPath: string = resolveWorkspaceWatchHostPath(),
): ElectronWorkspaceWatcherOptions {
  const onDiagnostic = (diagnostic: WorkspaceWatcherDiagnostic) =>
    logDiagnostic(container, diagnostic);
  return {
    host: selectWorkspaceWatchHostForker(env, hostPath, onDiagnostic),
    onDiagnostic,
    onDegraded: (degradation) => reportDegradation(container, degradation),
  };
}

function logDiagnostic(
  container: DependencyContainer,
  { level, message, detail }: WorkspaceWatcherDiagnostic,
): void {
  if (container.isRegistered(TOKENS.LOGGER)) {
    const logger = container.resolve<Logger>(TOKENS.LOGGER);
    const context = { ...detail };
    if (level === 'error') logger.error(message, context);
    else if (level === 'warn') logger.warn(message, context);
    else logger.info(message, context);
    return;
  }
  const write =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log;
  write(message, detail ?? '');
}

function reportDegradation(
  container: DependencyContainer,
  degradation: WorkspaceWatcherDegradation,
): void {
  if (!container.isRegistered(TOKENS.DEGRADATION_REPORTER)) return;
  container.resolve<DegradationReporter>(TOKENS.DEGRADATION_REPORTER).report({
    source: 'workspace-watcher',
    code: 'electron.workspace-watcher.host-degraded',
    severity: 'degraded',
    summary: `Workspace file watching stopped after ${degradation.failuresInWindow} watch host failures in 10 minutes; changes are picked up by a rescan every ${Math.round(
      degradation.rescanIntervalMs / 1000,
    )} s instead.`,
    detail: degradation.reason,
  });
}
