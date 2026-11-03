export const REVIEW_CORE_TOKENS = {
  QUEUE_REPOSITORY: Symbol.for('ReviewQueueRepository'),
  REVIEW_REPOSITORY: Symbol.for('ReviewRepository'),
  CLOCK: Symbol.for('ReviewClock'),
  POLICY_SERVICE: Symbol.for('ReviewPolicyService'),
  QUEUE_SERVICE: Symbol.for('ReviewQueueService'),
  GITHUB: Symbol.for('ReviewGithubPort'),
  ENVIRONMENT: Symbol.for('ReviewStageEnvironment'),
  ORCHESTRATOR: Symbol.for('ReviewOrchestratorService'),
} as const;
