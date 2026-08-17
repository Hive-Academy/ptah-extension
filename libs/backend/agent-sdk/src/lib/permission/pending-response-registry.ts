import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, TabId } from '@ptah-extension/shared';

export interface PendingResolver<TResponse, TRequest = never> {
  resolve: (value: TResponse | null) => void;
  sessionId?: SessionId;
  tabId?: TabId;
  idleTimer?: ReturnType<typeof setTimeout> | null;
  /**
   * The original request this resolver is waiting on.
   *
   * Kept so a caller can re-read what is still outstanding (see
   * {@link PendingResponseRegistry.listBySession}) — a webview reload loses
   * the in-flight prompt, and only the backend still knows it exists.
   *
   * Defaults to `never`, so a registry declared as
   * `PendingResponseRegistry<TResponse>` cannot store a request at all and
   * `listBySession` is statically empty for it.
   */
  readonly request?: TRequest;
}

export class PendingResponseRegistry<TResponse, TRequest = never> {
  private readonly pending = new Map<
    string,
    PendingResolver<TResponse, TRequest>
  >();

  constructor(private readonly logger: Logger) {}

  register(id: string, resolver: PendingResolver<TResponse, TRequest>): void {
    this.pending.set(id, resolver);
  }

  resolve(id: string, value: TResponse | null): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    this.pending.delete(id);
    entry.resolve(value);
    return true;
  }

  reject(id: string, reason: TResponse | null = null): boolean {
    return this.resolve(id, reason);
  }

  getPending(id: string): PendingResolver<TResponse, TRequest> | undefined {
    return this.pending.get(id);
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  clear(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    return this.pending.delete(id);
  }

  entries(): IterableIterator<[string, PendingResolver<TResponse, TRequest>]> {
    return this.pending.entries();
  }

  get size(): number {
    return this.pending.size;
  }

  disposeAll(disposalValue: TResponse | null = null): void {
    this.logger.info(
      `[PendingResponseRegistry] Disposing ${this.pending.size} pending entries`,
    );
    for (const [, entry] of this.pending.entries()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.resolve(disposalValue);
    }
    this.pending.clear();
  }

  /**
   * The stored request of every pending entry bound to `sessionOrTabId`.
   *
   * Matching follows the exact rule {@link cleanupBySession} uses — an entry
   * matches on either its `tabId` or its `sessionId` — so "what would be
   * cleaned up" and "what is still outstanding" can never drift apart.
   *
   * Entries registered without a `request` are skipped: there is nothing to
   * hand back for them.
   */
  listBySession(sessionOrTabId: string): TRequest[] {
    const requests: TRequest[] = [];
    for (const entry of this.pending.values()) {
      const matches =
        entry.tabId === sessionOrTabId || entry.sessionId === sessionOrTabId;
      if (!matches || entry.request === undefined) {
        continue;
      }
      requests.push(entry.request);
    }
    return requests;
  }

  cleanupBySession(
    sessionOrTabId: string,
    disposalValue: TResponse | null = null,
  ): string[] {
    const removed: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (
        entry.tabId === sessionOrTabId ||
        entry.sessionId === sessionOrTabId
      ) {
        if (entry.idleTimer) clearTimeout(entry.idleTimer);
        this.pending.delete(id);
        entry.resolve(disposalValue);
        removed.push(id);
      }
    }
    return removed;
  }
}
