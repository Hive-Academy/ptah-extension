# TASK_2026_621_3d5c — Retention must not delete unprocessed observations; find why extraction stopped

User-approved 2026-10-06 as an urgent item, separate from TASK_2026_620 (benchmark program).

## Evidence (from `../TASK_2026_620_a13e/forensics.md:66-79`, DB copy 2026-10-06)

- `observation_queue` has 59,614 rows with `processed_at IS NULL`. Rows captured 2026-09-22..09-24
  (8,421) and 2026-09-28..10-02 (~48,000) are ~100% unprocessed. `memories` has 0 rows created
  2026-09-24..10-01. Extraction processed nothing for ~9 days. Cause not determined.
- Retention deletes stuck rows after `stuckDays = 14` (`memory-curator/src/lib/retention/memory-retention-config.ts:32`).
  The oldest unprocessed rows (2026-09-22) reach 14 days on 2026-10-06.
- `memory_retention_state.last_skip_reason = 'foreground-active'`, `attempt_count = 144` — retention
  itself also skips while the app is in the foreground.
- Silent-drop modes VERIFIED in code: (a) a non-network extract/resolve failure returns outcome
  `'ran'` and the trigger marks observations processed (`curator-activity-log.ts:339-366`,
  `memory-trigger.service.ts:855-867`); (b) a boot-scan session that throws is skipped while later
  successes advance the watermark; (c) a `'ran'` pass with zero drafts consumes input; (d) windows
  beyond 8 lose the middle (`clamp-transcript.ts`); (e) no transcript-hash dedup.
- Snapshot of the data before any deletion: `~/.ptah/bench-snapshots/ptah-20261006-pre-retention.sqlite`
  (sha256 `82cd16ac39b60699c241286eda2db59b25be70c6aa85480db0be8ae7b77d575a`).

## Scope

1. **Retention guard (ship first).** Retention never deletes an observation that was never processed
   by extraction. Unprocessed rows older than the threshold are quarantined or kept and counted, not
   deleted. Disk growth stays observable (log + diagnostics count). Test: a spec that seeds
   unprocessed rows older than `stuckDays` and proves they survive a retention pass.
2. **Root cause of the stop.** Find why no extraction ran 2026-09-24..10-01 (host/runtime not running,
   curator disabled, admission/back-off, error passes marked processed). Evidence with file:line and
   log lines.
3. **Silent-drop fixes**, at least (a): a failed pass must not mark observations processed.
4. **Liveness signal**: an unprocessed-age metric visible in diagnostics so a stop is noticed.

Out of scope: benchmark work (620), retrieval (619).

## Root cause (codex lane, `root-cause.md`; dates verified by orchestrator)

INFERRED with high confidence: `5cf965d57` (2026-09-24 16:57, "stop CLI probing from blocking the
window") made Electron await sequential CLI registration before the heavy/Thoth boot, so
`bootThothRuntime` (Electron is its only production caller) did not run. `1095a8f20` (2026-10-01
18:28) removed the await; processing resumes 2026-10-02 in the DB. No host logs existed to
corroborate. The cause is already fixed on main. Remaining gap: nothing detected a 9-day stop, and
no spec proves Thoth boot is reached when a CLI probe hangs.

Added scope: 5. a boot-order spec in `apps/ptah-electron` that fails if `bootThothRuntime` waits on
CLI registration (follow-up batch, after items 1–4).

## Progress

- Branch `fix/task-621-retention-guard` (worktree `.claude-worktrees/agent-a0c9cbefc2a09f580-4957846ea3d6`):
  `7f7ad42fa` retention guard, `29025ad60` failed pass keeps observations, `1dd506097` revise round 1.
- Review round 1 (codex, `code-logic-review.md`): REVISE — boot scan advanced the watermark on
  `'failed'`; migration 0039 deleted old unprocessed rows. Both verified by orchestrator.
- Revise round 1: boot scan holds the watermark on `'failed'` for sessions < 7 days old (lasting
  bound without a migration), then lets them through with a warning; 0039 no longer deletes
  `observation_queue` rows (runner keys applied migrations by version only, verified
  `migration-runner.ts:87,113`). Rows an earlier 0039 run deleted are not recoverable.
- Open minor: diagnostics still show a per-run "Quarantined" figure that is always 0.
- Review round 2 (`code-logic-review-r2.md`): REVISE — 0039 resolved; boot scan still drops a
  failed session whose mtime is ≥ 7 days after one failure and blocks later sessions until then;
  the activity feed hides failed/stalled counts.
- **User decision 2026-10-06:** failed-session ledger (new migration). Watermark advances normally;
  failed sessions retried on their own up to a fixed count, then `given_up` with a visible count;
  activity feed shows failed/stalled. This is revise round 2 of 2 (last).

- Revise round 2 → `d5bf2c947` (ledger, migration 0052, diagnostics, activity feed).
- Review round 3 (`code-logic-review-r3.md`): earlier findings RESOLVED; new: (1 major) a given_up
  row never reopens when the session file changes; (2 major) retries can starve the normal scan
  under the shared hourly budget; (3 minor) index only on status. Revise cap reached.
- **User decision 2026-10-07:** one bounded correction for all three (migration 0053: mtime marker
  + composite index; reserve a budget slot for the normal scan), then one independent review. If
  that review finds defects, report them and stop.
- User instruction 2026-10-07: open a PR when the task is finished (after the review passes).

## Plan

- `backend-developer` (subagent, worktree): item 1, then 3 and 4.
- `codex` lane (read-only): item 2 → `root-cause.md`.
- Review cross-side: CLI lane reviews the subagent's code → `code-logic-review.md`.
