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
import type {
  AgentSessionOpenedPayload,
  EffortLevel,
  InlineImageAttachment,
  PermissionLevel,
} from '@ptah-extension/shared';

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

/** Resource ownership inherited by a replacement session, never by copying. */
export interface SuccessorSessionResourceLease {
  readonly worktreePath: string;
  readonly mcpRootPath?: string;
  readonly inheritedParentIds: readonly string[];
}

export interface SuccessorSessionSourceSnapshot {
  readonly sessionId: string;
  readonly tabId: string;
  readonly token: string;
  readonly workspacePath: string;
  readonly successorConfig: {
    readonly model?: string;
    readonly effort?: EffortLevel;
    readonly permissionLevel?: PermissionLevel;
    readonly workspacePath: string;
  };
}

/** Source-neutral payload; the host creates SDK messages only in the successor. */
export interface SuccessorSessionQueuedInput {
  readonly content: string;
  readonly files?: readonly string[];
  readonly images?: readonly InlineImageAttachment[];
  readonly origin?: unknown;
  readonly admission?: 'require-idle' | 'owned-handoff';
}

export interface StartSuccessorSessionInput {
  readonly operationId: string;
  /** The source identity used for token-safe close after confirmation. */
  readonly source: SuccessorSessionSourceSnapshot;
  /** Durable builder seed, optionally prefixed by bounded agent handoff text. */
  readonly seed: string;
  readonly resourceLease: SuccessorSessionResourceLease;
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
  /**
   * Bind and focus the successor before acknowledging it. A false outcome
   * means the source remains usable and its transfer FIFO is restored.
   */
  startSuccessorSession(
    input: StartSuccessorSessionInput,
  ): Promise<ChildChatSessionStartOutcome>;
  /** Delivers the coordinator-detached FIFO only after start and bind succeed. */
  deliverTransferInputs(
    operationId: string,
    inputs: readonly SuccessorSessionQueuedInput[],
  ): Promise<{ readonly delivered: boolean; readonly error?: string }>;
  /** Correlated UI acknowledgement for a successor replacement request. */
  acknowledgeSuccessorBound(
    operationId: string,
    sourceTabId: string,
    successorTabId: string,
  ): boolean;
}
