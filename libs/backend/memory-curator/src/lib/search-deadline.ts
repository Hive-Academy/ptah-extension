/**
 * Request budgets for searches that must answer before a deadline (the SQLite
 * search worker sends one with every request).
 *
 * The caller stops waiting at the budget; the work itself is not cancelled.
 * A better-sqlite3 statement cannot be interrupted, so a vector search whose
 * embed arrives late still runs its synchronous KNN unless it checks the
 * deadline first (`MemorySearchService.vecSearchInner` does).
 */

/** Work that did not finish inside its budget. */
export class BudgetExceededError extends Error {
  constructor(label: string, budgetMs: number) {
    super(`${label} did not finish within ${Math.max(0, Math.round(budgetMs))} ms`);
    this.name = 'BudgetExceededError';
  }
}

/** Milliseconds left before `deadlineMs`; `Infinity` without a deadline. */
export function remainingMs(deadlineMs: number | undefined): number {
  return deadlineMs === undefined ? Infinity : deadlineMs - Date.now();
}

/** Wait for `work` at most `budgetMs` (no bound when it is not finite). */
export async function withinBudget<T>(work: Promise<T>, budgetMs: number, label: string): Promise<T> {
  if (!Number.isFinite(budgetMs)) return work;
  // degradation-audit: reported - the caller reports the exceeded budget; the
  // abandoned work's own late failure has nobody left to answer.
  void work.catch(() => undefined);
  if (budgetMs <= 0) throw new BudgetExceededError(label, budgetMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BudgetExceededError(label, budgetMs)), budgetMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
