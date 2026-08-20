/**
 * Host-implemented port for spawning the embedder worker process.
 * `memory-curator` is an electron-free backend lib, so it MUST NOT call
 * `utilityProcess.fork` directly — the Electron host implements this factory
 * (precedent: voice-providers' `IVoiceWorkerProcessFactory` and
 * `GATEWAY_SESSION_LISTER`). On VS Code / CLI no factory is registered, and the
 * embedder degrades to unavailable — memory search falls back to BM25-only.
 */
export interface IEmbedderWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  /** Terminate the process. Safe to call more than once. */
  kill(): void;
}

export interface IEmbedderWorkerProcessFactory {
  /** Spawn a fresh worker process and send its `init` config immediately. */
  spawn(): IEmbedderWorkerProcess;
}
