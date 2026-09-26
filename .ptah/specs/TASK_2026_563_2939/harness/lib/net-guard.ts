/**
 * Outbound-network recorder for the M3 8(a) locality proof
 * (implementation-plan.md measurement table, "M3 reach": "Repeat after with
 * HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:9 to prove the path is local").
 *
 * A dead proxy alone proves little under Node: the built-in `fetch` ignores
 * `HTTP(S)_PROXY` unless `NODE_USE_ENV_PROXY=1`, so a direct connection would
 * succeed unnoticed. This recorder closes that gap. It wraps the four entry
 * points every outbound connection in Node passes through, in the main thread
 * AND inside the embedder worker thread, and appends one line per attempt to a
 * log file:
 *   - `net.Socket.prototype.connect` (TCP; undici/fetch, http, https, tls all
 *     reach it; local IPC pipes are recorded with kind `ipc`)
 *   - `dns.lookup` and `dns.promises.lookup`
 *   - `globalThis.fetch`
 * It records and forwards; it never blocks, so it cannot change behaviour.
 *
 * The same source text is written to `%TEMP%\mqs-563-eval\net-guard.cjs` and
 * required by a generated worker wrapper, because worker threads do not share
 * the main thread's module patches.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EVAL_DIR, assertSafeTarget } from './copy-db';
import { WORKER_BUNDLE } from './embedder';

export const NET_GUARD_FILE = path.join(EVAL_DIR, 'net-guard.cjs');
export const GUARDED_WORKER_FILE = path.join(
  EVAL_DIR,
  'embedder-worker-guarded.cjs',
);

const GUARD_SOURCE = `'use strict';
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
exports.install = function install(logFile, tag) {
  if (!logFile) throw new Error('net-guard: no log file');
  const note = (kind, detail) => {
    try { fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), tag, kind, detail }) + '\\n'); } catch (_) {}
  };
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const a = args[0];
    const o = Array.isArray(a) ? a[0] : a;
    const detail = o && typeof o === 'object'
      ? JSON.stringify({ host: o.host, port: o.port, path: o.path })
      : JSON.stringify(args.slice(0, 2));
    const ipc = o && typeof o === 'object' && typeof o.path === 'string';
    note(ipc ? 'ipc' : 'tcp-connect', detail);
    return origConnect.apply(this, args);
  };
  const origLookup = dns.lookup;
  dns.lookup = function (host, ...rest) { note('dns-lookup', String(host)); return origLookup.call(this, host, ...rest); };
  if (dns.promises && dns.promises.lookup) {
    const origP = dns.promises.lookup;
    dns.promises.lookup = function (host, ...rest) { note('dns-lookup', String(host)); return origP.call(this, host, ...rest); };
  }
  if (typeof globalThis.fetch === 'function') {
    const origFetch = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && (input.url || String(input)));
      note('fetch', String(url));
      return origFetch.call(this, input, init);
    };
  }
  note('installed', JSON.stringify({ HTTPS_PROXY: process.env.HTTPS_PROXY || null, HTTP_PROXY: process.env.HTTP_PROXY || null, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || null }));
};
`;

export interface NetGuardHandle {
  readonly logFile: string;
  readonly workerPath: string;
  /** Every recorded line except the two `installed` markers. */
  attempts(): Array<{ at: string; tag: string; kind: string; detail: string }>;
  installs(): Array<{ at: string; tag: string; kind: string; detail: string }>;
}

/**
 * Write the guard and the guarded worker wrapper into the eval dir, install the
 * guard in this (main) thread, and return the worker path to hand to
 * `HarnessEmbedderWorkerFactory`. The log file must be new.
 */
export function installNetGuard(label: string): NetGuardHandle {
  const logFile = assertSafeTarget(
    path.join(EVAL_DIR, `netguard-${label}.log`),
  );
  fs.writeFileSync(NET_GUARD_FILE, GUARD_SOURCE);
  fs.writeFileSync(
    GUARDED_WORKER_FILE,
    `'use strict';\nrequire(${JSON.stringify(NET_GUARD_FILE)}).install(${JSON.stringify(logFile)}, 'embedder-worker');\nrequire(${JSON.stringify(WORKER_BUNDLE)});\n`,
  );
  fs.writeFileSync(logFile, '');
  // Dynamic path: esbuild leaves it as a runtime require of the file just written.
  const guard = require(NET_GUARD_FILE) as {
    install(file: string, tag: string): void;
  };
  guard.install(logFile, 'main');
  const read = () =>
    fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map(
        (l) =>
          JSON.parse(l) as {
            at: string;
            tag: string;
            kind: string;
            detail: string;
          },
      );
  return {
    logFile,
    workerPath: GUARDED_WORKER_FILE,
    attempts: () => read().filter((r) => r.kind !== 'installed'),
    installs: () => read().filter((r) => r.kind === 'installed'),
  };
}
