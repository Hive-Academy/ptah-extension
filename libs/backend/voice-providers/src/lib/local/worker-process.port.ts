/**
 * Host-implemented port for spawning the voice worker process. `voice-providers`
 * is an electron-free backend lib, so it MUST NOT call `utilityProcess.fork`
 * directly — the Electron host implements this factory (precedent:
 * `GATEWAY_SESSION_LISTER`). On VS Code / CLI no factory is registered, and the
 * local providers degrade to `available: false`.
 */
export interface IVoiceWorkerProcess {
  postMessage(msg: unknown): void;
  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  /** Terminate the process. Safe to call more than once. */
  kill(): void;
}

export interface IVoiceWorkerProcessFactory {
  /** Spawn a fresh worker process and send its `init` config immediately. */
  spawn(): IVoiceWorkerProcess;
}
