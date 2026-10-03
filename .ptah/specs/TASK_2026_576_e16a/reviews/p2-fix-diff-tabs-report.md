# P2 Fix Report — Batch 19 diff-tabs review findings (TASK_2026_576_e16a)

Source review: `p2-phase-review-subagent.md`, findings 1-5.
Scope kept: only `diff-tabs.service.ts` and `diff-tabs.service.spec.ts` touched.
Branch `feat/task-2026-576-p2`, worktree `task-576-p2`. No git operations run.

## Finding 1 (SERIOUS) — statusUnavailable refreshes all, previous set kept

- `diff-tabs.service.ts:468` — `onGitStatusUpdate` gained an optional 4th
  parameter `statusUnavailable: GitStatusUnavailableReason`;
  `diff-tabs.service.ts:483` passes it through to `mergePendingRefreshScope`;
  `diff-tabs.service.ts:275` — `handleMessage` now forwards
  `payload?.statusUnavailable` (route used by the real message router).
- `diff-tabs.service.ts:569` — `statusDegraded = statusUnavailable !== undefined`.
- `diff-tabs.service.ts:584-591` — the refresh-all branch now also fires when
  `statusDegraded`, so a degraded push (e.g. `output-too-large` with an empty
  `files` list) re-reads every open diff tab instead of matching nothing.
- `diff-tabs.service.ts:600` — `previousStatusPaths` is replaced only for a
  valid, non-degraded file set (`hasFileSet && !statusDegraded`), so the
  degraded push keeps the previous set.
- Spec: `diff-tabs.service.spec.ts:795` — three-window test: scoped push
  establishes the previous set (2 refreshes); the `statusUnavailable` push
  refreshes both tabs (2 refreshes); a later plain scoped push with no files
  still matches both tabs (2 refreshes) — proving the previous set survived.

## Finding 2 (MODERATE) — causes present, files absent/non-array -> refresh all

- `diff-tabs.service.ts:584-591` — refresh-all also fires when `!hasFileSet`,
  i.e. `files` absent or not an array even with a present `causes` value. This
  restores the "unknown scope -> refresh everything" contract (code doc at
  `diff-tabs.service.ts:93-98`).
- Spec: `diff-tabs.service.spec.ts:837` — 3 open tabs; a `['workspace']` push
  with `files` absent refreshes all 3; a second push with `files: 'bogus'`
  (routed through `handleMessage`) refreshes all 3 again. Previously the
  absent-fileset push refreshed 0 tabs.

## Finding 3 (MODERATE) — workspace-switch drop, dispose, workspace resets

- `diff-tabs.service.ts:703` — `readDiffTabOnce` captures
  `previousStatus = tab.diff.status` before it patches the tab to `refreshing`.
- `diff-tabs.service.ts:722-727` — the workspace-mismatch drop now restores
  that previous status instead of leaving the tab parked at `refreshing`.
- `diff-tabs.service.ts:478-480` — `previousStatusPaths` is tagged with the
  workspace it was collected for (`previousStatusWorkspace`,
  `diff-tabs.service.ts:171-176`); a push for a newly active workspace clears
  the stale set first. Background-workspace pushes early-return before this
  and stay inert ("ignores a push for a different workspace" spec unchanged).
- `diff-tabs.service.ts:877-879` — `dispose()` now also clears
  `previousStatusPaths`, resets `previousStatusWorkspace`, and clears
  `inFlightDiffRefreshes`.
- Spec: the existing workspace-switch drop test
  (`diff-tabs.service.spec.ts:435-462`) previously ASSERTED the bug
  (`status: 'refreshing'`, spec line 461); it now asserts the restored
  `'fresh'` status. This is a deliberate behaviour change the review asked for.

## Finding 4 (MODERATE) — rpcCall rejection cannot strand the rerun marker

- `diff-tabs.service.ts:676-690` — `runDiffTabRefresh` wraps
  `readDiffTabOnce` in `try/catch/finally`:
  - `catch` maps a throwing `rpcCall` to the same outcome as the null
    transport path (`status: 'stale'`, `GIT_READ_TRANSPORT_MESSAGE`), so the
    rejection never propagates to the `void` call sites and never leaves the
    tab at `refreshing`;
  - `finally` deletes the rerun marker on BOTH paths and services the queued
    trailing pass when one is queued — a queued request is still never
    dropped.
- Deviation from the review's first suggestion (delete the marker on the throw
  path WITHOUT the trailing run): the trailing run still fires when a request
  was queued. The RC11 "a request is never dropped" contract is kept
  uniformly, and the clearing still removes the phantom-pass hazard.
- Spec: `diff-tabs.service.spec.ts:862` — run 1 rejects, a queued rerun is
  serviced (2 calls, content applied, tab `fresh`), and a later refresh runs
  exactly ONE pass (3 calls total — 4 would be the phantom pass).

## Finding 5 (MINOR, tests)

Three new specs added (finding-5 requested cases; the fourth was the reviewed
existing test):
- statusUnavailable -> all tabs refreshed, previous set kept (spec:795).
- causes with absent/malformed files -> refresh all (spec:837).
- rpc rejection clears the rerun marker (spec:862).
- workspace switch mid-refresh does not leave `refreshing` (updated existing
  test, spec:435-462 — restores the previous status).

New tests await the real promises instead of counting microtasks where the
assertion allows it; the three-push windows still reuse the suite's existing
`drain()` helper after `advanceTimersByTime(250)`, matching the sibling tests.

## Verification

| Command | Result |
| --- | --- |
| `npx nx run @ptah-extension/git-ui:test --testPathPatterns=diff-tabs` | 1 suite passed, **67 tests passed** (63 before, 4 new), 0 failed |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/git-ui` | 2 tasks successful (typecheck, lint) |

No re-run needed; no failures in branch-picker or backend files.

## Deviations

- Only one: the finding-4 trailing-run choice described above.
- Existing spec line spec.ts:435-462 changed assertion per review finding 3.

## Out-of-scope observations (not touched)

- A queued rerun that fires after a workspace switch still reads with the NEW
  workspace root against the old tab's paths (pre-existing; the review did not
  flag it beyond the drop path).
- Finding 6 (backend git-review-reader.service.spec real-git seam) belongs to
  the Component 13 spec and is outside this fix's scope.