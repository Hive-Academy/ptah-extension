export const LANE_OUTCOME_TOKENS = {
  STORE: Symbol.for('PtahLaneOutcomeStore'),
  RECORDER: Symbol.for('PtahLaneOutcomeRecorder'),
  READER: Symbol.for('PtahLaneOutcomeReader'),
  SKILL_TELEMETRY_SEAM: Symbol.for('PtahLaneOutcomeSkillTelemetrySeam'),
  FAILURE_CLASSIFIER: Symbol.for('PtahLaneOutcomeFailureClassifier'),
  LOGGER: Symbol.for('PtahLaneOutcomeLogger'),
} as const;
