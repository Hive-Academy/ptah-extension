/**
 * Compaction lifecycle e2e (TASK_2026_109 commit `9edbbbc1`).
 *
 * Per architect Q1 decision (TASK_2026_110): the four compaction-surface
 * tests ship as `it.skip(...)` placeholders rather than wiring full
 * scenarios. Reaching `compaction_start` / `compact_boundary` from the
 * CLI requires a real upstream Claude turn that crosses the context
 * threshold, which is not feasible without burning tokens on every CI
 * run. The placeholders document the surfaces so a follow-up task can
 * stand them up against a recorded SDK fixture or a synthetic harness
 * once one exists.
 *
 * NO production code is changed by this file — see Q1 in
 * `.ptah/specs/TASK_2026_110/clarifications.md`.
 *
 * Surfaces tracked (from commit `9edbbbc1`):
 *   1. preTokens flow on `compaction_start` (chat-store-compaction-listener
 *      forwards the pre-compaction token snapshot to session-stats-aggregator)
 *   2. sessionId resolution on `compact_boundary` (boundary event resolves
 *      the new sessionId via session-history-reader.findCompactionTarget)
 *   3. SubagentRegistry pruning on boundary (registry.pruneOnBoundary
 *      drops subagents whose root sessionId no longer matches)
 *   4. Token snapshot reset (session-stats-aggregator zeros the running
 *      counters and re-anchors at the post-boundary baseline)
 */

describe.skip('compaction lifecycle (TASK_2026_109 commit 9edbbbc1)', () => {
  it('preTokens flow on compaction_start propagates to session-stats-aggregator', () => {
    /* Stub — see file header for rationale. */
  });

  it('sessionId resolution on compact_boundary swaps the active session', () => {
    /* Stub — see file header for rationale. */
  });

  it('SubagentRegistry pruning on compact_boundary drops stale subagents', () => {
    /* Stub — see file header for rationale. */
  });

  it('Token snapshot reset re-anchors counters after compact_boundary', () => {
    /* Stub — see file header for rationale. */
  });
});
