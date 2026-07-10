/**
 * MetadataGatewaySessionLister — Electron host implementation of the
 * messaging-gateway `IGatewaySessionLister` port (TASK_2026_156 §4.2).
 *
 * Why aggregate-scanning instead of `SessionMetadataStore.getForWorkspace`:
 * that store reads through `WorkspaceAwareStateStorage.get()`, which delegates
 * to the ACTIVE workspace's storage file — so listing sessions for a
 * non-active workspace returns nothing, and gateway turns running in a
 * non-active root can write their metadata into the active workspace's file.
 * Per-storage placement is therefore unreliable in both directions. This
 * lister reads the `ptah.sessionMetadata` key from the active-or-default
 * delegate AND every registered workspace storage (read-only, no
 * active-workspace switch — zero interference with the desktop user), filters
 * by the entry's own `workspaceId`, dedupes, and caps at 25 (AC-2.2).
 */
import { z } from 'zod';
import {
  normalizeWorkspacePath,
  type GatewaySessionSummary,
  type IGatewaySessionLister,
} from '@ptah-extension/messaging-gateway';

const SESSION_METADATA_KEY = 'ptah.sessionMetadata';
const SESSION_LIST_CAP = 25;

/** File-I/O boundary: entries come from on-disk state JSON (SEC-8 posture). */
const sessionMetadataEntrySchema = z.object({
  sessionId: z.string().min(1),
  name: z.string().default(''),
  workspaceId: z.string().min(1),
  lastActiveAt: z.number(),
  isChildSession: z.boolean().optional(),
});

/** Read-only view of a single state-storage delegate. */
interface StateStorageReadLike {
  get<T>(key: string, defaultValue?: T): T | undefined;
}

/**
 * Structural seam over `WorkspaceAwareStateStorage` (vscode-core) — only the
 * members this lister needs, so tests need no real storage class and the app
 * layer stays decoupled from its concrete type.
 */
export interface WorkspaceMetadataStorageLike extends StateStorageReadLike {
  getAllWorkspacePaths(): string[];
  getStorageForWorkspace(
    workspacePath: string,
  ): StateStorageReadLike | undefined;
}

export class MetadataGatewaySessionLister implements IGatewaySessionLister {
  constructor(private readonly storage: WorkspaceMetadataStorageLike) {}

  async listForWorkspace(workspaceRoot: string): Promise<{
    sessions: GatewaySessionSummary[];
    truncated: boolean;
  }> {
    const target = normalizeWorkspacePath(workspaceRoot);

    const sources: StateStorageReadLike[] = [this.storage];
    for (const workspacePath of this.storage.getAllWorkspacePaths()) {
      const workspaceStorage =
        this.storage.getStorageForWorkspace(workspacePath);
      if (workspaceStorage) sources.push(workspaceStorage);
    }

    const bySessionId = new Map<string, GatewaySessionSummary>();
    for (const source of sources) {
      const raw = source.get<unknown>(SESSION_METADATA_KEY);
      if (!Array.isArray(raw)) continue;
      for (const candidate of raw) {
        const parsed = sessionMetadataEntrySchema.safeParse(candidate);
        if (!parsed.success) continue;
        const entry = parsed.data;
        if (entry.isChildSession === true) continue;
        if (normalizeWorkspacePath(entry.workspaceId) !== target) continue;
        const existing = bySessionId.get(entry.sessionId);
        if (existing && existing.lastActiveAt >= entry.lastActiveAt) continue;
        bySessionId.set(entry.sessionId, {
          sessionId: entry.sessionId,
          name: entry.name,
          lastActiveAt: entry.lastActiveAt,
        });
      }
    }

    const all = Array.from(bySessionId.values()).sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt,
    );
    return {
      sessions: all.slice(0, SESSION_LIST_CAP),
      truncated: all.length > SESSION_LIST_CAP,
    };
  }
}
