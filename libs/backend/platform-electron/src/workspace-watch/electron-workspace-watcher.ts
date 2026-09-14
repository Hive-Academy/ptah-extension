/**
 * `ElectronWorkspaceWatcher` — `IWorkspaceWatcher` for the Electron host
 * (TASK_2026_437 C8, INV-1, AC-7).
 *
 * Recursive watching runs in ONE supervised watch host
 * (`workspace-watch-host.mjs` in an Electron `utilityProcess`). Supervision —
 * lazy fork, heartbeat watchdog, restart budget, degraded rescans and recovery,
 * per-subscription pacing and containment — is `WorkspaceWatchSupervisor`
 * (platform-core), shared with `CliWorkspaceWatcher`. This facade keeps the
 * class name the Electron app registers and binds nothing else.
 *
 * No `electron` import. The host process arrives through the injected
 * {@link WorkspaceWatchHostForker} (the app's `ElectronUtilityWorkerProcess`
 * wrapper, or the `PTAH_WATCH_HOST=0` in-process hatch), per this lib's
 * "inject API shims" guideline.
 */

import {
  WorkspaceWatchSupervisor,
  type IDisposable,
  type IWorkspaceWatcher,
  type WorkspaceChangeListener,
  type WorkspaceWatchOptions,
  type WorkspaceWatchSupervisorOptions,
} from '@ptah-extension/platform-core';

export type ElectronWorkspaceWatcherOptions = WorkspaceWatchSupervisorOptions;

export class ElectronWorkspaceWatcher implements IWorkspaceWatcher {
  private readonly supervisor: WorkspaceWatchSupervisor;

  constructor(options: ElectronWorkspaceWatcherOptions) {
    this.supervisor = new WorkspaceWatchSupervisor(options);
  }

  /** True once the restart budget is spent, until a recovery host is confirmed. */
  get isDegraded(): boolean {
    return this.supervisor.isDegraded;
  }

  watch(
    root: string,
    options: WorkspaceWatchOptions,
    listener: WorkspaceChangeListener,
  ): IDisposable {
    return this.supervisor.watch(root, options, listener);
  }

  /** Stops the host and every subscription. Idempotent. */
  dispose(): void {
    this.supervisor.dispose();
  }
}
