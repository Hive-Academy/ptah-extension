/**
 * Session stats — usage statistics projected from transcripts without history
 * replay (TASK_2026_411 B4). See `session-stats-reader.service.ts`.
 */
export {
  SessionStatsReaderService,
  PARENT_FILE_CONCURRENCY,
  SUBAGENT_FILE_CONCURRENCY,
} from './session-stats-reader.service';
export type { SessionStatsRequest } from './session-stats-reader.service';
export type {
  SessionStatsReadEntry,
  SessionStatsScopeSelection,
} from './session-usage-aggregator';
