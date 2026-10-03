/**
 * TurnChangeSetStore (TASK_2026_576 Component 19).
 *
 * Pure storage for the per-session list of turn change sets: read, append,
 * remove, nothing else. Each session lives under its OWN key,
 * `ptah.turnChangeSets:<sessionId>`, never inside the all-sessions metadata
 * blob — the rule `session-metadata-store.ts` states for anything that grows
 * per session (TASK_2026_323 blocker B5). A session keeps its most recent
 * {@link MAX_CHANGE_SETS_PER_SESSION} change sets, oldest first.
 */

import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isAsyncStateStorage,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type { TurnChangeSet } from '@ptah-extension/shared';

/** Key prefix; one key per session. */
export const TURN_CHANGE_SETS_KEY_PREFIX = 'ptah.turnChangeSets:';

/** Change sets kept per session; older ones are dropped on append. */
export const MAX_CHANGE_SETS_PER_SESSION = 100;

const SCHEMA_VERSION = 1;

/** What is written under a session's key. */
interface StoredTurnChangeSets {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly changeSets: readonly TurnChangeSet[];
}

export function turnChangeSetsKey(sessionId: string): string {
  return `${TURN_CHANGE_SETS_KEY_PREFIX}${sessionId}`;
}

@injectable()
export class TurnChangeSetStore {
  /**
   * Tail of the in-flight append or remove per session. An append reads, then
   * writes; two appends for one session interleaving across those awaits
   * would drop one record. Entries are removed when their chain settles.
   */
  private readonly appendChains = new Map<string, Promise<void>>();

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private readonly storage: IStateStorage,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * The session's change sets, oldest first; empty when none are stored.
   * Stored records that fail the shape guard are left out and logged — the
   * next append rewrites the list without them.
   */
  async list(sessionId: string): Promise<TurnChangeSet[]> {
    const key = turnChangeSetsKey(sessionId);
    const stored = isAsyncStateStorage(this.storage)
      ? await this.storage.getAsync<unknown>(key)
      : this.storage.get<unknown>(key);
    const { changeSets, dropped } = readChangeSets(stored);
    if (dropped > 0) {
      this.logger.warn(
        `[TurnChangeSetStore] dropped ${dropped} stored change set(s) with an unknown shape (sessionId=${sessionId}); the next append rewrites the list without them`,
      );
    }
    return changeSets;
  }

  /**
   * Append one change set to its session, keeping the most recent
   * {@link MAX_CHANGE_SETS_PER_SESSION}. Rejects when storage fails.
   */
  append(changeSet: TurnChangeSet): Promise<void> {
    return this.enqueue(changeSet.sessionId, () => this.write(changeSet));
  }

  /**
   * Delete the session's key. Called when the session itself is deleted so
   * its change sets do not outlive it. Runs after any in-flight append for
   * the session, so a pending append cannot re-create the key. Rejects when
   * storage fails.
   */
  remove(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, () =>
      this.storage.update(turnChangeSetsKey(sessionId), undefined),
    );
  }

  private enqueue(
    sessionId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.appendChains.get(sessionId) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    this.appendChains.set(sessionId, run);
    const release = (): void => {
      if (this.appendChains.get(sessionId) === run) {
        this.appendChains.delete(sessionId);
      }
    };
    run.then(release, release);
    return run;
  }

  private async write(changeSet: TurnChangeSet): Promise<void> {
    const existing = await this.list(changeSet.sessionId);
    const changeSets = [...existing, changeSet].slice(
      -MAX_CHANGE_SETS_PER_SESSION,
    );
    const value: StoredTurnChangeSets = {
      schemaVersion: SCHEMA_VERSION,
      changeSets,
    };
    await this.storage.update(turnChangeSetsKey(changeSet.sessionId), value);
  }
}

/**
 * Workspace state is external input: keep only records with the shape the
 * card relies on, and treat anything else under the key as no records.
 * `dropped` counts the stored records that were left out.
 */
function readChangeSets(stored: unknown): {
  changeSets: TurnChangeSet[];
  dropped: number;
} {
  if (stored === undefined || stored === null) {
    return { changeSets: [], dropped: 0 };
  }
  const records =
    isRecord(stored) && Array.isArray(stored['changeSets'])
      ? (stored['changeSets'] as unknown[])
      : null;
  if (!isRecord(stored) || stored['schemaVersion'] !== SCHEMA_VERSION) {
    // A value under the key that this version cannot read: every record in
    // it (or the value itself, when it holds no list) is dropped.
    return { changeSets: [], dropped: records?.length ?? 1 };
  }
  if (records === null) return { changeSets: [], dropped: 1 };
  const changeSets = records.filter(isTurnChangeSet);
  return { changeSets, dropped: records.length - changeSets.length };
}

function isTurnChangeSet(value: unknown): value is TurnChangeSet {
  return (
    isRecord(value) &&
    typeof value['sessionId'] === 'string' &&
    typeof value['workspaceRoot'] === 'string' &&
    typeof value['turnStartedAt'] === 'number' &&
    typeof value['turnEndedAt'] === 'number' &&
    Array.isArray(value['files']) &&
    typeof value['truncatedCount'] === 'number' &&
    isRecord(value['totals']) &&
    typeof value['countsUnavailable'] === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
