import { Injectable } from '@angular/core';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { tailUserMessageIds } from './inbound-peer-message';

/**
 * Per tab, the prompts the person sent while a turn was in flight — the only
 * prompts that can wait in the backend queue behind a held peer turn (a lane
 * report or completion). `insertInboundPeerMessage` places a peer message
 * before such a prompt and after any other.
 *
 * The streaming boundary that marks such a prompt does not survive the turn
 * (`applyFinalizedTurn` drops `streamingState`), hence this record. It is
 * pruned to the prompts still at the transcript tail on every write and read,
 * so it stays bounded; an aborted turn clears it, because a prompt from a
 * stopped turn is not queued.
 */
@Injectable({ providedIn: 'root' })
export class QueuedPromptRecord {
  private readonly byTab = new Map<string, Set<string>>();

  /** Record a prompt that got a live boundary; `messages` already holds it. */
  add(
    tabId: string,
    messageId: string,
    messages: readonly ExecutionChatMessage[],
  ): void {
    const ids = this.queuedAtTail(tabId, messages);
    ids.add(messageId);
    this.byTab.set(tabId, ids);
  }

  /** The send failed: the prompt never reached the backend queue. */
  remove(tabId: string, messageId: string): void {
    const ids = this.byTab.get(tabId);
    if (!ids) return;
    ids.delete(messageId);
    if (ids.size === 0) this.byTab.delete(tabId);
  }

  clear(tabId: string): void {
    this.byTab.delete(tabId);
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
    return kept;
  }
}
