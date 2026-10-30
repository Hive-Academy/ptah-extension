import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type { SessionOrganizationSummary } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';

/** Most session ids the cache keeps; the least recently asked is dropped. */
export const SESSION_ORGANIZATION_CACHE_MAX = 64;

const LOG_CONTEXT = 'SessionOrganizationCache';

const UNKNOWN: Signal<SessionOrganizationSummary | null> = signal(null).asReadonly();

/** A `session:getOrganization` read: failed, or answered (summary may be null). */
type FetchResult =
  | { readonly ok: true; readonly summary: SessionOrganizationSummary | null }
  | { readonly ok: false };

/** One cached session id. */
interface CacheEntry {
  /** The `session:getOrganization` result; null until read or when unknown. */
  readonly fetched: WritableSignal<SessionOrganizationSummary | null>;
  /** What {@link SessionOrganizationCache.organizationFor} returns. */
  readonly view: Signal<SessionOrganizationSummary | null>;
  /**
   * `idle`: no read done, due again, or the last read failed; `loading`: in
   * flight; `read`: done.
   */
  state: 'idle' | 'loading' | 'read';
  /** A change push arrived while the read was in flight: read again. */
  stale: boolean;
}

/**
 * The organization record of any session id, for webview views that show a
 * session without owning the session list (TASK_2026_854): the compact
 * session card, and the git view (see `contract-for-git-view.md`).
 *
 * - `null` means unknown: not loaded yet, organization unavailable, or the
 *   id is not a persisted SDK session id yet.
 * - The loaded `session:list` row wins. A session outside the loaded list is
 *   read once with `session:getOrganization`.
 * - `session:organizationChanged` (routed by `ChatMessageHandler`) re-reads
 *   the cached ids it names; loaded rows refresh with the list reload.
 * - When the host does not serve organization (VS Code) no RPC call is made.
 * - At most {@link SESSION_ORGANIZATION_CACHE_MAX} ids are kept (LRU). No
 *   timer runs.
 */
@Injectable({ providedIn: 'root' })
export class SessionOrganizationCache {
  private readonly chatStore = inject(ChatStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);

  /** Insertion order is recency: the first key is the least recently asked. */
  private readonly entries = new Map<string, CacheEntry>();

  /** Organization of each loaded `session:list` row, by session id. */
  private readonly loadedRows = computed(() => {
    const rows = new Map<string, SessionOrganizationSummary>();
    for (const session of this.chatStore.sessions()) {
      if (session.organization) rows.set(session.id, session.organization);
    }
    return rows;
  });

  constructor() {
    // Read the cached ids the loaded list does not carry once organization
    // becomes available, and when a row leaves the list (paging, filters).
    effect(() => {
      if (!this.chatStore.organizationAvailable()) return;
      this.loadedRows();
      untracked(() => {
        for (const id of [...this.entries.keys()]) this.readIfMissing(id);
      });
    });
  }

  /**
   * The organization of a session, or null while unknown. The same signal is
   * returned for an id while it stays cached.
   */
  organizationFor(sessionId: string): Signal<SessionOrganizationSummary | null> {
    if (!sessionId) return UNKNOWN;
    const existing = this.entries.get(sessionId);
    if (existing) {
      this.entries.delete(sessionId);
      this.entries.set(sessionId, existing);
      return existing.view;
    }
    const fetched = signal<SessionOrganizationSummary | null>(null);
    const view = computed(() =>
      this.chatStore.organizationAvailable()
        ? (this.loadedRows().get(sessionId) ?? fetched())
        : null,
    );
    this.entries.set(sessionId, { fetched, view, state: 'idle', stale: false });
    while (this.entries.size > SESSION_ORGANIZATION_CACHE_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    // Callers may ask from a computed or a template, where a read must not
    // start synchronously; the read runs once that pass has finished.
    queueMicrotask(() => this.readIfMissing(sessionId));
    return view;
  }

  /** A `session:organizationChanged` push for these ids. */
  onOrganizationChanged(sessionIds: readonly string[]): void {
    for (const id of sessionIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (entry.state === 'loading') {
        entry.stale = true;
      } else {
        // `read`, or `idle` after a failed read: read it (again).
        entry.state = 'idle';
        this.readIfMissing(id);
      }
    }
  }

  /** Read an idle cached id the loaded list does not carry. */
  private readIfMissing(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.state !== 'idle') return;
    if (!this.chatStore.organizationAvailable()) return;
    if (this.loadedRows().has(sessionId)) return;
    void this.read(sessionId, entry);
  }

  private async read(sessionId: string, entry: CacheEntry): Promise<void> {
    entry.state = 'loading';
    entry.stale = false;
    const result = await this.fetch(sessionId);
    // Evicted while in flight: nothing shows this entry any more.
    if (this.entries.get(sessionId) !== entry) return;
    if (!result.ok) {
      // Keep the last good value; the id stays retryable (the next push, list
      // change or availability change reads it again).
      const retryNow = entry.stale;
      entry.state = 'idle';
      if (retryNow) this.readIfMissing(sessionId);
      return;
    }
    entry.fetched.set(result.summary);
    if (entry.stale) {
      entry.state = 'idle';
      this.readIfMissing(sessionId);
      return;
    }
    entry.state = 'read';
  }

  /**
   * One `session:getOrganization` read. `ok: false` is a failed read (RPC or
   * transport error); an answered read of an unknown or unavailable session
   * is `ok: true` with a null summary.
   */
  private async fetch(sessionId: string): Promise<FetchResult> {
    try {
      const response = await this.rpc.call('session:getOrganization', {
        sessionId,
      });
      if (!response.isSuccess()) {
        this.logger.warn(
          LOG_CONTEXT,
          'Failed to read session organization',
          response.error,
        );
        return { ok: false };
      }
      // `session-not-found`: not persisted yet; `organization-unavailable`:
      // the host has no store. Both are expected and read as unknown.
      return {
        ok: true,
        summary: response.data.ok ? response.data.organization : null,
      };
    } catch (error) {
      this.logger.warn(
        LOG_CONTEXT,
        'Failed to read session organization',
        error,
      );
      return { ok: false };
    }
  }
}
