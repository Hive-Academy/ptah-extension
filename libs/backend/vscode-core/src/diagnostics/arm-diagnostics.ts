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
import type { MainLoopWatchdog } from './main-loop-watchdog';
import type { BackgroundWorkGovernor } from './background-work-governor';
import {
  HangProfiler,
  isHangProfileEnabled,
  type HangProfilerOptions,
} from './hang-profiler';

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
  /**
   * Builds the opt-in hang profiler (`PTAH_HANG_PROFILE=1`). Test seam;
   * defaults to a profiler on a real `node:inspector` session.
   */
  createHangProfiler?: HangProfilerFactory;
}

/** Builds a {@link HangProfiler}; the spec seam of {@link armDiagnostics}. */
export type HangProfilerFactory = (
  options: HangProfilerOptions,
) => HangProfiler;

const defaultHangProfilerFactory: HangProfilerFactory = (options) =>
  new HangProfiler(options);

interface ArmedWatchdog {
  readonly watchdog: MainLoopWatchdog;
  readonly profiler: HangProfiler | null;
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
  const {
    container,
    logsPath,
    onLag,
    createHangProfiler = defaultHangProfilerFactory,
    ...monitorOptions
  } = options;

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

    const disposeGovernor = attachGovernor(container, monitor, logger);
    if (disposeGovernor !== null) unsubscribers.push(disposeGovernor);

    monitor.start(monitorOptions);

    const armed =
      logsPath !== undefined
        ? armWatchdog(container, logsPath, logger, createHangProfiler)
        : null;
    if (armed !== null) {
      const { watchdog } = armed;
      // The last lag sample rides every heartbeat, so a hang line names the
      // most recent measured stall that preceded it.
      unsubscribers.push(
        monitor.onLag((sample) => {
          watchdog.setBreadcrumb(
            'lastLag',
            `max=${sample.maxMs}ms p99=${sample.p99Ms}ms at ${new Date().toISOString()}`,
          );
        }),
      );
    }

    return {
      dispose: () => {
        for (const unsubscribe of unsubscribers) unsubscribe();
        monitor.dispose();
        // Both `dispose`s never reject; the worker's terminate and the
        // profiler's stop are fire-and-forget inside a synchronous LIFO
        // teardown chain.
        if (armed !== null) {
          void armed.watchdog.dispose();
          if (armed.profiler !== null) void armed.profiler.dispose();
        }
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

/**
 * Feed the monitor's samples to the background-work governor, on its own
 * failure boundary: a governor that cannot be resolved must not cost the host
 * its lag monitor. Adopters then see an always-clear gate, which is the
 * pre-governor behaviour.
 *
 * The handle's `dispose` is the host's shutdown path in all three hosts
 * (Electron `shutdown.ts`, VS Code `deactivate`, CLI `disposeDiagnostics`), so
 * disposing the governor here is what stops background work being admitted
 * during quit. Governor `dispose` also detaches the lag source.
 *
 * @returns The governor's disposer, or `null` when it is unavailable.
 */
function attachGovernor(
  container: DependencyContainer,
  monitor: EventLoopMonitor,
  logger: Logger,
): (() => void) | null {
  // Same shape as `armWatchdog`: the failure is logged, and the null result is
  // the documented "no governor" answer rather than a swallowed error.
  let dispose: (() => void) | null = null;
  try {
    const governor = container.resolve<BackgroundWorkGovernor>(
      TOKENS.BACKGROUND_WORK_GOVERNOR,
    );
    governor.attachLagSource(monitor);
    dispose = () => governor.dispose();
  } catch (error: unknown) {
    logger.warn('[diagnostics] background-work governor not attached', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return dispose;
}

/**
 * Start the main-loop watchdog on its own failure boundary.
 *
 * The watchdog spawns a worker thread, which can fail where the lag monitor
 * cannot (a host that forbids workers, resource exhaustion). That failure must
 * not cost the host its lag monitor too, so it is caught here and logged
 * rather than propagating into `armDiagnostics`' whole-handle fallback.
 */
function armWatchdog(
  container: DependencyContainer,
  logsPath: string,
  logger: Logger,
  createHangProfiler: HangProfilerFactory,
): ArmedWatchdog | null {
  let armed: ArmedWatchdog | null = null;
  let profiler: HangProfiler | null = null;
  try {
    const watchdog = container.resolve<MainLoopWatchdog>(
      TOKENS.MAIN_LOOP_WATCHDOG,
    );
    profiler = isHangProfileEnabled()
      ? armHangProfiler(createHangProfiler({ logger, logsPath }), logger)
      : null;
    const armedProfiler = profiler;
    watchdog.start(
      armedProfiler === null
        ? { logsPath }
        : {
            logsPath,
            onRecovered: async (details) => ({
              ...(await armedProfiler.captureHang(details)),
            }),
          },
    );
    armed = { watchdog, profiler: armedProfiler };
  } catch (error: unknown) {
    logger.warn('[diagnostics] main-loop watchdog not armed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    // No watchdog will ever ask this profiler for a hang, and nothing else
    // owns it: release its debugger attachment and rotation timer now.
    disposeOrphanedProfiler(profiler, logger);
  }
  return armed;
}

function disposeOrphanedProfiler(
  profiler: HangProfiler | null,
  logger: Logger,
): void {
  if (profiler === null) return;
  profiler.dispose().catch((error: unknown) => {
    logger.warn('[diagnostics] orphaned hang profiler did not dispose', {
      reason: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * Start the opt-in hang profiler (`PTAH_HANG_PROFILE=1`). Its start is async;
 * a failure there is logged and leaves the watchdog's recovery lines carrying
 * `hangProfileError` instead of a profile, never failing the arming.
 */
function armHangProfiler(profiler: HangProfiler, logger: Logger): HangProfiler {
  profiler.start().catch((error: unknown) => {
    logger.warn('[diagnostics] hang profiler did not start', {
      reason: error instanceof Error ? error.message : String(error),
    });
  });
  return profiler;
}
