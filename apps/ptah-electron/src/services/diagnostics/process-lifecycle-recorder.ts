/**
 * ProcessLifecycleRecorder — every process death and every window hang leaves a
 * record (TASK_2026_437, component 6, INV-8).
 *
 * ## Why this exists
 *
 * The 09-14 freeze left nothing behind: no handler listened for a renderer or
 * utility process dying, none for a window going unresponsive, the renderer's
 * own `console.error` output never reached the main log, and `crashReporter`
 * was never started — so "no Crashpad dump" proved nothing at all.
 *
 * ## What it records
 *
 * - `app` `child-process-gone` (utility, GPU, network service …) and `app`
 *   `render-process-gone` (every `WebContents`, windows and DevTools alike).
 *   Renderer deaths are taken ONCE, from `app`: a per-window
 *   `webContents.on('render-process-gone')` would log the same death twice.
 * - Per window, attached through `app` `browser-window-created` so the
 *   preparing shell, the main window and a macOS re-activated window are all
 *   covered by one subscription: `unresponsive` / `responsive` with the
 *   measured unresponsive duration, and `webContents` `console-message`.
 * - Console forwarding takes `warning` and `error` only, at most
 *   {@link CONSOLE_LINES_PER_WINDOW} lines per {@link CONSOLE_WINDOW_MS}, then one
 *   "suppressed N" line; each message is truncated to
 *   {@link CONSOLE_MAX_BYTES}. The renderer's `WebviewErrorHandler` already
 *   logs to its console, so this is the whole bridge — no new IPC channel, and
 *   `contextIsolation` / `sandbox` are untouched.
 *
 * ## Where it writes
 *
 * Everything goes to the shared `Logger` once the boot container has one, and
 * to `console` before that (or when the boot failed). `*-gone`,
 * `unresponsive` and `responsive` are ALSO appended synchronously to
 * `<logs>/ptah-hang.log` — the same file `MainLoopWatchdog` writes — because a
 * process death is often followed by an immediate exit that the async logger
 * never flushes.
 *
 * This module imports nothing from `electron` at runtime; `main.ts` hands it the
 * live `app` and `crashReporter`, which keeps it testable with fake emitters.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  App,
  BrowserWindow,
  CrashReporter,
  WebContents,
  WebContentsConsoleMessageEventParams,
} from 'electron';
import {
  HANG_LOG_FILE_NAME,
  HANG_LOG_MAX_BYTES,
  appendHangLogLine,
} from '@ptah-extension/vscode-core';

/** Forwarded renderer console lines allowed per rate window. */
export const CONSOLE_LINES_PER_WINDOW = 20;

/** Length of one console rate window. */
export const CONSOLE_WINDOW_MS = 10_000;

/** Per-message truncation bound for forwarded console text. */
export const CONSOLE_MAX_BYTES = 2_048;

/** Crash dumps kept after the startup prune (user decision Q5 / D9). */
export const CRASH_DUMPS_TO_KEEP = 5;

/** The logger surface this module uses — satisfied by vscode-core's `Logger`. */
export interface LifecycleLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface ProcessLifecycleRecorderOptions {
  /** Directory holding `ptah-hang.log`; Electron passes `app.getPath('logs')`. */
  logsPath: string;
  /**
   * The shared logger, or `null` while no boot container exists. Read per
   * record, so a logger that appears after install is used from then on.
   */
  getLogger: () => LifecycleLogger | null;
  /** Rotation cap for the hang log. Defaults to vscode-core's `HANG_LOG_MAX_BYTES`. */
  hangLogMaxBytes?: number;
}

type LifecycleApp = Pick<App, 'on'>;
type LifecycleWindow = Pick<BrowserWindow, 'id' | 'on' | 'once'> & {
  webContents: Pick<WebContents, 'on'>;
};

type Level = 'info' | 'warn' | 'error';

export class ProcessLifecycleRecorder {
  private readonly hangLogPath: string;
  private readonly hangLogMaxBytes: number;
  private readonly attached = new WeakSet<object>();
  private readonly unresponsiveSince = new Map<number, number>();

  private consoleWindowStartedAt = 0;
  private consoleLinesInWindow = 0;
  private consoleSuppressed = 0;
  private suppressionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ProcessLifecycleRecorderOptions) {
    this.hangLogPath = path.join(options.logsPath, HANG_LOG_FILE_NAME);
    this.hangLogMaxBytes = options.hangLogMaxBytes ?? HANG_LOG_MAX_BYTES;
  }

  /**
   * Subscribe to the app-level events. Call once, before `app.whenReady`, so
   * the first window's `browser-window-created` is not missed.
   */
  install(app: LifecycleApp): void {
    app.on('child-process-gone', (_event, details) => {
      this.record('error', 'child-process-gone', {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      });
    });
    app.on('render-process-gone', (_event, webContents, details) => {
      this.record('error', 'render-process-gone', {
        webContentsId: webContents.id,
        url: safeUrl(webContents),
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
    app.on('browser-window-created', (_event, window) => {
      this.attachWindow(window);
    });
  }

  /** Attach the per-window hooks. Idempotent per window. */
  attachWindow(window: LifecycleWindow): void {
    if (this.attached.has(window)) return;
    this.attached.add(window);
    const windowId = window.id;

    window.on('unresponsive', () => {
      this.unresponsiveSince.set(windowId, Date.now());
      this.record('warn', 'window-unresponsive', { windowId });
    });
    window.on('responsive', () => {
      const since = this.unresponsiveSince.get(windowId);
      this.unresponsiveSince.delete(windowId);
      this.record('info', 'window-responsive', {
        windowId,
        unresponsiveForMs: since === undefined ? null : Date.now() - since,
      });
    });
    window.once('closed', () => {
      this.unresponsiveSince.delete(windowId);
    });

    window.webContents.on('console-message', (details) => {
      this.forwardConsole(windowId, details);
    });
  }

  /** Flush a pending suppression count and stop its timer. Idempotent. */
  dispose(): void {
    this.flushSuppressed();
  }

  private forwardConsole(
    windowId: number,
    details: Pick<
      WebContentsConsoleMessageEventParams,
      'level' | 'message' | 'lineNumber' | 'sourceId'
    >,
  ): void {
    if (details.level !== 'warning' && details.level !== 'error') return;

    const now = Date.now();
    if (now - this.consoleWindowStartedAt >= CONSOLE_WINDOW_MS) {
      this.flushSuppressed();
      this.consoleWindowStartedAt = now;
      this.consoleLinesInWindow = 0;
    }

    if (this.consoleLinesInWindow >= CONSOLE_LINES_PER_WINDOW) {
      this.consoleSuppressed += 1;
      this.scheduleSuppressionFlush(now);
      return;
    }
    this.consoleLinesInWindow += 1;

    this.log(
      details.level === 'error' ? 'error' : 'warn',
      `[renderer] console.${details.level}`,
      {
        windowId,
        message: truncateUtf8(details.message, CONSOLE_MAX_BYTES),
        source: `${details.sourceId}:${details.lineNumber}`,
      },
    );
  }

  /**
   * Emit the count at the END of the window that suppressed it, even when no
   * further console line arrives to trigger it. The timer is unref'd:
   * diagnostics never hold the process open.
   */
  private scheduleSuppressionFlush(now: number): void {
    if (this.suppressionTimer !== undefined) return;
    const remaining = Math.max(
      0,
      this.consoleWindowStartedAt + CONSOLE_WINDOW_MS - now,
    );
    const timer = setTimeout(() => {
      this.suppressionTimer = undefined;
      this.flushSuppressed();
      // Close the window so the next line opens a fresh one.
      this.consoleWindowStartedAt = 0;
      this.consoleLinesInWindow = 0;
    }, remaining);
    timer.unref();
    this.suppressionTimer = timer;
  }

  private flushSuppressed(): void {
    if (this.suppressionTimer !== undefined) {
      clearTimeout(this.suppressionTimer);
      this.suppressionTimer = undefined;
    }
    if (this.consoleSuppressed === 0) return;
    const suppressed = this.consoleSuppressed;
    this.consoleSuppressed = 0;
    this.log('warn', '[renderer] console lines suppressed', {
      suppressed,
      windowMs: CONSOLE_WINDOW_MS,
      limit: CONSOLE_LINES_PER_WINDOW,
    });
  }

  /** A lifecycle event: the logger AND a synchronous hang-log append. */
  private record(
    level: Level,
    event: string,
    details: Record<string, unknown>,
  ): void {
    this.appendHangLog(event, details);
    this.log(level, `[process-lifecycle] ${event}`, details);
  }

  private log(
    level: Level,
    message: string,
    context: Record<string, unknown>,
  ): void {
    const logger = this.resolveLogger();
    if (logger !== null) {
      logger[level](message, context);
      return;
    }
    const line = `${message} ${JSON.stringify(context)}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  private resolveLogger(): LifecycleLogger | null {
    try {
      return this.options.getLogger();
    } catch (error: unknown) {
      // degradation-audit: optional-capability — the getter resolves from a DI
      // container that may be mid-teardown on quit. The record must still
      // land, so it falls back to console (warned below).
      console.warn(
        '[process-lifecycle] logger unavailable, using console:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private appendHangLog(event: string, details: Record<string, unknown>): void {
    const line = `${JSON.stringify({
      time: new Date().toISOString(),
      source: 'process-lifecycle',
      event,
      ...details,
    })}\n`;
    // Same bounded, rotating append the watchdog worker uses, so both writers
    // honour one cap. It never throws; the logger line still carries the event.
    if (!appendHangLogLine(this.hangLogPath, line, this.hangLogMaxBytes)) {
      console.warn(
        '[process-lifecycle] hang log append failed:',
        this.hangLogPath,
      );
    }
  }
}

/**
 * Start Crashpad with uploads OFF (user decision Q5): minidumps are written
 * under `app.getPath('crashDumps')` and never leave the machine. Must run
 * before `app.whenReady`.
 *
 * @returns `true` when the reporter started.
 */
export function startLocalCrashReporter(
  crashReporter: Pick<CrashReporter, 'start'>,
): boolean {
  try {
    crashReporter.start({ uploadToServer: false });
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability — local minidumps are a
    // diagnostic extra; a Crashpad start failure must never block boot.
    console.warn(
      '[process-lifecycle] crashReporter did not start (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

/**
 * Keep only the newest {@link CRASH_DUMPS_TO_KEEP} `.dmp` files under the
 * crash-dump directory (D9). Crashpad nests dumps one or two levels deep
 * (`reports/` on Windows, `completed/` and `pending/` elsewhere), so the walk
 * goes two levels. Best-effort: a dump that cannot be read or removed is left
 * in place, and the function never rejects.
 *
 * @returns The number of dumps removed.
 */
export async function pruneCrashDumps(
  crashDumpsPath: string,
  keep: number = CRASH_DUMPS_TO_KEEP,
): Promise<number> {
  const dumps: { file: string; mtimeMs: number }[] = [];
  await collectDumps(crashDumpsPath, 2, dumps);
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);

  let removed = 0;
  for (const dump of dumps.slice(keep)) {
    try {
      await fs.promises.unlink(dump.file);
      removed += 1;
    } catch (error: unknown) {
      console.warn(
        '[process-lifecycle] crash dump not pruned:',
        dump.file,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return removed;
}

async function collectDumps(
  dir: string,
  depth: number,
  out: { file: string; mtimeMs: number }[],
): Promise<void> {
  for (const entry of await readDumpDirEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0) await collectDumps(full, depth - 1, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.dmp')) {
      await pushDumpStat(full, out);
    }
  }
}

/** A crash-dump directory's entries; empty (never rejects) when unreadable. */
async function readDumpDirEntries(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    // degradation-audit: reported — an unreadable dump directory is warned
    // below; the empty list only means no dumps are listed for this dir.
    // A missing directory is the normal first-run state: nothing crashed yet.
    if (!isNotFound(error)) {
      console.warn(
        '[process-lifecycle] crash dump directory unreadable:',
        dir,
        error instanceof Error ? error.message : String(error),
      );
    }
    return [];
  }
}

/** Record a dump's mtime; a dump that cannot be stat'ed is skipped with a warning. */
async function pushDumpStat(
  file: string,
  out: { file: string; mtimeMs: number }[],
): Promise<void> {
  try {
    const stat = await fs.promises.stat(file);
    out.push({ file, mtimeMs: stat.mtimeMs });
  } catch (error: unknown) {
    console.warn(
      '[process-lifecycle] crash dump not inspected:',
      file,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function isNotFound(error: unknown): boolean {
  // Structural, not `instanceof Error`: fs errors can come from another realm
  // (Jest's sandbox is one), where the prototype check is false.
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function safeUrl(webContents: Pick<WebContents, 'getURL'>): string {
  try {
    return webContents.getURL();
  } catch (error: unknown) {
    // A destroyed WebContents throws on every accessor, and a gone renderer is
    // exactly when that happens. The reason and exit code still get recorded.
    return `<unavailable: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

const TRUNCATION_MARKER = ' …[truncated]';

/**
 * Truncate to at most `maxBytes` of UTF-8, marker included, without splitting
 * a code point.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARKER));
  // Step back over continuation bytes (10xxxxxx) to a code-point boundary.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}${TRUNCATION_MARKER}`;
}
