import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';

const MAX_RECORDS_PER_SESSION = 200;
const EMPTY_RECORDS: readonly ArtifactRecord[] = [];

@Injectable({ providedIn: 'root' })
export class ArtifactStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabs = inject(TabManagerService);

  readonly records = signal<Readonly<Record<string, readonly ArtifactRecord[]>>>({});
  readonly lastError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const sessionId = this.tabs.activeTabId();
      if (sessionId) void this.reload(sessionId);
    });
  }

  forSession(sessionId: string) {
    return computed(() => this.records()[sessionId] ?? EMPTY_RECORDS);
  }

  /**
   * The record with this artifact id, from any session the store holds.
   * Artifact ids are server-generated and globally unique, and a transcript
   * tool row knows only the id its tool result named, so the lookup does not
   * need the session resolved.
   */
  recordById(id: string): ArtifactRecord | null {
    for (const records of Object.values(this.records())) {
      const found = records.find((record) => record.id === id);
      if (found) return found;
    }
    return null;
  }

  upsert(record: ArtifactRecord): void {
    this.records.update((sessions) => ({
      ...sessions,
      [record.sessionId]: this.merge(sessions[record.sessionId] ?? EMPTY_RECORDS, [record]),
    }));
  }

  async reload(sessionId: string): Promise<void> {
    try {
      const result = await this.rpc.call('artifacts:list', { sessionId });
      if (!result.success) {
        this.lastError.set('Unable to load artifacts.');
        console.warn('[ArtifactStore] artifacts:list failed', { sessionId });
        return;
      }
      const { ArtifactListResponseSchema } = await import('@ptah-extension/shared/mcp-apps-contracts');
      const parsed = ArtifactListResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        this.lastError.set('Unable to load artifacts.');
        console.warn('[ArtifactStore] invalid artifacts:list response', { sessionId });
        return;
      }
      this.lastError.set(null);
      // The host resolves the routing tab id. A tab can switch while the request is in flight.
      const scoped = parsed.data.artifacts.filter((record) => record.sessionId === sessionId);
      this.records.update((sessions) => ({
        ...sessions,
        [sessionId]: this.merge(sessions[sessionId] ?? EMPTY_RECORDS, scoped),
      }));
    } catch {
      // degradation-audit: optional-capability - existing artifact rows remain available after reload failure.
      this.lastError.set('Unable to load artifacts.');
      console.warn('[ArtifactStore] artifacts:list request failed', { sessionId });
    }
  }

  private merge(
    existing: readonly ArtifactRecord[],
    incoming: readonly ArtifactRecord[],
  ): readonly ArtifactRecord[] {
    const byId = new Map(existing.map((record) => [record.id, record]));
    for (const record of incoming) {
      const previous = byId.get(record.id);
      if (!previous || record.revision >= previous.revision) byId.set(record.id, record);
    }
    return [...byId.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision)
      .slice(0, MAX_RECORDS_PER_SESSION);
  }
}
