/**
 * The chat-path host port (TASK_2026_584).
 *
 * `cli-agent-runtime` cannot reach the chat internals (`rpc-handlers` sits
 * above it), so the spawner starts a child's chat session through this port.
 * The implementation is registered by the host under
 * `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`; a host without it refuses
 * `ptah_session_start` with `chat-runtime-unavailable`.
 *
 * Type-only.
 */
import type { AgentSessionOpenedPayload } from '@ptah-extension/shared';

export interface ChildChatSessionStartInput {
  /** Backend-minted UUID v4: the child's tab id and MCP routing id. */
  readonly tabId: string;
  /** Parent root: the metadata `workspaceId` and the tab partition. */
  readonly workspaceRoot: string;
  /** The session's `projectPath` and cwd. */
  readonly worktreePath: string;
  /** Contract + task: what the SDK receives. */
  readonly prompt: string;
  /** What the webview adopts. */
  readonly descriptor: AgentSessionOpenedPayload;
  readonly sessionName: string;
  readonly model?: string;
}

export type ChildChatSessionStartOutcome =
  | {
      readonly started: true;
      /** False when no webview took the tab; it is adopted late on the next bootstrap. */
      readonly uiAnnounced: boolean;
    }
  | { readonly started: false; readonly error: string };

export interface IChildChatSessionHost {
  startChildSession(
    input: ChildChatSessionStartInput,
  ): Promise<ChildChatSessionStartOutcome>;
}
