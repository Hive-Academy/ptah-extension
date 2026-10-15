import { Injectable, inject } from '@angular/core';
import { z } from 'zod';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

const nonEmpty = z.string().min(1);
const timestamp = z.number().finite().nonnegative();
const lastSessionSchema = z.object({
  sdkSessionId: nonEmpty,
  tabId: nonEmpty.optional(),
  updatedAt: timestamp,
});
const manifestSchema = z.object({
  runId: z.string().uuid(),
  rootTabId: nonEmpty,
  rootSdkId: nonEmpty,
  move: z.enum(['council', 'forge', 'race', 'relay', 'crucible']),
  specTaskId: nonEmpty,
  lanes: z.array(z.object({ laneId: nonEmpty, role: nonEmpty })),
  rounds: z.number().int().positive(),
  startedAt: timestamp,
});

export type CommandCenterLastSession = z.infer<typeof lastSessionSchema>;
export type CommandCenterRunManifest = z.infer<typeof manifestSchema>;

interface StoredRecords {
  lastSession?: CommandCenterLastSession;
  activeTabId?: string;
  runs: Record<string, CommandCenterRunManifest>;
}

/** Workspace-scoped durable records, independent of the tab envelope. */
@Injectable({ providedIn: 'root' })
export class CommandCenterRecordsService {
  private readonly partitions = inject(TabWorkspacePartitionService);

  private key(workspacePath: string): string {
    return `${this.partitions.getStorageKeyForWorkspace(workspacePath)}.command-center`;
  }

  private read(workspacePath: string): StoredRecords {
    const empty: StoredRecords = { runs: {} };
    let parsed: unknown;
    try {
      const raw = localStorage.getItem(this.key(workspacePath));
      if (raw === null) return empty;
      parsed = JSON.parse(raw);
    } catch {
      return empty;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const value = parsed as Record<string, unknown>;
    const lastSession = lastSessionSchema.safeParse(value['lastSession']);
    if (lastSession.success) empty.lastSession = lastSession.data;
    const activeTabId = nonEmpty.safeParse(value['activeTabId']);
    if (activeTabId.success) empty.activeTabId = activeTabId.data;
    const rawRuns = value['runs'];
    if (rawRuns !== null && typeof rawRuns === 'object' && !Array.isArray(rawRuns)) {
      for (const [rootTabId, rawManifest] of Object.entries(rawRuns)) {
        const manifest = manifestSchema.safeParse(rawManifest);
        if (manifest.success && manifest.data.rootTabId === rootTabId) {
          empty.runs[rootTabId] = manifest.data;
        }
      }
    }
    return empty;
  }

  private write(workspacePath: string, records: StoredRecords): boolean {
    try {
      localStorage.setItem(this.key(workspacePath), JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }

  readLastSession(workspacePath: string): CommandCenterLastSession | undefined {
    return this.read(workspacePath).lastSession;
  }

  writeLastSession(workspacePath: string, value: CommandCenterLastSession): boolean {
    const validated = lastSessionSchema.safeParse(value);
    if (!validated.success) return false;
    const records = this.read(workspacePath);
    records.lastSession = validated.data;
    return this.write(workspacePath, records);
  }

  readActiveTabId(workspacePath: string): string | undefined {
    return this.read(workspacePath).activeTabId;
  }

  /** A null tab ID marks New Command Center without erasing last-session history. */
  setActiveTabId(workspacePath: string, tabId: string | null): boolean {
    if (tabId !== null && !nonEmpty.safeParse(tabId).success) return false;
    const records = this.read(workspacePath);
    if (tabId === null) delete records.activeTabId;
    else records.activeTabId = tabId;
    return this.write(workspacePath, records);
  }

  readRunManifest(workspacePath: string, rootTabId: string): CommandCenterRunManifest | undefined {
    return this.read(workspacePath).runs[rootTabId];
  }

  writeRunManifest(workspacePath: string, value: CommandCenterRunManifest): boolean {
    const validated = manifestSchema.safeParse(value);
    if (!validated.success) return false;
    const records = this.read(workspacePath);
    records.runs[validated.data.rootTabId] = validated.data;
    return this.write(workspacePath, records);
  }

  removeRunManifest(workspacePath: string, rootTabId: string): boolean {
    const records = this.read(workspacePath);
    delete records.runs[rootTabId];
    return this.write(workspacePath, records);
  }
}
