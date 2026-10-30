import type { MessageTokenUsage } from '../types/execution';
import type { SessionStatsEntry } from '../types/rpc/rpc-session.types';

export function isValidTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Sum the four disjoint message token classes when every reported count is valid. */
export function messageTokenTotal(
  usage: MessageTokenUsage | null | undefined,
): number | null {
  if (!usage) return null;

  const counts = [
    usage.input,
    usage.output,
    usage.cacheRead === undefined ? 0 : usage.cacheRead,
    usage.cacheCreation === undefined ? 0 : usage.cacheCreation,
  ];
  if (!counts.every(isValidTokenCount)) return null;

  const total = counts.reduce((sum, count) => sum + count, 0);
  return Number.isFinite(total) ? total : null;
}

/** The host owns the session total; missing data is never reconstructed. */
export function sessionTokenTotal(
  entry: Pick<SessionStatsEntry, 'tokenCount'> | null | undefined,
): number | null {
  const count = entry?.tokenCount;
  return isValidTokenCount(count) ? count : null;
}
