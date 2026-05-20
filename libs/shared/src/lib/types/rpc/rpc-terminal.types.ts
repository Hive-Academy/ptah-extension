/**
 * Terminal RPC Type Definitions: terminal session management types.
 */

/** Parameters for terminal:create RPC method */
export interface TerminalCreateParams {
  /** Working directory for the new terminal (defaults to workspace root) */
  cwd?: string;
  /** Shell executable path (defaults to system default) */
  shell?: string;
  /** Terminal display name */
  name?: string;
}

/** Response from terminal:create RPC method */
export interface TerminalCreateResult {
  /** Unique terminal session ID */
  id: string;
  /** PID of the spawned process */
  pid: number;
}

/** Parameters for terminal:kill RPC method */
export interface TerminalKillParams {
  /** Terminal session ID to kill */
  id: string;
}

/** Response from terminal:kill RPC method */
export interface TerminalKillResult {
  success: boolean;
  error?: string;
}

/** Parameters for terminal:resize (binary IPC, not JSON RPC) */
export interface TerminalResizeParams {
  /** Terminal session ID */
  id: string;
  /** New column count */
  cols: number;
  /** New row count */
  rows: number;
}
