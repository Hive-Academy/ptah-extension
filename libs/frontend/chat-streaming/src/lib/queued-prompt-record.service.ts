import { Injectable } from '@angular/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { tailUserMessageIds } from './inbound-peer-message';

/**
 * Per tab, prompts sent and not yet consumed: retired by their echo, by the
 * consuming turn's terminal `consumedClientMessageId`, or by a `chat:continue`
 * result that did not enqueue. This record lives for this renderer only; a
 * reload is covered by the backend's `beforeClientMessageId` placement hint.
 * Tail pruning removes prompts no longer at the transcript tail; confirmed
 * session teardown or tab close clears the record.
 */
@Injectable({ providedIn: 'root' })
export class QueuedPromptRecord {
  private readonly byTab = new Map<string, Set<string>>();
  private readonly sessionById = new Map<string, Map<string, string>>();

  /** Record a sent continue prompt; `messages` already holds it. */
  add(
    tabId: string,
    messageId: string,
    messages: readonly ExecutionChatMessage[],
    sessionId?: string,
  ): void {
    const ids = this.queuedAtTail(tabId, messages);
    ids.add(messageId);
    this.byTab.set(tabId, ids);
    if (sessionId) {
      const owners = this.sessionById.get(tabId) ?? new Map<string, string>();
      owners.set(messageId, sessionId);
      this.sessionById.set(tabId, owners);
    }
  }

  /** Retire exactly this prompt, whether acknowledged or never enqueued. */
  remove(tabId: string, messageId: string): void {
    const ids = this.byTab.get(tabId);
    if (!ids) return;
    ids.delete(messageId);
    this.sessionById.get(tabId)?.delete(messageId);
    if (ids.size === 0) this.byTab.delete(tabId);
  }

  clear(tabId: string): void {
    this.byTab.delete(tabId);
    this.sessionById.delete(tabId);
  }

  clearSession(tabId: string, sessionId: string): void {
    const owners = this.sessionById.get(tabId);
    for (const id of [...(this.byTab.get(tabId) ?? [])]) {
      const owner = owners?.get(id);
      if (owner === undefined || owner === sessionId) this.remove(tabId, id);
    }
  }

  /** The recorded prompts still at the tail of `messages`; prunes the rest. */
  queuedAtTail(
    tabId: string,
    messages: readonly ExecutionChatMessage[],
  ): Set<string> {
    const ids = this.byTab.get(tabId);
    if (!ids) return new Set();
    const tail = tailUserMessageIds(messages);
    const kept = new Set([...ids].filter((id) => tail.has(id)));
    if (kept.size === 0) this.byTab.delete(tabId);
    else this.byTab.set(tabId, kept);
    const owners = this.sessionById.get(tabId);
    if (owners) for (const id of owners.keys()) if (!kept.has(id)) owners.delete(id);
    return kept;
  }
}
