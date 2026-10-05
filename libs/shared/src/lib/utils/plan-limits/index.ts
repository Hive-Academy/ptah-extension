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
// Window state (design §2.1)
export {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  classifyOwnerEvidence,
  classifyWindow,
  isActiveLimitEvidence,
  resetPassage,
  usedPercent,
  windowObservedAt,
  type OwnerEvidenceState,
  type PlanLimitStateContext,
  type PlanWindowResetPassage,
  type PlanWindowState,
} from './window-state';
// Lane state, owner relation and scope (design §2.2, Decision 3, Req 4.5)
export {
  applicableLimits,
  applicableOwnerEvidence,
  applicableWindows,
  classifyLaneState,
  groupAlternatives,
  ownerRelation,
  windowModelScope,
  type ApplicableLimits,
  type ClassifiedWindow,
  type LaneAlternatives,
  type LaneLimitState,
  type LaneLookupFailure,
  type LaneStateContext,
  type LaneStateReason,
  type LaneStateResult,
  type OwnerRelation,
  type PlanWindowBlockingState,
} from './lane-state';
// Owner display labels (TASK_2026_615, FU-PHASE6)
export { ownerDisplayLabel, ownerKeySuffix } from './owner-display';
// Time and source formatting (design §0.4, §1)
export {
  formatLocalAbsolute,
  formatLocalWithRelative,
  formatRelative,
  formatSourceChips,
  formatToolInstant,
  formatToolResetText,
  formatToolSourceText,
  formatToolUtc,
  formatUsed,
  PLAN_LIMIT_SOURCE_LABELS,
  windowFieldSources,
  type LocalTimeOptions,
  type PlanLimitField,
  type PlanLimitFieldSourceGroup,
} from './plan-limit-format';
