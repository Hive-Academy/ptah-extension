/**
 * PtahFileSettingsManager — File-based settings storage for ~/.ptah/settings.json.
 *
 * Manages settings that cannot live in VS Code's package.json contributes.configuration
 * because the marketplace scanner flags trademarked terms ("copilot", "codex", "claude", "gpt")
 * as "suspicious content".
 *
 * Internal storage uses FLAT dot-notation keys (e.g., "provider.github-copilot.clientId")
 * matching the existing getConfiguration('ptah', 'provider.github-copilot.clientId') call pattern.
 * The on-disk JSON format uses nested objects for human readability; flatten/unflatten
 * conversion happens only during file serialization/deserialization.
 *
 * Pattern: Modeled after ElectronWorkspaceProvider's loadConfigSync + persistConfig pattern.
 * Platform-agnostic: NO vscode imports. Usable from both VS Code and Electron contexts.
 *
 * TASK_2025_247 Batch 2, Task 2.1
 * WP-5A: Cross-process reactivity via fs.watch on settings.json.
 */

import * as fs from 'fs';
import type { FSWatcher } from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface FileSettingsDefaults {
  [key: string]: unknown;
}

/** Minimal disposable returned by watch(). */
export interface ISettingsWatchHandle {
  dispose(): void;
}

/** Maximum retry attempts when re-establishing a lost fs.watch watcher. */
const CROSS_PROCESS_WATCH_MAX_RETRIES = 3;
/** Debounce window in milliseconds — coalesces multiple change events from a single atomic rename. */
const CROSS_PROCESS_WATCH_DEBOUNCE_MS = 50;

/** Whether the active cross-process watcher is on the file or the directory. */
type CrossProcessWatchMode = 'file' | 'directory' | null;

export class PtahFileSettingsManager {
  /** In-memory cache using flat dot-notation keys */
  private settings: Record<string, unknown> = {};
  private readonly filePath: string;
  private readonly dirPath: string;
  private readonly defaults: FileSettingsDefaults;
  /** Write serialization — prevents concurrent persist() calls from corrupting the file */
  private writePromise: Promise<void> = Promise.resolve();
  /**
   * In-process listeners for individual setting keys.
   * WP-5A adds cross-process fs.watch() on top of these.
   */
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();

  // ---------------------------------------------------------------------------
  // Cross-process watcher state (WP-5A)
  // ---------------------------------------------------------------------------
  /** Active FSWatcher, set by enableCrossProcessWatch(). */
  private crossProcessWatcher: FSWatcher | null = null;
  /** Which path surface the active watcher is on. */
  private crossProcessWatchMode: CrossProcessWatchMode = null;
  /** Debounce timer handle for coalescing rapid change events. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether enableCrossProcessWatch() has been called (guards against double-init). */
  private crossProcessWatchEnabled = false;
  /** Retry counter for re-establishing the watcher after a rename-induced loss. */
  private watcherRetries = 0;
  /** Whether a rename-triggered re-establish is already pending (prevents stacking). */
  private fileRenameReestablishPending = false;

  constructor(defaults: FileSettingsDefaults) {
    this.dirPath = path.join(homedir(), '.ptah');
    this.filePath = path.join(this.dirPath, 'settings.json');
    this.defaults = defaults;
    this.loadSync();
  }

  /**
   * Get a setting value.
   *
   * Lookup order:
   * 1. In-memory cache (user-set values)
   * 2. Caller-provided defaultValue
   * 3. Constructor-provided defaults (from FILE_BASED_SETTINGS_DEFAULTS)
   */
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.settings[key];
    if (value !== undefined) return value as T;
    if (defaultValue !== undefined) return defaultValue;
    const registeredDefault = this.defaults[key];
    return registeredDefault !== undefined
      ? (registeredDefault as T)
      : undefined;
  }

  /**
   * Set a setting value. Updates in-memory cache, persists to disk atomically,
   * then fires in-process listeners registered via watch().
   */
  async set(key: string, value: unknown): Promise<void> {
    this.settings[key] = value;
    this.writePromise = this.writePromise.then(
      () => this.persist(),
      () => this.persist(),
    );
    await this.writePromise;
    // Fire listeners after the write resolves.
    this.listeners.get(key)?.forEach((cb) => {
      try {
        cb(value);
      } catch {
        // Listener errors must not abort other listeners.
      }
    });
  }

  /**
   * Get the file path for external access (e.g., migration logic).
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Subscribe to in-process changes on a single settings key.
   *
   * The callback fires whenever `set(key, value)` resolves successfully.
   * This covers in-process writes only — cross-process reactivity (fs.watch on
   * settings.json) is deferred to Phase 5 (cross-process reactivity WP-5).
   *
   * Returns a disposable handle to unsubscribe.
   */
  watch(key: string, cb: (value: unknown) => void): ISettingsWatchHandle {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.listeners.get(key)!.add(cb);
    return {
      dispose: () => {
        this.listeners.get(key)?.delete(cb);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Cross-process reactivity (WP-5A)
  // ---------------------------------------------------------------------------

  /**
   * Enable cross-process change detection by watching the settings file with
   * Node's built-in `fs.watch`.
   *
   * When another process writes to ~/.ptah/settings.json (via the atomic
   * tmp+rename pattern), this watcher detects the change, diffs the new file
   * contents against the in-memory cache, and fires listeners only for keys
   * whose values actually changed.
   *
   * Self-write echo prevention: because `set()` updates `this.settings` before
   * persisting, any file-change event triggered by our own write produces an
   * empty diff (disk == cache) and no listeners fire. No mtime tracking needed.
   *
   * Atomic-rename handling: `rename` events indicate the inode was replaced.
   * On `rename`, the watcher is re-established on this.filePath so it follows
   * the new inode.
   *
   * Error recovery: on watcher error, exponential backoff is used (up to
   * CROSS_PROCESS_WATCH_MAX_RETRIES). After that, the watcher gives up
   * gracefully — in-process changes continue to work.
   *
   * @returns A disposable that closes the watcher when called.
   */
  enableCrossProcessWatch(): ISettingsWatchHandle {
    if (this.crossProcessWatchEnabled) {
      // Already active — return a no-op disposable.
      return { dispose: () => this.disposeCrossProcessWatch() };
    }
    this.crossProcessWatchEnabled = true;
    this.watcherRetries = 0;
    this.startWatcher();
    return { dispose: () => this.disposeCrossProcessWatch() };
  }

  /**
   * Dispose the cross-process watcher and cancel any pending debounce timers.
   * Safe to call multiple times (idempotent). Handles both 'file' and 'directory' modes.
   */
  disposeCrossProcessWatch(): void {
    this.crossProcessWatchEnabled = false;
    this.fileRenameReestablishPending = false;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.crossProcessWatcher !== null) {
      try {
        this.crossProcessWatcher.close();
      } catch {
        // Already closed — ignore.
      }
      this.crossProcessWatcher = null;
    }
    this.crossProcessWatchMode = null;
  }

  /**
   * Synchronously flush the current in-memory settings to disk using the same
   * atomic tmp-rename pattern as persist(). Safe to call from process-exit
   * handlers (will-quit, before-quit) — errors are caught and logged, never thrown.
   */
  flushSync(): void {
    try {
      fs.mkdirSync(this.dirPath, { recursive: true });

      const nested = unflattenObject(this.settings);
      const output = {
        $schema: 'https://ptah.live/schemas/settings.json',
        version: 1,
        ...nested,
      };

      const json = JSON.stringify(output, null, 2);
      // Distinct tmp path so a concurrent async persist() does not race on the same file.
      const tmpPath = this.filePath + '.flush.tmp';

      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (error: unknown) {
      console.error(
        `[PtahFileSettingsManager] flushSync failed for ${this.filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Cross-process watcher — private implementation (WP-5A)
  // ---------------------------------------------------------------------------

  /**
   * Entry point for watcher establishment. Prefers a file-level watcher for
   * precision (no sibling-file noise). Falls back to a directory-level watcher
   * only when the file does not yet exist (first-run case). The directory watcher
   * transitions automatically to a file watcher once settings.json appears.
   */
  private startWatcher(): void {
    // Tear down any existing watcher before creating a new one.
    this.closeCurrentWatcher();

    // Ensure the ~/.ptah/ directory exists before trying to watch anything.
    try {
      fs.mkdirSync(this.dirPath, { recursive: true });
    } catch {
      // If we can't create the directory, there's nothing to watch.
    }

    // PREFERRED path: file-watch (narrow surface — no sibling-file noise).
    if (this.tryStartFileWatch()) {
      return;
    }

    // FALLBACK path: directory-watch, used only when the file is absent.
    this.startDirectoryWatchForFile();
  }

  /**
   * Attempt to establish fs.watch on this.filePath.
   * Returns true on success, false when the file is absent (ENOENT).
   * Other errors are logged and also return false (watcher not established).
   */
  private tryStartFileWatch(): boolean {
    try {
      const watcher = fs.watch(this.filePath, { persistent: false });

      watcher.on('change', () => {
        this.scheduleDebouncedFlush();
      });

      watcher.on('rename', () => {
        this.handleFileRename();
      });

      watcher.on('error', (err: Error) => {
        console.warn(
          `[PtahFileSettingsManager] fs.watch error on ${this.filePath}: ${err.message}`,
        );
        this.handleWatcherError(err);
      });

      this.crossProcessWatcher = watcher;
      this.crossProcessWatchMode = 'file';
      // Reset retry counter on successful establishment.
      this.watcherRetries = 0;
      return true;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        // File does not exist yet — fall back to directory watch.
        return false;
      }
      // Unexpected error — log and report failure.
      console.warn(
        `[PtahFileSettingsManager] fs.watch(file) failed unexpectedly on ${this.filePath}:`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Establish fs.watch on the ~/.ptah/ directory.
   * This is the fallback for first-run when settings.json does not exist yet.
   * Its sole purpose is to detect the moment settings.json appears, then
   * transition to a file-level watcher and close this directory watcher.
   *
   * It also fires the diff pipeline for changes while in this mode, so no
   * events are lost during the brief window before the file-watch takes over.
   */
  private startDirectoryWatchForFile(): void {
    try {
      const settingsFileName = path.basename(this.filePath); // 'settings.json'
      const watcher = fs.watch(
        this.dirPath,
        { persistent: false },
        (eventType: string, filename: string | Buffer | null) => {
          const name =
            filename instanceof Buffer ? filename.toString() : filename;
          if (name !== settingsFileName) return;

          // settings.json appeared or changed. Try to transition to file-watch.
          // Close directory watcher first, then attempt file-watch.
          this.closeCurrentWatcher();
          if (!this.tryStartFileWatch()) {
            // File still not readable — stay on directory watch for next event.
            this.startDirectoryWatchForFile();
          }

          // Also process the change that brought us here.
          this.scheduleDebouncedFlush();
        },
      );

      watcher.on('error', (err: Error) => {
        console.warn(
          `[PtahFileSettingsManager] fs.watch error on ${this.dirPath}: ${err.message}`,
        );
        this.handleWatcherError(err);
      });

      this.crossProcessWatcher = watcher;
      this.crossProcessWatchMode = 'directory';
      this.watcherRetries = 0;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PtahFileSettingsManager] Unable to start fs.watch on ${this.dirPath}: ${msg}. ` +
          `Cross-process change notifications will not be available.`,
      );
      this.crossProcessWatcher = null;
      this.crossProcessWatchMode = null;
    }
  }

  /**
   * Called on a 'rename' event from the file watcher.
   *
   * An atomic write (tmp→rename) replaces the inode. The current FSWatcher is
   * now stale and will not see further changes on the new inode. We must:
   *   1. Fire the diff pipeline (the rename means new content landed).
   *   2. After the debounce window settles (file stable), close the stale
   *      watcher and re-establish a fresh file-watch on the same path.
   *
   * We do NOT re-establish synchronously here — doing so inside the rename
   * callback races with the rename completing on some platforms.
   */
  private handleFileRename(): void {
    if (this.fileRenameReestablishPending) return;
    this.fileRenameReestablishPending = true;

    // Cancel any existing debounce so we own the next debounce slot.
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.fileRenameReestablishPending = false;

      // Process the change that the rename brought.
      this.processCrossProcessChange();

      // Re-establish the file watcher on the new inode (file is now stable).
      if (this.crossProcessWatchEnabled) {
        this.closeCurrentWatcher();
        if (!this.tryStartFileWatch()) {
          // File missing after rename — unlikely but fall back to directory watch.
          this.startDirectoryWatchForFile();
        }
      }
    }, CROSS_PROCESS_WATCH_DEBOUNCE_MS);
  }

  /**
   * Close the currently active watcher (file or directory) without modifying
   * crossProcessWatchEnabled. Safe to call when no watcher is active.
   */
  private closeCurrentWatcher(): void {
    if (this.crossProcessWatcher !== null) {
      try {
        this.crossProcessWatcher.close();
      } catch {
        // Already closed — ignore.
      }
      this.crossProcessWatcher = null;
    }
    this.crossProcessWatchMode = null;
  }

  /**
   * Schedule a debounced read-diff-notify cycle.
   * Multiple rapid events (e.g., `change` + `rename` in quick succession) are
   * coalesced into a single cycle by resetting the timer on each event.
   */
  private scheduleDebouncedFlush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processCrossProcessChange();
    }, CROSS_PROCESS_WATCH_DEBOUNCE_MS);
  }

  /**
   * Handle a watcher error by attempting exponential-backoff retry.
   * After CROSS_PROCESS_WATCH_MAX_RETRIES failures, gives up gracefully.
   */
  private handleWatcherError(_err?: Error): void {
    this.closeCurrentWatcher();
    if (!this.crossProcessWatchEnabled) return;

    this.watcherRetries += 1;
    if (this.watcherRetries > CROSS_PROCESS_WATCH_MAX_RETRIES) {
      console.warn(
        `[PtahFileSettingsManager] fs.watch failed after ${CROSS_PROCESS_WATCH_MAX_RETRIES} retries on ` +
          `${this.filePath}. Cross-process reactivity disabled; in-process watch() still works.`,
      );
      return;
    }

    const backoffMs = Math.pow(2, this.watcherRetries - 1) * 100; // 100ms, 200ms, 400ms
    setTimeout(() => {
      if (this.crossProcessWatchEnabled) {
        this.startWatcher();
      }
    }, backoffMs);
  }

  /**
   * Read the settings file from disk, diff against the in-memory cache, and
   * fire listeners for any keys that changed.
   *
   * Self-write echo prevention: `set()` updates `this.settings` before the
   * async persist completes. By the time `fs.watch` fires for our own write,
   * the in-memory cache already matches disk — the diff produces zero changed
   * keys, so no listeners fire.
   */
  private processCrossProcessChange(): void {
    let freshSettings: Record<string, unknown>;

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      freshSettings = flattenObject(parsed);
    } catch (err: unknown) {
      // File might be mid-write or deleted — skip this event.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[PtahFileSettingsManager] Cross-process read failed for ${this.filePath}: ${msg}`,
      );
      return;
    }

    // Compute the union of all keys in both old and new states.
    const previousSettings = this.settings;
    const allKeys = new Set([
      ...Object.keys(previousSettings),
      ...Object.keys(freshSettings),
    ]);

    const changedKeys: string[] = [];
    for (const key of allKeys) {
      const oldVal = previousSettings[key];
      const newVal = freshSettings[key];
      if (!deepEqual(oldVal, newVal)) {
        changedKeys.push(key);
      }
    }

    if (changedKeys.length === 0) {
      // No changes — this was our own write echoing back. Do nothing.
      return;
    }

    // Update the cache to reflect the new on-disk state.
    this.settings = freshSettings;

    // Fire listeners for each changed key.
    for (const key of changedKeys) {
      const newVal = freshSettings[key];
      this.listeners.get(key)?.forEach((cb) => {
        try {
          cb(newVal);
        } catch {
          // Listener errors must not abort other listeners.
        }
      });
    }
  }

  /**
   * Synchronously load settings from disk on construction.
   * Handles first-run gracefully (file/directory don't exist).
   * Handles corrupted JSON gracefully (logs warning, starts with empty settings).
   */
  private loadSync(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Flatten the nested JSON structure to dot-notation keys
      this.settings = flattenObject(parsed);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        // File doesn't exist on first launch — start with empty settings
        this.settings = {};
        return;
      }
      // JSON parse error or other read error — log warning, start fresh
      console.warn(
        `[PtahFileSettingsManager] Failed to load settings from ${this.filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
      this.settings = {};
    }
  }

  /**
   * Persist settings to disk using atomic write (temp file + rename).
   * Creates ~/.ptah/ directory if it doesn't exist.
   * Unflattens dot-notation keys to nested JSON for human readability.
   */
  private async persist(): Promise<void> {
    try {
      // Ensure directory exists
      await fsPromises.mkdir(this.dirPath, { recursive: true });

      // Build the nested object from flat keys, including schema and version metadata
      const nested = unflattenObject(this.settings);
      const output = {
        $schema: 'https://ptah.live/schemas/settings.json',
        version: 1,
        ...nested,
      };

      const json = JSON.stringify(output, null, 2);
      const tmpPath = this.filePath + '.tmp';

      // Atomic write: write to temp file, then rename
      await fsPromises.writeFile(tmpPath, json, 'utf-8');
      await fsPromises.rename(tmpPath, this.filePath);
    } catch (error: unknown) {
      // Swallow persist errors — in-memory cache is authoritative.
      // Matches VscodeDiskStateStorage convention.
      console.warn(
        `[PtahFileSettingsManager] Failed to persist settings to ${this.filePath}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers: flatten / unflatten
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into dot-notation keys.
 *
 * Example:
 *   { provider: { "github-copilot": { clientId: "abc" } } }
 *   => { "provider.github-copilot.clientId": "abc" }
 *
 * Skips metadata keys ($schema, version) that are not settings.
 * Leaf values (primitives, arrays, null) are kept as-is; only plain objects are recursed.
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip file metadata keys — not actual settings
    if (prefix === '' && (key === '$schema' || key === 'version')) {
      continue;
    }

    const flatKey = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, flatKey),
      );
    } else {
      // Leaf value: primitive, array, or null
      result[flatKey] = value;
    }
  }

  return result;
}

/**
 * Unflatten dot-notation keys back into a nested object.
 *
 * Example:
 *   { "provider.github-copilot.clientId": "abc" }
 *   => { provider: { "github-copilot": { clientId: "abc" } } }
 */
function unflattenObject(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [flatKey, value] of Object.entries(flat)) {
    const parts = splitDotKey(flatKey);
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current) || !isPlainObject(current[part])) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return result;
}

/**
 * Split a dot-notation key into path segments.
 *
 * This is straightforward: split on '.' characters. Keys like
 * "provider.github-copilot.modelTier.opus" split into
 * ["provider", "github-copilot", "modelTier", "opus"].
 *
 * Hyphens within segments (like "github-copilot") are NOT split points.
 */
function splitDotKey(key: string): string[] {
  return key.split('.');
}

/**
 * Check if a value is a plain object (not array, not null, not Date, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Type guard for Node.js error with code property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Structural equality check for setting values.
 *
 * Used by the cross-process watcher diff to detect which keys changed.
 * Handles primitives, null, arrays (by JSON serialization), and plain objects
 * (by JSON serialization). JSON round-trip is sufficient here because setting
 * values originate from JSON.parse and contain only JSON-serializable types.
 *
 * WP-5A: Cross-process reactivity.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  // For objects and arrays, use JSON serialization as a fast structural check.
  // This is correct because settings round-trip through JSON.stringify/parse.
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
