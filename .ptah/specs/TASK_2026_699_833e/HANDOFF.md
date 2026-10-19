# HANDOFF — TASK_2026_699_833e (inspector Stats dock) + TASK_2026_705_9d53 (remove single layout)

Written 2026-10-19 at session wrap-up (token budget). No subagent or CLI lane is running.
This document covers BOTH tasks. TASK_2026_705_9d53 has a short pointer HANDOFF.md to this file.

## Goal

The user wants a PR for each of these tasks (user message: "wrap all of these together and make PRs for the fixes"):

1. **PR 1 — TASK_2026_699_833e**, branch `feat/inspector-side-dock`. The "This session" inspector
   becomes a resizable side dock in the **Electron canvas**. A vertical `ptah-sidebar-tab` labelled
   **"Stats"** on the dock's LEFT (inner) edge opens and closes it (decision 13). The dock has a grip resize
   handle and a persisted width of 300-560 px. The single-focus tile floor is 360 px (decision 18).
   The defaults are 336/400/448 px. The PR also contains the Plan Limits cards (inspector variant), the
   chat-ui split-handle and sidebar-tab fixes, and the lane plan limits RPC timeout of 15 s.
2. **PR 2 — TASK_2026_705_9d53**, branch `refactor/remove-single-layout`. Delete `ptah-tab-bar` and
   the `'single'` LayoutMode in every host, including the VS Code Canvas/single toggle. A stored
   `'single'` maps to `'grid'`. The user approved these removals (decisions 2, 4, 5, 6 in the 705 folder).

Separate filed task (no work in this session's PRs): **TASK_2026_704_8918** (NG0956 warning and
the remaining `agent:getLanePlanLimits` timeout at startup). It is in the main checkout:
`D:\projects\ptah-extension\.ptah\specs\TASK_2026_704_8918\context.md`.

## Key history (read decisions.md rows 13-19 in this folder)

- Batches 1-3 put the dock in `chat-view.component`. That component hosts the inspector only in the
  'single' layout. The Electron canvas renders "This session" in
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`. The first visual review
  forced the single layout, so it did not catch the error. The user found it (decision 16).
- Plan rev 4 (`implementation-plan-rev4.md`) retargets the dock to the canvas board and reverts
  chat-view to main. Gate 2 APPROVED by codex after 1 revise round (decision 19).
- main (15fe6031a) was merged into the branch: clean merge `17b523b2e` (decision 17).

## Locations

| Item | Path |
|---|---|
| Worktree PR 1 | `D:\projects\ptah-extension\.claude-worktrees\inspector-side-dock` (branch `feat/inspector-side-dock`, local only) |
| Task folder PR 1 | `...\inspector-side-dock\.ptah\specs\TASK_2026_699_833e` |
| Worktree PR 2 | `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout` (branch `refactor/remove-single-layout` from main 15fe6031a, local only, no commits) |
| Task folder PR 2 | `...\remove-single-layout\.ptah\specs\TASK_2026_705_9d53` (untracked) |

Both worktrees have `node_modules` as a junction to the main checkout. The main checkout stays on `main`.

## Done

### PR 1 (feat/inspector-side-dock) — commits, not pushed
- `9d5063f43`, `309cb2bca`, `431e7cf75`, `5fc888d16`: batches 1-4 (batches 2-3 = chat-view dock, now reverted by rev 4)
- `069902dea` + `69a49a585`: phase-review fix round + Stats tab move (codex re-review APPROVED: logic 8/10, style 9/10)
- `82b79b348`: visual fixes (open Stats label contrast 13.7:1 light / 14.2:1 dark, inset focus ring, readout position)
- `6e28fe6a2`: `LANE_PLAN_LIMITS_TIMEOUT_MS` 10 s → 15 s (does not remove the startup timeout completely, see TASK_2026_704_8918)
- `52a811674`: batches.md docs
- `17b523b2e`: merge of main

### PR 1 — rev 4 implementation: DONE, NOT COMMITTED
The frontend-developer subagent implemented all of plan rev 4. Report: `rev4-implementation-report.md`.
Its scoped check passed: `typecheck,test,lint` for 3 projects, 9/9 tasks, no cache. The
orchestrator did NOT re-run the check. Uncommitted changes:
- canvas: `canvas-board-mode.ts`, `canvas-rail/canvas-rail-board.component.{ts,spec.ts}`, `canvas-rail/canvas-rail.component.spec.ts`
- chat: `chat-view.component.{ts,html,css,spec.ts}` and `inspector-shell.controller.ts` reverted to main
  (the report says the diff is empty); deleted `inspector-open-state.service.spec.ts`, `inspector-shell.controller.spec.ts`
  (branch-only specs); edited `session-inspector/{index.ts, inspector-dock-width.store.ts, inspector-dock.controller.{ts,spec.ts}}`;
  new `inspector-dock-width.ts` + `inspector-dock-width.spec.ts`
- task docs: `decisions.md` (rows 16-19), `implementation-plan-rev4.md`, `implementation-plan-rev4-review.md`, `rev4-implementation-report.md`, this file

Deviations (in the report): the dock open state uses `linkedSignal`, which resets only when the
board crosses between sm and md. Prettier was not run on the canvas board files, because main does
not format them. The pre-commit hook WILL reformat them, so expect a large diff in that commit.

### PR 2 (refactor/remove-single-layout) — plan stage
- `context.md`, `decisions.md` (rows 1-7), `parity-inventory.md` (59 rows), `implementation-plan.md` (9 components, 4 sequential batches).
- Gate 2: codex round 1 REVISE → architect revised → codex re-review **REVISE**. F1-F6 are closed. **F7 is open**: the plan
  requires an app-state spec that writes `ptah-layout-mode`, but its zero-reference sweep allows that key only in
  e2e `canvas.spec.ts`. Fix: allow the key in the app-state migration spec (the spec that proves a stored
  `'single'` maps to `'grid'`). This is revise round 2 of 2 (the last one).

## Open problems and decisions

- `.ptah/specs/TASK_2026_699_833e/.electron-userdata/` is a private Electron profile. It is NOT git-ignored
  (`.gitignore:139` `!.ptah/specs/**`). **Never stage it.** Delete it before the PR, or leave it untracked.
- 699 Minor finding (recorded, not fixed): overlapping drags can restore the wrong body cursor.
- 699 Minor finding: the long plan-window label truncates at 300/336 px (hover title only).
- 699 Minor finding: the 2 px primary "open" indicator line on the sidebar tab is about 1.2:1 in the light theme.
- 705 remove-proposed, OUT of PR 2 (not asked yet; list them in the PR body as follow-ups):
  - row 103: chat-view's fallbacks when there is no `SESSION_CONTEXT`
  - the `SESSION_WORKFLOW_ADDONS` token and `workflowAddonsFor` (no provider and no consumer after PR 2)
- Peer branch rule (still valid): do not edit `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`.
- Shared Electron: before a launch, send "Electron: 699 launching" to the peer sessions (ListAgents), and send "Electron: free" after.

## Exact next steps

### PR 1 (TASK_2026_699_833e), worktree inspector-side-dock
1. Verify rev 4 yourself (one heavy check at a time, output filtered). Use the real project names from
   each `project.json`, and confirm that the header says 3 projects:
   `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1 --skip-nx-cache 2>&1 | grep -E "Running target|Successfully|Failed|failed|✕|●" | head -30`
2. Team-leader Mode 2: commit rev 4 in the FOREGROUND. Stage specific paths only, never `.electron-userdata/`.
   Read `.commitlintrc.json` first (subject ≤ 72, body ≤ 100). End the message with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
3. codex code review (different family) of the rev 4 commit → overwrite `code-logic-review.md` (+ `code-style-review.md`, because there is new public API).
   Run `ptah_agent_list` first (codex had room, Weekly 40%; grok was AT LIMIT until 2026-10-20 17:40 UTC). One fix round only.
4. Visual review in the **canvas layout, with NO layout override** and the user's normal data if possible.
   Build: `npx nx build-dev ptah-electron` then `npx nx copy-renderer-dev ptah-electron` (the renderer is NOT part of build-dev).
   Launch: `node apps/ptah-electron/scripts/launch.js` (from the worktree). Take dark + light screenshots at 1440 and 760.
   Show the dock in the md/lg/xl bands, the Stats tab open and closed, the drag grip, and the compact sheet. Compare to `prototype/`, and show the screenshots to the user.
5. Team-leader Mode 3, then Gate 3. Then push and open the PR in ONE background command:
   `git push -u origin feat/inspector-side-dock && gh pr create --base main --title "..." --body "..."`
   (## Summary + ## Test plan. End the body with "🤖 Generated with [Claude Code](https://claude.com/claude-code)").

### PR 2 (TASK_2026_705_9d53), worktree remove-single-layout
1. Fix F7 in `implementation-plan.md` (architect subagent, or a bounded edit). Then a codex re-review of F7 only. This is the last revise round. If it is still REVISE, go to the user.
2. A frontend-developer subagent implements the 4 sequential batches (`chat-view.component.ts` belongs to one batch only).
3. Scoped checks for the projects that the plan lists (`-p`, `--parallel=1`, Jest `--maxWorkers=2`).
4. Team-leader commit, then a codex code review, then before/after screenshots of the VS Code webview and Electron
   (no surface is added, so before/after screenshots are enough).
5. Push and open the PR in one background command, then report the link. Merge order: PR 1 first is recommended.
   PR 2 deletes the chat-view inspector host that PR 1 reverts to main, so the two PRs touch the same files only in the main state.

Never merge to main. Never run workspace-wide checks, serve, e2e or package targets.
