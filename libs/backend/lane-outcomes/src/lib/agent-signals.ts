import type {
  AgentOutcomeSignals,
  LaneFailureClass,
  LaneOutcomeRecord,
} from '@ptah-extension/shared';

export function computeAgentSignals(
  records: readonly LaneOutcomeRecord[],
  windowDays: number,
): Record<string, AgentOutcomeSignals> {
  const grouped = new Map<string, LaneOutcomeRecord[]>();
  for (const record of records) {
    if (record.role === null) continue;
    const group = grouped.get(record.role) ?? [];
    group.push(record);
    grouped.set(record.role, group);
  }
  const result: Record<string, AgentOutcomeSignals> = {};
  for (const [slug, rows] of grouped) {
    const verified = rows.filter((row) => row.verdict !== 'unverified');
    const reviewed = rows.filter((row) => row.finalReview !== null);
    const failures = new Map<
      LaneFailureClass,
      { count: number; latest: number }
    >();
    for (const row of rows) {
      if (row.failureClass === null) continue;
      const previous = failures.get(row.failureClass);
      failures.set(row.failureClass, {
        count: (previous?.count ?? 0) + 1,
        latest: Math.max(previous?.latest ?? 0, row.endedAt),
      });
    }
    const top =
      [...failures.entries()].sort(
        (a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest,
      )[0]?.[0] ?? null;
    result[slug] = {
      slug,
      windowDays,
      runCount: rows.length,
      delivered: {
        numerator: verified.filter((row) => row.verdict === 'delivered').length,
        denominator: verified.length,
      },
      reviewPass: {
        numerator: reviewed.filter((row) => row.finalReview === 'approved')
          .length,
        denominator: reviewed.length,
      },
      avgReviseRounds: reviewed.length
        ? Math.round(
            (reviewed.reduce((sum, row) => sum + row.reviseRounds, 0) * 10) /
              reviewed.length,
          ) / 10
        : null,
      topFailureClass: top,
    };
  }
  return result;
}
