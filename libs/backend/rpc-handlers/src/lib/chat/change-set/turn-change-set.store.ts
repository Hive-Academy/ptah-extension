/**
 * TurnChangeSetStore (TASK_2026_576 Component 19).
 *
 * Pure storage for the per-session list of turn change sets: read, append,
 * nothing else. Each session lives under its OWN key,
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
   * Tail of the in-flight append per session. An append reads, then writes;
   * two appends for one session interleaving across those awaits would drop
   * one record. Entries are removed when their chain settles.
   */
  private readonly appendChains = new Map<string, Promise<void>>();

  constructor(
    @inject(PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE)
    private readonly storage: IStateStorage,
  ) {}

  /** The session's change sets, oldest first; empty when none are stored. */
  async list(sessionId: string): Promise<TurnChangeSet[]> {
    const key = turnChangeSetsKey(sessionId);
    const stored = isAsyncStateStorage(this.storage)
      ? await this.storage.getAsync<unknown>(key)
      : this.storage.get<unknown>(key);
    return readChangeSets(stored);
  }

  /**
   * Append one change set to its session, keeping the most recent
   * {@link MAX_CHANGE_SETS_PER_SESSION}. Rejects when storage fails.
   */
  append(changeSet: TurnChangeSet): Promise<void> {
    const { sessionId } = changeSet;
    const previous = this.appendChains.get(sessionId) ?? Promise.resolve();
    const run = previous.then(
      () => this.write(changeSet),
      () => this.write(changeSet),
    );
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
 */
function readChangeSets(stored: unknown): TurnChangeSet[] {
  if (!isRecord(stored) || stored['schemaVersion'] !== SCHEMA_VERSION) {
    return [];
  }
  const changeSets = stored['changeSets'];
  return Array.isArray(changeSets) ? changeSets.filter(isTurnChangeSet) : [];
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
