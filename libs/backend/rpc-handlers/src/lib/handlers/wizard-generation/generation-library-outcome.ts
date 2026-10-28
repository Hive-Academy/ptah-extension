/**
 * The Library outcome of one wizard generation invocation: whether the
 * Library was refreshed after the run wrote its agent files, and which of
 * those agents now have a Library copy that carries the user's edits and is
 * diverged from the new source.
 *
 * Pure functions; the handler supplies every read. Nothing here changes a
 * per-file outcome: a failed Library pass leaves the files on disk, and the
 * outcomes reported for them, exactly as they were.
 */

import type { CloneEntry } from '@ptah-extension/agent-generation';
import type { UserLayerRefreshStatus } from '@ptah-extension/harness-sync';
import type {
  GenerationAgentOutcome,
  LibraryPassStatus,
} from '@ptah-extension/shared';

/** What the invocation did that decides whether a Library pass was due. */
export interface LibraryPassInput {
  /** Whether the run wrote under the harness root (the Library's source). */
  atHarnessRoot: boolean;
  /** Number of files this invocation wrote with new content. */
  writtenCount: number;
  /**
   * The user-layer refresh status of this invocation's propagation, `failed`
   * when the propagation itself threw, or `null` when the host has no
   * propagation (and so no Library) at all.
   */
  userLayer: UserLayerRefreshStatus | null;
}

/**
 * - `not-applicable`: the run wrote under the opened folder (no Library reads
 *   it), wrote nothing, runs on a host without a Library, or its refresh was
 *   skipped. A skip is reported for THIS invocation even when an earlier
 *   pass succeeded.
 * - `updated`: the refresh ran for this invocation.
 * - `failed`: a refresh was due and did not complete.
 */
export function libraryPassFor(input: LibraryPassInput): LibraryPassStatus {
  if (!input.atHarnessRoot || input.writtenCount === 0) return 'not-applicable';
  switch (input.userLayer) {
    case 'refreshed':
      return 'updated';
    case 'failed':
      return 'failed';
    case 'skipped':
    case null:
      return 'not-applicable';
  }
}

/** Agent ids this invocation wrote with new content, in outcome order. */
export function writtenAgentIds(
  outcomes: readonly GenerationAgentOutcome[],
): string[] {
  return outcomes
    .filter((outcome) => outcome.status === 'written')
    .map((outcome) => outcome.agentId);
}

/** The slice of a Library clone record the divergence check reads. */
export type LibraryCloneState = Pick<
  CloneEntry,
  'diverged' | 'pendingSourceHash'
>;

export interface LibraryDivergedInput {
  /** Agents written by this invocation; any other agent is never listed. */
  writtenAgentIds: readonly string[];
  /** The hash the wizard recorded per written agent (the origin store). */
  originHashes: Readonly<Record<string, string>>;
  /** The Library clone of one agent, or `null` when it has none. */
  readClone: (agentId: string) => Promise<LibraryCloneState | null>;
  /** Reports an agent omitted because its clone could not be read. */
  warn: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * Agents whose Library copy carries the user's edits and is now diverged from
 * the content this run wrote: the clone is `diverged` AND its
 * `pendingSourceHash` equals the hash the wizard recorded for the file. A
 * clone diverged from some other source, an agent without a recorded hash,
 * and an agent the run did not write (a kept file included) are never
 * listed. A clone that cannot be read is omitted with a warning.
 */
export async function collectLibraryDiverged(
  input: LibraryDivergedInput,
): Promise<string[]> {
  const diverged: string[] = [];
  for (const agentId of input.writtenAgentIds) {
    if (!Object.prototype.hasOwnProperty.call(input.originHashes, agentId)) {
      continue;
    }
    const writtenHash = input.originHashes[agentId];
    let clone: LibraryCloneState | null;
    try {
      clone = await input.readClone(agentId);
    } catch (error: unknown) {
      // degradation-audit: reported - an unreadable clone only drops this
      // agent from the "Library copy diverged" notice; the warning names it.
      input.warn('Library copy of a generated agent could not be read', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (
      clone !== null &&
      clone.diverged &&
      clone.pendingSourceHash !== null &&
      clone.pendingSourceHash === writtenHash
    ) {
      diverged.push(agentId);
    }
  }
  return diverged;
}
