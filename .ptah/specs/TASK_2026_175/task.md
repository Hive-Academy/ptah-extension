---
id: TASK_2026_175
status: backlog
type: BUGFIX
title: Git watcher debounce starves under continuous file-system churn
description: GitWatcherService uses plain re-arming setTimeout debounces with no max-wait. On a machine with ambient background churn (Nx daemon, editor autosave, other tooling) the timer never goes quiet, so git:status-update never fires and the file tree's git state goes stale indefinitely. Measured at 0 status invocations over 60s against the live monorepo. Add max-wait semantics so a coalesced burst still fires within a bounded window.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-03T00:00:00.000Z
updated: 2026-08-03T00:00:00.000Z
---

## Description

### Origin

Surfaced by the TASK_2026_173 Batch 0 M3 measurement (`measurements.md` § M3, FINDING). Recorded there as a measurement-environment observation; this task is the product defect underneath it.

### The defect

`apps/ptah-electron/src/services/git-watcher.service.ts` coalesces file-system events with plain re-arming `setTimeout` debounces:

```
private debounceTimer / treeDebounceTimer / gitOpsDebounceTimer / switchDebounceTimer
CONTENT_CHANGE_DEBOUNCE_MS = 500
GIT_DEBOUNCE_MS            = 500
WORKSPACE_DEBOUNCE_MS      = 2000
```

Every qualifying event clears and re-arms the timer. There is no max-wait, so a burst of events spaced closer than the debounce window **never** reaches the trailing edge. Under continuous churn the push never fires at all.

This is not a hypothetical. Measured against this repository, with the watcher's exact exclusion predicate and debounce window replicated standalone:

> **0 status invocations over a 60-second window, despite 734 qualifying (non-excluded) file-system events.** The 2000 ms timer never went quiet once across the entire window.

The same script against an isolated scratch repository produced 25 invocations in 60 s, confirming the mechanism works when the machine is quiet. The difference is ambient churn from the Nx daemon, editor autosave and other tooling — i.e. **ordinary conditions on a developer machine**.

### User-visible symptom

The file tree's git decorations and the git status bar silently stop updating on a busy workspace. No error, no spinner, no indication anything is stale — the UI simply reflects a snapshot from whenever the machine was last quiet. Because the failure is silent and machine-dependent, it reads as flakiness rather than a bug.

### Why TASK_2026_173's B4 does not fix this

B4 (batch 5 of TASK_2026_173) adds `.nx/` and `.angular/` to the watcher's exclusion set. That is correct and worth doing — it removes a large share of the event volume, which makes the debounce far more likely to go quiet.

**But it reduces the probability of starvation rather than eliminating it.** Any workspace with enough non-excluded churn — a large `git rebase`, a bulk codemod, a watch-mode build writing into a directory that is not excluded — starves it again. B4 treats the volume; this task treats the semantics.

The two are complementary and should not be merged: B4 has its own measurement (M3 before/after) and its own acceptance criteria in TASK_2026_173, and folding this in would confound them.

### Also note

A reactive/RxJS rewrite does **not** by itself fix this. `debounceTime` has exactly the same starvation property. The fix is choosing the right operator semantics — `auditTime`, `throttleTime` with trailing, or `debounceTime` paired with a max-wait — not changing paradigm. Whether to move the watcher to observables is a separate design question and explicitly out of scope here; the fix should be possible in the existing `setTimeout` structure in roughly 15 lines.

### Approach

Add a max-wait to each debounced channel: record the timestamp of the first event in the current burst, and on each re-arm, if `now - burstStart >= MAX_WAIT`, fire immediately instead of re-arming. Suggested starting values — confirm against the M3 harness rather than guessing:

- content-change (500 ms debounce) — max-wait ~2 s
- git-ops (500 ms) — max-wait ~2 s
- workspace (2000 ms) — max-wait ~8 s

The trade is a bounded amount of extra `git status` work under sustained churn in exchange for the guarantee that status is never unboundedly stale. That trade is the point; state the chosen ceiling explicitly.

### Constraints

- **Do not change the debounce windows themselves.** TASK_2026_173's C1 AC2 requires existing debounce windows to be observably identical, and batch 1 has already shipped against that. Adding a max-wait ceiling is additive; shortening a window is not.
- Coordinate with TASK_2026_173 batch 5 (B4). Landing this first changes B4's M3 before-figure; landing it after is cleaner. **Prefer after.**
- `catch (error: unknown)`. No `@ts-ignore`.

### Acceptance criteria

1. Each debounced channel fires within its max-wait ceiling regardless of continuous event arrival — proven by a test that emits events faster than the debounce window for longer than the ceiling and asserts the push fired.
2. Re-running the M3 harness against the **live monorepo** (`apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`) yields a non-zero invocation count. The current live-repo figure is 0.
3. Debounce windows unchanged; TASK_2026_173 C1 AC2 still holds.
4. The chosen max-wait ceilings are documented with the reasoning for each value.
5. `ptah-electron` suite green; cross-project passed-test sum does not decrease.

### Related

- `TASK_2026_173` — B4 / batch 5 (exclusion set), M3 measurement, `measurements.md` § M3 FINDING.
- `TASK_2026_173` batch 5, Task 5.3: the M3 after-figure must **not** be captured against the live monorepo while this defect is open — a live-repo run reports 0 for the wrong reason (starvation) and would read as a perfect fix.
