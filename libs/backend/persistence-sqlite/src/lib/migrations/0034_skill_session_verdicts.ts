// 0034_skill_session_verdicts — the session archaeologist's verdict row
// (TASK_2026_180, phase 2).
//
// THE NULLABILITY CONTRACT IS THE WHOLE POINT OF THIS TABLE.
// `intent`, `outcome`, `evidence_class` and `routine` are ALL nullable, and a
// row whose `degraded_reason` is non-NULL while `intent` is NULL is a
// first-class record: the GRACEFUL-DEGRADATION VERDICT. Phase 2 writes exactly
// that row when no query path exists (a CLI/e2e host with no
// `INTERNAL_QUERY_SERVICE_TOKEN`) instead of throwing or retrying. The schema
// therefore has to express three distinct states, not two:
//
//   * no row at all           ⇒ this session was never analyzed
//   * row, `intent IS NULL`   ⇒ analyzed, no verdict, and `degraded_reason`
//                               says WHY (the drain must not re-attempt, and
//                               the UI can explain itself)
//   * row, `intent NOT NULL`  ⇒ a real verdict
//
// A `NOT NULL` on any of the four would collapse the middle state into either a
// fabricated verdict or no row, and the drain would re-attempt indefinitely.
//
// `degraded_reason` IS LOAD-BEARING, NOT DECORATION. Phase 3's replay validator
// prefers `routine`/`friction_map` and falls back to
// `ExtractedTrajectory.canonicalText` when the row is absent **or**
// `degraded_reason IS NOT NULL`; phase 4's win rate counts a session with no
// usable verdict as `unknown`. Both read it. Hence `idx_ssv_degraded` below.
//
// `evidence_class` CARRIES A `CHECK`; `degraded_reason` DELIBERATELY DOES NOT.
// That asymmetry is a decision, not an oversight — do NOT "fix" either half.
// SQLite cannot widen a CHECK with `ALTER TABLE` (rebuilding the table on every
// user's live `ptah.db` is the only way out), so the test is whether the
// vocabulary is fully knowable TODAY:
//   * `evidence_class` is. Plan §2.4 specifies all five members and phase 4's
//     win-rate query partitions on exactly those names — `tests-green`,
//     `user-accepted` and `explicit-confirmation` are wins, `unverified` is
//     unknown, `no-correction` is neither. Adding a sixth member would change
//     that arithmetic and IS a schema break, so pinning it here is correct.
//     This follows 0032's stage/status precedent.
//   * `degraded_reason` is not. Phase 2 writes `no-query-path` and
//     `tool-use-unsupported`; later phases will name failure modes that do not
//     exist yet. This follows 0033's `judge_status` precedent: the vocabulary
//     stays open, enforcement (where there is any) lives in TypeScript, and
//     widening costs one line instead of a table rebuild.
// NOTE: a NULL `evidence_class` still satisfies the CHECK — SQLite treats a
// CHECK that evaluates to NULL as passing. That is exactly what the degraded
// row needs, so the CHECK and the nullability contract do not fight.
//
// `friction_map` is `NOT NULL DEFAULT '[]'` rather than nullable because "no
// friction found" and "friction not measured" are the same thing to every
// consumer, and an always-array column means no reader needs a null branch
// around `JSON.parse`. `routine` IS nullable — "no transferable routine here"
// is a real, common verdict and must not be confused with an empty routine.
//
// This is a CREATE TABLE, not an ALTER, so `NOT NULL … DEFAULT` is safe on the
// counters (`turn_count`, `passes`) — there is no pre-existing INSERT to break,
// unlike 0033's situation with `registerCandidate`.
//
// Three indexes, one per access path that actually exists:
//   * `idx_ssv_ws`       — the workspace feed ("recent verdicts for this
//                          project"), newest first.
//   * `idx_ssv_evidence` — phase 4's win-rate aggregation partitions on it.
//   * `idx_ssv_degraded` — PARTIAL, over the degraded rows only. The "why is
//                          there no verdict" sweep is the minority of rows by
//                          design, so a partial index costs nothing on the
//                          healthy path and keeps the sweep off a full scan.
//                          Beyond plan §2.4's two indexes, deliberately.
// Per-session lookup needs no index: `session_id` is the PRIMARY KEY.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS skill_session_verdicts (
  session_id      TEXT PRIMARY KEY,
  workspace_root  TEXT NOT NULL DEFAULT '',
  intent          TEXT,
  outcome         TEXT,
  evidence_class  TEXT CHECK (evidence_class IN (
                    'tests-green','user-accepted','no-correction',
                    'explicit-confirmation','unverified')),
  friction_map    TEXT NOT NULL DEFAULT '[]',
  routine         TEXT,
  turn_count      INTEGER NOT NULL DEFAULT 0,
  lane            TEXT,
  model           TEXT,
  passes          INTEGER NOT NULL DEFAULT 0,
  degraded_reason TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ssv_ws
  ON skill_session_verdicts(workspace_root, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ssv_evidence
  ON skill_session_verdicts(evidence_class);
CREATE INDEX IF NOT EXISTS idx_ssv_degraded
  ON skill_session_verdicts(degraded_reason)
  WHERE degraded_reason IS NOT NULL;
`;
