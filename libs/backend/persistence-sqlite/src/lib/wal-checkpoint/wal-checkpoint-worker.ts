/**
 * WAL checkpoint utility process entry, bundled by ptah-electron's
 * `build-wal-checkpoint-worker` target as `wal-checkpoint-worker.mjs` and
 * forked by `ElectronWalCheckpointWorkerFactory`.
 *
 * The Electron main connection runs with `wal_autocheckpoint = 0`, so SQLite
 * no longer copies WAL frames into the database file (and fsyncs it) inside a
 * COMMIT on the main thread. This process does that work instead, one
 * `PRAGMA wal_checkpoint(PASSIVE)` per request from `WalCheckpointScheduler`.
 * It writes nothing but checkpointed pages and has no logger: every outcome,
 * failures included, goes back to the host in the reply.
 */
// Must stay the first import: the transport guard runs before anything else.
import { walCheckpointParentPort as port } from './wal-checkpoint-worker.parent-port';
import {
  runWalCheckpoint,
  type CheckpointDatabase,
} from './wal-checkpoint-worker-runtime';

type DatabaseCtor = new (
  file: string,
  options: { fileMustExist: boolean },
) => CheckpointDatabase;

function openReadWrite(dbPath: string): CheckpointDatabase {
  // `better-sqlite3` is an esbuild external resolved from the app's own
  // node_modules (asar-unpacked when packaged), so the ABI matches the
  // Electron runtime that forked this process. `require` comes from the
  // bundle's createRequire banner.
  const Database = require('better-sqlite3') as DatabaseCtor;
  return new Database(dbPath, { fileMustExist: true });
}

port.on('message', (event) => {
  port.postMessage(runWalCheckpoint(event.data, openReadWrite));
});
