/**
 * 0016_observation_queue — capture-side queue for hook-driven observations.
 *
 * Adds a single append-only queue table populated by the agent-sdk hook
 * registries (PreToolUse Read, PostToolUse, ToolFailure, Stop, UserPromptSubmit)
 * and drained by `MemoryTriggerService.invokeCurate` when composing the curator
 * transcript. Rows are marked processed only after a successful curator run.
 *
 * Rollback story: forward-only per persistence-sqlite/CLAUDE.md. Manual
 * recovery is `DROP TABLE observation_queue` via `db:reset` followed by
 * re-migration. `SqliteBackupService.pre-migration` is the canonical recovery
 * path.
 *
 * STATIC TEXT ONLY: no ${...} interpolation (ESLint no-template-curly-in-migration).
 */
export const sql = `
CREATE TABLE observation_queue (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id         TEXT    NOT NULL,
  workspace_root     TEXT,
  prompt_number      INTEGER,
  kind               TEXT    NOT NULL,
  tool_name          TEXT,
  tool_input_json    TEXT,
  tool_response_text TEXT,
  assistant_message  TEXT,
  user_prompt        TEXT,
  file_path          TEXT,
  captured_at        INTEGER NOT NULL,
  processed_at       INTEGER
);
CREATE INDEX idx_obs_queue_session ON observation_queue(session_id, processed_at, captured_at);
CREATE INDEX idx_obs_queue_drain   ON observation_queue(processed_at, captured_at) WHERE processed_at IS NULL;
`;
