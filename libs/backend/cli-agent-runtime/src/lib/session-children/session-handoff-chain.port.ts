/**
 * Durable handoff chain (TASK_2026_876). Edges are SDK session ids in one
 * workspace's state document. The store does not broadcast; wiring subscribes
 * with {@link ISessionHandoffChain.onLinkWritten}.
 */

/** Fired after an edge is in memory, whether or not the document write landed. */
export interface SessionHandoffLinkWritten {
  readonly fromSessionId: string;
  readonly toSessionId: string;
}

export interface ISessionHandoffChain {
  /**
   * Record `fromSessionId → toSessionId` in the document for `workspacePath`.
   * Omit the path on a host with one store. Never throws.
   */
  append(
    fromSessionId: string,
    toSessionId: string,
    workspacePath?: string,
  ): Promise<void>;

  /**
   * The connected component that contains `sessionId`, root first.
   * An id with no edge returns an empty list. Never throws.
   */
  read(
    sessionId: string,
    workspacePath?: string,
  ): Promise<readonly string[]>;

  /**
   * Subscribe to edges that were just appended. The returned function
   * removes the listener. A listener throw does not fail `append`.
   */
  onLinkWritten(
    listener: (link: SessionHandoffLinkWritten) => void,
  ): () => void;
}
