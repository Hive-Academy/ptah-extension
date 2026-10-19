import type { SubagentExecutionEntry } from './subagent-execution.store';

export const ENTRY_EVENT_CAP = 2000;
export const LIVE_EVENT_CAP = 10000;
export const FINALIZED_ENTRY_CAP = 20;

export function liveEventCount(
  entries: ReadonlyMap<string, SubagentExecutionEntry>,
): number {
  let count = 0;
  for (const entry of entries.values()) count += entry.state?.events.size ?? 0;
  return count;
}

export function oldestFinalized(
  entries: ReadonlyMap<string, SubagentExecutionEntry>,
  lastRead: ReadonlyMap<string, number>,
): [string, SubagentExecutionEntry] | undefined {
  return [...entries]
    .filter(([, entry]) => !entry.live && entry.refs === 0)
    .sort(
      ([left], [right]) =>
        (lastRead.get(left) ?? 0) - (lastRead.get(right) ?? 0),
    )[0];
}

export function oldestLiveSpill(
  entries: ReadonlyMap<string, SubagentExecutionEntry>,
  receivingKey: string,
): [string, SubagentExecutionEntry] | undefined {
  return [...entries]
    .filter(
      ([key, entry]) =>
        key !== receivingKey &&
        entry.live &&
        entry.refs === 0 &&
        (entry.state !== null || !entry.spilled),
    )
    .sort(([, left], [, right]) => left.lastEventAt - right.lastEventAt)[0];
}
