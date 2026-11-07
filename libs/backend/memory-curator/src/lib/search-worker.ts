/**
 * SQLite search utility process entry, bundled by ptah-electron's
 * `build-search-worker` target as `search-worker.mjs` and forked by
 * `ElectronSearchWorkerFactory`.
 *
 * It owns a read-only better-sqlite3 connection to the live WAL database and
 * answers memory search, code-symbol search, session-start listing and chunk
 * lookups, so their synchronous SQLite work never blocks the Electron main
 * thread. It never runs migrations and never writes. Logs are forwarded to the
 * host as `log` messages; this file has no logger of its own.
 */
// Must stay the first import: the transport guard runs before anything heavy.
import { searchWorkerParentPort as port } from './search-worker.parent-port';
import 'reflect-metadata';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { SearchWorkerRuntime } from './search-worker-runtime';

type DatabaseCtor = new (
  file: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => SqliteDatabase;

function openReadOnly(dbPath: string): SqliteDatabase {
  // `better-sqlite3` is an esbuild external resolved from the app's own
  // node_modules (asar-unpacked when packaged), so the ABI matches the
  // Electron runtime that forked this process. `require` comes from the
  // bundle's createRequire banner.
  const Database = require('better-sqlite3') as DatabaseCtor;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

const runtime = new SearchWorkerRuntime({
  post: (message) => port.postMessage(message),
  openReadOnly,
});

port.on('message', (event) => runtime.handle(event.data));
