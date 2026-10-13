# TASK_2026_629_c0b3 — sixth handoff (N1/N2 done, main merged, R9 regression phase next)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). This file is the source of truth for the next
session and REPLACES `handoff-5.md` §3 and §5. Still valid: `handoff-5.md` §2 (recorded, not fixed) and §4 (rules),
`handoff.md` §4 (final-run tools), §6 (coordination) and §7 (lanes and checks), and `implementation-plan-rail.md`
"## Electron re-check list". Decisions: `decisions.md` rows 63-72 are new in this session.

## 1. Where we are

| Step | Result |
|---|---|
| N1 (Serious) + N2 (Minor) correction | One codex `frontend-developer` lane (`lane-rail-correction-report.md`). Team-leader Mode 2 ran checks (canvas 409/409, chat-ui 1131/1131, typecheck + lint pass) and committed `1908f240e` `fix(canvas,chat-ui): rail keyboard focus and +N more fit`. |
| Review of the correction | Claude `code-logic-reviewer` (Claude reviewing codex) `code-logic-review-correction.md`: APPROVED 9/10, 0 Blocking/Serious/Moderate, 3 Minor (recorded, not fixed — see §6). Revise cap for the Rail fix round is now used up. |
| Main sync (user decision row 67) | `0c3cf0ac4` merge of `origin/main` (51 commits, PRs #716-#720), no conflicts. Typecheck after merge: chat-ui, chat, canvas pass. Tests were NOT run after the merge — run them in R9. |
| Electron renderer | Rebuilt from `1908f240e` (BEFORE the merge) at 22:35-22:37. Rebuild again after R9. |
| User's manual Electron test | Done by the user. Video: `.ptah/tmp/final-run/video/page@e8500e413589e3d7f7829254f1d1b4d0.webm`. The user closed the window (that is fine; the launcher still finalizes the video when `stop` is created). The user found the R9 items (§2). The "Re-check" section in `final-run-review.md` is NOT written yet. |
| R9 "before" screenshots | `.ptah/tmp/final-run/shots/before-r9-{rail,grid}-{anubis,anubis-light}.png` (pre-R9 build, side panels open). Video `page@bde4a88f3f32cea37269b325020acb22.webm`. |
| BL heap, contrast #10 | NOT run on this build — R9 changes the canvas hosts. Run them on the R9 build. The 628 message must use the new heap result. |
| R9 plan | NOT written. A Claude architect was started and then stopped by the user before it wrote anything. |
| PR, push, Mode 3 | ON HOLD until R9 passes (user decision row 65). |
| `better-sqlite3` | Still Electron ABI in the SHARED `D:\projects\ptah-extension\node_modules`. ASK THE USER before `npm rebuild better-sqlite3` (backend Jest needs it; the Electron dev app needs the Electron build). Do it after the R9 Electron re-check. |

Uncommitted on purpose: none of `.claude/commands/orchestrate*.md` now differs from HEAD (they equalled origin/main
and the merge brought that content in; backup in `%TEMP%\629-cmd-backup-1791922037`).

## 2. R9 scope — 8 items (user decisions rows 65, 69-72)

Evidence is from a read-only trace on 2026-10-13; the architect must verify each.

1. **Rail "New session" has no name popover.** `orchestra-canvas.component.ts:167-170` renders the dock popover only
   when `activeBoard().mode === 'grid'`; the Rail footer button `canvas-rail.component.ts:179-187` →
   `canvas-rail-board.component.ts:321-329` `newSession()` calls `addTile(defaultSessionName())`. Contradicts D9
   ("the dock keeps the named popover", `implementation-plan-rail.md:~1118`). Fix: same named popover in Rail; empty name
   keeps the default name so the first-prompt auto-rename (`tab-manager.service.ts:913-917,1712-1720`) still works; keep
   the running-cap gate.
2. + 3. **Displays and Agents dock removed from the canvas.** Both canvas hosts provide `HIDE_AGENT_SIDEBAR: true`
   (`canvas-tile.component.ts:618`, commit `79e7e81fd`; `canvas-detail/canvas-detail-transcript.component.ts:56`,
   commit `3ee56f825`). So the dock state is null (`chat-view.component.ts:240-248`), `ptah-display-dock` does not mount
   (`chat-view.component.html:292`, `display-dock.component.ts:178`), display candidates are off
   (`transcript-display-feed.ts:73,80`) and every `ptah-ui display` fence shows "Display panel unavailable"
   (`ptah-ui-display-chip.component.ts:131,307-316`). Inline `ptah-ui` blocks still render. The prototype Details
   "Agents" section (`prototypes/02-focus-rail.html:299-303,345`, `prototypes/shared.js:640-644`) was not built
   (`canvas-session-details.component.ts:31-100` shows only context, todos, git). TARGET (user production screenshot,
   row 71): restore the EXISTING per-tile right dock — tabs "Displays (n) | Agents (n)", vertical "DISPLAY" toggle, pin
   and close, the Turn summary display panel (Files/Lines/Tokens/Cost/Duration cards) and the in-chat "Open in panel"
   button — for the focused session in Rail and for the Grid detail panel. Session details stay reachable. Keep ONE
   live ChatView and the heap budget. Not covered by any parity row — an unapproved removal, so it blocks the PR.
4. **Grid loses the last opened lane.** Card click `canvas-tile.component.ts:640` → `CanvasDetailService.toggle()` →
   `open(tabId,'orchestrator')` overwrites `_laneKeys` (`canvas-detail.service.ts:42-58`); `step()` → `open(id)`
   (`:91`). Rail keeps it. Fix: open without an explicit lane keeps the stored lane. Not persisted across reload (D6).
5. **Rail pointer and hover.** Rail card host has the click but no role (`canvas-rail-card.component.ts:42-49`; inner
   parts `pointer-events:none`, `compact-rail-card.component.ts:100-111`); lane rows (`:308-318`), `.rc-action`
   (`:115-124`) and the collapsed button (`canvas-rail-card.component.ts:86-98`) have no hover. Match Grid
   (`compact-session-lanes.component.ts:100`). No layout shift (176/96, 70 px lane block); keep the N1 helper
   `focusRailSelectButton` and the N2 `rc-lane-overflow`.
6. **A CLI agent from one session shows on other session cards** (row 69). Card lane rows use the tolerant
   `agentVisibleInSession` (`compact-lane-rows.ts:60`, added on this branch in `56ee65cd6`) and
   `compact-session-card.component.ts:226-228` `agentsForSession`; both show any agent with an unresolved
   `parentSessionId` in every session. The lane tabs already use strict `ownedBySession`
   (`canvas-lane-tabs.component.ts:98-115`) and the store has `agentsOwnedBySession`
   (`chat-streaming/src/lib/agent-monitor.store.ts:~884-894`). Fix: strict ownership on cards (rows, counts, `+N`, Now
   line) and in the restored Agents view; decide `tile-agent-indicator.component.ts:63` (on base, tolerant); check
   `knownSessionId` (`agent-monitor.store.ts:1163,1481`) for the root cause — backend causes become a finding only.
7. **Sub-agents as tiles in the main chat transcript** (row 70; `TASK_2026_654_7a18` cancelled and moved here). Stop
   rendering the nested sub-agent stream inline; render each sub-agent as ONE compact tile in the background-agent tile
   style (kind icon, name, status, last activity line, tool count, duration). Click → Rail: that lane tab in the focus
   area; Grid: the detail panel on that lane; single chat view: the full transcript in the main view (or the existing
   sub-agent transcript viewer) with a way back. NO backend work — reuse the frontend sub-agent execution data that
   the nested render uses so it stays live; a real backend need becomes a `TASK_2026_633_21fa` finding. Parity rows
   for every nested-view capability (tool calls, permission prompts inside a sub-agent, errors, results,
   expand/collapse, copy); removals go to the user. Reuse the background-agent tile visual, no new designer pass.
8. **Grid summary tiles are too tall** (row 72). Summary (compact-card) tiles stretch to the full grid row (~700-900 px)
   with mostly empty space; the Grid detail panel opens below the fold. Find the cause (gridstack cellHeight, default
   `h`, compact-card host height, TASK_2026_583 free tile height). Fix: default summary-tile height fits the card; the
   detail panel is visible without scrolling at 1600x1000 and 1280; a user-resized height persists; no layout shift.
   **Cause traced:** `grid-height-trace.md` (auto-card tiles keep the 6-row full height plus the 90 % row floor; the
   detail panel has a 70 % height floor). Recommended: Fix 1 (card height for all tiles above the live budget) + Fix 2
   (detail height = space left). ASK THE USER the two product decisions at its end (may the focused live Grid tile
   shrink — row 43 vs row 72; default card rows 2 or 3) before the plan is final.

Out of scope (row 66, `TASK_2026_653_2931` in the main checkout `.ptah/specs`): left sidebar collapse-to-strip,
Details column resizer, app-wide cursor audit.

## 3. Next steps (in order)

1. **R9 plan.** Ask the user which executor writes it (the user stopped the Claude architect; the orchestrator's
   recommendation: a codex `software-architect` lane, then a Claude sub-agent cross-side review). One prompt with all
   8 items from §2 — do not add items by mid-run messages. Deliverables: `implementation-plan-rail-r9.md` (verified
   contracts, data flow for the dock and the sub-agent tiles, failure cases, file-disjoint batches R9a.. of ≤ 8 files
   with codex lanes and which batches can run in parallel (max 3), named spec cases, updated Electron re-check list)
   and parity rows 45+ in `parity-inventory-layout.md`. Then Gate 2 cross-side review (`implementation-plan-rail-r9-review.md`),
   lane-review mode, revise cap 2.
2. **Team-leader Mode 1** → `batches-rail-r9.md` (or an R9 section in `batches-rail.md`). Codex `frontend-developer`
   lanes per batch; fresh team-leader Mode 2 per batch verifies and commits. The first batch also runs the full test
   suites of the projects it touches (first test run after the merge).
3. **One Claude `code-logic-reviewer`** on the R9 phase diff (Claude reviewing codex); add a style review only for new
   public API. One fix round, then a scoped re-review (orchestration lean rules 3-4).
4. **Rebuild the renderer only:** `npx nx build-dev ptah-electron --parallel=1 && node scripts/copy-wasm.js
   dist/apps/ptah-electron && npx nx copy-renderer-dev ptah-electron --parallel=1` (one heavy job, background, long
   timeout, log to `.ptah/tmp/final-run/build-renderer.log`). No native rebuild while the ABI is unchanged.
5. **Electron re-check.** The user wants to test manually: launch with video (`rm -f ready stop`, then in the
   background `node .ptah/tmp/final-run/launch.mjs "D:\projects\ptah-final-run-ws"`), give the user the step list
   (the plan's re-check list + R9 items), and wait for "done". Then, with the app still open, run the script checks over
   CDP: `s-heap` (0 detached `ptah-canvas-tile` / `gridstack-item` / `ptah-canvas-lane-view`, at most one live ChatView),
   contrast #10 in both themes (include M5), and "after" screenshots `after-r9-{rail,grid}-{anubis,anubis-light}.png`
   (`s-theme`, new `s-board.mjs` with `BOARD=rail|grid`). Note: `s-panels.mjs` TOGGLES the side panels. Show the user
   before/after screenshots. Write a "Re-check" section in `final-run-review.md`.
6. **Ask the user** before `npm rebuild better-sqlite3`.
7. **Team-leader Mode 3** (parity rows 1-44 + the R9 rows, v3 write-path trace, screenshots shown to the user).
8. **Push + PR in ONE background command:** `git push -u origin feat/task-629-canvas-board && gh pr create ...`
   (title < 70 chars, `## Summary` + `## Test plan`, list the recorded-not-fixed items of §6, end with
   `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). The pre-push hook runs di-lint + Electron
   validate-deps; a failed gate needs a fix commit on top, then push again.
9. **When 629 merges:** `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with the
   NEW BL heap result (0 detached `ptah-canvas-tile` / `gridstack-item`, if the R9 run confirms it).

## 4. Rules (repeat in every lane and sub-agent prompt)

- STRICT checks: `npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1
  --skip-nx-cache` (never `--testPathPattern`), then the project once, then `npx nx typecheck|lint <project>
  --parallel=1 --skip-nx-cache`. One heavy check at a time. No workspace-wide runs, no build/serve/dev/e2e/package
  except the Electron re-check, no npm install. Filter output (strip `\x1b\[[0-9;]*m`, grep
  `Tests:|Test Suites:|FAIL `); logs go to `%TEMP%`, never the task folder.
- Do not run git commands in `D:\projects\ptah-final-run-ws` without asking the user.
- Commits: foreground, `.commitlintrc.json` scopes, subject ≤ 72 chars, body ≤ 100 (wrap 72), end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path. Push in the background.
- Lanes: `cli: codex`, `role` as needed, `workingDirectory` = the worktree, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`,
  `deliverables`, `timeout: 1200000`, ≤ 40 tool calls (60 for a multi-defect fix lane). Codex limit state read
  "unknown (limit lookup timed out)" this session; it still worked.
- End each turn with a short summary of what is done and what is left.

## 5. Coordination

- 628 session: see §3 step 9.
- Main checkout `.ptah/specs`: `TASK_2026_653_2931` (backlog, depends on 629) and `TASK_2026_654_7a18` (cancelled,
  duplicate of 629) are untracked there. They are not on this branch.

## 6. Recorded, not fixed — carry to the PR body

- From `handoff-5.md` §2: M5 (state inks 3:1 used as 10-12 px text; dark idle `#6b7280` 3.17-3.83:1, dark run/err on
  `base-300` ~4.1:1 — reopening D13 is the user's call; measure in the re-check), M2, M3 (verify in Electron), M4, M7
  (prove in the re-check), M8, m1-m7, style Moderates 2-5.
- From `code-logic-review-correction.md`: (1) Escape on the only collapsed button is swallowed with `preventDefault`
  although focus does not move (`canvas-rail-keyboard.ts:31-36`, pre-existing); (2) `focusRailSelectButton` uses
  `aria-hidden` ancestry as its visibility signal (`canvas-rail-keyboard.ts:12`); (3) the `+N more` hit area is 16 px
  because its `::after` extension is clipped.
- Follow-up `TASK_2026_653_2931`: sidebar strip, Details resizer, app-wide cursor audit.
