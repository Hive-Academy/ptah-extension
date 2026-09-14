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
  WorkspaceWatchHostCore,
  readEventStormBreakerOptionsFromEnv,
  type WorkspaceWatchEngine,
} from '@ptah-extension/platform-core';

import type {
  WorkspaceWatchHostForker,
  WorkspaceWatchHostProcess,
} from './electron-workspace-watcher';
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
    let engine: WorkspaceWatchEngine | undefined;
    let loadError: string | undefined;
    try {
      engine = (options.loadEngine ?? loadParcelWatcherEngine)();
    } catch (error: unknown) {
      loadError = error instanceof Error ? error.message : String(error);
    }

    if (engine === undefined) {
      // The adapter reads `fatal` as a host failure: restart, then degrade.
      const message = `watch engine failed to load: ${loadError ?? 'unknown'}`;
      setImmediate(() => this.emit({ type: 'fatal', message }));
      this.core = undefined;
      return;
    }

    this.core = new WorkspaceWatchHostCore({
      engine,
      post: (message) => setImmediate(() => this.emit(message)),
      stormBreakerOptions: readEventStormBreakerOptionsFromEnv(
        options.env ?? process.env,
      ),
    });
    this.core.start();
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
