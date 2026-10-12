/**
 * What the update-family suites share (`update.suite.ts` for mem.update and
 * mem.temporal, `update-seed.suite.ts` for mem.update.seed): the planted
 * session shape, the value matcher, the update triple per read path, and one
 * curation pass of a planted session. See `update.suite.ts` for the design.
 */

import type { ExtractedMemoryDraft } from '@ptah-extension/memory-contracts';

import type { UpdateCase } from '../../ground-truth/label-schemas';
import type { MemorySkillsHostSuiteContext } from '../../host/memory-skills-host';
import {
  matchesFact,
  type MatchableMemoryRow,
} from '../../matching/fact-matcher';
import {
  updateOutcomeRate,
  type UpdateCase as UpdatePresence,
  type UpdateOutcome,
} from '../../metrics/curation-metrics';
import {
  commitDrafts,
  extractSession,
  rateMetrics,
  type ModelCallLog,
} from './merge-update-pass';
import type { MergeUpdatePorts, PortHit } from './merge-update-ports';

export type { UpdatePresence };

/** Top-k of the `searchRich` read (design 3.3). */
export const READ_TOP_K = 10;
export const UPDATE_OUTCOMES: readonly UpdateOutcome[] = [
  'correct',
  'stale',
  'omission',
  'hallucination',
];

export const GROUND_TRUTH = {
  id: 'gt-memory',
  version: 'v1',
  method: 'labelled',
} as const;

export interface UpdateSuiteDeps {
  readonly resolvePorts: (
    context: MemorySkillsHostSuiteContext,
  ) => MergeUpdatePorts;
  /** Monotonic clock for latencies. Default `performance.now`. */
  readonly now?: () => number;
  /** Per-case safety cap; default `case-runner.ts`'s 120 s. */
  readonly capMs?: number;
}

/** One planted session: its date and its `ROLE: content` records. */
export interface SeededSession {
  readonly sessionId: string;
  /** `YYYY-MM-DD`; the records are stamped on this day. */
  readonly date: string;
  readonly records: readonly {
    readonly role: 'user' | 'assistant';
    readonly text: string;
  }[];
}

/** The flattened transcript the curator receives (no dates). */
export function transcriptOf(session: SeededSession): string {
  return session.records
    .map((record) => `${record.role.toUpperCase()}: ${record.text}`)
    .join('\n\n');
}

/** The R-M4 matcher with the whole value as its only key token. */
export function hasValue(value: string, row: MatchableMemoryRow): boolean {
  return matchesFact({ keyTokens: [[value]], forbiddenTokens: [] }, row);
}

export function hitRow(hit: PortHit): MatchableMemoryRow {
  return { subject: hit.subject, chunk: hit.chunkText };
}

export function presenceIn(
  updateCase: Pick<UpdateCase, 'v1' | 'v2'> & { readonly bait: string | null },
  rows: readonly MatchableMemoryRow[],
): UpdatePresence {
  return {
    hasV1: rows.some((row) => hasValue(updateCase.v1.value, row)),
    hasV2: rows.some((row) => hasValue(updateCase.v2.value, row)),
    hasBait:
      updateCase.bait !== null &&
      rows.some((row) => hasValue(updateCase.bait ?? '', row)),
  };
}

/** Numbered lines of a `buildBlock` result (`N. [subject]: text`). */
export function blockLines(block: string): string[] {
  return block.split('\n').filter((line) => /^\d+\. /u.test(line));
}

export function outcomeMetrics(
  prefix: string,
  presences: readonly UpdatePresence[],
): Record<string, number | null> {
  return Object.assign(
    {},
    ...UPDATE_OUTCOMES.map((outcome) =>
      rateMetrics(`${prefix}${outcome}`, updateOutcomeRate(presences, outcome)),
    ),
  ) as Record<string, number | null>;
}

export const NO_MEMORY: UpdatePresence = {
  hasV1: false,
  hasV2: false,
  hasBait: false,
};

/** Curate one session into `workspaceRoot`; returns the resolve calls made. */
export async function curateSession(
  ports: MergeUpdatePorts,
  session: SeededSession,
  workspaceRoot: string,
  log: ModelCallLog,
  signal: AbortSignal,
): Promise<{ status: string; drafts: number }> {
  const extraction = await extractSession(
    ports,
    transcriptOf(session),
    log,
    signal,
  );
  if (extraction.status !== 'extracted') {
    return { status: extraction.status, drafts: 0 };
  }
  const drafts: readonly ExtractedMemoryDraft[] = extraction.drafts;
  if (drafts.length > 0) {
    await commitDrafts(
      ports,
      { drafts, workspaceRoot, sessionId: session.sessionId, signal },
      log,
    );
  }
  return { status: 'extracted', drafts: drafts.length };
}
