/**
 * AttachedSessionRegistry — in-memory contention backstop for attached sessions.
 *
 * When a Ptah SDK session is attached to a messaging binding (via
 * `gateway:attachSession`), the messaging bridge becomes the sole legitimate
 * driver of that session's JSONL. This registry records the
 * `sessionUuid → bindingId` link so the *webview* resume path can be rejected
 * while the link is live: a stale webview tab must not drive an attached
 * session concurrently with the bridge.
 *
 * The registry is intentionally tiny and process-local. The durable source of
 * truth for "is this binding attached?" is derived state (approved binding +
 * non-null conversation `ptah_session_id`); this map is only the fast,
 * synchronous enforcement seam consulted on the resume hot path.
 */
import { injectable } from 'tsyringe';
import type { ISessionAttachmentGuard } from '@ptah-extension/platform-core';

@injectable()
export class AttachedSessionRegistry implements ISessionAttachmentGuard {
  /** sessionUuid → bindingId. One binding may own at most one attached uuid at a time. */
  private readonly bySession = new Map<string, string>();

  /** Record that `sessionUuid` is attached to `bindingId`. Idempotent. */
  attach(sessionUuid: string, bindingId: string): void {
    if (!sessionUuid || !bindingId) return;
    this.bySession.set(sessionUuid, bindingId);
  }

  /** Remove the attach record for `sessionUuid` (no-op if absent). */
  detach(sessionUuid: string): void {
    if (!sessionUuid) return;
    this.bySession.delete(sessionUuid);
  }

  /** True when `sessionUuid` is currently attached to a binding. */
  isAttached(sessionUuid: string): boolean {
    return !!sessionUuid && this.bySession.has(sessionUuid);
  }

  /** The bindingId owning `sessionUuid`, or null when not attached. */
  bindingFor(sessionUuid: string): string | null {
    return this.bySession.get(sessionUuid) ?? null;
  }
}
