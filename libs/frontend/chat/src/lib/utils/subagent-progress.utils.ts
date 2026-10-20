import type { SubagentRecord } from '@ptah-extension/chat-streaming';

/** Short progress line shared by subagent lane surfaces. */
export function subagentProgressText(record: SubagentRecord): string | null {
  if (record.latestSummary) return record.latestSummary;
  if (record.lastToolName) return `last: ${record.lastToolName}`;
  return record.description || null;
}
