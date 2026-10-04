// Instants: parse provider-stated times to epoch ms UTC
export {
  normaliseInstant,
  parseRetryAfterDeadline,
  resolveClockTimeReset,
  resolveRelativeReset,
  windowKindFromDuration,
  type PlanWindowDescriptor,
} from './instants';
// Evidence precedence and engine constants
export {
  FRESHNESS_MS,
  LIMIT_LOOKUP_DEADLINE_MS,
  NEAR_LIMIT_PERCENT,
  supersedes,
  type PlanLimitEvidenceStamp,
} from './evidence-precedence';
