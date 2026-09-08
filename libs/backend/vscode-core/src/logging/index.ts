/**
 * Logging Module - Public API
 * Exports Logger service and related types
 */

export { Logger } from './logger';
export {
  DegradationReporter,
  MAX_TRACKED_DEGRADATION_CODES,
} from './degradation-reporter';
export type {
  DegradationReport,
  DegradationCount,
  DegradationSnapshot,
} from './degradation-reporter';
export { sanitizeConsoleText } from './console-text';
export type { LogLevel, LogContext, LogEntry } from './types';
