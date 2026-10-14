/**
 * Session handoff (TASK_2026_655): the contract a chat session uses to hand
 * its work to a NEW top-level chat session in the same workspace and cwd,
 * whose first user message is the continuation prompt.
 *
 * Type-only. The implementation is registered under
 * `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF`; the MCP surface depends on this
 * port, never on the class.
 *
 * Refusals follow the repository's discriminated-result shape: every call
 * either started the session or returns a closed reason the caller can act on.
 */

export interface SessionHandoffRequest {
  /**
   * The calling session's MCP routing id, taken from the transport and never
   * from tool arguments.
   */
  readonly callerSessionId: string | undefined;
  /** Absolute path of the handoff file the caller wrote before calling. */
  readonly handoffPath: string;
  /** The continuation prompt: the new session's first user message. */
  readonly prompt: string;
  /** Tab label; absent → `Continued: <caller session name>`. */
  readonly label?: string;
}

export type SessionHandoffRefusalCode =
  /** No live chat session is behind the caller id. */
  | 'unattributed-caller'
  /** A child session cannot hand off; its parent supervises its work. */
  | 'child-session'
  /** This caller already started a handoff session. */
  | 'already-handed-off'
  /** The host has no chat runtime to open a session in. */
  | 'chat-runtime-unavailable'
  /** The Ptah MCP server is not running, so the new session could not hand off again. */
  | 'mcp-unavailable'
  /** The caller's cwd or root is not inside an open workspace folder. */
  | 'no-workspace'
  /** `handoffPath` is not an existing file inside an open workspace folder. */
  | 'handoff-file-missing'
  /** The host failed to start the new session. */
  | 'session-start-failed';

export type SessionHandoffResult =
  | {
      readonly ok: true;
      /** The new session's tab id. */
      readonly tabId: string;
      readonly label: string;
      readonly workspaceRoot: string;
      readonly cwd: string;
      /** False when no webview took the tab. */
      readonly tabOpened: boolean;
    }
  | {
      readonly ok: false;
      readonly refusal: SessionHandoffRefusalCode;
      readonly detail: string;
    };

export interface ISessionHandoff {
  /** Never throws: every failure is a closed refusal. */
  handoff(request: SessionHandoffRequest): Promise<SessionHandoffResult>;
}
