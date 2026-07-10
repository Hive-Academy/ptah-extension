/**
 * ConversationTurnTracker — per-conversation turn-in-flight signal.
 *
 * Written by the gateway-chat-bridge (`begin` on enqueue, `end` when the
 * enqueue promise settles) and read by the command control plane to refuse
 * mutating commands while a turn is executing OR queued for the same
 * conversation (AC-3.6/4.3/6.6). Counter-based so a queued turn behind a
 * running one keeps the key busy; per-key, so other conversations are never
 * blocked (NFR-4). Process-local by design — a crash resets it with the
 * process, same posture as `AttachedSessionRegistry`.
 */
import { injectable } from 'tsyringe';
import type { ConversationKey } from './types';

@injectable()
export class ConversationTurnTracker {
  /** conversationKey → number of in-flight/queued turns. */
  private readonly counts = new Map<ConversationKey, number>();

  begin(key: ConversationKey): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  end(key: ConversationKey): void {
    const current = this.counts.get(key);
    if (current === undefined) return;
    if (current <= 1) {
      this.counts.delete(key);
      return;
    }
    this.counts.set(key, current - 1);
  }

  isBusy(key: ConversationKey): boolean {
    return (this.counts.get(key) ?? 0) > 0;
  }
}
