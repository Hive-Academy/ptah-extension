/**
 * In-process watch host — the `PTAH_WATCH_HOST=0` field-recovery hatch
 * (TASK_2026_437 C8, implementation-plan "Failure and rollback").
 *
 * Runs the same `WorkspaceWatchHostCore` inside the calling process and speaks
 * the same message protocol, so `ElectronWorkspaceWatcher` supervises it
 * exactly like a forked host: heartbeats, restarts, budget, degradation.
 * Messages cross on `setImmediate` in both directions, so nothing is delivered
 * synchronously and the Zod validation on each side still runs.
 *
 * What it gives up is the point of the host: per-event work runs on the
 * calling thread. It exists for users whose packaged app cannot load the host
 * bundle (assumption A2 faults), and is deleted once one release ships with no
 * host-load degradations — see the flag site in the app factory.
 */

import {
  bootWorkspaceWatchHost,
  workspaceWatchListDirectoryFor,
  type WorkspaceWatchEngine,
  type WorkspaceWatchHostCore,
  type WorkspaceWatchHostForker,
  type WorkspaceWatchHostProcess,
} from '@ptah-extension/platform-core';

import { loadParcelWatcherEngine } from './parcel-watcher-engine';

export interface InProcessWorkspaceWatchHostOptions {
  /** Defaults to {@link loadParcelWatcherEngine}. */
  readonly loadEngine?: () => WorkspaceWatchEngine;
  /** Storm breaker tunables source. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

class InProcessWorkspaceWatchHostProcess implements WorkspaceWatchHostProcess {
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];
  private readonly core: WorkspaceWatchHostCore | undefined;
  private killed = false;

  constructor(options: InProcessWorkspaceWatchHostOptions) {
    // An engine that cannot load posts `fatal`, which the adapter reads as a
    // host failure: restart, then degrade.
    this.core = bootWorkspaceWatchHost({
      post: (message) => setImmediate(() => this.emit(message)),
      loadEngine: options.loadEngine ?? loadParcelWatcherEngine,
      env: options.env ?? process.env,
      listDirectory: workspaceWatchListDirectoryFor(process.platform),
    });
  }

  postMessage(message: unknown): void {
    if (this.killed) return;
    const core = this.core;
    setImmediate(() => {
      if (!this.killed) core?.handleMessage(message);
    });
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  on(
    event: 'message' | 'exit',
    listener: ((message: unknown) => void) | ((code: number | null) => void),
  ): void {
    if (event === 'message') {
      this.messageListeners.push(listener as (message: unknown) => void);
    } else {
      this.exitListeners.push(listener as (code: number | null) => void);
    }
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    void this.core?.dispose();
    setImmediate(() => {
      for (const listener of this.exitListeners) listener(null);
    });
  }

  private emit(message: unknown): void {
    if (this.killed) return;
    for (const listener of this.messageListeners) listener(message);
  }
}

/** A forker whose hosts run in the calling process. */
export function createInProcessWorkspaceWatchHostForker(
  options: InProcessWorkspaceWatchHostOptions = {},
): WorkspaceWatchHostForker {
  return { fork: () => new InProcessWorkspaceWatchHostProcess(options) };
}
