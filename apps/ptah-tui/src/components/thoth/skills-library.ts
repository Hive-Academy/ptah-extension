import type { CloneSummary } from '@ptah-extension/shared';

/** A whole percent, or "No grade" when no task review graded the entry. */
export function formatSuccessRate(
  successRate: CloneSummary['successRate'],
): string {
  return typeof successRate === 'number' && Number.isFinite(successRate)
    ? `${Math.round(successRate * 100)}%`
    : 'No grade';
}

/** The one-line summary under a Library entry in the TUI Skills panel. */
export function describeLibraryEntry(
  clone: Pick<CloneSummary, 'invocationCount' | 'successRate'>,
): string {
  return `${clone.invocationCount} invocations · ${formatSuccessRate(clone.successRate)}`;
}
