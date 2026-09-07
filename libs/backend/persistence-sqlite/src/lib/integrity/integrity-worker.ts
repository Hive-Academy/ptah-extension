/**
 * Integrity worker entry — a single bundled `integrity-worker.mjs` driven by
 * TWO runtimes:
 *   - Electron `utilityProcess` (its own OS process, running Electron's own
 *     Node, so the ABI-143 `better-sqlite3` the repo already rebuilds loads
 *     unchanged — a `child_process.fork` of system Node would not). Bundled by
 *     ptah-electron's `build-integrity-worker` esbuild target.
 *   - Plain Node `worker_threads` in the headless CLI, which has no Electron
 *     `utilityProcess`. Bundled by ptah-cli's `build-integrity-worker` target.
 *
 * WHY THIS EXISTS. `PRAGMA quick_check` on a real 1 000.7 MB
 * `~/.ptah/state/ptah.sqlite` measured 1868 ms WARM and 20-26 s cold, and it
 * used to run inside `SqliteConnectionService.openAndMigrate` — on the only
 * `await` the post-window boot makes, with `isOpen` already true, so every
 * renderer IPC reply queued behind it. The cost is intrinsic to reading a
 * gigabyte off disk; it cannot be optimised away, only moved off the thread
 * that answers IPC. That is this file.
 *
 * Transport is auto-detected at startup: if `process.parentPort` exists (the
 * Electron utilityProcess global, whose 'message' events wrap the payload as
 * `{ data }`) we use it; otherwise we fall back to `node:worker_threads`
 * `parentPort` (raw payload). No `electron` import — the utilityProcess global
 * is provided by the runtime, keeping this file importable by the
 * (electron-free) backend lib bundle. Copied from
 * `memory-curator/src/lib/embedder/embedder-worker.ts:33-83`.
 *
 * THE CONNECTION IS READ-ONLY AND THE FILE MUST ALREADY EXIST. `readonly: true`
 * means WAL lets this second connection read while the host process holds the
 * database open and keeps writing. `fileMustExist: true` stops a vanished or
 * mistyped path being CREATED as an empty database, which would then pass
 * `quick_check` and record a clean verdict for a file nobody checked — the same
 * trap `backup.service.ts:56-69` guards.
 *
 * EVERY FAILURE IS `'unavailable'`, NEVER `'corrupt'`. A missing native module,
 * an ABI mismatch, a locked file, a refused open, a thrown pragma: none of them
 * is evidence about the data. `'corrupt'` is reserved for `quick_check` having
 * actually run and answered something other than `ok`. The driving service
 * writes NO record for `'unavailable'`, so an inconclusive check retries in the
 * next window instead of being remembered as clean.
 *
 * This file imports NOTHING from the monorepo except its own protocol module,
 * so it stays bundleable in isolation with `better-sqlite3` as its one
 * external.
 *
 * Protocol (matches `integrity-worker-protocol.ts`):
 *   request:  { id, type: 'check', dbPath }
 *   response: { id, ok: true, verdict, quickCheck, foreignKeyViolations,
 *               durationMs, pageCount, detail }
 *           | { id, ok: false, error }
 */
import { parentPort as workerThreadsParentPort } from 'node:worker_threads';
import {
  classifyQuickCheck,
  isIntegrityCheckRequest,
  type IntegrityCheckRequest,
  type IntegrityWorkerOutbound,
} from './integrity-worker-protocol';

/**
 * Electron utilityProcess `process.parentPort` (a `MessagePortMain`): its
 * 'message' events wrap the payload as `{ data }`. Typed structurally so this
 * file needs no `electron` import.
 */
interface ElectronParentPortLike {
  on(event: 'message', cb: (e: { data: unknown }) => void): void;
  postMessage(msg: unknown): void;
}

const electronParentPort = (
  process as unknown as { parentPort?: ElectronParentPortLike }
).parentPort;

/**
 * Transport shim normalizing the two runtimes into a single `post(msg)` +
 * `subscribe(handler)` pair. Everything below is transport-agnostic.
 *
 * Electron delivers messages wrapped as `{ data }`; `node:worker_threads`
 * delivers the raw payload — the crux the two branches normalize.
 */
type PostFn = (msg: IntegrityWorkerOutbound) => void;
type MessageHandler = (msg: unknown) => void;

let post: PostFn;
let subscribe: (handler: MessageHandler) => void;

if (electronParentPort) {
  const electronPort = electronParentPort;
  post = (msg) => electronPort.postMessage(msg);
  subscribe = (handler) => electronPort.on('message', (e) => handler(e.data));
} else if (workerThreadsParentPort) {
  const threadPort = workerThreadsParentPort;
  post = (msg) => threadPort.postMessage(msg);
  subscribe = (handler) =>
    threadPort.on('message', (payload: unknown) => handler(payload));
} else {
  throw new Error(
    'integrity-worker.ts must be run as a worker (no Electron parentPort and no worker_threads parentPort)',
  );
}

/** The narrow slice of `better-sqlite3` this worker uses. Read-only. */
interface ReadOnlyDatabase {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

type DatabaseCtor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => ReadOnlyDatabase;

/**
 * Open the file read-only.
 *
 * Deliberately one function that may throw, with the caller mapping ANY throw
 * to `'unavailable'` — "load the module" and "open this file" are inconclusive
 * in the same way and need no separate treatment here, because neither is
 * evidence about the data.
 */
function openReadOnly(dbPath: string): ReadOnlyDatabase {
  // `better-sqlite3` is an esbuild external, resolved from the host's own
  // node_modules at runtime so the ABI matches the runtime that forked us.
  const Database = require('better-sqlite3') as DatabaseCtor;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run both pragmas and build the response. Never throws: the whole body is one
 * try, and every escape lands on the `'unavailable'` verdict.
 */
function runCheck(request: IntegrityCheckRequest): IntegrityWorkerOutbound {
  const startedAt = Date.now();
  let db: ReadOnlyDatabase | null = null;
  try {
    db = openReadOnly(request.dbPath);

    const quickCheckRaw = db.pragma('quick_check', { simple: true });
    const verdict = classifyQuickCheck(quickCheckRaw);
    const quickCheck = typeof quickCheckRaw === 'string' ? quickCheckRaw : '';

    // `foreign_key_check` measured 27 ms against the same 1 GB file — 0.14 % of
    // the pair's warm cost — so it is always worth running once we are here.
    const fkRows = db.pragma('foreign_key_check');
    const foreignKeyViolations = Array.isArray(fkRows) ? fkRows.length : 0;

    const pageCountRaw = db.pragma('page_count', { simple: true });
    const pageCount = typeof pageCountRaw === 'number' ? pageCountRaw : 0;

    // The detail is the ONE free-text field on the record. A clean check has
    // nothing to say and stores NULL rather than an empty string.
    let detail: string | null = null;
    if (verdict === 'corrupt') {
      detail = quickCheck;
    } else if (verdict === 'ok' && foreignKeyViolations > 0) {
      detail = `${foreignKeyViolations} foreign key violation(s)`;
    }

    return {
      id: request.id,
      ok: true,
      verdict,
      quickCheck,
      foreignKeyViolations,
      durationMs: Date.now() - startedAt,
      pageCount,
      detail,
    };
  } catch (error: unknown) {
    return {
      id: request.id,
      ok: true,
      verdict: 'unavailable',
      quickCheck: '',
      foreignKeyViolations: 0,
      durationMs: Date.now() - startedAt,
      pageCount: 0,
      detail: describe(error),
    };
  } finally {
    try {
      db?.close();
    } catch {
      // A close failure says nothing about the data and there is nothing left
      // to do about it — the process is about to exit either way.
    }
  }
}

subscribe((msg: unknown) => {
  if (!isIntegrityCheckRequest(msg)) {
    // An unrecognised payload has no id to echo, so there is no correlated
    // reply to send. Dropping it is correct: the driver's own kill budget
    // reclaims the process.
    return;
  }
  post(runCheck(msg));
});
