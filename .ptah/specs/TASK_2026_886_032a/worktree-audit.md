# Worktree audit - TASK_2026_886_032a

Audited 2026-11-07, read-only, against `origin/main` = `390808edf` (fetched just before the audit).
PR data: `gh pr list --state all --limit 1000` (one snapshot).

## Summary

| Bucket | Count |
| --- | --- |
| Worktrees under `.claude-worktrees/` (excluding `task-status-sweep`) | 53 |
| SAFE_REMOVE | 10 |
| REVIEW | 19 |
| KEEP | 24 |
| App-managed `Ptah Dev/review/attempts/*` worktrees (excluded, not audited) | 15 |
| Prunable or missing worktree entries | 0 |

Findings:

- This repo merges PRs with merge commits, not squash. Every merged-PR worktree has its HEAD as an ancestor of `origin/main`, and none has commits after the PR's `headRefOid` (`rev-list <oid>..HEAD` = 0 for all of them).
- Task-spec folders are not kept on `origin/main` (see cf9d37b98). So every untracked `.ptah/specs/<task>/` file in a worktree exists **only in that worktree**. None of them is in `origin/main`, and only 1 file of all of them is also in the main checkout's `.ptah/specs`. This is why most merged worktrees fall into REVIEW and not SAFE_REMOVE.
- Several worktrees sit on a main commit with **no commits of their own** (ancestor = true, ahead = 0), but they hold uncommitted source work. They are "merged" only in a trivial sense, so they are flagged in REVIEW.
- The 17 `fix/main-loop-sync-blocks` / `fix/mlsb-*` branches have no PR. Every `mlsb-*` HEAD is an ancestor of `fix/main-loop-sync-blocks` (4d473d169, 29 commits ahead of main, no remote branch). They all collapse into that one unpublished line of work.

Dirty counts are written `T` (tracked modified/staged/deleted) and `U` (untracked files, `-uall`). `node_modules` junctions are ignored by git and do not appear in these counts.

## SAFE_REMOVE (10) - included in `work/remove-worktrees.sh`

All are clean: T=0, U=0. Only ignored content remains, and I accept it as disposable: `node_modules` (junction, except `lane-restore-followups`, which has a real 1083-entry dir), `.nx/`, `dist/`, `tmp/`, `.husky/_/`, `.ptah/harness/` (claude.manifest.json, state.json), `.ptah/tmp/`.

| Path | Branch / HEAD | PR | Dirty | Notes |
| --- | --- | --- | --- | --- |
| .claude-worktrees/handoff-linked-sessions | feat/handoff-linked-sessions @ db241f958 | #942 MERGED | T0 U0 | origin branch exists, 0 unpushed. Ignored leftover: `.ptah/specs/TASK_2026_876_4949/prototype/screenshots/` |
| .claude-worktrees/hidden-features-analysis | docs/hidden-features-analysis @ 58e200c46 | #931 MERGED | T0 U0 | |
| .claude-worktrees/idle-compact-background | fix/idle-compact-background @ 6d80e33c4 | #923 MERGED | T0 U0 | Ignored leftover: `.ptah/specs/TASK_2026_863_26b1/dev-watch.log` |
| .claude-worktrees/lane-restore-followups | fix/lane-restore-followups @ 01c167725 | #964 MERGED | T0 U0 | node_modules is a real directory, not a junction |
| .claude-worktrees/readme-v2 | docs/readme-v2 @ 53645bcbf | #934 MERGED | T0 U0 | Ignored leftover: `.ptah/specs/README.md` |
| .claude-worktrees/routing-learning | fix/routing-learning @ 00ca92803 | #954 MERGED | T0 U0 | |
| .claude-worktrees/verify-speed | perf/verify-speed @ f328d9030 | #929 MERGED | T0 U0 | |
| .claude-worktrees/windows-hide-unpin | fix/windows-hide-unpin @ 6c51fa43a | #925 MERGED | T0 U0 | |
| .claude-worktrees/nx-verify-warm | detached @ c20dccc03 | none (no own commits) | T0 U0 | main commit from 2026-10-24, ancestor of origin/main |
| .claude-worktrees/psm-visual-base | detached @ 9e797082e | none (no own commits) | T0 U0 | merge commit of PR #853, ancestor of origin/main |

## REVIEW (19) - merged or no own commits, but holding local-only files

### A. Merged PR, tracked tree clean, only untracked task-spec notes (10)

If the user does not need these notes, archive or delete the listed `.ptah/specs` folder. After that the worktree becomes SAFE_REMOVE (or use `--force`).

| Path | Branch / HEAD | PR | Dirty | Local-only files |
| --- | --- | --- | --- | --- |
| .claude-worktrees/codex-lane-tree | fix/codex-lane-tree @ 6754a1210 | #938 MERGED | T0 U5 | `.ptah/specs/TASK_2026_883_codex_lane_tree/` |
| .claude-worktrees/codex-lane-write-dac | fix/codex-lane-write-dac @ ab952aff4 | #945 MERGED | T0 U5 | `.ptah/specs/TASK_2026_883_codex_lane_tree/` (1 of 5 is identical in the main checkout) |
| .claude-worktrees/inspector-sidebar-styling | fix/inspector-sidebar-styling @ f446e3367 | #963 MERGED | T0 U12 | `.ptah/specs/inspector-sidebar-styling/` |
| .claude-worktrees/landing-revamp | feat/landing-revamp @ 0e3242cfb | #940 MERGED | T0 U6 | `.ptah/specs/TASK_2026_878_eae4/` (HANDOFF, design-spec, prototype/, revision-1). origin branch in sync |
| .claude-worktrees/landing-revamp-p2 | feat/landing-revamp-p2 @ 2252719bf | #961 MERGED (+ #951 MERGED) | T0 U17 | `.ptah/specs/TASK_2026_878_eae4/` (design-spec, download-page, reviews, prototype/) |
| .claude-worktrees/lane-flat-chrome | fix/lane-flat-chrome @ e5013bb88 | #952 MERGED | T0 U1 | `.ptah/specs/lane-flat-chrome/` |
| .claude-worktrees/lane-start-failures | fix/lane-start-failures @ 7197e8312 | #939 MERGED | T0 U5 | `.ptah/specs/TASK_2026_882_01ef/` |
| .claude-worktrees/main-loop-freeze | fix/main-loop-freeze-regression @ a3c2990dc | #944 MERGED | T0 U22 | `.ptah/specs/TASK_2026_880_49d4/` |
| .claude-worktrees/task-detail-header-focus | fix/task-detail-header-focus @ 67c92cdba | #926 MERGED | T0 U1 | `.ptah/specs/TASK_2026_871_0d04/header-focus-review.md` |
| .claude-worktrees/unified-display | feat/unified-display @ 18bae7859 | #943 MERGED | T0 U1 | `.ptah/specs/TASK_2026_879_f5da/pr-body.md` |

### B. Merged PR, tracked spec file modified plus untracked spec notes (2)

| Path | Branch / HEAD | PR | Dirty | Local-only files |
| --- | --- | --- | --- | --- |
| .claude-worktrees/lane-control-model | feat/lane-control-model @ 2150a0d75 | #955 MERGED | T1 U8 | M `.ptah/specs/TASK_2026_LANE_CONTROL/context.md`, plus 8 untracked in the same folder (HANDOFF, coderabbit-fix-*, merge-*, verification-tier1) |
| .claude-worktrees/review-repo-settings | fix/review-repo-settings @ 097aa5f8f | #946 MERGED | T1 U27 | M `.ptah/specs/TASK_2026_873_f748/HANDOFF.md`, plus 27 untracked (pr-body.md, reports/p2-*) |

### C. Detached HEAD on a main commit, with local notes (2)

| Path | HEAD | PR | Dirty | Local-only files |
| --- | --- | --- | --- | --- |
| .claude-worktrees/codex-d9-live | detached @ 865cffff0 | none | T0 U1 | `live-d9-report.md` (repo root) |
| .claude-worktrees/d9-live | detached @ f4e2f87ed | none | T1 U0 | M `task-tracking/landing-live-demo/HANDOFF.md` (path no longer on origin/main) |

### D. Branch with no own commits (ahead 0) but uncommitted source work (5) - treat as KEEP unless abandoned

| Path | Branch / HEAD | PR | Dirty | Top files |
| --- | --- | --- | --- | --- |
| .claude-worktrees/landing-pilot-agy | feat/landing-pilot-agy @ 90a634721 | none | T1 U8 | M `libs/web/landing/src/lib/landing-page.component.ts`; new `libs/web/landing/src/lib/sections/decision-loop/` (3), `pilot-report.md`, `pilot-shots/*.png` |
| .claude-worktrees/landing-pilot-codex | feat/landing-pilot-codex @ 90a634721 | none | T1 U5 | same shape as agy: landing-page.component.ts, decision-loop/ (2), pilot-report.md, pilot-shots/ |
| .claude-worktrees/mlsb-perf | fix/mlsb-perf @ 0abc5e54c | none | T8 U66 | 7 deleted `.claude/commands/*.md` (also gone on main), 1 modified; new `scripts/perf/streaming-load-metrics*.{cjs,mjs,spec.ts,json}`, `apps/ptah-electron-e2e/src/specs/perf/streaming-load.perf.spec.ts`, 61 files in `.ptah/specs/main-loop-sync-blocks/` |
| .claude-worktrees/ptah-v2-promo | feat/ptah-v2-promo @ 4e2d1eb5e | none | T4 U43 | M `.gitignore`, `libs/frontend/webview-e2e-harness/src/{index.ts,lib/csp-stub.ts,lib/fixture-server.ts}`; new `apps/ptah-video-studio/` (hyperframes 15, eslint config, src), `webview-e2e-harness/src/lib/film/` (16), `.ptah/specs/ptah-v2-promo/` (10) |
| .claude-worktrees/workspace-split | chore/workspace-split @ dc8c9f752 | none | T1 U25 | M `task-tracking/landing-live-demo/HANDOFF.md`; `.ptah/specs/TASK_2026_workspace_split/` (25) |

## KEEP (24) - not merged

| Path | Branch / HEAD | PR | Dirty | Notes |
| --- | --- | --- | --- | --- |
| .claude-worktrees/lane-restore-resume | fix/lane-restore-resume @ 6fb2015ba | #965 OPEN | T191 U15 | 6 commits ahead of main, pushed (0 unpushed). 191 staged/modified (mostly `.ptah/specs/TASK_2026_858_f7b9/*`; 168 match main content, 3 differ, 20 not on main), 15 untracked in `.ptah/specs/TASK_2026_LANE_RESTORE/`. Active work |
| .claude-worktrees/agent-messaging | feat/agent-messaging-2way @ 5a3a01f4a | none | T0 U12 | 2 commits ahead of main (2026-11-07), no remote branch. `.ptah/specs/TASK_2026_AGENT_MESSAGING/` |
| .claude-worktrees/main-loop-sync-blocks | fix/main-loop-sync-blocks @ 4d473d169 | none | T0 U65 | 29 commits ahead of main (21 patch-unique), no remote branch. Parent of all mlsb-* below. `.ptah/specs/main-loop-sync-blocks/` (65) |
| .claude-worktrees/mlsb-fix-11 | fix/mlsb-fix-11 @ 4d473d169 | none | T0 U3 | same HEAD as main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-12 | fix/mlsb-fix-12 @ ed48f39da | none | T10 U6 | 28 ahead, ancestor of main-loop-sync-blocks, **plus uncommitted source**: M `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime{,.spec}.ts`, `libs/backend/persistence-sqlite/src/lib/backup.service{,.spec}.ts`, integrity specs (+5); new `persistence-sqlite/src/lib/daily-backup-pending-marker.ts`, `integrity/snapshot-backup-copy{,.spec}.ts` |
| .claude-worktrees/mlsb-fix-10 | fix/mlsb-fix-10 @ e2a304ffc | none | T0 U3 | 27 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-9a | fix/mlsb-fix-9a @ b84a8cd8d | none | T0 U3 | 23 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-9b | fix/mlsb-fix-9b @ 69c55bbae | none | T0 U2 | 23 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-8 | fix/mlsb-fix-8 @ feb4394cc | none | T0 U5 | 22 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-7 | fix/mlsb-fix-7 @ 68f62267e | none | T0 U2 | 21 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-6 | fix/mlsb-fix-6 @ 0277e2c84 | none | T0 U10 | 20 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-4 | fix/mlsb-fix-4 @ 24ecbdcad | none | T0 U7 | 17 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-3 | fix/mlsb-fix-3 @ cfdf1654e | none | T0 U4 | 16 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-2 | fix/mlsb-fix-2 @ fec588034 | none | T0 U4 | 13 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-core | fix/mlsb-fix-core @ 5992903a8 | none | T0 U3 | 6 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-fix-git | fix/mlsb-fix-git @ 20d2ee778 | none | T0 U3 | 6 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-diag | fix/mlsb-diag @ cdb605115 | none | T0 U3 | 1 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-flicker | fix/mlsb-flicker @ 2bf70f91d | none | T0 U1 | 1 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-git | fix/mlsb-git @ 01234b5f4 | none | T0 U1 | 1 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/mlsb-sqlite | fix/mlsb-sqlite @ e164e6d11 | none | T0 U2 | 1 ahead, ancestor of main-loop-sync-blocks |
| .claude-worktrees/demo-recording | chore/demo-recording @ 30db3bcc4 | none | T3 U2 | 2 commits ahead, both merge commits. `git cherry` finds no patch-unique commits, and merged-in `feat/ptahcode-rebrand` (2b39647ad) is on main. Uncommitted: M `libs/web/landing/src/lib/live-demo/runtime/{replay-bridge.entry.ts,rpc-responder.ts}`, `task-tracking/landing-live-demo/HANDOFF.md`; new `scripts/landing/{capture-smooth-clips,encode-smooth-clip}.mjs` |
| .claude-worktrees/native-loop | feat/native-agent-loop-pi-ai @ d0c0f6c97 | none | T0 U0 | 15 commits ahead (2026-09-03, docs/task-specs), no remote branch. Clean, stale |
| .claude-worktrees/pr-603-landing-i18n | claude/sleepy-turing-pdzxlm @ 391c9f8a1 | #603 CLOSED (unmerged) | T0 U0 | 52 ahead, **2 commits not on origin branch**. Stale (2026-09-30) |
| .claude-worktrees/ptah-review-canary | test/ptah-review-canary @ b5c4dcfce | #941 CLOSED (unmerged) | T1 U0 | 4 canary test commits, no remote branch. M `.gitignore`. Likely disposable test branch, but needs the user's decision |

Unmerged branches with no remote copy (lost if the branch is deleted, not if only the worktree is removed): agent-messaging, main-loop-sync-blocks and all 16 mlsb-*, native-loop, demo-recording, ptah-review-canary.

## Extra check - retired spec folders in the main checkout

`<repo>\.ptah\specs` has 456 folders. 331 exist on origin/main. **125 do not.**

- cf9d37b98 ("remove 126 retired task spec folders", on origin/main) touches 121 distinct folder names. 118 of them still exist locally, and 3 are already gone.
- The other 7 not-on-main folders are not from that commit: `lane-inactivity-stop`, `TASK_2026_408`, `TASK_2026_586_2b3e`, `TASK_2026_596_0a19`, `TASK_2026_597_ab22`, `TASK_2026_609_c495`, `TASK_2026_883_codex_lane_tree`.
- Empty folders: **0**. No file in any of the 125 is tracked in the index.
- **123 folders hold only ignored files**: exactly 1 file each, `.harvested.json` (ignored by `.gitignore:145` `.ptah/specs/**/.harvested.json`). That is 123 files in total. They are safe to delete as a group if wanted.
- **2 folders hold an untracked, non-ignored file** (real notes, not on main):
  - `.ptah/specs/lane-inactivity-stop/investigation.md`
  - `.ptah/specs/TASK_2026_883_codex_lane_tree/sandbox-experiment.md` (the worktree copies of this task folder in codex-lane-tree / codex-lane-write-dac have more files)

Nothing was deleted.
