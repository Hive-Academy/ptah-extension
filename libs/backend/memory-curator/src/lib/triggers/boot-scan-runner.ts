import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

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
 * Required rather than optional so a new pipeline has to answer the question.
 */
export type BootScanItemOutcome = 'ran' | 'stalled';

export interface BootScanResult {
  readonly scanned: number;
  readonly succeeded: number;
  readonly skipped: number;
  /** Items the gate stopped. Non-zero means the scan ended early, on purpose. */
  readonly stalled: number;
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
   * Wall clock, injected for tests. The cold-start floor is the only consumer;
   * a whole clock abstraction would be a port for one subtraction.
   */
  readonly now?: number;
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
      return { scanned: 0, succeeded: 0, skipped: 0, stalled: 0 };
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
      return { scanned: 0, succeeded: 0, skipped: 0, stalled: 0 };
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

    eligible.sort((a, b) => a.mtime - b.mtime);

    let succeeded = 0;
    let skipped = 0;
    let stalled = 0;
    let maxMtime = watermark;

    for (let i = 0; i < eligible.length; i++) {
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
        succeeded++;
        if (item.mtime > maxMtime) maxMtime = item.mtime;
      } catch (err: unknown) {
        skipped++;
        const message = err instanceof Error ? err.message : String(err);
        options.logger.warn('[memory-curator] boot-scan run failed', {
          pipeline: options.pipeline,
          sessionId: item.sessionId,
          error: message,
        });
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

    return { scanned: eligible.length, succeeded, skipped, stalled };
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
