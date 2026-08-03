/**
 * IPtyHost — the "spawn / kill a pseudo-terminal" port behind the `terminal:*`
 * RPC methods. Gated by the `pty` capability; only hosts that own a terminal
 * surface register an implementation.
 *
 * Intentionally NOT a full PTY lifecycle port: data flow (write/resize/onData/
 * onExit) and shutdown run over binary IPC in the host, never over JSON RPC,
 * and no library consumer needs them.
 */
export interface PtySpawnRequest {
  /** Working directory for the shell. Resolved by the caller — never empty. */
  readonly cwd: string;
  /** Shell executable override. Host picks its platform default when absent. */
  readonly shell?: string;
  /** Display name; carried for reference, not used to spawn. */
  readonly name?: string;
}

export interface PtySpawnResult {
  readonly id: string;
  readonly pid: number;
}

export interface PtyKillResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface IPtyHost {
  /** Spawn a session. Throws when the host's session limits are exceeded. */
  create(request: PtySpawnRequest): PtySpawnResult;
  /** Kill a session by id. Returns `{success:false}` for an unknown id. */
  kill(id: string): PtyKillResult;
}
