import type { Logger } from '@ptah-extension/vscode-core';
import type { SessionId, TabId } from '@ptah-extension/shared';

export interface PendingResolver<T> {
  resolve: (value: T | null) => void;
  sessionId?: SessionId;
  tabId?: TabId;
  idleTimer?: ReturnType<typeof setTimeout> | null;
}

export class PendingResponseRegistry<T> {
  private readonly pending = new Map<string, PendingResolver<T>>();

  constructor(private readonly logger: Logger) {}

  register(id: string, resolver: PendingResolver<T>): void {
    this.pending.set(id, resolver);
  }

  resolve(id: string, value: T | null): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      return false;
    }
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    this.pending.delete(id);
    entry.resolve(value);
    return true;
  }

  reject(id: string, reason: T | null = null): boolean {
    return this.resolve(id, reason);
  }

  getPending(id: string): PendingResolver<T> | undefined {
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

  entries(): IterableIterator<[string, PendingResolver<T>]> {
    return this.pending.entries();
  }

  get size(): number {
    return this.pending.size;
  }

  disposeAll(disposalValue: T | null = null): void {
    this.logger.info(
      `[PendingResponseRegistry] Disposing ${this.pending.size} pending entries`,
    );
    for (const [, entry] of this.pending.entries()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.resolve(disposalValue);
    }
    this.pending.clear();
  }

  cleanupBySession(
    sessionOrTabId: string,
    disposalValue: T | null = null,
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
