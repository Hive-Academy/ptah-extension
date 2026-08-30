/**
 * `armDiagnostics` — the one call each host makes to turn instrumentation on.
 *
 * Three hosts (Electron main, the VS Code extension host, the headless CLI)
 * need the identical four steps: resolve the monitor, resolve the capture,
 * point the capture at the host's log directory, join them so lag can trigger
 * a profile, and start sampling. Putting that sequence in each host would be
 * three chances to wire it subtly differently — and the failure mode of a
 * mis-wired diagnostic is silence, which reads exactly like "no problem
 * found".
 *
 * The whole thing is failure-tolerant by construction. Instrumentation added
 * to diagnose a hang must never itself become a reason the app will not start,
 * so a resolution failure downgrades to a no-op handle and a warning.
 */

import type { DependencyContainer } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import {
  EventLoopMonitor,
  type EventLoopLagListener,
  type EventLoopMonitorOptions,
} from './event-loop-monitor';
import { CpuProfileCapture } from './cpu-profile-capture';

export interface ArmDiagnosticsOptions extends EventLoopMonitorOptions {
  /** Container holding the vscode-core platform-agnostic registrations. */
  container: DependencyContainer;
  /**
   * Directory for `.cpuprofile` files. Electron passes `app.getPath('logs')`,
   * VS Code `context.logUri.fsPath`, the CLI `~/.ptah/logs`. Omitted, the
   * capture falls back to platform global storage and then the temp dir.
   */
  logsPath?: string;
  /**
   * Extra lag listener. The CLI uses this to republish lag as a
   * `debug.perf.lag` JSON-RPC notification; the desktop hosts rely on the log.
   */
  onLag?: EventLoopLagListener;
}

export interface DiagnosticsHandle {
  /** Stop sampling. Idempotent; safe inside a LIFO teardown chain. */
  dispose(): void;
  /**
   * Capture a CPU profile now, returning the written file path. Single-flight
   * — concurrent calls share one capture. Rejects only if writing fails.
   */
  captureCpuProfile(durationMs?: number): Promise<string>;
}

/**
 * Resolve, wire and start the diagnostics pair.
 *
 * @returns A handle that is always usable. On failure the handle's `dispose`
 *   is a no-op and `captureCpuProfile` rejects with the reason, so callers
 *   (an IPC channel, a VS Code command) need no null checks.
 */
export function armDiagnostics(
  options: ArmDiagnosticsOptions,
): DiagnosticsHandle {
  const { container, logsPath, onLag, ...monitorOptions } = options;

  let logger: Logger | undefined;
  try {
    logger = container.resolve<Logger>(TOKENS.LOGGER);

    const monitor = container.resolve<EventLoopMonitor>(
      TOKENS.EVENT_LOOP_MONITOR,
    );
    const capture = container.resolve<CpuProfileCapture>(
      TOKENS.CPU_PROFILE_CAPTURE,
    );

    if (logsPath !== undefined) capture.configure(logsPath);

    const unsubscribers = [
      monitor.onLag((sample) => {
        capture.handleLag(sample);
      }),
    ];
    if (onLag !== undefined) unsubscribers.push(monitor.onLag(onLag));

    monitor.start(monitorOptions);

    return {
      dispose: () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        monitor.dispose();
      },
      captureCpuProfile: (durationMs?: number) =>
        capture.captureFor(durationMs),
    };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    logger?.warn('[diagnostics] arming failed — continuing without', {
      reason,
    });
    return {
      dispose: () => {
        /* nothing was armed */
      },
      captureCpuProfile: () =>
        Promise.reject(new Error(`Diagnostics unavailable: ${reason}`)),
    };
  }
}
