/**
 * ISessionAttachmentGuard — port for the "is this SDK session driven by another
 * driver right now?" question consulted on the webview resume hot path.
 *
 * The messaging gateway (Electron-only) can ATTACH a Ptah SDK session to a
 * messaging binding, making the gateway bridge the SOLE legitimate driver of
 * that session's JSONL. A stale webview tab must not resume the same session
 * concurrently. This port is the synchronous enforcement seam: `chat:resume`
 * asks `isAttached(sessionUuid)` before resuming.
 *
 * The port lives in `platform-core` (the ports layer) so the SHARED chat RPC
 * handler — which runs in BOTH the VS Code extension host and the Electron host
 * — can depend on the TYPE without importing `messaging-gateway` (absent in the
 * VS Code host). The Electron host binds the concrete
 * `AttachedSessionRegistry`; the VS Code host binds a null-object default
 * (`NullSessionAttachmentGuard` in `vscode-core`) so the token always resolves
 * and `isAttached` is a harmless `false`.
 *
 * This interface intentionally carries NO gateway types — it is a single
 * boolean predicate over a session UUID string.
 */
export interface ISessionAttachmentGuard {
  /**
   * True when `sessionUuid` is currently attached to a messaging binding and
   * therefore must NOT be resumed from the webview. False (the safe default)
   * when no gateway is present or the session is free.
   */
  isAttached(sessionUuid: string): boolean;
}
