/**
 * Terminal Type Definitions for Frontend
 * TASK_2025_227 Batch 5: Terminal binary IPC API and tab state types
 *
 * PtahTerminalApi: Interface for the window.ptahTerminal binary IPC bridge
 * exposed by the Electron preload script. This is separate from JSON RPC
 * because terminal I/O is high-frequency binary data that would bottleneck
 * the JSON serialization pipeline.
 *
 * TerminalTab: UI state for a single terminal tab in the multi-tab terminal panel.
 */

/** Window extension for terminal binary IPC (exposed by Electron preload.ts) */
export interface PtahTerminalApi {
  /** Write user input data to a terminal session (renderer -> main) */
  write(id: string, data: string): void;
  /** Resize a terminal session (renderer -> main) */
  resize(id: string, cols: number, rows: number): void;
  /** Listen for terminal data output (main -> renderer). Returns cleanup function. */
  onData(callback: (id: string, data: string) => void): () => void;
  /** Listen for terminal exit events (main -> renderer). Returns cleanup function. */
  onExit(callback: (id: string, exitCode: number) => void): () => void;
}

declare global {
  interface Window {
    ptahTerminal?: PtahTerminalApi;
  }
}

/** Terminal tab state for the multi-tab terminal panel UI */
export interface TerminalTab {
  /** Unique terminal session ID (from terminal:create RPC result) */
  id: string;
  /** Display name for the tab */
  name: string;
  /** PID of the spawned process */
  pid: number;
  /** Whether this tab is the active/visible tab */
  isActive: boolean;
  /** Whether the terminal process has exited */
  hasExited: boolean;
  /** Exit code if the process has exited */
  exitCode?: number;
}
