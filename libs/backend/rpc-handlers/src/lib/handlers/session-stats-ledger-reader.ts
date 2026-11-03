import type { SessionStatsEntry } from '@ptah-extension/shared';
import type { SessionStatsRepository, SessionModelUsageRow } from '@ptah-extension/persistence-sqlite';

const MICRO_USD = 1_000_000;

/** A range projection of accepted live events. Null means this session has no ledger row. */
export async function readSessionStatsRangeFromLedger(
  repository: SessionStatsRepository,
  sessionId: string,
  workspaceKey: string,
  since: number,
  until: number,
): Promise<SessionStatsEntry | null> {
  const stats = await repository.getSessionStats(sessionId, workspaceKey);
  if (!stats) return null;
  const [models, messageCount] = await Promise.all([
    repository.getSessionModelUsage(sessionId, workspaceKey, since, until),
    repository.getSessionUsageEventCount(sessionId, workspaceKey, since, until),
  ]);
  const totals = models.reduce((sum, row) => ({
    input: checkedSum(sum.input, row.input_tokens),
    output: checkedSum(sum.output, row.output_tokens),
    cacheRead: checkedSum(sum.cacheRead, row.cache_read_tokens),
    cacheCreation: checkedSum(sum.cacheCreation, row.cache_write_tokens),
    knownCostMicroUsd: checkedSum(sum.knownCostMicroUsd, row.known_cost_micro_usd ?? 0),
    hasUnpriced: sum.hasUnpriced || row.has_unpriced === 1,
    hasPriced: sum.hasPriced || row.known_cost_micro_usd !== null,
  }), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, knownCostMicroUsd: 0, hasUnpriced: false, hasPriced: false });
  const tokenCount = checkedSum(
    checkedSum(totals.input, totals.output),
    checkedSum(totals.cacheRead, totals.cacheCreation),
  );
  const ranked = [...models].filter((row) => row.model_id !== '__session_residual__').sort(compareModels);
  const model = ranked[0]?.model_id ?? null;
  return {
    sessionId,
    model,
    totalCost: totals.hasUnpriced || !totals.hasPriced ? null : totals.knownCostMicroUsd / MICRO_USD,
    knownCost: totals.hasPriced ? totals.knownCostMicroUsd / MICRO_USD : null,
    tokens: { input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheCreation: totals.cacheCreation },
    tokenCount,
    messageCount,
    modelUsageList: models.map((row) => ({
      model: row.model_id === '__session_residual__' || row.model_id === '__unattributed__' ? 'Unattributed' : row.model_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheRead: row.cache_read_tokens,
      cacheCreation: row.cache_write_tokens,
      costUSD: row.has_unpriced === 1 ? null : (row.known_cost_micro_usd ?? 0) / MICRO_USD,
    })),
    status: models.length > 0 ? 'ok' : 'empty',
    coverage: 'partial',
    pricingCoverage: totals.hasUnpriced ? (totals.hasPriced ? 'partial' : 'none') : 'full',
    untimestampedCount: 0,
    scope: 'range',
  };
}

function checkedSum(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error('Session usage total exceeds safe integer range');
  return sum;
}

function compareModels(a: SessionModelUsageRow, b: SessionModelUsageRow): number {
  const aCost = a.known_cost_micro_usd ?? 0;
  const bCost = b.known_cost_micro_usd ?? 0;
  return bCost - aCost ||
    (b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens) -
      (a.input_tokens + a.output_tokens + a.cache_read_tokens + a.cache_write_tokens) ||
    a.model_id.localeCompare(b.model_id, 'en');
}
