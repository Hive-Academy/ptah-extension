# Handoff: TASK_2026_629_c0b3 — Orchestra Canvas mission board

Date: 2026-10-13 (third handoff). Branch: `feat/task-629-canvas-board` (local only, NOT pushed).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Base: `origin/main` `736b0ad84` (TASK_2026_628 merged). HEAD: see `git log -1` (handoff commit on top of `f3a12f3f7`).

## 1. Where we are

The final Electron run is done; its fix round is committed and reviewed. The user then asked for a new
board layout **inside 629, before the PR**: the "Rail" mode. The Rail design is at **revise round 1 of 2**
(designer revision done or in flight — see §3 step 1). The user stopped the session here and said the Rail
screenshots "look awesome". That is positive feedback, NOT the Gate 1.7 approval: the gate still runs on
the revised design.

## 2. User decisions this session (decisions.md rows 40-46 are the source of truth)

- F1 (row 42): Claude sessions have no `TodoWrite` tool → honest label "Todos not reported by this session"
  (committed `cb00c04fb`). A todo source for Claude sessions (e.g. `ptah_task_*` calls) is a LATER task.
- Layout (rows 43-44): card tiles kept full height because AC 1.4 / D1 forbid geometry changes on focus.
  New default board mode **"Rail"**: fixed slots — a rail of fixed-height cards (176 px) + one focus area
  (focused session live, lane tabs in its header) + details column. Focus swaps content; card order and
  height never change. Rail from the FIRST session (overrides task-description.md:223 for Rail mode).
  Today's Gridstack board stays as **"Grid"** mode behind a toggle → NO removals. Base prototype:
  `prototypes/02-focus-rail.html` (was "rejected" at task-description.md:76; now chosen).
- better-sqlite3 (row 42): rebuild for Node only AFTER the Electron re-check run, and ask the user first
  (`npm rebuild better-sqlite3`; node_modules is a junction to the main checkout). It is still on the
  Electron ABI now: backend Jest that loads better-sqlite3 fails until then; frontend Jest is fine.
- Standing rules: do not run git commands in `D:\projects\ptah-final-run-ws` without asking. Push + PR at the
  end (global CLAUDE.md). Notify the 628 session when 629 merges (§6).

## 3. Next steps (in order)

1. **Designer revision 1.** Check `layout-design-spec.md` for a `## Revision 1` section and the prototype
   for the fixes listed in `layout-design-spec-review.md` findings 1-10. If the section is missing or the
   files look half-edited, re-run the designer (subagent `ui-ux-designer`) with the findings (the prompt is
   in decisions row 46 + the review). Render the prototype yourself:
   `node .ptah/tmp/final-run/proto-rail-shots.mjs "<abs path to prototypes/02-focus-rail.html>"` (from
   `.ptah/tmp/final-run/`; writes `shots/rail-*.png`; prints script errors). Check 9/12 sessions (chips on one
   line), 920 px (git `+a −d` both visible), dark + light.
2. **Re-review (round 1 pair close).** Resume the codex reviewer: `ptah_agent_spawn` with `cli: codex`,
   `role: code-logic-reviewer`, `resume_session_id: 01a13335-f4ac-7851-9f69-e0293909d886`, task "Re-review
   the revision; write layout-design-spec-rereview.md" (read-only, deliverable declared). If REVISE: one more
   round (round 2 of 2), then the gate goes to the user with every open item.
3. **Gate 1.7 (user, mandatory — redesign + AC changes).** Show the rendered screenshots (dark + light),
   who wrote/reviewed, verdict, and ask the open questions in ONE AskUserQuestion: Q2 dense 96 px card mode at
   12+ sessions (designer/reviewer recommend: one density now), Q4 "Send to messaging" placement (proposal:
   focus-header overflow menu), Q5 close button on non-focused cards (recommend: defer). Also confirm the
   designer decisions: stable oldest-first order with jump chips instead of groups, `role="list"`, 176 px
   cards, lighter dark error red.
4. **Architect plan** (`software-architect` subagent): `implementation-plan-rail.md` covering the v3 layout
   record (per-workspace `boardMode`, default Rail for v1/v2, Grid tile intent preserved, `railCollapsed`,
   no write before hydration, future version read-only — `canvas-layout-persistence.service.ts:29-51,179-209,
   265-283`), one live ChatView + lane panel in Rail with per-tab lane selection
   (`canvas-detail.service.ts:9-41`, `orchestra-canvas.component.ts:232-251`), injector cleanup, BL leak
   guarantees, the cap of 9, parity rows 1-44 (`parity-inventory-layout.md`), and the carried review items
   from row 45 (#1 sort ended lane rows by `endedAt` desc, #2 per-session lane selection / value equality).
   Cross-side review of the plan by codex → Gate 2 (lane-review mode: APPROVED passes with a notice).
5. **Team-leader decomposition → batches on codex lanes** (`role: frontend-developer`), one lane with checks
   at a time, commit per batch after scoped checks; one code-logic review per phase (Claude subagent,
   cross-side of codex code); one fix round.
6. **Electron re-check run** (rebuild needed — §4): Rail + Grid in dark + light; rerun `s-draft3.mjs` (F5 must
   pass: draft survives a card/focus swap), F6 selection, F7 queue Escape vs detail Escape (row 45 #8), F3
   sub-agent lanes on cards, no-shift (card positions before/after focus change, new session, state change),
   cap of 9 text, BL heap check (`s-heap.mjs`). Update `final-run-review.md` (add a "Re-check" section).
7. Ask the user, then `npm rebuild better-sqlite3` (main checkout).
8. Push + PR in the background: `git push -u origin feat/task-629-canvas-board && gh pr create …`
   (title < 70 chars, `## Summary` + `## Test plan`, end with the Claude Code line). Pre-push hook runs
   di-lint + Electron validate-deps. Then tell the 628 session (§6).
   B9 perf record stays with the user (needs a `main` build + 6 streaming sessions × 3 runs).

## 4. Final-run tools (git-ignored, `.ptah/tmp/final-run/`)

- `launch.mjs <workspace>`: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs`, video
  1600x1000, CDP port 9333; writes `ready`; creating `stop` closes the app and finalizes the video. Run it in
  the background: delete `ready`, `node launch.mjs "D:\projects\ptah-final-run-ws"`.
- `step.mjs <step.mjs> [shot]`: one step over CDP, saves `shots/<shot>.png`, prints JSON.
- Steps: `s-theme` (`THEME=anubis|anubis-light`), `s-new` (`NAME=`; uses the header New Session button),
  `s-send` (`TILE= TEXT= WAIT=`), `s-look`, `s-probe`, `s-eval` (`JS=` body returning a value), `s-click`
  (`SEL=`), `s-open` (`TILE= DY= KEYS=`), `s-keys` (`KEYS=`), `s-draft3` (F5), `s-select2` (F6),
  `s-backdrop` (F7), `s-heap` (`TAG= TILE_CLOSE=`; counts detached `<ptah-canvas-tile>`/`<gridstack-item>`),
  `s-compact`, `s-subtab`, `s-lane`, `s-qallow`, `s-allow`, `s-mode`, `s-panels` (collapse side panels),
  `s-scroll`. `proto.mjs <html> [name]` renders a prototype; `proto-rail-shots.mjs` renders the rail states.
- The dist build is from `06c1f09cb` — it does NOT include `3aa592e66` / `cb00c04fb` or any Rail code.
  Rebuild before the re-check: `node apps/ptah-electron/scripts/rebuild-native.js && npx nx build-dev
  ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev
  ptah-electron --parallel=1`.
- Videos: run 2 `video/page@e947e5722591367a3827bd447ee2795b.webm` (complete); run 1 in `video/run1/`.
- Dev profile `%APPDATA%/Ptah Dev`; Claude CLI works there. The scratch workspace now has S1-S4 sessions,
  `perm.txt`, a disabled autopilot (Manual mode) and the Anubis dark theme. Real turns cost money: keep
  prompts very short. Close side panels first (`s-panels.mjs`) — with them open the canvas is ~920 px.

## 5. Open items carried (do not lose)

decisions.md rows 10, 11, 14, 18, 19/21, 24, 25, 26, 30, 31, 33, 37-39 (see the second handoff list in git
history), plus this session: F2 git metric is folder-wide incl. Ptah harness files (later: title + harness
gitignore), F8-F12 Minors (`final-run-review.md`), row 45 Moderates #1/#2 (into Rail batches), #4 (F5 live
proof), #8 (Escape), row 46 Part B caveat (explicit empty TodoWrite reads "not reported"), todo source for
Claude sessions (later task), cap of 9 / "+N more lanes" / Deny not run live.

## 6. Coordination

- Notify session `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x` with `SendMessage`
  when 629 merges (TASK_2026_645 M-final measurement is blocked on 629). BL heap result from this run:
  0 detached `ptah-canvas-tile` / `gridstack-item` after closing a tile — send it with the merge notice.

## 7. How to run lanes and checks

- Load the `orchestration` and `agent-lanes` skills first.
- `ptah_agent_spawn`: `cli: codex`, `role` as needed, `workingDirectory` = the worktree, `taskFolder:
  .ptah/specs/TASK_2026_629_c0b3`, `deliverables: [...]`, `timeout: 1200000`, ≤ 40 tool calls (60 for a
  multi-defect fix lane). Resumes above 60k tokens: start fresh with full instructions.
- Checks (STRICT, repeat in every prompt): `npx nx test <project> --testFile=<spec> --coverage=false
  --maxWorkers=2 --parallel=1 --skip-nx-cache` (never `--testPathPattern`), then the project once, then
  `npx nx typecheck|lint <project> --parallel=1 --skip-nx-cache`. One heavy check at a time; no workspace-wide
  runs, no build/serve/dev/e2e/package except the Electron re-check, no npm install. Filter output: Jest
  summary lines carry ANSI codes — redirect to a file and `grep -aE "Tests:|Test Suites:|FAIL "` after
  stripping `\x1b\[[0-9;]*m`.
- Last check results (after `cb00c04fb`): canvas 26/326, chat-ui 70/1115, chat 200/3628 (+2 skip);
  typecheck pass x3; lint 0 errors x3.
- Commit in the foreground (`type(scope): subject`, end with `Co-Authored-By: Claude Opus 5.5
  <noreply@anthropic.com>`); push in the background.
