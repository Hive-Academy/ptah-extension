# Batch 16 report: task-level reconciliation and harvester

- Task: TASK_2026_878_5513, Phase C (Skills), Batch 16
- Status: **passed** (see Verification; the first run failed only on a Batch 4 file)
- Executor: `backend-developer` subagent (claude family). Phase C review goes to another family.
- Worktree W: `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions`. No git commands were run.

## Provenance

When this executor started (2026-11-05 02:35), the Batch 16 code was already in W: the files are
dated 2026-11-05 00:10-00:14 and have no report. Most likely the Batch 15 subagent continued into
Batch 16 before its session ended (HANDOFF.md still said "Batch 16 not done"). This executor
checked every quality requirement against the plan, found the work complete, and ran the scoped
verify. No line needed changing.

## Files

- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.spec.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/memory-skills-dead-actions/libs/backend/skill-synthesis/src/lib/spec-harvester.concurrent-attribution.spec.ts`

## Task 16.1: `reconcileTaskEvents` replaces `reconcileSubagentEvent`

- `reconcileTaskEvents({taskId, workspaceRoot, succeeded, verdictSource, reconciledAt}): number`.
  - It runs `SELECT id, workspace_root ... WHERE task_id = ? AND reconciled_at IS NULL`, with any
    source.
  - Each row is zod-parsed (`TaskEventRowSchema`). It keeps only rows whose
    `normalizeWorkspaceRoot(workspace_root)` equals the normalized input root. NULL roots are
    excluded.
- `applyReconciliation(ids, input)` (private, kept) runs one `db.transaction` of guarded
  `UPDATE ... SET succeeded = ?, reconciled_at = ?, verdict_source = ? WHERE id = ? AND reconciled_at IS NULL`.
  It returns the summed `changes`. All SQL is parameterized.
- `reconcileSubagentEvent`, the null-task time-window fallback, `toWindowVerdictSource` and
  `EventIdRowSchema` are deleted. `grep -rn reconcileSubagentEvent libs apps` returns nothing.
  `spec-window:` still appears only in readers of legacy rows (types.ts, rpc-skill-clone.types.ts,
  scorecard-detail.component.ts, the 0056 migration spec). That is correct: old rows keep that
  provenance.
- Spec (better-sqlite3, because `node:sqlite` has no `transaction`; skipped only if the native
  module fails to load, the same pattern as the sibling harvester specs) covers:
  - every source of the task in the same workspace only, ignoring other workspaces, NULL roots and
    rows already reconciled;
  - a second call returns 0;
  - the guarded UPDATE skips a row that an overlapping harvest reconciled after the SELECT;
  - a task with no eligible event returns 0;
  - scorecards still aggregate.

## Task 16.2: harvester

- `MARKER_VERSION = 3`. An older marker makes the spec re-harvest once.
- `harvest(workspaceRoot?, options: HarvestOptions = {})`, where
  `HarvestOptions = { trigger?: 'manual' | 'auto' }` (exported type `HarvestTrigger`).
  - The batch loop is gone. Every completed spec whose `taskVerdict(spec)` is non-null calls
    `reconcileTaskEvents` with `verdictSource: spec:<taskId>`. This runs on every run, before the
    marker check, and is idempotent.
  - Grades and the marker are still written only when the marker is missing, old, or has a
    different digest.
- `writeGrades`:
  - Conflicting matching reviews resolve to the latest `modifiedAt` (`latestReviews`), with a
    debug log.
  - A tie of different verdicts on the newest mtime is still skipped, with a warn.
  - When `upsert` returns `false`, it logs warn
    `[spec-harvester] grade key owned by another workspace` `{taskId, slug}` and does not add the
    key to `keep`.
  - `removeAbsent` stays workspace-scoped.
- `getRecentFindings` passes `normalizeWorkspaceRoot(join(root,'..','..'))` to `hasGradeForTask`.
- `HarvestResult` gains `pending` (scanned, not done or cancelled) and `skippedFolders` (from
  `readSpecs`, which now returns `{specs, skippedFolders}`).
- Every run logs `[spec-harvester] harvest complete` at info with `trigger`, `scanned`,
  `harvested`, `reconciled`, `pending` and `skippedFolders`. When no trigger is given, `trigger`
  is `'unspecified'`.
- Specs:
  - mock-store cases:
    - v3 marker written;
    - a v2 marker re-harvested once;
    - reconcile runs regardless of the marker;
    - cancelled, done and pending verdicts;
    - info log when harvested is 0;
    - `pending` and `skippedFolders`;
    - owned-key warn;
    - workspace-scoped findings;
  - a real-store describe;
  - the R7 two-workspace marker upgrade (A, then B, then both again: own grades only, events
    reconciled once by their own harvest, the second round reconciles 0, and grade and event rows
    are byte-identical);
  - an owned-key case;
  - `spec-harvester.concurrent-attribution.spec.ts` rewritten for task level, including
    "cancelled task fails its events even with an approving review", idempotent double
    reconcile, and overlapping manual and auto harvests reconciling each event exactly once.

## Verification

Command (from W):
`npm run verify -- -p @ptah-extension/skill-synthesis > /tmp/b878/batch16.log 2>&1; echo EXIT $?`

Run 1 (lock acquired after 1974 s in the queue):

```
NX   2 tasks: 1 succeeded, 1 failed
✖ nx run @ptah-extension/skill-synthesis:typecheck
✖ nx run @ptah-extension/skill-synthesis:test
lock released after 108.9s, exit code 1
```

- Lint succeeded.
- Typecheck errors are only
  `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:1032,1210 TS2304 Cannot find name 'curatorRunMessage'`.
  That is a Batch 4 file that another executor was editing; it uses the function without importing
  it. skill-synthesis reaches it transitively.
- Test: `Test Suites: 4 failed, 31 passed, 35 total`, `Tests: 1 skipped, 583 passed, 584 total`.
  The 4 failed suites (skill-trigger.integration, skill-trigger.service, di/register,
  foreground-activity.tracker) all stop at load on the same TS2304 in memory-trigger.service.ts.
  No test failed. Every Batch 16 suite ran and passed.
- The Batch 15 `marked` / missing `node_modules` problem is gone: W now has `node_modules`.

The curator-backend executor was told about the missing import. This executor did not edit that
file. The re-run result is recorded below.

Session 4 re-run (coordinator): `npm run verify -- -t test -p @ptah-extension/skill-synthesis -- --testPathPatterns="spec-harvester.service.spec|skill-trigger"` passed (exit 0) after the Batch 17 integration-spec fix. Lint and typecheck for skill-synthesis passed (4/4 with mcp-bench). Committed as 1b2d0bd98.

Merged-state verification: after merging origin/main 0abc5e54c (bd83117de, migration renumbered to 0070), `npm run verify` over 14 projects (persistence-sqlite, memory-curator, shared, rpc-handlers, thoth-runtime, skill-synthesis, mcp-bench, ui, chat, core, webview-e2e-harness, memory-curator-ui, ptah-electron, ptah-extension-webview): lint+typecheck 26/28; the 2 lint failures (persistence-sqlite no-restricted-syntax in 0057/0058, webview 'Static imports of lazy-loaded libraries' in unchanged app files) also fail on main. Tests 15/19; every failure was environmental and passed on a targeted re-run: harness-root tests in rpc-handlers and ptah-electron saw a stray /tmp/.ptah (MCP spill folder, not ours) as the root and passed with TMPDIR=/var/tmp/b878, except plugin-rpc.handlers.session-notice.spec.ts which hard-codes /tmp paths; BootScanRunner given_up (unchanged file) and mcp-bench launchBenchHost/snapshot-audits passed on re-run.

## Risks

- R6: the reconcile API and its only caller changed together. No other caller of the deleted
  method exists.
- A run with no trigger logs `trigger: 'unspecified'`. Batch 17 makes both callers pass one.
- The harvest wire result already carries `pending` and `skippedFolders`, because the handler
  returns `HarvestResult` as is. The shared type gains them as optional in Batch 18. This is
  compatible: TypeScript allows the extra fields on a non-literal return.
- The reviewer-line matcher in `writeGrades` still uses `/plan|architecture/i` to keep plan
  reviews out of the session-less agent fallback. This is the pre-existing behaviour.
  `isDocumentReview` from Batch 15 is stricter. The plan did not ask to change this line, so it is
  left for the Phase C review to decide.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the pre-existing Batch 16 code instead of rewriting it | rewrite; keep after review | Every quality requirement in batches.md:831-855 and plan :274-288, :391-394 is met in source and specs | yes |
| `trigger` logs `'unspecified'` when absent | omit the key; `'unspecified'` | The plan asks for `trigger` in every info log; callers pass it from Batch 17 on | yes |
