/**
 * `mem.ranking.roster` (benchmark-design.md 3.7): the seeded rows at day 0,
 * the product's session-start roster (`buildSessionStartBlock`), scored with
 * 619's NDCG@10 against the labelled-useful subjects, and the same score for
 * a recency-only order. No claim is made either way until it runs on the
 * product.
 */

import { ndcgAtK, recallAtK } from '../../../metrics/retrieval-metrics';
import type { CurationDetails } from '../../memory-skills-suite-kinds';
import { rate } from '../../metrics/curation-metrics';
import type { CaseRecord } from '../../runner/suite-result';
import { deltaOf, inputSha256, rateMetrics } from './memory-suite-support';
import {
  CallLedger,
  RETENTION_EPOCHS,
  RETENTION_GROUND_TRUTH,
  installSimulatedClock,
  seedRows,
  type RetentionSuiteInput,
  type RetentionSuiteOutput,
} from './retention-support';

export const RANKING_ROSTER_SUITE_ID = 'mem.ranking.roster';

/** The roster the product injects holds 10 subjects by default (`memory-prompt-injector.ts:71`). */
export const ROSTER_K = 10;

/** The subjects of the roster block's memory list, in rank order. */
export function parseRosterSubjects(block: string): string[] {
  const lines = block.split('\n');
  const start = lines.findIndex((line) =>
    line.startsWith('Recent observations curated for this workspace'),
  );
  if (start < 0) return [];
  const subjects: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\d+\. (.+)$/.exec(line);
    if (match !== null) {
      subjects.push(match[1]);
    } else if (subjects.length > 0) {
      break;
    }
  }
  return subjects;
}

export async function runRankingRoster(
  input: RetentionSuiteInput,
): Promise<RetentionSuiteOutput> {
  const { port, seed, workspaceRoot } = input;
  const ledger = new CallLedger();
  const epoch = RETENTION_EPOCHS.roster;
  const clock = installSimulatedClock(epoch);
  let block: string;
  try {
    await seedRows(port, clock, ledger, seed, workspaceRoot, epoch);
    clock.set(epoch);
    block = await ledger.timedRun(() =>
      port.buildSessionStartBlock(workspaceRoot),
    );
  } finally {
    clock.restore();
  }
  const bySubject = new Map(seed.map((row) => [row.subject, row]));
  const ranked = parseRosterSubjects(block).map((subject) => {
    const row = bySubject.get(subject);
    if (row === undefined) {
      throw new Error(
        `the roster lists a subject the seed did not write: ${subject}`,
      );
    }
    return row.id;
  });
  // Recency only: last use, newest first; ties by seed id.
  const recency = [...seed]
    .sort((left, right) =>
      left.lastUsedAgeDays !== right.lastUsedAgeDays
        ? left.lastUsedAgeDays - right.lastUsedAgeDays
        : left.id < right.id
          ? -1
          : left.id > right.id
            ? 1
            : 0,
    )
    .slice(0, ROSTER_K)
    .map((row) => row.id);
  const useful = seed.filter((row) => row.useful).map((row) => row.id);
  const truth = { items: useful };
  const score = (ids: string[]) => ({
    ndcg: ndcgAtK({ ranked: ids, abstained: false }, truth, ROSTER_K),
    recall: recallAtK({ ranked: ids, abstained: false }, truth, ROSTER_K),
  });
  const product = score(ranked.slice(0, ROSTER_K));
  const baseline = score(recency);
  const inTop = (ids: readonly string[], id: string): number =>
    ids.indexOf(id) + 1;
  const cases: CaseRecord[] = seed
    .filter((row) => row.useful)
    .map((row) => {
      const rank = inTop(ranked.slice(0, ROSTER_K), row.id);
      return {
        caseId: `useful/${row.id}`,
        inputSha256: inputSha256({ row }),
        expected: `in the session-start roster top ${ROSTER_K}`,
        observed: rank === 0 ? 'not in the roster' : `roster rank ${rank}`,
        outcome: rank > 0 ? 'pass' : 'fail',
        baselineOutcomes: {
          'recency-only': inTop(recency, row.id) > 0 ? 'pass' : 'fail',
        },
        cassetteKey: null,
        latencyMs: 0,
        error: null,
      };
    });
  const hits = rate(
    cases.filter((record) => record.outcome === 'pass').length,
    cases.length,
  );
  const recencyHits = rate(
    useful.filter((id) => recency.includes(id)).length,
    useful.length,
  );
  const productMetrics = {
    ndcgAt10: product.ndcg,
    recallAt10: product.recall,
    ...rateMetrics('usefulInRoster', hits),
  };
  const recencyMetrics = {
    ndcgAt10: baseline.ndcg,
    recallAt10: baseline.recall,
    ...rateMetrics('usefulInRoster', recencyHits),
  };
  const naReason =
    useful.length === 0
      ? 'no-useful-rows'
      : ranked.length === 0
        ? 'empty-roster'
        : undefined;
  const details: CurationDetails = {
    operation: 'ranking',
    target: 'roster',
    ndcgAt10: product.ndcg,
    recallAt10: product.recall,
  };
  return {
    cases,
    result: {
      suiteId: RANKING_ROSTER_SUITE_ID,
      kind: 'curation',
      details,
      claim: {
        source: 'ledger',
        ref: 'feature-evidence: salience for ranking (443, PR #521); libs/backend/memory-curator/src/lib/salience-ranking.ts:18-38',
        text: 'Ranking improves vs recency only.',
      },
      groundTruth: RETENTION_GROUND_TRUTH,
      baselines: [
        {
          id: 'recency-only',
          label: 'recency only (last use, newest first)',
          metrics: recencyMetrics,
        },
      ],
      deltas: { 'recency-only': deltaOf(productMetrics, recencyMetrics) },
      cost: ledger.cost(cases),
      modelCalls: 0,
      verdict:
        naReason !== undefined
          ? 'na'
          : product.ndcg > baseline.ndcg
            ? 'pass'
            : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: {
        ...productMetrics,
        rosterLength: ranked.length,
        rows: seed.length,
        usefulRows: useful.length,
      },
      cassetteVersion: null,
    },
  };
}
