# HANDOFF — TASK_2026_699_833e (inspector Stats dock) + TASK_2026_705_9d53 (remove single layout)

Written 2026-10-19 (session 2 wrap-up). No subagent or CLI lane is running. Electron is closed and
the peer sessions were told "Electron: free". This document covers BOTH tasks.
TASK_2026_705_9d53 has a short pointer HANDOFF.md to this file.

## Goal

The user wants one PR for each task (never merge to main):

1. **PR 1 — TASK_2026_699_833e**, branch `feat/inspector-side-dock`. The "This session" inspector is a
   resizable side dock in the **Electron canvas** (`canvas-rail-board.component.ts`, single-focus mode).
   A vertical "Stats" `ptah-sidebar-tab` on the dock's LEFT edge opens and closes it (decision 13).
   Grip resize, persisted width 300-560 px, single-focus tile floor 360 px (decision 18), defaults
   336/400/448 px. The PR also has the Plan Limits cards (inspector variant), chat-ui split-handle and
   sidebar-tab fixes, and the lane plan-limits RPC timeout of 15 s.
2. **PR 2 — TASK_2026_705_9d53**, branch `refactor/remove-single-layout`. Delete `ptah-tab-bar` and the
   `'single'` LayoutMode in every host, including the VS Code Canvas/single toggle. A stored `'single'`
   lands on the grid. Removals approved by the user: 705 decisions 2, 4, 5, 6.

Separate filed task, not part of these PRs: TASK_2026_704_8918 (NG0956 warning, startup
`agent:getLanePlanLimits` timeout), in the main checkout `.ptah/specs/TASK_2026_704_8918/`.

## Locations

| Item | Path |
|---|---|
| Worktree PR 1 | `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock` (branch `feat/inspector-side-dock`, local only) |
| Task folder PR 1 | `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock\.ptah\specs\TASK_2026_699_833e` |
| Worktree PR 2 | `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout` (branch `refactor/remove-single-layout` from main 15fe6031a, local only, NO commits) |
| Task folder PR 2 | `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout\.ptah\specs\TASK_2026_705_9d53` (untracked) |

Both worktrees have `node_modules` as a junction to the main checkout. The main checkout stays on `main`.

## Done in this session

### PR 1
- Scoped check of rev 4 by the orchestrator: `typecheck,test,lint` for chat-ui, chat, canvas → "Successfully ran ... for 3 projects".
- `git diff main -- chat-view.component.* inspector-shell.controller.ts` is empty (revert is correct).
- Team-leader Mode 2 commits (foreground, hooks ran, not pushed):
  - `2ac83d78e` feat(canvas,chat): dock the session inspector in the canvas rail board
  - `0485f95b4` docs(task-specs): TASK_2026_699 rev 4 plan, report and batches
- codex review of `17b523b2e..2ac83d78e` (Review family: codex, implementer: claude):
  - `code-logic-review.md`: **REVISE 6/10**, 1 Serious (L1 below). The orchestrator confirmed L1 in the code.
  - `code-style-review.md`: **APPROVED 8/10**, 1 Minor (barrel `session-inspector/index.ts:24-37` exports more width helpers than callers use).
- Electron build: `npx nx build-dev ptah-electron` + `npx nx copy-renderer-dev ptah-electron` green (dist is current for `2ac83d78e`).
- Visual review in the CANVAS layout, no layout override (`visual-review.md`, screenshots in `screenshots/rev4/`):
  **REVISE 6/10**. Dock bands, clamps, persistence, Esc restore, rail auto-collapse: OK. V1, V2 fixed; V3 partly fixed.
- These three review files are modified but NOT committed (commit them with the fix round).

### PR 2
- F7 fixed by the orchestrator (`implementation-plan.md:380-387`: `ptah-layout-mode` allowed only in e2e
  `canvas.spec.ts` and the `app-state.service.spec.ts` regression case; no production read/write).
- codex re-review: **Gate 2 APPROVED** (`implementation-plan-review.md:13,15`). Decision 8 logged.
- Team-leader Mode 1 wrote `batches.md`: 4 sequential batches, 11 tasks, "PASSED WITH RISKS" (9 risks, 6 assumptions).
  It REORDERED the plan's batches so callers go before the core API deletion (each batch must typecheck alone):
  1. chat shell, routing services, `SurfaceActiveDirective` + `app-shell.component.html` (projects core, chat)
  2. chat-view only + a canvas spec stub/comment (chat, canvas) — the only batch that edits `chat-view.*`
  3. core layout API deletion + harness-builder + webview (core, harness-builder, ptah-extension-webview)
  4. chat-ui deletions + e2e/showcase edits (chat-ui, ptah-electron-e2e)
  Batch 1 is marked IN_PROGRESS in `batches.md` but NO code was written. `task.md` status = `in_progress`.
  Correction: the no-SESSION_CONTEXT fallbacks are `parity-inventory.md:114` (not "row 103").

## Open findings — PR 1 fix round (ONE round only, then a scoped re-review)

| ID | Severity | Location | Problem | Proposed fix |
|---|---|---|---|---|
| V-F1 | Blocking (visual) | composer toolbar `chat-input.component.ts:364-365`; floor in `canvas-rail-board.component.ts:389-396` | At a tile of 360 px or less the "+", permission shield, model name and effort bars overlap. Reached at 800-900 px with the dock open and at 1200 when dragged to the floor. Probably also in split panes today (not proven, no base screenshot). | **`chat-input.component.ts` is PEER-OWNED — do NOT edit it.** Options: (a) raise the single-focus floor to the width where the toolbar fits (board lowers dock max or closes the dock), or (b) file the toolbar fix as a follow-up for the peer owner and show the user a base-commit split-pane screenshot. This is a scope choice → ask the user (one AskUserQuestion) if evidence does not settle it. |
| L1 | Serious (logic) | `canvas-rail-board.component.ts:310-312,378-387,907-910` | Compact sheet uses `detailsOpen`; dock uses `dockOpen`. Crossing 400 px board width loses the open inspector and focus. | On the 400 px crossing, hand the open state to the destination, close the old one, move focus explicitly. Add a board spec that crosses 400 px both ways while open. Note: visual review found the board never measures below 400 in Electron (window `minWidth: 800`), but the VS Code/webview host can. |
| V-F2 | Serious (visual) | `canvas-rail-board.component.ts:249` (`@defer (on idle)`; same trigger 203, 271) | Dock body shows an empty "Session details" placeholder for 4.5-6.5 s after each open on a busy page. | `@defer (when dockOpen())` or `on immediate`, plus `prefetch on idle`; skeleton placeholder. |
| V-F3 | Moderate | `canvas-rail-board.component.ts:383-396` | At 760 the tile is 308 px (300 dock min wins, as decision 18 allows); compact sheet not reachable in Electron. | Fix only if it can break config or lose data (rule) → otherwise record as a named later task. |
| V-Minor | Minor | `split-handle.component.ts:162` | Width readout now covers the "Model" card label during a resize. | Record, do not fix. |
| S-Minor | Minor | `session-inspector/index.ts:24-37` | Barrel exports extra width helpers. | Record, do not fix. |

Known Minor items (recorded, not fixed): overlapping drags can restore the wrong body cursor; long plan-window
label truncates at 300/336 px; 2 px light-theme open indicator ~1.2:1. Plan Limits card visuals were not
re-verified this round (fixture did not map to the focused session; round 1 covered them).

## Rules and hazards

- `.ptah/specs/TASK_2026_699_833e/.electron-userdata/` is a private Electron profile and contains the private
  launcher `launch.js` (adds `--remote-debugging-port=9391` and a private user-data dir). It is NOT git-ignored.
  **Never stage it.** Leave it untracked or delete it before the PR.
- Peer-owned files, never edit: `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`.
- Shared Electron: before a launch, `ListAgents` and send "Electron: 699 launching" (or "705") to each peer; send "Electron: free" after.
- CLAUDE.md: worktree only, scoped checks with `-p` and `--parallel=1`, Jest `--maxWorkers=2`, one heavy check at a time,
  never workspace-wide/serve/e2e/package; commit in the foreground; push + `gh pr create` as ONE background command.
- Lanes (2026-10-19): codex had room (Weekly 43%); grok AT LIMIT until 2026-10-20 17:40 UTC; opencode Monthly 93%. Run `ptah_agent_list` first.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Read `.commitlintrc.json` (subject ≤ 72, body ≤ 100).

## Exact next steps

### PR 1 (worktree inspector-side-dock)
1. Decide V-F1 (see table; ask the user only if needed — it touches a peer-owned file or the approved floor of decision 18).
2. One fix round by a frontend-developer subagent (implementer family claude) for L1, V-F2 and the chosen V-F1 option. Give it
   the paths `code-logic-review.md` and `visual-review.md`. Log decisions in `decisions.md` (next row after 19).
3. Scoped check (output filtered, confirm "3 projects"):
   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1 2>&1 | grep -E "Running target|Successfully|Failed|failed|✕|●" | head -30`
4. Team-leader Mode 2 commit (foreground; stage specific paths plus the three review files; never `.electron-userdata/`).
5. codex re-review scoped to the fixes (resume session `01a15220-90f4-7871-9270-9a482d77a093` or a fresh codex lane). If it
   still finds defects: report them and stop (no second round).
6. Rebuild (`npx nx build-dev ptah-electron` then `npx nx copy-renderer-dev ptah-electron`), announce the launch, visual
   re-check of the fixed items only (canvas layout, no override, dark + light), announce "Electron: free". Show screenshots to the user.
7. Team-leader Mode 3, Gate 3, then in ONE background command:
   `git push -u origin feat/inspector-side-dock && gh pr create --base main --title "feat(canvas,chat): Stats side dock for the session inspector" --body "..."`
   (## Summary + ## Test plan; list the recorded Minor items and TASK_2026_704_8918). Report the link.

### PR 2 (worktree remove-single-layout)
1. "Before" screenshots (dark + light) from base `15fe6031a` of the VS Code webview shell (tab bar + Canvas/single toggle)
   and Electron (risk R9 in `batches.md`). The worktree is still at the base, so build/capture there before Batch 1 lands.
2. Batches 1-4 in order, one frontend-developer per batch (subagent or codex lane), each with its scoped check from
   `batches.md` and a team-leader Mode 2 commit. Never edit the peer-owned files.
3. Final scoped checks (from `implementation-plan.md:396-399`, run one at a time):
   `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
   `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview --parallel=1`
   `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/harness-builder ptah-extension-webview ptah-electron-e2e --parallel=1`
   Run the zero-reference sweep from `implementation-plan.md:380-388`.
4. codex code review of the whole diff (one fix round), "after" screenshots, Mode 3, then push + `gh pr create` in one
   background command and report the link. List follow-ups in the PR body: no-SESSION_CONTEXT fallbacks
   (`parity-inventory.md:114`), the `SESSION_WORKFLOW_ADDONS` token and `workflowAddonsFor`.
5. Merge order: PR 1 first is recommended (PR 2 deletes the chat-view inspector host that PR 1 reverts to main).

## Key files

- PR 1: `implementation-plan-rev4.md`, `decisions.md` (rows 13-19), `rev4-implementation-report.md`, `batches.md`,
  `code-logic-review.md`, `code-style-review.md`, `visual-review.md`, `prototype/`, `screenshots/rev4/`.
- PR 1 code: `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`, `libs/frontend/canvas/src/lib/canvas-board-mode.ts`,
  `libs/frontend/chat/src/lib/services/session-inspector/{inspector-dock-width.ts,inspector-dock.controller.ts,inspector-dock-width.store.ts,index.ts}`.
- PR 2: `implementation-plan.md`, `implementation-plan-review.md`, `parity-inventory.md`, `batches.md`, `decisions.md` (rows 1-8).
