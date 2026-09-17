/**
 * CLI wiring for the out-of-process workspace watch host (TASK_2026_437 C9).
 *
 * The CLI counterpart of the Electron app's
 * `electron-workspace-watch-host-factory.ts`: the host bundle path and the
 * adapter's log and degradation sinks, bound to this container. Phase 0
 * registers the adapter before `TOKENS.LOGGER` and `TOKENS.DEGRADATION_REPORTER`
 * exist, so both are looked up behind `isRegistered` when a line or a report
 * is produced.
 *
 * `bundleDir` is the running bundle's `__dirname`. `cli-engine` is bundled into
 * both `main.mjs` and `tui.mjs`, which share `dist/apps/ptah-cli`, so the same
 * expression finds the host for both (D7) — as `register-thoth-libraries.ts`
 * finds `embedder-worker.mjs` and `integrity-worker.mjs`.
 */

import type { DependencyContainer } from 'tsyringe';
import {
  resolveCliWorkspaceWatchHostPath,
  type CliWorkspaceWatcherOptions,
} from '@ptah-extension/platform-cli';
import type {
  WorkspaceWatcherDegradation,
  WorkspaceWatcherDiagnostic,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type DegradationReporter,
  type Logger,
} from '@ptah-extension/vscode-core';

export function createCliWorkspaceWatcherOptions(
  container: DependencyContainer,
  bundleDir: string,
): CliWorkspaceWatcherOptions {
  return {
    hostPath: resolveCliWorkspaceWatchHostPath(bundleDir),
    onDiagnostic: (diagnostic) => logDiagnostic(container, diagnostic),
    onDegraded: (degradation) => reportDegradation(container, degradation),
  };
}

function logDiagnostic(
  container: DependencyContainer,
  { level, message, detail }: WorkspaceWatcherDiagnostic,
): void {
  // No console fallback: stdout carries JSON-RPC and the TUI owns the
  // terminal. Nothing is lost in practice — a diagnostic needs a `watch`, and
  // `setup()` registers the logger synchronously before any consumer runs.
  if (!container.isRegistered(TOKENS.LOGGER)) return;
  const logger = container.resolve<Logger>(TOKENS.LOGGER);
  const context = { ...detail };
  if (level === 'error') logger.error(message, context);
  else if (level === 'warn') logger.warn(message, context);
  else logger.info(message, context);
}

function reportDegradation(
  container: DependencyContainer,
  degradation: WorkspaceWatcherDegradation,
): void {
  if (!container.isRegistered(TOKENS.DEGRADATION_REPORTER)) return;
  container.resolve<DegradationReporter>(TOKENS.DEGRADATION_REPORTER).report({
    source: 'workspace-watcher',
    code: 'cli.workspace-watcher.host-degraded',
    severity: 'degraded',
    summary: `Workspace file watching stopped after ${degradation.failuresInWindow} watch host failures in 10 minutes; changes are picked up by a rescan every ${Math.round(
      degradation.rescanIntervalMs / 1000,
    )} s instead.`,
    detail: degradation.reason,
  });
}
