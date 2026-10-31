import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '../di/tokens';
import {
  SessionIdResolvedCallbackRegistry,
  type SessionIdResolvedPayload,
} from './session-id-resolved-callback-registry';

const MAX_ENTRIES = 200;
const MAX_TEXT_LENGTH = 600;

/** In-memory, single-use reminders for the next main-thread prompt. */
@injectable()
export class NextTurnReminderQueue {
  private readonly entries = new Map<
    string,
    { text: string; order: number; owner: string | null }
  >();
  private readonly aliases = new Map<string, string>();
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

  take(sessionId: string): string | null {
    const key = this.aliases.get(sessionId) ?? sessionId;
    const entry = this.entries.get(key);
    this.entries.delete(key);
    return entry?.text ?? null;
  }

  /** Remove a reminder by its tab key or its resolved SDK session id. */
  discard(sessionKey: string): void {
    this.entries.delete(sessionKey);
    this.entries.delete(this.aliases.get(sessionKey) ?? sessionKey);
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
