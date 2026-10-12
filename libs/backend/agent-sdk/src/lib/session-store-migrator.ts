/**
 * Copy-forward from the per-workspace stores into the global session store
 * (Plane PTAH-35, MP-1).
 *
 * Runs on every start. A source is skipped when its receipt says it was
 * copied in this exact state; otherwise each session is copied unless the
 * global store already holds a copy at least as recent. Legacy stores are
 * only read, never written, so the previous build keeps working on them:
 * that is the rollback. A session an older build writes after a rollback
 * changes the source's fingerprint and is picked up on the next start.
 */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import {
  isAsyncStateStorage,
  type ISessionBlobStore,
  type ISessionRecordRepository,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import {
  SessionId,
  type CliOutputSegment,
  type CliSessionReference,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  LEGACY_SESSION_STORAGE_KEYS as KEYS,
  agentOutputBlobName,
  toSessionRecordInput,
  type PersistedAgentOutput,
  type SessionMetadata,
  type TaggedAgentOutputItem,
} from './session-metadata-store';

export interface LegacySessionSource {
  /** Stable identity of the store, e.g. its storage folder. */
  readonly sourcePath: string;
  readonly storage: IStateStorage;
}

/** A per-session key another module wrote, copied to a blob of the session. */
export interface LegacySessionKeyMapping {
  readonly keyPrefix: string;
  readonly blobName: string;
}

export interface LegacySessionMigrationResult {
  readonly sources: number;
  /** Sources skipped because their receipt matched. */
  readonly skipped: number;
  /** Sources that could not be read; retried on the next start. */
  readonly failed: number;
  /** Sessions written to the global store. */
  readonly copied: number;
}

type EmbeddedOutputRef = CliSessionReference & {
  readonly segments?: readonly CliOutputSegment[];
  readonly streamEvents?: readonly FlatStreamEventUnion[];
};

/**
 * A plain JSON state file (Electron v1, the CLI's workspace-state.json) as a
 * store that can be read and never written.
 */
export async function openReadOnlyJsonStateFile(
  file: string,
): Promise<IStateStorage> {
  const data = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<
    string,
    unknown
  >;
  return {
    get: <T>(key: string, fallback?: T) =>
      (key in data ? (data[key] as T) : fallback) as T,
    update: async () => {
      throw new Error('legacy session source is read-only');
    },
    keys: () => Object.keys(data),
  };
}

export class LegacySessionStoreMigrator {
  constructor(
    private readonly records: ISessionRecordRepository,
    private readonly blobs: ISessionBlobStore,
    private readonly logger: Logger,
    private readonly extraKeys: readonly LegacySessionKeyMapping[] = [],
  ) {}

  async migrate(
    sources: Iterable<LegacySessionSource>,
  ): Promise<LegacySessionMigrationResult> {
    let total = 0;
    let skipped = 0;
    let failed = 0;
    let copied = 0;
    for (const source of sources) {
      total++;
      try {
        const index = await this.readIndex(source.storage);
        const fingerprint = fingerprintOf(index);
        if (
          await this.records.hasMigrationSource(source.sourcePath, fingerprint)
        ) {
          skipped++;
          continue;
        }
        let copiedHere = 0;
        for (const entry of index) {
          if (await this.copySession(source.storage, entry)) copiedHere++;
        }
        await this.records.recordMigrationSource(
          source.sourcePath,
          fingerprint,
          copiedHere,
        );
        copied += copiedHere;
        this.logger.info('[SessionStoreMigrator] Copied legacy session store', {
          sourcePath: source.sourcePath,
          sessions: index.length,
          copied: copiedHere,
        });
      } catch (error: unknown) {
        failed++;
        this.logger.warn(
          '[SessionStoreMigrator] Could not copy a legacy session store; it is left as is and retried on the next start',
          {
            sourcePath: source.sourcePath,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    return { sources: total, skipped, failed, copied };
  }

  private async readIndex(storage: IStateStorage): Promise<SessionMetadata[]> {
    const stored = isAsyncStateStorage(storage)
      ? await storage.getAsync<unknown>(KEYS.index)
      : storage.get<unknown>(KEYS.index);
    const items = Array.isArray(stored)
      ? stored
      : ((stored as { items?: unknown } | undefined)?.items ?? []);
    if (!Array.isArray(items)) return [];
    // Only real SDK session ids. Another tool's log file was once imported as
    // a session (PTAH-21); such a row has no transcript and is not copied.
    return (items as SessionMetadata[]).filter(
      (m) =>
        typeof m?.sessionId === 'string' && SessionId.validate(m.sessionId),
    );
  }

  /** True when the session was written to the global store. */
  private async copySession(
    storage: IStateStorage,
    entry: SessionMetadata,
  ): Promise<boolean> {
    const existing = await this.records.get(entry.sessionId);
    if (existing && existing.lastActiveAt >= entry.lastActiveAt) return false;

    const raw = await this.readDetail(storage, entry);
    for (const ref of (raw.cliSessions ?? []) as readonly EmbeddedOutputRef[]) {
      await this.copyAgentOutput(storage, entry.sessionId, ref);
    }
    for (const mapping of this.extraKeys) {
      const key = `${mapping.keyPrefix}${entry.sessionId}`;
      const value = isAsyncStateStorage(storage)
        ? await storage.getAsync<unknown>(key)
        : storage.get<unknown>(key);
      if (value !== undefined) {
        await this.blobs.write(entry.sessionId, mapping.blobName, value);
      }
    }
    // The detail can still carry bulk output from before the split; that is
    // now in the session's blobs, so the row keeps only the references.
    const detail = {
      ...raw,
      ...(raw.cliSessions
        ? {
            cliSessions: (raw.cliSessions as readonly EmbeddedOutputRef[]).map(
              ({ segments: _s, streamEvents: _e, ...lean }) => {
                const ref = { ...lean } as Record<string, unknown>;
                delete ref['stdout'];
                return ref as unknown as CliSessionReference;
              },
            ),
          }
        : {}),
      // The index entry is what lists and newest-wins compare.
      lastActiveAt: Math.max(raw.lastActiveAt ?? 0, entry.lastActiveAt),
    } as SessionMetadata;
    await this.records.upsert(toSessionRecordInput(detail));
    return true;
  }

  private async readDetail(
    storage: IStateStorage,
    entry: SessionMetadata,
  ): Promise<SessionMetadata> {
    if (!isAsyncStateStorage(storage)) return entry;
    const detail = await storage.getAsync<SessionMetadata>(
      `${KEYS.detailPrefix}${entry.sessionId}`,
    );
    return detail ?? entry;
  }

  private async copyAgentOutput(
    storage: IStateStorage,
    sessionId: string,
    ref: EmbeddedOutputRef,
  ): Promise<void> {
    if (typeof ref.agentId !== 'string' || ref.agentId.length === 0) return;
    // The blob store rejects such an id; one bad ref must not fail the source.
    if (!isSafeBlobSegment(ref.agentId)) {
      this.logger.warn(
        '[SessionStoreMigrator] Skipped agent output with an invalid agent id',
        { sessionId, agentId: ref.agentId },
      );
      return;
    }
    const key = `${KEYS.agentOutputPrefix}${ref.agentId}`;
    let output = isAsyncStateStorage(storage)
      ? await readSequenceOutput(storage, key, ref.agentId)
      : storage.get<PersistedAgentOutput>(key);
    if (!output && (ref.segments?.length || ref.streamEvents?.length)) {
      output = {
        agentId: ref.agentId,
        savedAt: Date.now(),
        ...(ref.segments?.length ? { segments: ref.segments } : {}),
        ...(ref.streamEvents?.length ? { streamEvents: ref.streamEvents } : {}),
      };
    }
    if (output) {
      await this.blobs.write(
        sessionId,
        agentOutputBlobName(ref.agentId),
        output,
      );
    }
  }
}

/** Same rule as the blob store's file names. */
function isSafeBlobSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value) && value !== '.' && value !== '..';
}

async function readSequenceOutput(
  storage: IStateStorage & {
    readJsonSequence: (
      key: string,
    ) => AsyncIterable<{ items: readonly unknown[]; done: boolean }>;
  },
  key: string,
  agentId: string,
): Promise<PersistedAgentOutput | undefined> {
  const segments: CliOutputSegment[] = [];
  const streamEvents: FlatStreamEventUnion[] = [];
  for await (const page of storage.readJsonSequence(key)) {
    for (const item of page.items as readonly TaggedAgentOutputItem[]) {
      if (item?.tag === 'segment') segments.push(item.value);
      else if (item?.tag === 'streamEvent') streamEvents.push(item.value);
    }
    if (page.done) break;
  }
  if (segments.length === 0 && streamEvents.length === 0) return undefined;
  return {
    agentId,
    savedAt: Date.now(),
    ...(segments.length > 0 ? { segments } : {}),
    ...(streamEvents.length > 0 ? { streamEvents } : {}),
  };
}

/** Changes whenever a session is added, removed, renamed or touched. */
function fingerprintOf(index: readonly SessionMetadata[]): string {
  const hash = createHash('sha256');
  for (const m of [...index].sort((a, b) =>
    a.sessionId.localeCompare(b.sessionId),
  )) {
    hash.update(`${m.sessionId}\u0000${m.lastActiveAt}\u0000${m.name}\u0001`);
  }
  return hash.digest('hex');
}
