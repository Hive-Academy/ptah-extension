/**
 * The main-loop watchdog worker's program text, carried as a string.
 *
 * **Why a string.** The worker starts with `new Worker(source, { eval: true })`,
 * the same shape as workspace-intelligence's `ts-diagnostics-worker-source.ts`.
 * There is nothing to resolve on disk and nothing to bundle, so no host needs a
 * new esbuild target, packaging asset or factory port, and the worker behaves
 * the same under Jest (CJS), the Electron ESM bundle and the CLI ESM bundle.
 *
 * **Why a worker at all.** The watchdog exists to record a hang of the MAIN
 * event loop. Any timer on that loop stops firing during the very block it
 * would report, so the thing that notices the missing heartbeat has to run on
 * a thread that does not need the main loop. It writes synchronously for the
 * same reason: the record must land even if the process is killed while it is
 * still frozen.
 *
 * **The trade this makes.** The body is not type-checked or linted. It is
 * covered instead by `main-loop-watchdog.spec.ts`, which runs this exact text
 * in a real worker against a real temp file.
 *
 * **Constraints on edits.** The literals are template literals, so the program
 * text must contain no backticks and no `${` sequence. Use `'a' + b`
 * concatenation, never a template literal. A literal whose text contains a
 * backslash escape meant for the worker (the `'\n'` in `append`) MUST be a
 * `String.raw` template, or the escape is resolved here instead of in the
 * worker; the backslash-free literals are plain templates.
 *
 * Protocol (see `main-loop-watchdog.ts` for the typed mirror):
 *   workerData: { hangLogPath: string, hangLogMaxBytes: number,
 *                 hangThresholdMs: number, checkIntervalMs: number }
 *   message:    { type: 'heartbeat', breadcrumbs: Record<string, string> }
 *
 * Line format, one JSON object per line so a reader can `grep` or parse it:
 *   { time, source: 'main-loop-watchdog', event: 'hang', blockedForMs, breadcrumbs }
 *   { time, source: 'main-loop-watchdog', event: 'recovered', blockedForMs, breadcrumbs }
 *
 * **Suspend guard.** A laptop that sleeps stops BOTH threads. On wake the gap
 * since the last heartbeat is large, but the main loop was never blocked. The
 * worker detects this from its own check timer: if its own tick arrived later
 * than the hang threshold, the worker was frozen too, so the gap is not
 * evidence against the main loop and the clock is reset instead of reported.
 */

/**
 * The bounded hang-log append, as source text.
 *
 * Twin of `appendHangLogLine` in `main-loop-watchdog.ts`, which the Electron
 * `ProcessLifecycleRecorder` uses for the same file. An eval'd worker has no
 * module resolution, so it cannot import the TS function; this text is the
 * price. It is not left as a promise: `main-loop-watchdog.spec.ts` evals THIS
 * EXACT TEXT, drives it and the TS function through the same writes, and
 * asserts identical files — so the two writers cannot drift on the rotation
 * rule.
 *
 * Rule: before an append, if the file is already at or past `maxBytes`, rename
 * it to `<file>.1` (replacing any previous `.1`), then append. A failed rotate
 * (another writer won the race, or a reader holds the file open on Windows)
 * still appends. Returns whether the line landed. No free variables: `nodeFs`
 * and `nodePath` are parameters.
 */
export const HANG_LOG_APPEND_SOURCE = `
function appendHangLogLine(nodeFs, nodePath, hangLogPath, line, maxBytes) {
  try {
    nodeFs.mkdirSync(nodePath.dirname(hangLogPath), { recursive: true });
    const stat = nodeFs.statSync(hangLogPath, { throwIfNoEntry: false });
    if (stat && stat.size >= maxBytes) {
      try {
        nodeFs.renameSync(hangLogPath, hangLogPath + '.1');
      } catch (rotateError) {
        // Keep appending; an oversized file beats a lost record.
      }
    }
    nodeFs.appendFileSync(hangLogPath, line, 'utf8');
    return true;
  } catch (appendError) {
    return false;
  }
}
`;

export const MAIN_LOOP_WATCHDOG_WORKER_SOURCE =
  `
'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const nodeFs = require('node:fs');
const nodePath = require('node:path');

const hangLogPath = workerData.hangLogPath;
const hangLogMaxBytes = workerData.hangLogMaxBytes;
const hangThresholdMs = workerData.hangThresholdMs;
const checkIntervalMs = workerData.checkIntervalMs;

let lastBeatAt = Date.now();
let lastCheckAt = lastBeatAt;
let hung = false;
let hangStartedAt = 0;
let breadcrumbs = {};
` +
  HANG_LOG_APPEND_SOURCE +
  String.raw`
// A failed append is swallowed. The watchdog is instrumentation: a read-only
// log directory must not take down the thread, and there is nobody to report
// the failure to without the main loop.
function append(event, blockedForMs) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    source: 'main-loop-watchdog',
    event: event,
    blockedForMs: blockedForMs,
    breadcrumbs: breadcrumbs,
  }) + '\n';
  appendHangLogLine(nodeFs, nodePath, hangLogPath, line, hangLogMaxBytes);
}

parentPort.on('message', function (message) {
  if (!message || message.type !== 'heartbeat') return;
  const now = Date.now();
  if (message.breadcrumbs && typeof message.breadcrumbs === 'object') {
    breadcrumbs = message.breadcrumbs;
  }
  if (hung) {
    hung = false;
    append('recovered', now - hangStartedAt);
  }
  lastBeatAt = now;
});

setInterval(function () {
  const now = Date.now();
  const sinceLastCheck = now - lastCheckAt;
  lastCheckAt = now;

  // Suspend guard: this thread was frozen as well, so the heartbeat gap says
  // nothing about the main loop.
  if (sinceLastCheck >= hangThresholdMs) {
    lastBeatAt = now;
    return;
  }

  if (hung) return;
  const silentForMs = now - lastBeatAt;
  if (silentForMs >= hangThresholdMs) {
    hung = true;
    hangStartedAt = lastBeatAt;
    append('hang', silentForMs);
  }
}, checkIntervalMs);
`;
