import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import {
  BOOT_SCAN_RETRIES_PER_BOOT,
  type BootScanFailureLedger,
} from './boot-scan-failure-ledger';

export type BootScanPipeline = 'memory' | 'skills';

/**
 * What one scanned session's `run` callback reported.
 *
 * `'stalled'` means the callback did no work and consumed no input because a
 * process-wide gate stopped it — today, the provider quota cooldown. It is NOT
 * a failure: nothing went wrong, and nothing was spent. The distinction matters
 * because the watermark is the scan's memory of what it has already handled,
 * and a session that was never handled must not be recorded as one that was
 * (TASK_2026_306 Batch 10, F1).
 *
 * `'failed'` means the callback dispatched work that failed and consumed
 * nothing (TASK_2026_621). With a {@link BootScanFailureLedger} the session is
 * recorded there and the scan moves on, so one failing session never blocks
 * the healthy sessions after it; later boots retry it a bounded number of
 * times. Without a ledger (or when recording fails) it is handled like
 * `'stalled'`: the scan stops below it so nothing is lost.
 *
 * Required rather than optional so a new pipeline has to answer the question.
 */
export type BootScanItemOutcome = 'ran' | 'stalled' | 'failed';

export interface BootScanResult {
  readonly scanned: number;
  readonly succeeded: number;
  readonly skipped: number;
  /** Items the gate stopped. Non-zero means the scan ended early, on purpose. */
  readonly stalled: number;
  /** Scan items whose pass failed (recorded in the ledger, or held). */
  readonly failed: number;
  /** Ledger sessions retried this boot. */
  readonly retried: number;
  /** Ledger retries that curated the session (row removed). */
  readonly recovered: number;
  /** Ledger sessions marked `given_up` this boot. */
  readonly givenUp: number;
  /**
   * Pending ledger sessions not retried this boot because the last curate
   * slot was kept for the normal scan (`retryAllowed`).
   */
  readonly retriesDeferred: number;
}

const EMPTY_RESULT: BootScanResult = {
  scanned: 0,
  succeeded: 0,
  skipped: 0,
  stalled: 0,
  failed: 0,
  retried: 0,
  recovered: 0,
  givenUp: 0,
  retriesDeferred: 0,
};

interface RetryTally {
  retried: number;
  recovered: number;
  givenUp: number;
  deferred: number;
  stalled: boolean;
}

export interface BootScanRunnerOptions {
  readonly pipeline: BootScanPipeline;
  readonly workspaceRoot: string;
  readonly workspaceFingerprint: string;
  readonly sessionsDirectory: string | null;
  readonly sqlite: SqliteConnectionService;
  readonly logger: Logger;
  readonly run: (
    sessionId: string,
    workspaceRoot: string,
    signal?: AbortSignal,
  ) => Promise<BootScanItemOutcome>;
  readonly signal?: AbortSignal;
  readonly throttleMs?: number;
  /**
   * Wall clock, injected for tests: the cold-start floor and every timestamp
   * written to the failure ledger.
   */
  readonly now?: number;
  /**
   * Per-session failure ledger (TASK_2026_621). Only the memory pipeline,
   * whose callback can report `'failed'`, supplies one.
   */
  readonly failures?: BootScanFailureLedger;
  /**
   * Whether one more ledger retry may spend a curate slot and still leave one
   * for the normal scan. Asked before each retry, and only when the normal scan
   * has eligible sessions, so retries can never starve it (TASK_2026_621).
   * Absent means unlimited.
   */
  readonly retryAllowed?: () => boolean;
}

interface WatermarkRow {
  readonly last_scanned_session_mtime: number;
}

const DEFAULT_THROTTLE_MS = 200;

/**
 * How far back a COLD scan — one with no persisted watermark — may reach.
 *
 * This bounds the first pass in a workspace. `readWatermark` returning `null`
 * means this pipeline has never recorded a mark for this fingerprint: a fresh
 * install, a workspace whose fingerprint just changed, or a `ptah.db` that was
 * reset. That case used to floor to `0`, so every session file satisfied
 * `mtime > watermark` and the first launch curated the project's ENTIRE Claude
 * history — one `curator.curate` LLM call per session, throttled only by 200 ms
 * (TASK_2026_319). Steady state was near-free because the watermark had already
 * advanced, which is exactly why it never showed up in normal testing.
 *
 * Seven days rather than "since install": the user's intent is "do not learn
 * from anything I did before I used Ptah", and an install timestamp would say
 * that exactly — but it is a durable fact nothing stores, and storing it in the
 * same database would be erased by the same reset that produces a cold read
 * here. A rolling week is the bounded approximation that ALSO self-heals: after
 * a reset the scan re-floors to the last seven days instead of to the beginning
 * of time.
 *
 * A PERSISTED watermark is never floored, in either direction. Flooring one
 * forward would skip every session between the real mark and `now - 7 days` —
 * precisely the sessions the scan exists to pick up.
 */
const COLD_START_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The scan both boot pipelines share — `memory` (which curates inline) and
 * `skills` (which enqueues). The cold-start floor below therefore bounds BOTH,
 * which is correct: neither pipeline should reach back into a history the user
 * accumulated before Ptah existed.
 */
export class BootScanRunner {
  async run(options: BootScanRunnerOptions): Promise<BootScanResult> {
    const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
    const sessionsDir = options.sessionsDirectory;
    if (!sessionsDir) {
      options.logger.info(
        '[memory-curator] boot-scan skipped — sessions directory missing',
        { pipeline: options.pipeline },
      );
      return EMPTY_RESULT;
    }

    const persisted = this.readWatermark(
      options.sqlite,
      options.pipeline,
      options.workspaceFingerprint,
      options.logger,
    );
    const now = options.now ?? Date.now();
    const watermark = persisted ?? now - COLD_START_LOOKBACK_MS;
    if (persisted === null) {
      options.logger.info(
        '[memory-curator] boot-scan cold start — bounded to the last 7 days',
        {
          pipeline: options.pipeline,
          workspaceFingerprint: options.workspaceFingerprint,
          floor: watermark,
        },
      );
    }

    let entries: string[] = [];
    try {
      entries = await fs.readdir(sessionsDir);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      options.logger.warn('[memory-curator] boot-scan readdir failed', {
        pipeline: options.pipeline,
        sessionsDir,
        error: message,
      });
      return EMPTY_RESULT;
    }

    const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl'));
    const eligible: { sessionId: string; mtime: number }[] = [];
    for (const file of jsonlFiles) {
      const full = path.join(sessionsDir, file);
      try {
        const stat = await fs.stat(full);
        const mtime = stat.mtimeMs;
        if (mtime > watermark) {
          const sessionId = file.replace(/\.jsonl$/, '');
          eligible.push({ sessionId, mtime });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        options.logger.warn('[memory-curator] boot-scan stat failed', {
          pipeline: options.pipeline,
          file,
          error: message,
        });
      }
    }

    // A terminal ledger row is still a new scan candidate when the underlying
    // file changed, even if its mtime is at or below the persisted watermark
    // (for example after a preserved-mtime copy or clock skew).
    const knownEligible = new Set(eligible.map((item) => item.sessionId));
    const ledger = options.failures;
    if (ledger) {
      let givenUpOffset = 0;
      let reopened = 0;
      while (reopened < BOOT_SCAN_RETRIES_PER_BOOT) {
        const page = ledger.listGivenUp(
          options.workspaceFingerprint,
          BOOT_SCAN_RETRIES_PER_BOOT,
          givenUpOffset,
        );
        if (page.length === 0) break;
        givenUpOffset += page.length;
        for (const entry of page) {
          const mtime = await this.sessionMtime(entry.sessionPath);
          if (
            typeof mtime === 'number' &&
            mtime !== entry.sessionMtimeMs &&
            !knownEligible.has(entry.sessionId)
          ) {
            eligible.push({ sessionId: entry.sessionId, mtime });
            knownEligible.add(entry.sessionId);
            reopened++;
            if (reopened >= BOOT_SCAN_RETRIES_PER_BOOT) {
              break;
            }
          }
        }
        if (page.length < BOOT_SCAN_RETRIES_PER_BOOT) break;
      }
    }

    eligible.sort((a, b) => a.mtime - b.mtime);

    // Ledger retries run BEFORE the scan. They only see failures from earlier
    // boots, so a session that fails in this boot's scan is not re-run in the
    // same boot; and they are bounded (BOOT_SCAN_RETRIES_PER_BOOT rows, each at
    // most BOOT_SCAN_MAX_ATTEMPTS times in its life), so they cannot starve the
    // scan for long. If a gate (budget, back-off) stops them, the scan is not
    // started: it would hit the same gate, and an unstarted scan leaves the
    // watermark where it is, so nothing is lost. While the normal scan has
    // work, `retryAllowed` keeps the last curate slot for it.
    const retry = await this.retryFailures(
      options,
      now,
      throttleMs,
      eligible.length > 0,
    );

    let succeeded = 0;
    let skipped = 0;
    let stalled = retry.stalled ? 1 : 0;
    let failed = 0;
    let maxMtime = watermark;

    for (let i = 0; i < eligible.length && !retry.stalled; i++) {
      if (options.signal?.aborted) {
        options.logger.info('[memory-curator] boot-scan aborted', {
          pipeline: options.pipeline,
          processed: i,
          total: eligible.length,
        });
        break;
      }
      const item = eligible[i];
      try {
        const outcome = await options.run(
          item.sessionId,
          options.workspaceRoot,
          options.signal,
        );
        if (outcome === 'stalled') {
          // Stop the whole scan, and do not move the watermark past this item.
          //
          // Both halves matter. Continuing would run every remaining session
          // into the same gate — the tight `findSessionsDirectory` → skip loop
          // at `coldstart-306.log:1232-1260`, 15 passes in a few hundred lines.
          // And `eligible` is sorted by mtime ascending while the watermark is
          // the MAX over handled items, so letting a later item succeed past a
          // stalled one would jump the watermark over the stalled session and
          // lose it exactly as `markProcessed` did.
          stalled++;
          options.logger.info(
            '[memory-curator] boot-scan stopped early — a gate stalled the pass',
            {
              pipeline: options.pipeline,
              sessionId: item.sessionId,
              remaining: eligible.length - i,
            },
          );
          break;
        }
        if (outcome === 'failed') {
          failed++;
          const recorded = options.failures?.recordFailure(
            options.workspaceFingerprint,
            {
              sessionId: item.sessionId,
              workspaceRoot: options.workspaceRoot,
              sessionPath: path.join(sessionsDir, `${item.sessionId}.jsonl`),
              sessionMtimeMs: item.mtime,
            },
            now,
          );
          if (!recorded) {
            // No ledger, or the write failed: the failure would be lost if the
            // watermark moved past it, so stop below it like a stall.
            options.logger.warn(
              '[memory-curator] boot-scan stopped early — a pass failed and could not be recorded',
              {
                pipeline: options.pipeline,
                sessionId: item.sessionId,
                remaining: eligible.length - i,
              },
            );
            break;
          }
          options.logger.warn(
            '[memory-curator] boot-scan pass failed; session recorded for a retry',
            {
              pipeline: options.pipeline,
              sessionId: item.sessionId,
              attemptCount: recorded.attemptCount,
              status: recorded.status,
            },
          );
        } else {
          succeeded++;
          // A newer generation of a session with a ledger row was curated:
          // the row (pending or given_up) is obsolete.
          options.failures?.remove(
            options.workspaceFingerprint,
            item.sessionId,
          );
        }
        if (item.mtime > maxMtime) maxMtime = item.mtime;
      } catch (err: unknown) {
        skipped++;
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        options.logger.warn('[memory-curator] boot-scan run failed', {
          pipeline: options.pipeline,
          sessionId: item.sessionId,
          error: message,
        });
        const recorded = options.failures?.recordFailure(
          options.workspaceFingerprint,
          {
            sessionId: item.sessionId,
            workspaceRoot: options.workspaceRoot,
            sessionPath: path.join(sessionsDir, `${item.sessionId}.jsonl`),
            sessionMtimeMs: item.mtime,
          },
          now,
        );
        if (options.failures && !recorded) break;
      }
      if (i < eligible.length - 1 && throttleMs > 0) {
        await this.delay(throttleMs, options.signal);
      }
    }

    // On a cold start `watermark` is the 7-day floor, not a stored value, so a
    // pass that found nothing inside the window writes NO row — and the next
    // boot floors again to a fresh `now - 7 days`. That rolling behaviour is
    // intended: an empty week must not be recorded as a scan that happened.
    if (maxMtime > watermark) {
      this.writeWatermark(
        options.sqlite,
        options.pipeline,
        options.workspaceFingerprint,
        maxMtime,
        options.logger,
      );
    }

    return {
      scanned: eligible.length,
      succeeded,
      skipped,
      stalled,
      failed,
      retried: retry.retried,
      recovered: retry.recovered,
      givenUp: retry.givenUp,
      retriesDeferred: retry.deferred,
    };
  }

  /**
   * Retry this workspace's `pending` ledger sessions (TASK_2026_621). A
   * success removes the row; a failure (reported or thrown) records another
   * attempt, which marks the row `given_up` at the ledger's maximum; a
   * session file that no longer exists is `given_up` with that reason; a gate
   * stop ends the retries and reports `stalled` so the scan does not start.
   * When the scan has work and `retryAllowed` refuses, the rest are deferred
   * to a later boot and the scan runs.
   */
  private async retryFailures(
    options: BootScanRunnerOptions,
    now: number,
    throttleMs: number,
    scanHasWork: boolean,
  ): Promise<RetryTally> {
    const tally: RetryTally = {
      retried: 0,
      recovered: 0,
      givenUp: 0,
      deferred: 0,
      stalled: false,
    };
    const ledger = options.failures;
    if (!ledger) return tally;
    const fp = options.workspaceFingerprint;
    const pending = ledger.listPending(fp, BOOT_SCAN_RETRIES_PER_BOOT);
    for (let i = 0; i < pending.length; i++) {
      if (options.signal?.aborted) break;
      const entry = pending[i];
      const mtime = await this.sessionMtime(entry.sessionPath);
      if (mtime === 'missing') {
        if (ledger.giveUp(fp, entry.sessionId, 'session-file-missing', now)) {
          tally.givenUp++;
        }
        options.logger.warn(
          '[memory-curator] boot-scan retry given up — session file no longer exists',
          { pipeline: options.pipeline, sessionId: entry.sessionId },
        );
        continue;
      }
      if (scanHasWork && options.retryAllowed && !options.retryAllowed()) {
        tally.deferred = pending.length - i;
        options.logger.info(
          '[memory-curator] boot-scan retries deferred — last curate slot kept for the scan',
          { pipeline: options.pipeline, deferred: tally.deferred },
        );
        break;
      }
      tally.retried++;
      let outcome: BootScanItemOutcome;
      try {
        outcome = await options.run(
          entry.sessionId,
          entry.workspaceRoot,
          options.signal,
        );
      } catch (err: unknown) {
        options.logger.warn('[memory-curator] boot-scan retry threw', {
          pipeline: options.pipeline,
          sessionId: entry.sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
        outcome = 'failed';
      }
      if (outcome === 'stalled') {
        tally.retried--;
        tally.stalled = true;
        options.logger.info(
          '[memory-curator] boot-scan retries stopped — a gate stalled the pass',
          { pipeline: options.pipeline, sessionId: entry.sessionId },
        );
        break;
      }
      if (outcome === 'ran') {
        if (ledger.remove(fp, entry.sessionId)) tally.recovered++;
      } else {
        const recorded = ledger.recordFailure(
          fp,
          { ...entry, sessionMtimeMs: mtime },
          now,
        );
        if (recorded?.status === 'given_up') {
          tally.givenUp++;
          options.logger.warn(
            '[memory-curator] boot-scan retry given up — attempts exhausted',
            {
              pipeline: options.pipeline,
              sessionId: entry.sessionId,
              attemptCount: recorded.attemptCount,
            },
          );
        }
      }
      if (i < pending.length - 1 && throttleMs > 0) {
        await this.delay(throttleMs, options.signal);
      }
    }
    return tally;
  }

  /** The file's mtime (its generation), `'missing'`, or `null` if unreadable. */
  private async sessionMtime(file: string): Promise<number | 'missing' | null> {
    try {
      return (await fs.stat(file)).mtimeMs;
    } catch (err: unknown) {
      // Only a definite "not there" gives up; any other stat error retries
      // the session normally rather than discarding it.
      const code = (err as { code?: unknown } | null)?.code;
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : null;
    }
  }

  /**
   * The persisted watermark, or `null` when this pipeline has no mark for this
   * workspace.
   *
   * `null` is NOT `0`, and collapsing the two is what TASK_2026_319 fixed. A
   * stored `0` is a mark the scan wrote and must be honoured verbatim; absence
   * is the cold start the caller floors to `now - COLD_START_LOOKBACK_MS`.
   */
  private readWatermark(
    sqlite: SqliteConnectionService,
    pipeline: BootScanPipeline,
    fingerprint: string,
    logger: Logger,
  ): number | null {
    try {
      const row = sqlite.db
        .prepare(
          `SELECT last_scanned_session_mtime FROM boot_scan_state WHERE pipeline = ? AND workspace_fingerprint = ?`,
        )
        .get(pipeline, fingerprint) as WatermarkRow | undefined;
      if (!row) return null;
      const stored = row.last_scanned_session_mtime;
      return typeof stored === 'number' && Number.isFinite(stored)
        ? stored
        : null;
    } catch (err: unknown) {
      // A read that threw leaves us knowing nothing, exactly like a read that
      // found nothing — so it takes the cold path AND its floor. Returning `0`
      // here is what turned a locked or corrupt database into a scan of all
      // history.
      logger.warn('[boot-scan] watermark read failed — treating as cold', {
        pipeline,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private writeWatermark(
    sqlite: SqliteConnectionService,
    pipeline: BootScanPipeline,
    fingerprint: string,
    mtime: number,
    logger?: Logger,
  ): void {
    if (!sqlite.isOpen) return;
    try {
      const now = Date.now();
      sqlite.db
        .prepare(
          `INSERT INTO boot_scan_state (pipeline, workspace_fingerprint, last_scanned_session_mtime, last_run_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(pipeline, workspace_fingerprint)
           DO UPDATE SET last_scanned_session_mtime = excluded.last_scanned_session_mtime, last_run_at = excluded.last_run_at`,
        )
        .run(pipeline, fingerprint, mtime, now);
    } catch (err: unknown) {
      logger?.warn('[boot-scan] watermark write failed', {
        pipeline,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener?.('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }
}
