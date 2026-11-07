# Status audit: non-backlog task carriers (TASK_2026_886_032a)

Date: 2026-11-07. Worktree `chore/task-status-sweep` at origin/main `390808edf`.
Evidence: `gh pr list --state all --limit 1000` (960 PRs, #1 to #965, only #965 open),
`git log origin/main`, the task folders and spot checks of the code.

## Summary

| Bucket | Count |
| --- | --- |
| Carriers in scope (done 125, in_progress 17, in-progress 1, in_review 1, blocked 2) | 146 |
| Applied: status changed to `done` | 14 (12 in_progress, 1 in_review, 1 invalid `in-progress`) |
| Proposed for a user decision | 3 (+1 carrier with no status line) |
| Kept as is (still active or blocked) | 5 |
| `done` carriers checked | 125: none to downgrade; 11 have no trail outside the task folder (see Unclear) |

Only the `status:` line and the `updated:` line (where present) were edited, in 14 carriers.
Nothing was set to `cancelled` and no `done` was downgraded.

## Applied

| Task | Old → new | Evidence |
| --- | --- | --- |
| TASK_2026_593_7c2e | in_progress → done | #780 `7eee8c211`, #783 `b1e9ed431`, #790 `c09f1e960`, #795 `9d3323490`, #802 `1d7c36c3f`, all merged. HANDOFF lists every phase PR as merged; the leftover M4/M7/M8 items are "propose as a new task". |
| TASK_2026_853_897f | in_progress → done | All four phases merged: A #854 `286609dab`, B #862 `a2ca429a6`, C #863 `a7036819e`, D #879 `b84d0e2f6` (HANDOFF: "Cut ... in four phases"). The open item (migration delete race #85) was handed to the user as a possible separate task. |
| TASK_2026_855_d4b6 | in_progress → done | #857 `f40926947` merged 2026-10-30. It also changed `session-folder.ts`, the Batch 6 file (commit `0547874dc`). |
| TASK_2026_856_d668 | in_progress → done | #869 `b38484b5d` merged 2026-10-31 ("persist session metrics on host state"). |
| TASK_2026_857_f660 | in_progress → done | #870 `daebe63c4`, plus #872 `4b3898a6e` with the commits #870 missed. Both merged 2026-10-31. |
| TASK_2026_858_c7a2 | in_progress → done | #888 `5c9e2910a` merged 2026-11-02 ("stagger transcript message enter and leave"). |
| TASK_2026_859_b561 | in_progress → done | #882 `add31d0d5` merged 2026-11-01 ("migrate MCP registry to v0.1 server.json"). |
| TASK_2026_860 | in_progress → done | #889 `d7bc04d66` merged 2026-11-02 (rail grouping, agent dock cap, pulse loaders). |
| TASK_2026_862_bf84 | in_review → done | #900 `dd380c449` merged 2026-11-03 (branch `feat/codex-binary-unpin`, named in the carrier). |
| TASK_2026_863 | in_progress → done | #919 `0e8028688` merged 2026-11-04 ("live rail tile status, compact tiles by default"). |
| TASK_2026_863_cfae | in_progress → done | #909 `7531c509d` merged 2026-11-03. The PR defers one conditional item (resume after the SDK stream ends) until live logs show it is needed. |
| TASK_2026_865_2a1d | in_progress → done | #914 `424d4298e` merged 2026-11-04 ("continue a conversation on the new provider"). |
| TASK_2026_872_f3b4 | in_progress → done | #911 `55b604b66` merged 2026-11-03 ("split agent run details from lane plan limits"). |
| TASK_2026_glass_scenes | in-progress (invalid) → done | #884 `bfcd0b717` merged 2026-11-01. The branch `feat/glass-theme-scenes` is named in the carrier. This carrier has no `updated:` line. |

## Proposed (user decision)

| Task | Current | Proposed | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| TASK_2026_714_c8a2 | in_progress | `done`, and file the remaining batches as a backlog follow-up | The core scope is merged: #809, #823 `944837c0c` (native runtime, Removal B, P10 lane parity proof) and #881 `fb279dff1` (Removal A, D9 history, sub-agent cards). The triaged "remaining scope" (wire chat, session controls, gateway and lanes, prove parity, retire proxy and SDK lane) is on main. Still `PENDING` in `batches.md` with no code found: 11c (Codex named roles / personas), 13a-13b (turn-start shadow-tree checkpoint and rewind), 14a-14b (parity-gate ledger, live parity run). There is no open PR or branch for them. | medium |
| TASK_2026_591_fff5 | in_progress | `done` for Phase 1, and split Phase 2 into a new backlog task | Phase 1 (queue-next-turn) merged in #658 `779b89b5d`. The opencode adapter spec pins `continuation: supported` and messaging `queue`. Phase 2 (steer and interrupt through `opencode serve`) is a design-first item behind a user gate and was never started. | medium |
| TASK_2026_853_cli_lanes | (no `status:` line) | add `status: done` (not applied: it would add a field) | The carrier is prose-only with no frontmatter. Its branch `fix/cli-lane-prompt` merged as #865 `bc73e7e4e` on 2026-10-31. | high |

## Kept as is (still active)

| Task | Status | Evidence |
| --- | --- | --- |
| TASK_2026_858_f7b9 | in_progress | Phases B to E merged: #927, #928, #962 `be25eb1d1` (2026-11-06). HANDOFF: "Next: Phase F from `batches.md` Batch 23" (mobile PWA, design revision G-D first). No open PR. |
| TASK_2026_873_f748 | in_progress | P1 #924 `90a634721` and P2 #935 `a7f2e15b9` merged. P3 (learnings and tuning) and P4 (headless daemon) are planned in `implementation-plan.md`. |
| TASK_2026_886_032a | in_progress | This sweep. |
| TASK_2026_155 | blocked | User-set block (context.md, 2026-08-09): the Checkpoint 2 architecture was never answered. No `goal-workflow` lib on main; PR #421 only mentions the ID. The user could cancel it or move it back to backlog. |
| TASK_2026_479_4e71 | blocked | context.md "backlog audit": delivered in part (MCP back-off, PR #539). Still open: tree-kill of orphaned cmd/node after a connect timeout (`off-thread-process-spawner.ts:387-389`) and the duplicate drive-letter registration in `~/.claude.json`. The block reason is not stated, so `backlog` may fit better. |

## `done` spot-check result

- 91 of 125 have a merged PR that names the task ID or its branch. 3 of them also have a
  PR that closed unmerged (TASK_2026_615_04b0 #652, TASK_2026_710_html and
  TASK_2026_710_ptah-glass-theme #799). In each case a merged PR covers the work
  (#654, #789, #805).
- 34 have no PR match. Of these, 9 cite a commit or PR that is on main: 237, 239, 256, 258,
  335, 510_eb26 (`c24b6e4cf`), 656_reviews (#722), settings_ui_polish (#840), and
  717_5410 (#822 `fix/glass-shadow-borders`). 10 have a feature or fix commit on main that
  names the ID: 254, 257, 290, 291, 299, 323, 331, 334, 365, 721_es01. 4 were checked in
  the code: 259 (the `pruneStaleFiles` guard keeps user-authored harness skills), 268
  (`max-lines` 700 in `eslint.config.mjs`), 318 (`.mcp.json` writes under
  `withMcpConfigLock`, citing TASK_2026_318) and 509_2f47 (no `@nx/jest:jest` executor
  left).

No `done` carrier is proposed for a downgrade.

## Unclear

- Done, trail only inside the task folder: TASK_2026_248, 251, 253, 255, 303, 308, 309,
  314, 332, 333 and 359. Each has an implementation report, review or context entry but no
  PR, ID-tagged commit or cited sha on main. These are September-era carriers from before
  the one-PR-per-task flow. The code was not checked one by one. Risk: low.
- TASK_2026_714_c8a2: `batches.md` still shows 10b-10e and 12a-12d as `PENDING`, but #823
  and #881 delivered them. The outline is stale, not a sign of open work.
