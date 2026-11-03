export const REVIEW_CORE_TOKENS = {
  QUEUE_REPOSITORY: Symbol.for('ReviewQueueRepository'),
  CLOCK: Symbol.for('ReviewClock'),
  POLICY_SERVICE: Symbol.for('ReviewPolicyService'),
  QUEUE_SERVICE: Symbol.for('ReviewQueueService'),
} as const;
