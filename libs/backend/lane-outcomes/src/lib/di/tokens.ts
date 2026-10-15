export const LANE_OUTCOME_TOKENS = {
  /** Store provided by this library. */
  STORE: Symbol.for('PtahLaneOutcomeStore'),
  /** Recorder provided by this library. */
  RECORDER: Symbol.for('PtahLaneOutcomeRecorder'),
  /** Reader provided by this library. */
  READER: Symbol.for('PtahLaneOutcomeReader'),
  /** Optional skill telemetry supplied by the host. */
  SKILL_TELEMETRY_SEAM: Symbol.for('PtahLaneOutcomeSkillTelemetrySeam'),
  /** Optional failure classifier supplied by the host. */
  FAILURE_CLASSIFIER: Symbol.for('PtahLaneOutcomeFailureClassifier'),
  /** Host logger registered by this library. */
  LOGGER: Symbol.for('PtahLaneOutcomeLogger'),
} as const;
