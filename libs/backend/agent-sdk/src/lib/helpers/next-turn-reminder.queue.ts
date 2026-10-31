import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '../di/tokens';
import {
  SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
} from './session-id-resolved-callback-registry';

const MAX_ENTRIES = 200;
const MAX_TEXT_LENGTH = 600;

/** A drained reminder and the producer that put it (`null` = untagged). */
export interface NextTurnReminder {
  readonly text: string;
  readonly owner: string | null;
}

/** In-memory, single-use reminders for the next main-thread prompt. */
@injectable()
export class NextTurnReminderQueue {
  private readonly entries = new Map<
    string,
    { text: string; order: number; owner: string | null }
  >();
  private readonly aliases = new Map<string, string>();
  private readonly gates = new Map<string, () => boolean>();
  private nextOrder = 0;
  private readonly unsubscribe: () => void;

  constructor(
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    registry: Pick<SessionIdResolvedCallbackRegistry, 'register'>,
  ) {
    this.unsubscribe = registry.register((event) => this.rekey(event));
  }

  /** `owner` tags the entry so its producer can drop all of its own entries. */
  put(sessionKey: string, text: string, owner: string | null = null): void {
    const key = this.aliases.get(sessionKey) ?? sessionKey;
    this.entries.delete(key);
    this.entries.set(key, {
      text: text.slice(0, MAX_TEXT_LENGTH),
      order: ++this.nextOrder,
      owner,
    });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** Drains the session's reminder; one whose owner's gate is closed is dropped. */
  takeEntry(sessionId: string): NextTurnReminder | null {
    const key = this.aliases.get(sessionId) ?? sessionId;
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (!entry || !this.allows(entry.owner)) return null;
    return { text: entry.text, owner: entry.owner };
  }

  take(sessionId: string): string | null {
    return this.takeEntry(sessionId)?.text ?? null;
  }

  /**
   * Remove the reminder `owner` put under a tab key or its resolved SDK
   * session id. Another producer's entry at the same key stays.
   */
  discard(sessionKey: string, owner: string): void {
    const keys = [sessionKey, this.aliases.get(sessionKey) ?? sessionKey];
    for (const key of keys) {
      if (this.entries.get(key)?.owner === owner) this.entries.delete(key);
    }
  }

  /**
   * `allows` is read each time an entry of `owner` is drained or about to be
   * injected; while it reads false those entries are withheld. Returns the
   * release.
   */
  gateOwner(owner: string, allows: () => boolean): () => void {
    this.gates.set(owner, allows);
    return () => {
      if (this.gates.get(owner) === allows) this.gates.delete(owner);
    };
  }

  /** Whether an entry of `owner` may be injected now; untagged always may. */
  allows(owner: string | null): boolean {
    const gate = owner === null ? undefined : this.gates.get(owner);
    return gate === undefined || gate();
  }

  /** Remove every queued reminder `owner` put, in all sessions. */
  discardOwned(owner: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.owner === owner) this.entries.delete(key);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.entries.clear();
    this.aliases.clear();
    this.gates.clear();
  }

  private rekey({
    tabId,
    realSessionId,
    previousSessionId,
  }: SessionIdResolvedPayload): void {
    const oldKeys = [tabId, previousSessionId].filter(
      (key): key is string => !!key && key !== realSessionId,
    );
    const keys = new Set(
      oldKeys.flatMap((key) => [key, this.aliases.get(key) ?? key]),
    );
    let latest = this.entries.get(realSessionId);
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry && (!latest || entry.order > latest.order)) {
        latest = entry;
      }
      this.entries.delete(key);
    }
    if (latest) {
      this.entries.delete(realSessionId);
      this.entries.set(realSessionId, latest);
    }
    for (const [alias, target] of this.aliases) {
      if (keys.has(target)) {
        this.aliases.set(alias, realSessionId);
      }
    }
    for (const key of oldKeys) {
      this.aliases.delete(key);
      this.aliases.set(key, realSessionId);
      if (this.aliases.size > MAX_ENTRIES) {
        const oldest = this.aliases.keys().next().value;
        if (oldest !== undefined) this.aliases.delete(oldest);
      }
    }
  }
}
