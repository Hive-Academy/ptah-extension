import { Injectable, computed, inject, signal, type Signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  SessionHandoffChainEntry,
  SessionHandoffChainResult,
  SessionHandoffLinkedPayload,
} from '@ptah-extension/shared';
import type { InspectorLinkedSessionEntry } from '@ptah-extension/chat-ui';

const NO_ENTRIES: readonly InspectorLinkedSessionEntry[] = [];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validate a `session:handoffChain` result (TASK_2026_876). Returns `null`
 * for anything that is not one: an object whose `sessions` is an array of
 * entries with a non-empty `sessionId` and a `label` that is a string or
 * `null`. One bad entry refuses the whole chain, so a malformed record is
 * never drawn as a partial chain. Hand-written like
 * `parseSessionHandoffOpenedPayload`, to keep Zod out of the webview.
 */
export function parseHandoffChainResult(
  value: unknown,
): SessionHandoffChainResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sessions = (value as Record<string, unknown>)['sessions'];
  if (!Array.isArray(sessions)) return null;
  const parsed: SessionHandoffChainEntry[] = [];
  for (const raw of sessions) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const sessionId = entry['sessionId'];
    const label = entry['label'];
    if (!isNonEmptyString(sessionId)) return null;
    if (label !== null && typeof label !== 'string') return null;
    parsed.push({ sessionId, label });
  }
  return { sessions: parsed };
}

/**
 * Chain order is root first. Entries before the open id continued into it
 * (`from`), entries after it continued from it (`in`). When the open id is
 * absent from a non-empty chain the chain is shown as is and no row is
 * current; no row is invented.
 */
export function linkedSessionEntries(
  sessions: readonly SessionHandoffChainEntry[],
  openSessionId: string,
): readonly InspectorLinkedSessionEntry[] {
  if (sessions.length === 0) return NO_ENTRIES;
  const currentIndex = sessions.findIndex(
    (s) => s.sessionId === openSessionId,
  );
  return sessions.map((s, i): InspectorLinkedSessionEntry => ({
    sessionId: s.sessionId,
    label: s.label,
    relation:
      i === currentIndex
        ? 'current'
        : currentIndex !== -1 && i > currentIndex
          ? 'in'
          : 'from',
  }));
}

interface ChainSlot {
  /** Inspectors showing this session; the slot is dropped at zero. */
  refs: number;
  /** Bumped per request; a response for an older generation is dropped. */
  generation: number;
}

/**
 * `HandoffChainClient`: the handoff chain of each session an expanded
 * inspector shows (TASK_2026_876), read with `session:handoffChain`.
 *
 * An inspector `retain`s its session id while it shows it and `release`s it
 * when it stops, so the cache holds only shown sessions. The first retain
 * loads; `sessionHandoff:linked` reloads every shown session the new edge
 * touches (either end, or any session already in its chain). One request per
 * shown id plus one per link that names it; no poll, no timer.
 *
 * A failed RPC or a result {@link parseHandoffChainResult} refuses clears that
 * session's chain to `[]`, so the section is absent. No spinner, no alert.
 */
@Injectable({ providedIn: 'root' })
export class HandoffChainClient {
  private readonly rpc = inject(ClaudeRpcService);

  private readonly slots = new Map<string, ChainSlot>();
  private readonly _chains = signal<
    ReadonlyMap<string, readonly SessionHandoffChainEntry[]>
  >(new Map());

  /** Linked-session rows for `sessionId`, root first; `[]` when there is no chain. */
  entriesFor(sessionId: string): Signal<readonly InspectorLinkedSessionEntry[]> {
    return computed(() =>
      linkedSessionEntries(this._chains().get(sessionId) ?? NO_ENTRIES, sessionId),
    );
  }

  /** Start showing `sessionId`. The first holder loads its chain. */
  retain(sessionId: string): void {
    if (!sessionId) return;
    const slot = this.slots.get(sessionId);
    if (slot) {
      slot.refs += 1;
      return;
    }
    this.slots.set(sessionId, { refs: 1, generation: 0 });
    void this.load(sessionId);
  }

  /** Stop showing `sessionId`. The last holder drops its chain. */
  release(sessionId: string): void {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    slot.refs -= 1;
    if (slot.refs > 0) return;
    this.slots.delete(sessionId);
    this.setChain(sessionId, null);
  }

  /** `sessionHandoff:linked`: reload each shown session the edge touches. */
  onLinked(link: SessionHandoffLinkedPayload): void {
    const chains = this._chains();
    for (const sessionId of this.slots.keys()) {
      const chain = chains.get(sessionId) ?? NO_ENTRIES;
      const touched =
        sessionId === link.fromSessionId ||
        sessionId === link.toSessionId ||
        chain.some(
          (s) =>
            s.sessionId === link.fromSessionId ||
            s.sessionId === link.toSessionId,
        );
      if (touched) void this.load(sessionId);
    }
  }

  private async load(sessionId: string): Promise<void> {
    const slot = this.slots.get(sessionId);
    if (!slot) return;
    const generation = ++slot.generation;
    let sessions: readonly SessionHandoffChainEntry[] = NO_ENTRIES;
    try {
      const result = await this.rpc.call('session:handoffChain', { sessionId });
      if (result.success) {
        const parsed = parseHandoffChainResult(result.data);
        if (parsed) {
          sessions = parsed.sessions;
        } else {
          console.warn(
            '[HandoffChainClient] session:handoffChain result rejected — section hidden',
          );
        }
      } else {
        console.warn(
          '[HandoffChainClient] session:handoffChain failed:',
          result.error,
        );
      }
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the linked-sessions section
      // is absent when the chain cannot be read; the sessions themselves
      // stay reachable from the session list.
      console.warn('[HandoffChainClient] session:handoffChain threw:', error);
    }
    const current = this.slots.get(sessionId);
    if (current !== slot || slot.generation !== generation) return;
    this.setChain(sessionId, sessions);
  }

  private setChain(
    sessionId: string,
    sessions: readonly SessionHandoffChainEntry[] | null,
  ): void {
    this._chains.update((prev) => {
      if (sessions === null && !prev.has(sessionId)) return prev;
      const next = new Map(prev);
      if (sessions === null) next.delete(sessionId);
      else next.set(sessionId, sessions);
      return next;
    });
  }
}
