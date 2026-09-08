/**
 * Host-implemented port for spawning the integrity worker process.
 *
 * `persistence-sqlite` is an electron-free foundation lib, so it MUST NOT call
 * `utilityProcess.fork` directly — the host implements this factory. Precedent
 * and shape: `memory-curator/src/lib/embedder/worker-process.port.ts:9-20`,
 * which declares its port LOCALLY rather than in `platform-core` for exactly
 * this reason. `platform-core` stays a leaf with no worker vocabulary.
 *
 * The port lives here, beside the worker it spawns, rather than in
 * `platform-core`, so the whole integrity feature is one folder.
 *
 * A host that registers no factory simply never runs an integrity check:
 * `SqliteIntegrityService` logs once at `info` and returns. VS Code is that
 * host by construction — it never registers
 * `PERSISTENCE_TOKENS.SQLITE_CONNECTION` at all, so it has no database to
 * check. Electron and the CLI both ship one.
 */
export interface IIntegrityWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  /** Terminate the process. Safe to call more than once. */
  kill(): void;
}

export interface IIntegrityWorkerProcessFactory {
  /**
   * Spawn a fresh worker process. Unlike the embedder's factory this sends no
   * `init` message: the integrity worker is single-shot and takes its only
   * input — the database path — on the `check` request itself.
   */
  spawn(): IIntegrityWorkerProcess;
}
