/**
 * EventLoopMonitor — the missing stall signal (TASK_2026_323, Phase 1).
 *
 * ## Why this exists
 *
 * In Electron the Ptah backend runs in the MAIN process, on the same event loop
 * that drives `BrowserWindow` management. A synchronous burst anywhere in the
 * backend — a 1 MB stdout re-copy, a `ts.createProgram` over 2000 tsconfigs, a
 * 50 MB transcript `JSON.parse` — freezes the entire application, and every one
 * of those looks identical from the outside: "Ptah hung".
 *
 * Before this class the ONLY stall signal in any runtime was a client-side
 * 30 s RPC timeout in the renderer (`rpc-call.util.ts`). That fires long after
 * the fact, names the wrong culprit (whichever RPC happened to be in flight),
 * and is invisible in the CLI and gateway hosts which have no renderer at all.
 *
 * `monitorEventLoopDelay` measures the thing itself: libuv schedules a timer at
 * a fixed interval and records how late it actually fired. Late means blocked.
 * The measurement runs in C++ on the libuv thread, so — unlike a JS
 * `setInterval` drift check — the monitor keeps recording accurately DURING the
 * very stall it is trying to report.
 *
 * ## Why it never holds the process open
 *
 * The sampling interval is `unref()`-ed, and `monitorEventLoopDelay`'s own
 * timer is unref'd by libuv. Diagnostics must never be the reason a process
 * refuses to exit — that is the defect class fixed in commit 5dc525f02, and
 * shipping a hang-detector that itself causes a hang would be an unusually
 * poor outcome.
 */

import { inject, injectable } from 'tsyringe';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { TOKENS } from '../di/tokens';
import type { Logger } from '../logging/logger';
import { readMsEnv, roundMs } from './env-thresholds';

/** One sampling window's worth of event-loop delay, in milliseconds. */
export interface EventLoopLagSample {
  /** Worst single delay in the window. This is what the threshold tests. */
  maxMs: number;
  /** 99th percentile delay — separates one bad tick from sustained pressure. */
  p99Ms: number;
  /** Mean delay across the window. Baseline, for reading the other two. */
  meanMs: number;
}

export type EventLoopLagListener = (sample: EventLoopLagSample) => void;

export interface EventLoopMonitorOptions {
  /**
   * Warn when the window's max delay reaches this many milliseconds.
   * Overridden by `PTAH_LOOP_LAG_WARN_MS` when that is set to a positive value.
   */
  warnThresholdMs?: number;
  /** How often to read and reset the histogram. */
  sampleIntervalMs?: number;
}

export const EVENT_LOOP_LAG_WARN_MS_ENV = 'PTAH_LOOP_LAG_WARN_MS';

/**
 * 250 ms. Below roughly 100 ms an interaction still feels instantaneous, and
 * ordinary GC pauses land there, so a lower bar would warn constantly on a
 * healthy machine. Above ~500 ms the freeze is already visible to the user, so
 * a higher bar would only confirm what they can see. 250 ms is the band where
 * the loop is measurably blocked but the app has not yet visibly stopped.
 */
export const DEFAULT_EVENT_LOOP_LAG_WARN_MS = 250;

/**
 * 2 s. Long enough that sampling costs nothing measurable; short enough that a
 * multi-second freeze produces several consecutive warnings rather than one,
 * which is what makes a sustained stall distinguishable from a single spike in
 * the log.
 */
export const DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS = 2_000;

/**
 * 20 ms. This is the histogram's own timer period — it bounds how finely a
 * delay can be attributed, and it is also the floor of what can be observed.
 * Finer resolutions cost more wakeups to detect stalls that, at this
 * threshold, we would ignore anyway.
 */
const HISTOGRAM_RESOLUTION_MS = 20;

const NS_PER_MS = 1e6;

/**
 * Samples libuv event-loop delay and warns when the loop is blocked.
 *
 * Registered as a singleton under `TOKENS.EVENT_LOOP_MONITOR` but deliberately
 * NOT started at registration — each host arms it at the point in its boot
 * sequence where it wants coverage to begin (for Electron, before the heavy
 * wiring, because that is itself a suspect).
 */
@injectable()
export class EventLoopMonitor {
  private histogram: IntervalHistogram | undefined;
  private sampler: ReturnType<typeof setInterval> | undefined;
  private sampleIntervalMs = DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS;
  /** `performance.now()` at the previous read — the freeze fallback's clock. */
  private lastSampleAt = 0;
  private warnThresholdMs = DEFAULT_EVENT_LOOP_LAG_WARN_MS;
  private readonly listeners = new Set<EventLoopLagListener>();
  private readonly sampleListeners = new Set<EventLoopLagListener>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** True between `start()` and `dispose()`. */
  get running(): boolean {
    return this.sampler !== undefined;
  }

  /** The threshold actually in force, after env and option resolution. */
  get thresholdMs(): number {
    return this.warnThresholdMs;
  }

  /**
   * Subscribe to lag events. The listener fires only for windows that also
   * produced a warning, i.e. it sees exactly what the log sees.
   *
   * @returns An unsubscribe function.
   */
  onLag(listener: EventLoopLagListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to EVERY window, breach or not (TASK_2026_437 C14).
   *
   * `onLag` cannot serve a consumer with hysteresis: the
   * `BackgroundWorkGovernor` has to see quiet windows to know lag has ENDED,
   * and `onLag` is silent for exactly those. Listeners here run before the
   * threshold test and are isolated the same way.
   *
   * @returns An unsubscribe function.
   */
  onSample(listener: EventLoopLagListener): () => void {
    this.sampleListeners.add(listener);
    return () => {
      this.sampleListeners.delete(listener);
    };
  }

  /**
   * Begin sampling. Idempotent — a second call while running is a no-op, so a
   * host that arms the monitor in two places cannot end up with two histograms
   * silently halving each other's windows.
   */
  start(options: EventLoopMonitorOptions = {}): void {
    if (this.sampler !== undefined) return;

    this.warnThresholdMs =
      readMsEnv(EVENT_LOOP_LAG_WARN_MS_ENV) ??
      options.warnThresholdMs ??
      DEFAULT_EVENT_LOOP_LAG_WARN_MS;
    const sampleIntervalMs =
      options.sampleIntervalMs ?? DEFAULT_EVENT_LOOP_SAMPLE_INTERVAL_MS;
    this.sampleIntervalMs = sampleIntervalMs;
    this.lastSampleAt = performance.now();

    const histogram = monitorEventLoopDelay({
      resolution: HISTOGRAM_RESOLUTION_MS,
    });
    histogram.enable();
    this.histogram = histogram;

    const sampler = setInterval(() => {
      this.sample();
    }, sampleIntervalMs);
    // Diagnostics never keep a process alive. See the class doc.
    sampler.unref();
    this.sampler = sampler;

    this.logger.info('[event-loop] monitor armed', {
      warnThresholdMs: this.warnThresholdMs,
      sampleIntervalMs,
      resolutionMs: HISTOGRAM_RESOLUTION_MS,
    });
  }

  /**
   * Stop sampling and release the histogram. Safe to call when not running and
   * safe to call twice — hosts dispose this from LIFO teardown chains where
   * neither is guaranteed.
   */
  dispose(): void {
    if (this.sampler !== undefined) {
      clearInterval(this.sampler);
      this.sampler = undefined;
    }
    if (this.histogram !== undefined) {
      this.histogram.disable();
      this.histogram = undefined;
    }
    this.listeners.clear();
    this.sampleListeners.clear();
  }

  /**
   * Read the window, reset it, and warn if it breached.
   *
   * The reset is unconditional and happens before the threshold test: each
   * warning must describe ITS OWN window. Without the reset `max` is a
   * high-water mark for the whole session, so one early stall would keep every
   * later window above the threshold forever.
   *
   * ## `maxMs` also counts this sampler's own lateness (TASK_2026_437 C14)
   *
   * The histogram can MISS a total freeze. Measured on Node 24.15: a 1.5 s and
   * a 5 s synchronous block that began within one histogram resolution (20 ms)
   * after `reset()` left `max` at 0-33 ms in every later window, while the same
   * block started later was recorded at full length. The interval's own
   * lateness (`now - lastSampleAt - interval`) is independent of that, and it
   * sees every block that spans a sample tick. `maxMs` is the larger of the
   * two, so the post-freeze window carries the freeze whichever one saw it.
   * Residual: a block shorter than one interval that starts inside that 20 ms
   * post-reset slot and ends before the next tick is seen by neither. Cost: a
   * machine sleep also makes the tick late, so the first window after resume
   * reads as one lag window (one warn line; the governor holds background work
   * for its 3-window exit, about 6 s).
   */
  private sample(): void {
    const histogram = this.histogram;
    if (histogram === undefined) return;

    const now = performance.now();
    const lateMs = Math.max(0, now - this.lastSampleAt - this.sampleIntervalMs);
    this.lastSampleAt = now;

    const sample: EventLoopLagSample = {
      maxMs: Math.max(toMs(histogram.max), roundMs(lateMs)),
      p99Ms: toMs(histogram.percentile(99)),
      meanMs: toMs(histogram.mean),
    };
    histogram.reset();

    this.notify(
      this.sampleListeners,
      sample,
      '[event-loop] sample listener threw',
    );

    if (sample.maxMs < this.warnThresholdMs) return;

    this.logger.warn('[event-loop] lag', {
      maxMs: sample.maxMs,
      p99Ms: sample.p99Ms,
    });
    this.notify(this.listeners, sample, '[event-loop] lag listener threw');
  }

  /**
   * Fan a sample out to one listener set, isolating each listener.
   *
   * A listener throwing (the CPU-profile auto-capture is one) must not kill the
   * sampling interval — losing the lag log at the exact moment lag is happening
   * is the worst possible failure mode for this class.
   */
  private notify(
    listeners: ReadonlySet<EventLoopLagListener>,
    sample: EventLoopLagSample,
    failureMessage: string,
  ): void {
    for (const listener of listeners) {
      try {
        listener(sample);
      } catch (error: unknown) {
        this.logger.warn(failureMessage, {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/**
 * Convert a histogram reading (nanoseconds) to rounded milliseconds.
 *
 * `mean` is `NaN` on an empty window and `max` can be `0`; both are normalised
 * to `0` so a quiet window can never look like a breach.
 */
function toMs(nanoseconds: number): number {
  return roundMs(nanoseconds / NS_PER_MS);
}
