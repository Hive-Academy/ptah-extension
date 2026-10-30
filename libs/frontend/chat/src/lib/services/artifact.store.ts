import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { type ArtifactRecord } from '@ptah-extension/shared';

const MAX_RECORDS_PER_SESSION = 200;
const EMPTY_RECORDS: readonly ArtifactRecord[] = [];

/** A request to show a newly published artifact; `seq` rises on every request. */
export interface ArtifactAutoOpenRequest {
  readonly record: ArtifactRecord;
  readonly seq: number;
}

function newestFirst(a: ArtifactRecord, b: ArtifactRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision;
}

/**
 * The artifacts a Display panel for `tabId` lists: the tab's bucket, plus the
 * selected artifact when it lives in another bucket. A bucket is keyed by the
 * tab the publishing MCP caller was routed to, which can differ from the tab
 * that shows the transcript (a resumed or continued session), so the selected
 * id is resolved across buckets. Bucket order is kept; no id appears twice.
 */
export function panelArtifactsFrom(
  records: Readonly<Record<string, readonly ArtifactRecord[]>>,
  tabId: string | null,
  selectedArtifactId: string | null,
): readonly ArtifactRecord[] {
  const bucket = (tabId ? records[tabId] : undefined) ?? EMPTY_RECORDS;
  if (!selectedArtifactId || bucket.some((record) => record.id === selectedArtifactId)) {
    return bucket;
  }
  for (const [key, others] of Object.entries(records)) {
    if (key === tabId) continue;
    const found = others.find((record) => record.id === selectedArtifactId);
    if (found) return [...bucket, found].sort(newestFirst);
  }
  return bucket;
}

@Injectable({ providedIn: 'root' })
export class ArtifactStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabs = inject(TabManagerService);

  readonly records = signal<Readonly<Record<string, readonly ArtifactRecord[]>>>({});
  readonly lastError = signal<string | null>(null);
  private readonly autoOpen = signal<ArtifactAutoOpenRequest | null>(null);
  /** The latest publish the Display panel should open, when the user setting allows it. */
  readonly autoOpenRequest = this.autoOpen.asReadonly();

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

  /** Reactive when read in a computed or effect. See `panelArtifactsFrom`. */
  panelArtifacts(tabId: string | null, selectedArtifactId: string | null): readonly ArtifactRecord[] {
    return panelArtifactsFrom(this.records(), tabId, selectedArtifactId);
  }

  /** Asks the Display panel to open this record; the latest request wins. */
  requestAutoOpen(record: ArtifactRecord): void {
    this.autoOpen.update((previous) => ({ record, seq: (previous?.seq ?? 0) + 1 }));
  }

  /**
   * Rebuilds a record from a `ptah_artifact_publish` tool result found in the
   * transcript, so a card and the panel still resolve it after an app restart
   * or in a tab whose session is not live (`artifacts:list` then returns none).
   * The result is validated with `ArtifactPublishResultSchema`; `savedPath`
   * stays out of the store. Returns the record, or `null` when the result is
   * invalid.
   */
  async adoptPublishResult(result: unknown): Promise<ArtifactRecord | null> {
    try {
      const { ArtifactPublishResultSchema } = await import('@ptah-extension/shared/mcp-apps-contracts');
      const parsed = ArtifactPublishResultSchema.safeParse(result);
      if (!parsed.success) {
        console.warn('[ArtifactStore] invalid artifact publish result');
        return null;
      }
      const { id, title, revision, sessionId, viewerUrl, createdAt } = parsed.data;
      const record: ArtifactRecord = { id, title, revision, sessionId, viewerUrl, createdAt };
      const known = this.recordById(id);
      if (!known || known.revision < revision) this.upsert(record);
      return record;
    } catch {
      // degradation-audit: reported — schema loading failure leaves the card without a record.
      console.warn('[ArtifactStore] artifact publish result could not be validated');
      return null;
    }
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
      .sort(newestFirst)
      .slice(0, MAX_RECORDS_PER_SESSION);
  }
}
