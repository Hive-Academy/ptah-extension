import { app } from 'electron';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

// Ensure non-esbuild runtimes (such as Jest ts-jest specs that import IpcBridge)
// have a default boolean value on globalThis so `if (__PTAH_REPLAY_RECORDER__ && ...)`
// never throws ReferenceError, while esbuild still replaces the bare identifier
// with the literal `false` in production builds.
if (typeof __PTAH_REPLAY_RECORDER__ === 'undefined') {
  (globalThis as Record<string, unknown>)['__PTAH_REPLAY_RECORDER__'] = false;
}

export interface RawReplayRpcCase {
  readonly match: Record<string, unknown>;
  readonly data: unknown;
}

export interface RawReplayRpcError {
  readonly error: string;
  readonly errorCode?: string;
}

export interface RawReplayTimelineEntry {
  readonly at: number;
  readonly message: {
    readonly type: string;
    readonly payload?: unknown;
    readonly [key: string]: unknown;
  };
}

export interface RawReplayCapture {
  readonly recordedAt: string;
  readonly timeBase: number;
  readonly rpc: Record<string, unknown>;
  readonly rpcCases: Record<string, RawReplayRpcCase[]>;
  readonly rpcErrors: Record<string, RawReplayRpcError>;
  readonly timeline: RawReplayTimelineEntry[];
}

export interface ReplayRecorderOptions {
  readonly outputPath: string;
  readonly timeBase?: number;
  readonly now?: () => number;
  readonly debounceMs?: number;
  readonly maxTimelineEntries?: number;
  readonly writeFile?: (filePath: string, content: string) => void;
}

interface PendingRpcCall {
  readonly method: string;
  readonly params: unknown;
}

interface ObservedRpcCall {
  readonly paramsKey: string;
  readonly match: Record<string, unknown>;
  readonly dataKey: string;
  readonly data: unknown;
}

export interface ReplayRecorderGateDeps {
  readonly defineEnabled?: boolean;
  readonly isPackaged?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly app?: {
    readonly isPackaged?: boolean;
    on?(event: 'will-quit' | 'before-quit', listener: () => void): void;
  };
  readonly now?: () => number;
  readonly timeBase?: number;
  readonly debounceMs?: number;
  readonly maxTimelineEntries?: number;
  readonly writeFile?: (filePath: string, content: string) => void;
}

export const DEFAULT_FLUSH_DEBOUNCE_MS = 2_000;
export const DEFAULT_MAX_TIMELINE_ENTRIES = 10_000;
const MAX_PENDING_CALLS = 1_000;

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableSerialize(
  value: unknown,
  seen: Set<object> = new Set<object>(),
): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (seen.has(value)) {
    throw new TypeError('Cannot stableSerialize circular structure');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map(
        (key) => `${JSON.stringify(key)}:${stableSerialize(record[key], seen)}`,
      )
      .join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function toMatchObject(params: unknown): Record<string, unknown> {
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    return cloneJson(params as Record<string, unknown>);
  }
  if (params === undefined || params === null) {
    return {};
  }
  return { value: cloneJson(params) };
}

function formatRpcError(error: unknown): string {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) {
      return msg;
    }
  }
  return error !== undefined && error !== null
    ? String(error)
    : 'Unknown error';
}

/**
 * Atomic file write helper: writes to `${filePath}.tmp` and renames into place
 * so a crash or kill mid-write never leaves a truncated capture file.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  writeFileSync(tempPath, content, 'utf8');
  renameSync(tempPath, filePath);
}

/**
 * Checks whether an output file path is valid for raw replay recording:
 * - Must be an absolute path (POSIX or Windows)
 * - Must not point inside any `dist/` or `public/` directory segment
 * - Must include a filename (not end with a path separator)
 */
export function isValidReplayOutputPath(
  outPath: string | undefined,
): outPath is string {
  if (typeof outPath !== 'string') return false;
  const trimmed = outPath.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) return false;

  const isAbsolute =
    path.isAbsolute(trimmed) ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed);
  if (!isAbsolute) return false;

  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return false;
  for (const segment of segments) {
    if (segment === '..' || segment === 'dist' || segment === 'public') {
      return false;
    }
  }
  return true;
}

const disabledRecorderSet = new WeakSet<object>();
const loggedRecorderSet = new WeakSet<object>();

/**
 * Non-throwing tap wrapper for `IpcBridge`.
 * Executes `fn(recorder)` if the recorder is active; on any thrown error,
 * logs a single warning and permanently disables the recorder so recorder
 * faults can never alter IPC bridge behavior.
 */
export function tapReplayRecorder<T extends object>(
  recorder: T | null | undefined,
  fn: (rec: T) => unknown,
): void {
  if (!recorder || disabledRecorderSet.has(recorder)) {
    return;
  }
  if (
    'isDisabled' in recorder &&
    typeof (recorder as { isDisabled?: unknown }).isDisabled === 'function' &&
    (recorder as { isDisabled(): boolean }).isDisabled()
  ) {
    disabledRecorderSet.add(recorder);
    return;
  }
  try {
    fn(recorder);
  } catch (error) {
    // degradation-audit: reported - the recorder is disabled and the error goes to disableOnError or console.warn
    disabledRecorderSet.add(recorder);
    if (
      'disableOnError' in recorder &&
      typeof (recorder as { disableOnError?: unknown }).disableOnError ===
        'function'
    ) {
      (recorder as { disableOnError(err: unknown): void }).disableOnError(
        error,
      );
      return;
    }
    if (!loggedRecorderSet.has(recorder)) {
      loggedRecorderSet.add(recorder);
      console.warn(
        '[ReplayRecorder] Recorder disabled after unexpected error:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

/**
 * Dev-only Electron IPC replay recorder.
 *
 * Captures accepted RPC calls/results and host-to-renderer pushes in their
 * exact delivery order, keeping `batch` envelopes intact and excluding
 * `rpc:response` messages from the timeline.
 */
export class ReplayRecorder {
  private readonly outputPath: string;
  private readonly timeBase: number;
  private readonly recordedAt: string;
  private readonly now: () => number;
  private readonly startPerfNow: number;
  private readonly debounceMs: number;
  private readonly maxTimelineEntries: number;
  private readonly writeFile: (filePath: string, content: string) => void;

  private readonly pendingCalls = new Map<string, PendingRpcCall>();
  private readonly rpc = new Map<string, unknown>();
  private readonly observationsByMethod = new Map<string, ObservedRpcCall[]>();
  private readonly rpcErrors = new Map<string, RawReplayRpcError>();
  private readonly timeline: RawReplayTimelineEntry[] = [];
  private readonly serializedTimeline: string[] = [];
  private lastAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disabled = false;
  private warnedTimelineCap = false;

  constructor(options: ReplayRecorderOptions) {
    if (!isValidReplayOutputPath(options.outputPath)) {
      throw new Error(
        `Invalid replay recorder output path: ${String(options.outputPath)}`,
      );
    }
    this.outputPath = options.outputPath;
    this.timeBase = options.timeBase ?? Date.now();
    this.recordedAt = new Date(this.timeBase).toISOString();
    this.now = options.now ?? (() => performance.now());
    this.startPerfNow = this.now();
    this.debounceMs = options.debounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
    this.maxTimelineEntries =
      options.maxTimelineEntries ?? DEFAULT_MAX_TIMELINE_ENTRIES;
    this.writeFile = options.writeFile ?? atomicWriteFileSync;
  }

  /**
   * Whether the recorder has been disabled due to an internal or I/O error.
   */
  isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * Disable the recorder and log the failure once.
   */
  disableOnError(error: unknown): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.disabled = true;
    disabledRecorderSet.add(this);
    this.pendingCalls.clear();
    if (!loggedRecorderSet.has(this)) {
      loggedRecorderSet.add(this);
      console.warn(
        '[ReplayRecorder] Recorder disabled after error:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private runSafely(fn: () => void): void {
    if (this.disabled) return;
    try {
      fn();
    } catch (error) {
      this.disableOnError(error);
    }
  }

  /**
   * Record an accepted RPC request after sender validation.
   */
  recordRpcCall(method: string, params: unknown, correlationId: string): void {
    this.runSafely(() => {
      if (!method || typeof method !== 'string') return;
      const key = correlationId || `__anon_${method}`;
      if (
        !this.pendingCalls.has(key) &&
        this.pendingCalls.size >= MAX_PENDING_CALLS
      ) {
        const oldestKey = this.pendingCalls.keys().next().value;
        if (oldestKey !== undefined) {
          this.pendingCalls.delete(oldestKey);
        }
      }
      this.pendingCalls.set(key, {
        method,
        params: cloneJson(params),
      });
    });
  }

  /**
   * Record the RPC response corresponding to an earlier `recordRpcCall`.
   * Successful responses populate `rpc[method]` and, when the same method
   * returns different data for different params, `rpcCases[method]`.
   * Failed responses populate `rpcErrors[method]`.
   */
  recordRpcResult(
    correlationId: string,
    response: {
      readonly success: boolean;
      readonly data?: unknown;
      readonly error?: unknown;
      readonly errorCode?: string;
    },
    methodFallback?: string,
    paramsFallback?: unknown,
  ): void {
    this.runSafely(() => {
      const pending = correlationId
        ? this.pendingCalls.get(correlationId)
        : undefined;
      if (correlationId) {
        this.pendingCalls.delete(correlationId);
      }
      const method = pending?.method ?? methodFallback;
      if (!method) return;
      const params = pending ? pending.params : cloneJson(paramsFallback);

      if (!response.success) {
        const errorEntry: RawReplayRpcError = {
          error: formatRpcError(response.error),
          ...(typeof response.errorCode === 'string' &&
          response.errorCode.length > 0
            ? { errorCode: response.errorCode }
            : {}),
        };
        this.rpcErrors.set(method, errorEntry);
        this.scheduleFlush();
        return;
      }

      const clonedData = cloneJson(response.data ?? null);
      if (!this.rpc.has(method)) {
        this.rpc.set(method, clonedData);
      }

      const match = toMatchObject(params);
      const paramsKey = stableSerialize(match);
      const dataKey = stableSerialize(clonedData);
      const list = this.observationsByMethod.get(method) ?? [];
      const existingIndex = list.findIndex(
        (item) => item.paramsKey === paramsKey,
      );
      const observation: ObservedRpcCall = {
        paramsKey,
        match,
        dataKey,
        data: clonedData,
      };
      if (existingIndex >= 0) {
        list[existingIndex] = observation;
      } else {
        list.push(observation);
      }
      this.observationsByMethod.set(method, list);

      // If all observations share the same paramsKey, update `rpc[method]` to the latest data.
      if (list.length === 1) {
        this.rpc.set(method, clonedData);
      }
      this.scheduleFlush();
    });
  }

  /**
   * Record a host-to-renderer push at `webContents.send('to-renderer', message)`.
   * Preserves `batch` envelopes and delivery order. Never records `rpc:response`.
   */
  recordPush(message: unknown): void {
    this.runSafely(() => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return;
      }
      const msg = message as Record<string, unknown>;
      const type = msg['type'];
      if (typeof type !== 'string' || type.length === 0) {
        return;
      }
      if (type === MESSAGE_TYPES.RPC_RESPONSE || type === 'rpc:response') {
        return;
      }

      if (this.timeline.length >= this.maxTimelineEntries) {
        if (!this.warnedTimelineCap) {
          this.warnedTimelineCap = true;
          console.warn(
            `[ReplayRecorder] Timeline soft cap (${this.maxTimelineEntries}) reached; dropping further push events.`,
          );
        }
        return;
      }

      let clonedMessage = cloneJson(msg) as {
        type: string;
        payload?: unknown;
        [key: string]: unknown;
      };

      if (type === MESSAGE_TYPES.BATCH || type === 'batch') {
        const payload = clonedMessage.payload;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const events = (payload as { events?: unknown }).events;
          if (Array.isArray(events)) {
            const filteredEvents = events.filter((event) => {
              if (!event || typeof event !== 'object') return false;
              const eventType = (event as { type?: unknown }).type;
              return (
                typeof eventType === 'string' &&
                eventType !== MESSAGE_TYPES.RPC_RESPONSE &&
                eventType !== 'rpc:response'
              );
            });
            if (filteredEvents.length === 0) {
              return;
            }
            clonedMessage = {
              ...clonedMessage,
              payload: {
                ...(payload as Record<string, unknown>),
                events: filteredEvents,
              },
            };
          }
        }
      }

      const rawElapsed = Math.max(
        0,
        Math.round(this.now() - this.startPerfNow),
      );
      const at = Math.max(this.lastAt, rawElapsed);
      this.lastAt = at;

      const entry: RawReplayTimelineEntry = {
        at,
        message: clonedMessage,
      };
      const serializedEntry = JSON.stringify(entry);
      this.timeline.push(entry);
      this.serializedTimeline.push(serializedEntry);
      this.scheduleFlush();
    });
  }

  private buildHeaderObjects(deepClone: boolean): {
    rpc: Record<string, unknown>;
    rpcCases: Record<string, RawReplayRpcCase[]>;
    rpcErrors: Record<string, RawReplayRpcError>;
  } {
    const rpcObj: Record<string, unknown> = {};
    for (const [method, data] of this.rpc.entries()) {
      rpcObj[method] = deepClone ? cloneJson(data) : data;
    }

    const rpcCasesObj: Record<string, RawReplayRpcCase[]> = {};
    for (const [method, observations] of this.observationsByMethod.entries()) {
      if (observations.length < 2) continue;
      const distinctDataKeys = new Set(observations.map((obs) => obs.dataKey));
      if (distinctDataKeys.size < 2) continue;
      rpcCasesObj[method] = observations.map((obs) => ({
        match: deepClone ? cloneJson(obs.match) : obs.match,
        data: deepClone ? cloneJson(obs.data) : obs.data,
      }));
    }

    const rpcErrorsObj: Record<string, RawReplayRpcError> = {};
    for (const [method, err] of this.rpcErrors.entries()) {
      rpcErrorsObj[method] = deepClone ? cloneJson(err) : err;
    }

    return {
      rpc: rpcObj,
      rpcCases: rpcCasesObj,
      rpcErrors: rpcErrorsObj,
    };
  }

  /**
   * Snapshot the current capture state without writing to disk.
   */
  getSnapshot(): RawReplayCapture {
    const { rpc, rpcCases, rpcErrors } = this.buildHeaderObjects(true);
    return {
      recordedAt: this.recordedAt,
      timeBase: this.timeBase,
      rpc,
      rpcCases,
      rpcErrors,
      timeline: cloneJson(this.timeline),
    };
  }

  /**
   * Assemble capture JSON using pre-serialized timeline strings without
   * deep-cloning or re-serializing the timeline array on every flush.
   */
  private serializeIncrementalCapture(
    rpc: Record<string, unknown>,
    rpcCases: Record<string, RawReplayRpcCase[]>,
    rpcErrors: Record<string, RawReplayRpcError>,
  ): string {
    const prefix =
      `{"recordedAt":${JSON.stringify(this.recordedAt)},` +
      `"timeBase":${JSON.stringify(this.timeBase)},` +
      `"rpc":${JSON.stringify(rpc)},` +
      `"rpcCases":${JSON.stringify(rpcCases)},` +
      `"rpcErrors":${JSON.stringify(rpcErrors)},` +
      `"timeline":[`;
    return `${prefix}${this.serializedTimeline.join('') ? this.serializedTimeline.join(',') : ''}]}\n`;
  }

  /**
   * Flush the raw capture JSON to `outputPath` immediately and clear any pending debounce timer.
   * Never throws: on write failure, logs once and disables the recorder.
   */
  flush(): RawReplayCapture {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const { rpc, rpcCases, rpcErrors } = this.buildHeaderObjects(false);
    const snapshot: RawReplayCapture = {
      recordedAt: this.recordedAt,
      timeBase: this.timeBase,
      rpc,
      rpcCases,
      rpcErrors,
      timeline: this.timeline.slice(),
    };
    if (this.disabled) {
      return snapshot;
    }
    try {
      const payload = this.serializeIncrementalCapture(
        rpc,
        rpcCases,
        rpcErrors,
      );
      this.writeFile(this.outputPath, payload);
    } catch (error) {
      this.disableOnError(error);
    }
    return snapshot;
  }

  private scheduleFlush(): void {
    if (this.disabled || this.debounceMs <= 0) return;
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.debounceMs);
  }
}

/**
 * Factory that creates a `ReplayRecorder` ONLY when all 5 gate conditions hold:
 * 1. Build-time define `__PTAH_REPLAY_RECORDER__` is `true`
 * 2. `!app.isPackaged`
 * 3. `process.env.NODE_ENV === 'development'`
 * 4. `process.env.PTAH_REPLAY_RECORD === '1'`
 * 5. `process.env.PTAH_REPLAY_RECORD_OUT` is an absolute path outside `dist/` and `public/`
 */
export function createReplayRecorderIfEnabled(
  deps: ReplayRecorderGateDeps = {},
): ReplayRecorder | null {
  try {
    const defineEnabled =
      deps.defineEnabled !== undefined
        ? deps.defineEnabled
        : typeof __PTAH_REPLAY_RECORDER__ !== 'undefined' &&
          __PTAH_REPLAY_RECORDER__ === true;
    if (!defineEnabled) {
      return null;
    }

    const electronApp = deps.app ?? app;
    const isPackaged = deps.isPackaged ?? electronApp?.isPackaged ?? false;
    if (isPackaged) {
      return null;
    }

    const env = deps.env ?? process.env;
    if (env['NODE_ENV'] !== 'development') {
      return null;
    }
    if (env['PTAH_REPLAY_RECORD'] !== '1') {
      return null;
    }

    const outputPath = env['PTAH_REPLAY_RECORD_OUT'];
    if (!isValidReplayOutputPath(outputPath)) {
      return null;
    }

    const recorder = new ReplayRecorder({
      outputPath: outputPath.trim(),
      now: deps.now,
      timeBase: deps.timeBase,
      debounceMs: deps.debounceMs,
      maxTimelineEntries: deps.maxTimelineEntries,
      writeFile: deps.writeFile,
    });

    if (typeof electronApp?.on === 'function') {
      electronApp.on('will-quit', () => {
        tapReplayRecorder(recorder, (r) => r.flush());
      });
    }

    return recorder;
  } catch (error) {
    // degradation-audit: reported - replay recording is optional; the init failure is logged and no recorder is used
    console.warn(
      '[ReplayRecorder] Failed to initialize recorder:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
