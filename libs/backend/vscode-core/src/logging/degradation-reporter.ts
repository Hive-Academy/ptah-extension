/**
 * Degradation reporter (TASK_2026_383, component 2).
 *
 * ## What this is and is not
 *
 * This is the one way a site that fell back to a default says so, and the one
 * place the per-boot counts live. It is deliberately NOT a logger: a call site
 * that already writes `logger.warn` keeps writing it, because the log line is
 * for a human reading a file and this is for a machine keeping a tally. It is
 * also not a policy engine — it never decides how bad a degradation is. The
 * call site chooses the severity because the call site is the only place that
 * knows what was lost.
 *
 * It lives beside `Logger` rather than in a lib of its own because every
 * backend lib already injects `TOKENS.LOGGER` from here, so the new token adds
 * no dependency edge anywhere in the graph.
 *
 * ## The rules that keep it safe on the boot path
 *
 * - **It never throws.** A reporter that could throw would turn every degrade
 *   site — sites that exist precisely to keep the app alive — into a crash
 *   site, which is strictly worse than the silence this task is fixing. A
 *   missing webview manager, a rejected broadcast, a container that resolves to
 *   nothing: all are swallowed, and the count is taken regardless.
 * - **`TOKENS.WEBVIEW_MANAGER` is resolved lazily, per report, behind
 *   `isRegistered`** — the same rule `createActivityEmitter` follows. The CLI
 *   registers a duck-typed manager and a test host may register none; capturing
 *   the answer at construction would freeze whichever was true then.
 * - **It does not log on the reporting path.** The single exception is the
 *   one-shot error when the code map hits its cap, which fires at most once per
 *   process.
 * - **The count map is bounded.** A `code` is a string literal by contract, so
 *   an unbounded map means a caller is interpolating one — a bug the cap
 *   contains rather than lets grow.
 */

import type { DependencyContainer } from 'tsyringe';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  DegradationEventPayload,
  DegradationSeverity,
  DegradationSource,
} from '@ptah-extension/shared';
import { TOKENS } from '../di/tokens';
import type { Logger } from './logger';

/**
 * How many distinct codes are tracked before new ones are dropped.
 *
 * Sized well above any plausible legitimate total (the repo-wide inventory is
 * ~268 sites across every library, of which a single boot touches a handful),
 * so hitting it is evidence of an interpolated code rather than growth.
 */
export const MAX_TRACKED_DEGRADATION_CODES = 64;

/** The one method this file needs from `WebviewManager`. */
interface BroadcastSurface {
  broadcastMessage: (type: string, payload: unknown) => Promise<void>;
}

/** What a call site hands to {@link DegradationReporter.report}. */
export interface DegradationReport {
  readonly source: DegradationSource;
  /** A stable string literal. Never interpolated — see `rpc-degradation.types.ts`. */
  readonly code: string;
  readonly severity: DegradationSeverity;
  readonly summary: string;
  readonly detail?: string;
}

/** One code's running tally. */
export interface DegradationCount {
  readonly code: string;
  readonly source: DegradationSource;
  /** The severity of the most recent report for this code. */
  readonly severity: DegradationSeverity;
  readonly count: number;
  /** The most recent report's summary, so a reader needs no second lookup. */
  readonly summary: string;
}

/** The whole tally, as the boot summary reads it. */
export interface DegradationSnapshot {
  /** Every report accepted this process, including repeats of one code. */
  readonly total: number;
  /** Highest count first, then code order — a stable, printable ordering. */
  readonly entries: readonly DegradationCount[];
  /** Reports whose code arrived after the cap and was therefore not tallied. */
  readonly droppedReports: number;
  /** Broadcasts that could not be handed to a webview manager at all. */
  readonly broadcastFailures: number;
}

interface MutableCount {
  source: DegradationSource;
  severity: DegradationSeverity;
  count: number;
  summary: string;
}

/**
 * Counts degradations and pushes each one to the renderer, best-effort.
 *
 * Constructed with the container rather than with resolved collaborators so the
 * webview manager stays a per-report lookup. Registered as a lazily-constructed
 * singleton under `TOKENS.DEGRADATION_REPORTER`.
 */
export class DegradationReporter {
  private readonly counts = new Map<string, MutableCount>();
  private totalReports = 0;
  private droppedReports = 0;
  private broadcastFailures = 0;
  private capReported = false;

  constructor(private readonly container: DependencyContainer) {}

  /**
   * Record one degradation and push it to the renderer.
   *
   * Returns `void` and never rejects: there is nothing a call site could
   * usefully do with a reporting failure, and making it await one would put a
   * broadcast on the boot path.
   */
  report(report: DegradationReport): void {
    this.tally(report);
    this.broadcast(report);
  }

  /** The per-code tally, for the once-per-boot summary line. */
  snapshot(): DegradationSnapshot {
    const entries: DegradationCount[] = [];
    for (const [code, tally] of this.counts) {
      entries.push({
        code,
        source: tally.source,
        severity: tally.severity,
        count: tally.count,
        summary: tally.summary,
      });
    }
    entries.sort((a, b) =>
      b.count === a.count ? a.code.localeCompare(b.code) : b.count - a.count,
    );
    return {
      total: this.totalReports,
      entries,
      droppedReports: this.droppedReports,
      broadcastFailures: this.broadcastFailures,
    };
  }

  /**
   * Pure map arithmetic — no I/O, no resolution, nothing that can throw. This
   * is what makes "counts even when the broadcast is impossible" true by
   * construction rather than by a catch block.
   */
  private tally(report: DegradationReport): void {
    this.totalReports += 1;
    const existing = this.counts.get(report.code);
    if (existing !== undefined) {
      existing.count += 1;
      existing.severity = report.severity;
      existing.summary = report.summary;
      existing.source = report.source;
      return;
    }
    if (this.counts.size >= MAX_TRACKED_DEGRADATION_CODES) {
      this.droppedReports += 1;
      this.reportCapOnce(report.code);
      return;
    }
    this.counts.set(report.code, {
      source: report.source,
      severity: report.severity,
      count: 1,
      summary: report.summary,
    });
  }

  private broadcast(report: DegradationReport): void {
    try {
      if (!this.container.isRegistered(TOKENS.WEBVIEW_MANAGER)) return;
      const webviewManager = this.container.resolve<BroadcastSurface>(
        TOKENS.WEBVIEW_MANAGER,
      );
      const payload: DegradationEventPayload = {
        source: report.source,
        code: report.code,
        severity: report.severity,
        summary: report.summary,
        timestamp: Date.now(),
        ...(report.detail === undefined ? {} : { detail: report.detail }),
      };
      void webviewManager
        .broadcastMessage(MESSAGE_TYPES.DEGRADATION_EVENT, payload)
        .catch(() => {
          // A rejected push is not worth a log line on a path whose entire
          // premise is that nothing on it may disturb its caller. The count is
          // already taken; this only records that the renderer never saw it.
          this.broadcastFailures += 1;
        });
    } catch (error: unknown) {
      // Resolution itself failed — a half-built container, a manager whose
      // constructor threw. Same outcome as a rejected push: the count stands,
      // the renderer never saw it, and the caller is untouched.
      void error;
      this.broadcastFailures += 1;
    }
  }

  /**
   * The cap is a bug signal, so it is the one thing here that logs — once per
   * process, at `error`, naming the code that tripped it. Guarded end to end
   * because a host with no logger registered must not be turned into a crash by
   * a diagnostic.
   */
  private reportCapOnce(code: string): void {
    if (this.capReported) return;
    this.capReported = true;
    try {
      if (!this.container.isRegistered(TOKENS.LOGGER)) return;
      const logger = this.container.resolve<Logger>(TOKENS.LOGGER);
      logger.error(
        `[Degradation] Tracking cap of ${MAX_TRACKED_DEGRADATION_CODES} distinct codes reached; further new codes are counted only in droppedReports. A code must be a string literal — an interpolated one is a bug.`,
        { firstDroppedCode: code },
      );
    } catch (error: unknown) {
      // The cap notice is a diagnostic. If even that fails there is nothing
      // left to tell, and `capReported` is already latched so it is not retried.
      void error;
    }
  }
}
