/**
 * Host-implemented port for spawning the WAL checkpoint worker process.
 *
 * `persistence-sqlite` is an electron-free lib, so it never calls
 * `utilityProcess.fork` itself; the host implements this factory, exactly as
 * it does for the integrity worker (`../integrity/worker-process.port.ts`).
 * Only the Electron composition binds one. A host without a factory keeps
 * SQLite's own auto-checkpoint.
 */
export interface IWalCheckpointWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  /** Terminate the process. Safe to call more than once. */
  kill(): void;
}

export interface IWalCheckpointWorkerProcessFactory {
  /** Spawn a fresh, long-lived worker. It takes the db path per request. */
  spawn(): IWalCheckpointWorkerProcess;
}
