/**
 * Outbound-network recorder for the memory-skills bench (benchmark-design.md
 * 6.2 / R13), ported from the 563 net guard
 * (.ptah/specs/TASK_2026_563_2939/harness/lib/net-guard.ts). CI suite
 * execution runs with this recorder installed, and any recorded outbound
 * attempt fails the run.
 *
 * The recorder wraps the four entry points every outbound connection in Node
 * passes through, appends one JSON line per attempt to a log file, and
 * forwards the call unchanged, so it cannot change behaviour:
 *   - `net.Socket.prototype.connect` (TCP; undici/fetch, http, https and tls
 *     all reach it; local IPC pipes record with kind `ipc`, and unlike the
 *     563 guard a pipe passed as a plain connect path is recognised too)
 *   - `dns.lookup` and `dns.promises.lookup`
 *   - `globalThis.fetch`
 * It records in the main thread and inside worker threads. Worker threads do
 * not share the main thread's module patches, so `startNetRecorder` also
 * writes a CommonJS guard module; `guardedWorkerEntry` wraps any worker entry
 * so the same patches install in the worker before the worker's own code
 * runs (the 563 pattern: a generated wrapper requires the guard first).
 *
 * Two properties the 563 guard did not have:
 *   - determinism: a log line carries only `{tag, kind, detail}` (no
 *     timestamp), and every projection is sorted by kind, tag, detail, so a
 *     run's verdict never depends on when or in which order attempts happened;
 *   - stop(): the main-thread patches are restored exactly once even when the
 *     subsequent log read throws (restore runs before the read).
 *
 * The recorder never swallows errors: a failed log append surfaces to the
 * code that connected, a malformed log line surfaces to the caller that read
 * it, and a failed connect, lookup or fetch propagates unchanged.
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

/** Kinds that count as outbound attempts and fail a run. */
export type NetOutboundKind = 'dns-lookup' | 'fetch' | 'tcp-connect';

/** Every kind a log line can carry; `ipc` and `installed` are diagnostics. */
export type NetEntryKind = NetOutboundKind | 'ipc' | 'installed';

/** One outbound attempt, as `failIfAny` reports it. */
export interface NetAttempt {
  readonly kind: NetOutboundKind;
  readonly tag: string;
  readonly detail: string;
}

/** One log line, including the local-IPC and install-marker entries. */
export interface NetLogEntry {
  readonly kind: NetEntryKind;
  readonly tag: string;
  readonly detail: string;
}

/** The log file must be new and must not sit in the real `~/.ptah` home. */
export class NetRecorderTargetError extends Error {
  constructor(target: string, reason: string) {
    super(`net-recorder: refusing target ${target}: ${reason}`);
    this.name = 'NetRecorderTargetError';
  }
}

/** Thrown by `failIfAny` when suite execution recorded an outbound attempt. */
export class NetRecorderViolationError extends Error {
  readonly label: string;
  readonly attempts: readonly NetAttempt[];
  readonly logFile: string;

  constructor(label: string, attempts: readonly NetAttempt[], logFile: string) {
    const lines = attempts.map(
      (attempt, index) =>
        `  ${index + 1}. [${attempt.kind}] ${attempt.tag} ${attempt.detail}`,
    );
    super(
      `${label}: ${attempts.length} outbound network attempt(s) recorded ` +
        `during suite execution (log: ${logFile})\n${lines.join('\n')}`,
    );
    this.name = 'NetRecorderViolationError';
    this.label = label;
    this.attempts = attempts;
    this.logFile = logFile;
  }
}

export const NET_RECORDER_GUARD_FILE = 'net-recorder-guard.cjs';

const NET_ENTRY_KINDS: readonly string[] = [
  'dns-lookup',
  'fetch',
  'tcp-connect',
  'ipc',
  'installed',
];

export interface NetRecorderOptions {
  /** Directory for the guard module and generated worker wrappers. */
  readonly dir?: string;
  /** Explicit log file path. Default: `<dir>/net-recorder.log`. Must be new. */
  readonly logFile?: string;
  /** Tag for main-thread entries. Default: `main`. */
  readonly mainTag?: string;
}

export interface NetRecorderHandle {
  readonly dir: string;
  readonly logFile: string;
  readonly guardModulePath: string;

  /** Sorted outbound attempts (no `ipc`, no install markers). */
  attempts(): NetAttempt[];
  /** Sorted log entries, including `ipc` and install markers. */
  allEntries(): NetLogEntry[];
  /** Sorted install markers, one per thread the guard was installed in. */
  installs(): NetLogEntry[];
  /**
   * Write a CommonJS wrapper that installs the guard inside a worker thread
   * (tag `tag`, default `worker`) before requiring `workerEntryPath`, and
   * return the wrapper path to hand to `new Worker(...)`.
   */
  guardedWorkerEntry(workerEntryPath: string, tag?: string): string;
  /** Fail the run when any outbound attempt was recorded. */
  failIfAny(label: string): void;
  /**
   * Restore the main-thread patches exactly once, then return the sorted
   * outbound attempts. Restore happens before the log read, so the patches are
   * back in place even when the read throws; the read error propagates.
   */
  stop(): NetAttempt[];
}

/**
 * The worker-thread guard, written as CommonJS because a worker loads it with
 * Node's own `require`, outside any bundler. It is the same patch set the
 * main thread installs in TypeScript below, so the two must stay in sync (the
 * spec exercises both paths). `install` returns a `restore` function; a
 * worker never needs it, the main thread uses its own typed restore instead.
 */
const NET_GUARD_SOURCE = `'use strict';
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
exports.install = function install(logFile, tag) {
  if (!logFile) throw new Error('net-recorder: no log file');
  const note = (kind, detail) => {
    fs.appendFileSync(logFile, JSON.stringify({ tag: tag, kind: kind, detail: detail }) + '\\n');
  };
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = args[0];
    const opts = Array.isArray(first) ? first[0] : first;
    const detail = opts && typeof opts === 'object'
      ? JSON.stringify({ host: opts.host, port: opts.port, path: opts.path })
      : JSON.stringify(args.slice(0, 2));
    const isPipe = typeof opts === 'string' ||
      (opts && typeof opts === 'object' && typeof opts.path === 'string');
    note(isPipe ? 'ipc' : 'tcp-connect', detail);
    return origConnect.apply(this, args);
  };
  const origLookup = dns.lookup;
  dns.lookup = function (host, ...rest) {
    note('dns-lookup', String(host));
    return origLookup.call(this, host, ...rest);
  };
  let origPromisesLookup = null;
  if (dns.promises && dns.promises.lookup) {
    origPromisesLookup = dns.promises.lookup;
    dns.promises.lookup = function (host, ...rest) {
      note('dns-lookup', String(host));
      return origPromisesLookup.call(this, host, ...rest);
    };
  }
  let origFetch = null;
  if (typeof globalThis.fetch === 'function') {
    origFetch = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      note('fetch', fetchTarget(input));
      return origFetch.call(this, input, init);
    };
  }
  function fetchTarget(input) {
    if (typeof input === 'string') return input;
    if (input && input.url) return String(input.url);
    return String(input);
  }
  note('installed', JSON.stringify({
    HTTPS_PROXY: process.env.HTTPS_PROXY || null,
    HTTP_PROXY: process.env.HTTP_PROXY || null,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || null,
  }));
  return function restore() {
    net.Socket.prototype.connect = origConnect;
    dns.lookup = origLookup;
    if (origPromisesLookup) dns.promises.lookup = origPromisesLookup;
    if (origFetch) globalThis.fetch = origFetch;
  };
};
`;

/** A patched function shape: any receiver, any args, opaque result. */
type PatchedFn = (this: unknown, ...args: unknown[]) => unknown;

function fetchTarget(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input !== null && typeof input === 'object' && 'url' in input) {
    return String((input as { url?: unknown }).url);
  }
  return String(input);
}

function connectDetail(first: unknown, args: unknown[]): string {
  const opts = Array.isArray(first) ? first[0] : first;
  if (opts !== null && typeof opts === 'object') {
    return JSON.stringify({
      host: (opts as { host?: unknown }).host,
      port: (opts as { port?: unknown }).port,
      path: (opts as { path?: unknown }).path,
    });
  }
  return JSON.stringify(args.slice(0, 2));
}

function isPipeConnect(first: unknown): boolean {
  const opts = Array.isArray(first) ? first[0] : first;
  if (typeof opts === 'string') {
    return true;
  }
  return (
    opts !== null &&
    typeof opts === 'object' &&
    typeof (opts as { path?: unknown }).path === 'string'
  );
}

/**
 * Replace an own property on `target` and return a function that restores
 * the exact original descriptor. Plain assignment is not enough on two
 * targets: `import * as dns` (a CJS interop namespace) exposes getter-only
 * copies, so the recorder patches the builtin's own exports object, which
 * `require` returns; and `globalThis.fetch` may be a lazy getter.
 * `Object.defineProperty` handles both, and descriptor restore puts every
 * target back in its exact prior shape.
 */
function overrideProperty(
  target: object,
  key: string,
  value: unknown,
): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  if (!original) {
    throw new Error(
      `net-recorder: no property descriptor for ${key} on the patch target`,
    );
  }
  if (!original.configurable) {
    throw new Error(
      `net-recorder: ${key} is not configurable, so it cannot be recorded`,
    );
  }
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: original.enumerable ?? true,
    configurable: true,
  });
  return function restoreProperty(): void {
    Object.defineProperty(target, key, original);
  };
}

/**
 * Install the main-thread patches and return a restore function. The restore
 * is idempotent; it puts back the exact original descriptor of every target,
 * so a stop during which something else also patched a global last-wins for
 * that global.
 */
function installMainThreadGuard(logFile: string, tag: string): () => void {
  const note = (kind: NetEntryKind, detail: string): void => {
    appendFileSync(logFile, JSON.stringify({ kind, tag, detail }) + '\n');
  };

  const restores: Array<() => void> = [];

  const origConnect = (
    net.Socket.prototype as unknown as {
      connect: PatchedFn;
    }
  ).connect;
  restores.push(
    overrideProperty(
      net.Socket.prototype,
      'connect',
      function (this: unknown, ...args: unknown[]): unknown {
        note(
          isPipeConnect(args[0]) ? 'ipc' : 'tcp-connect',
          connectDetail(args[0], args),
        );
        return origConnect.apply(this, args);
      },
    ),
  );

  const dnsModule = require('node:dns') as typeof import('node:dns');
  const origLookup = dnsModule.lookup as unknown as PatchedFn;
  restores.push(
    overrideProperty(
      dnsModule,
      'lookup',
      function (this: unknown, host: unknown, ...rest: unknown[]): unknown {
        note('dns-lookup', String(host));
        return origLookup.call(this, host, ...rest);
      },
    ),
  );
  const origPromiseLookup = dnsModule.promises
    ? (dnsModule.promises.lookup as unknown as PatchedFn)
    : undefined;
  if (origPromiseLookup) {
    restores.push(
      overrideProperty(
        dnsModule.promises,
        'lookup',
        function (this: unknown, host: unknown, ...rest: unknown[]): unknown {
          note('dns-lookup', String(host));
          return origPromiseLookup.call(this, host, ...rest);
        },
      ),
    );
  }

  const origFetch =
    typeof globalThis.fetch === 'function'
      ? (globalThis.fetch as unknown as PatchedFn)
      : undefined;
  if (origFetch) {
    restores.push(
      overrideProperty(
        globalThis,
        'fetch',
        function (this: unknown, input: unknown, init?: unknown): unknown {
          note('fetch', fetchTarget(input));
          return origFetch.call(this, input, init);
        },
      ),
    );
  }

  note(
    'installed',
    JSON.stringify({
      HTTPS_PROXY: process.env['HTTPS_PROXY'] ?? null,
      HTTP_PROXY: process.env['HTTP_PROXY'] ?? null,
      NODE_USE_ENV_PROXY: process.env['NODE_USE_ENV_PROXY'] ?? null,
    }),
  );

  let restored = false;
  return function restoreMainThread(): void {
    if (restored) {
      return;
    }
    restored = true;
    // Every patch is restored even if an earlier restore throws; otherwise a
    // single failure would leave the remaining globals patched for the rest
    // of the process. All failures are reported together afterwards.
    const failures: unknown[] = [];
    for (const restore of restores.reverse()) {
      try {
        restore();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'net-recorder: failed to restore patched globals',
      );
    }
  };
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Deterministic projection: same log, same array, on every platform and every
 * read, independent of write order. The log is written by our own guard, but
 * it is still a file boundary, so a line that is not JSON or not the expected
 * shape is an error, never silently dropped or passed through.
 */
function readNetRecorderLog(logFile: string): NetLogEntry[] {
  const entries: NetLogEntry[] = [];
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parsed = JSON.parse(trimmed) as Partial<NetLogEntry>;
    if (
      typeof parsed.kind !== 'string' ||
      typeof parsed.tag !== 'string' ||
      typeof parsed.detail !== 'string' ||
      !NET_ENTRY_KINDS.includes(parsed.kind)
    ) {
      throw new Error(`net-recorder: malformed line in ${logFile}: ${trimmed}`);
    }
    entries.push({
      kind: parsed.kind as NetEntryKind,
      tag: parsed.tag,
      detail: parsed.detail,
    });
  }
  entries.sort((left, right) => {
    const byKind = compareText(left.kind, right.kind);
    if (byKind !== 0) {
      return byKind;
    }
    const byTag = compareText(left.tag, right.tag);
    if (byTag !== 0) {
      return byTag;
    }
    return compareText(left.detail, right.detail);
  });
  return entries;
}

function isOutboundKind(kind: NetEntryKind): kind is NetOutboundKind {
  return kind === 'dns-lookup' || kind === 'fetch' || kind === 'tcp-connect';
}

function assertSafeRecorderTarget(logFile: string): void {
  const target = resolve(logFile);
  const realPtahHome = resolve(homedir(), '.ptah');
  if (target === realPtahHome || target.startsWith(realPtahHome + sep)) {
    throw new NetRecorderTargetError(
      target,
      `the recorder must never touch the real ~/.ptah home (${realPtahHome})`,
    );
  }
  if (existsSync(target)) {
    throw new NetRecorderTargetError(
      target,
      'the recorder log file must be new; refusing to truncate an existing file',
    );
  }
}

/**
 * Start the recorder: patch the four entry points in this (main) thread, write
 * the worker guard module, and create the (new) log file. The handle restores
 * the patches on `stop`, even when the log read fails afterwards.
 */
export function startNetRecorder(
  options: NetRecorderOptions = {},
): NetRecorderHandle {
  const dir =
    options.dir ?? mkdtempSync(join(tmpdir(), 'ptah-620-net-recorder-'));
  const logFile = options.logFile ?? join(dir, 'net-recorder.log');
  assertSafeRecorderTarget(logFile);
  mkdirSync(dirname(logFile), { recursive: true });

  const guardModulePath = join(dir, NET_RECORDER_GUARD_FILE);
  writeFileSync(guardModulePath, NET_GUARD_SOURCE, 'utf8');
  writeFileSync(logFile, '', 'utf8');

  const tag = options.mainTag ?? 'main';
  let restoreMainThread: (() => void) | null = installMainThreadGuard(
    logFile,
    tag,
  );

  const allEntries = (): NetLogEntry[] => readNetRecorderLog(logFile);
  const attempts = (): NetAttempt[] =>
    allEntries().filter((entry): entry is NetAttempt =>
      isOutboundKind(entry.kind),
    );

  return {
    dir,
    logFile,
    guardModulePath,
    attempts,
    allEntries,
    installs: () => allEntries().filter((entry) => entry.kind === 'installed'),
    guardedWorkerEntry: (workerEntryPath: string, workerTag = 'worker') => {
      // Content-addressed name: the same worker entry + tag rewrites the same
      // wrapper with the same bytes; two workers never share a wrapper.
      const hash = createHash('sha256')
        .update(`${workerEntryPath}|${workerTag}`, 'utf8')
        .digest('hex')
        .slice(0, 12);
      const wrapperPath = join(
        dir,
        `net-recorder-worker-${workerTag}-${hash}.cjs`,
      );
      writeFileSync(
        wrapperPath,
        `'use strict';\n` +
          `require(${JSON.stringify(guardModulePath)}).install(` +
          `${JSON.stringify(logFile)}, ${JSON.stringify(workerTag)});\n` +
          `require(${JSON.stringify(workerEntryPath)});\n`,
        'utf8',
      );
      return wrapperPath;
    },
    failIfAny: (label: string) => {
      const recorded = attempts();
      if (recorded.length > 0) {
        throw new NetRecorderViolationError(label, recorded, logFile);
      }
    },
    stop: (): NetAttempt[] => {
      const restore = restoreMainThread;
      restoreMainThread = null;
      if (restore) {
        restore();
      }
      return attempts();
    },
  };
}
