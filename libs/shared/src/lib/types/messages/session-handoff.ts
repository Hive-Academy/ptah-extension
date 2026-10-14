/**
 * Payload describing a top-level chat session a session started with
 * `ptah_session_handoff` to continue its work (TASK_2026_655).
 *
 * The backend pushes it to the webview BEFORE the new session starts, so the
 * tab exists when its first chunk arrives. The webview adopts it into the
 * panel that holds `fromTabId`, places it after that tab and focuses it. The
 * new session is an ordinary chat: it has no parent, no worktree and no
 * `agentOrigin`.
 */
export interface SessionHandoffOpenedPayload {
  /** New tab id: the stream key the new session's events are routed by. */
  readonly tabId: string;
  /** The tab id of the session that handed off. */
  readonly fromTabId: string;
  /** The SDK session id of the session that handed off, when it is known. */
  readonly fromSessionId: string | null;
  /** Workspace root the new session belongs to: the tab partition. */
  readonly workspaceRoot: string;
  /** The new session's working directory (the handing-off session's cwd). */
  readonly cwd: string;
  readonly label: string;
  /** The continuation prompt shown as the first user turn of the new tab. */
  readonly displayPrompt: string;
  /** Epoch milliseconds the new session was started at. */
  readonly startedAt: number;
}
