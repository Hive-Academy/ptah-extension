import { ndcgAtK, recallAtK } from '../../metrics/retrieval-metrics';

export { ndcgAtK, recallAtK };

export interface Rate {
  value: number | null;
  num: number;
  den: number;
}

export type UpdateOutcome = 'correct' | 'stale' | 'omission' | 'hallucination';

export interface UpdateCase {
  hasV1: boolean;
  hasV2: boolean;
  hasBait: boolean;
  v1Rank?: number;
  v2Rank?: number;
}

export interface RetentionCase {
  deleted: boolean;
  archived?: boolean;
  neededAfterDeletion: boolean;
}

export interface MergeCounts {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
}

export function rate(num: number, den: number): Rate {
  return { value: den === 0 ? null : num / den, num, den };
}

export function recall(
  seededFactIds: readonly string[],
  presentFactIds: readonly string[],
): Rate {
  const present = new Set(presentFactIds);
  const seeded = new Set(seededFactIds);
  return rate(
    [...seeded].filter((factId) => present.has(factId)).length,
    seeded.size,
  );
}

/** Unlabelled written rows are excluded from this denominator. */
export function precision(
  writtenRows: readonly ('seeded' | 'unlabelled' | 'other')[],
): Rate {
  const labelled = writtenRows.filter((row) => row !== 'unlabelled');
  return rate(
    labelled.filter((row) => row === 'seeded').length,
    labelled.length,
  );
}

/** False-memory rate: one minus the share of bait facts written as memory. */
export function falseMemoryRate(writtenBaits: number, baitCount: number): Rate {
  const num = baitCount - writtenBaits;
  const den = baitCount;
  return {
    value: den === 0 ? null : num / den,
    num,
    den,
  };
}

export function overSuppression(
  oldWrittenFactIds: readonly string[],
  currentWrittenFactIds: readonly string[],
): Rate {
  const current = new Set(currentWrittenFactIds);
  const old = new Set(oldWrittenFactIds);
  return rate(
    [...old].filter((factId) => !current.has(factId)).length,
    old.size,
  );
}

export function classifyUpdate(update: UpdateCase): UpdateOutcome {
  if (update.hasBait) return 'hallucination';
  if (!update.hasV1 && update.hasV2) return 'correct';
  if (!update.hasV1 && !update.hasV2) return 'omission';
  return 'stale';
}

export function updateOutcomeRate(
  updates: readonly UpdateCase[],
  outcome: UpdateOutcome,
): Rate {
  return rate(
    updates.filter((update) => classifyUpdate(update) === outcome).length,
    updates.length,
  );
}

export function mergePrecision(counts: MergeCounts): Rate {
  return rate(counts.truePositive, counts.truePositive + counts.falsePositive);
}

export function mergeRecall(counts: MergeCounts): Rate {
  return rate(counts.truePositive, counts.truePositive + counts.falseNegative);
}

// F1 = 2TP / (2TP + FP + FN), computed from the integer counts so `value`
// is exactly `num / den` and the scorecard projection hash stays stable.
export function mergeF1(counts: MergeCounts): Rate {
  const num = 2 * counts.truePositive;
  const den = num + counts.falsePositive + counts.falseNegative;
  return { value: den === 0 ? null : num / den, num, den };
}

export function duplicateClusterRate(
  activeRowsPerFact: readonly number[],
): Rate {
  return rate(
    activeRowsPerFact.filter((rowCount) => rowCount > 1).length,
    activeRowsPerFact.length,
  );
}

export function singletonSubjectShare(
  activeRowsPerSubject: readonly number[],
): Rate {
  return rate(
    activeRowsPerSubject.filter((rowCount) => rowCount === 1).length,
    activeRowsPerSubject.length,
  );
}

export function falseDeleteRate(cases: readonly RetentionCase[]): Rate {
  return rate(
    cases.filter(
      (retentionCase) =>
        retentionCase.deleted && retentionCase.neededAfterDeletion,
    ).length,
    cases.filter((retentionCase) => retentionCase.deleted).length,
  );
}

export function falseRetainRate(cases: readonly RetentionCase[]): Rate {
  return rate(
    cases.filter(
      (retentionCase) =>
        !retentionCase.deleted && !retentionCase.neededAfterDeletion,
    ).length,
    cases.filter((retentionCase) => !retentionCase.neededAfterDeletion).length,
  );
}

export function archivedThenNeededRate(cases: readonly RetentionCase[]): Rate {
  // benchmark-design.md §3.7: "archived-then-needed = useful rows archived
  // on their question day". The denominator is therefore useful rows.
  return rate(
    cases.filter(
      (retentionCase) =>
        (retentionCase.deleted || retentionCase.archived === true) &&
        retentionCase.neededAfterDeletion,
    ).length,
    cases.filter((retentionCase) => retentionCase.neededAfterDeletion).length,
  );
}
