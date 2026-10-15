# TASK_2026_629_c0b3 — HANDOFF (eleventh handoff: all 24 R9 batches + phase fixes committed; user-test changes in the tree)

Worktree W: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
Branch: `feat/task-629-canvas-board` (local only, NOT pushed, no PR). Task folder TF: `W\.ptah\specs\TASK_2026_629_c0b3`.
> File name: this handoff is `handoff-11.md`. NEVER write `HANDOFF.md` (row 91: on Windows it is the same file as the
> tracked `handoff.md`). The next handoff is `handoff-12.md`.

This file REPLACES `handoff-10.md` §1-§4 as the source of truth. Still valid: `handoff-10.md` §5 (rules) and §6
(recorded-not-fixed, extended in §6 below); `handoff-9.md` §5; `handoff-8.md` §3 steps 6-11 (final-run tools, the
628 message text in step 11); `handoff.md` §4 (final-run tools). New decision rows this session: 104-114.

## 1. Goal (unchanged)

Phase R9 of the Orchestra Canvas: replace the Grid board with the Rail board (Rail + focus area), keep the display
dock (row 77), add Rail split focus (rows 80, 82, 83, 85, 86) and Rail reorder. After the batches: phase review
(done), renderer rebuild (done), user Electron test with video (IN PROGRESS: the user sent change requests), re-checks,
team-leader Mode 3, push + PR.

## 2. Committed this session (session 11)

| Commit | Content |
|---|---|
| `61078e201` | R9v (10 paths, incl. FloatingUIService request token, row 103); correction review APPROVE 8/10 |
| `8c9fc364a` | R9w split focus board (8 paths); review 5/10 -> fix round -> 6/10 -> correction (row 105) -> 6/10; C1-C3 routed to R9x (row 106) |
| `4cf6d4f83` | R9x header split actions, swap, stacked Tab order, R9w C1-C3 fixes (8 paths); codex 6/10 -> fix (row 107) -> APPROVE 8/10. **24/24 batches** |
| `201175e0e` | Phase fixes (row 108/109): Fix A Rail card split selection (APPROVE 8.5), Fix B conductor tile keeps the display dock (correction APPROVE 8) |
| `1a2f6bc74`, `916c0685f`, `b9b2bf678`, `1548dde46` | docs commits (TF) |

Mode 2 at `201175e0e` (`mode2-phase-fix-report.md`): canvas 23 suites / 334 tests, chat 3728 pass / 2 skipped,
tribunal-panel 17 / 336; typecheck 0 errors; lint 0 errors (warnings canvas 28, chat 40, tribunal 0).
Phase reviews: `code-logic-review-R9-phase.md` 6/10, `codex-review-R9-phase.md` 6/10, `code-style-review-R9-phase.md`
7/10. Named later task "R9 cleanup follow-up" (row 108): ~650 lines of dead Grid code (`canvas-layout-intent.ts`,
store `commitDragIntent`/`toggleLayoutFocus`) + style F1-F5 (board 815 lines / max-lines, RAIL_MIN_CONTENT_WIDTH
location, cap 4 written twice, repeated 360/400/1440 literals, hand-rolled header menu).

Renderer rebuilt after `201175e0e` (`W\.ptah\tmp\final-run\build-renderer.log`, exit 0). App launched with video:
`node launch.mjs "D:\projects\ptah-final-run-ws"` from `W\.ptah\tmp\final-run` (log `launch-r9.out`, videos in
`video\`). If that process still runs, `touch W\.ptah\tmp\final-run\stop` finalizes the video; if the session that
started it ended, the last video may be incomplete — relaunch for the next test.

## 3. Working tree state at handoff (IMPORTANT: NOT clean on purpose)

HEAD = the docs commit that adds this file. Three user-requested changes from the manual test are UNCOMMITTED in
`libs` (22 paths). Do not stash, restore or reset them. `git status --short libs apps` must show exactly these:

| Change (row) | Paths (under `libs/frontend/`) | State |
|---|---|---|
| **C-card** (rows 110, 111): Session actions ⋮ inside the card at the top-right, card full width; focused card highlight in both themes | `canvas/.../canvas-rail/canvas-rail-card.component.ts` + `.spec.ts`; `chat-ui/.../compact-session/compact-rail-card.component.ts` + `.spec.ts`; `chat/.../molecules/compact-session/compact-session-card.component.ts` (one-line input passthrough) | writer done (`lane-rail-actions-inside-report.md`); codex review `codex-review-rail-actions-inside.md` **APPROVE 8/10** (visual check left) |
| **C-dedupe** (row 112, user chose "bug + dedupe now, tiles later"): Electron display dock shows Displays only (Agents tab, badge, count, auto-open, monitor removed in every host); Rail sub-agent click -> `CanvasDetailService.open` | `chat/.../organisms/display-dock/display-dock.component.ts` + `.spec.ts`; `chat/.../templates/chat-view.component.ts`, `.html`, `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`; `chat/.../organisms/transcript/chat-transcript.component.spec.ts`; `chat/.../tokens/session-context.token.ts`; `tribunal-panel/.../conductor-tile.component.ts`; `canvas/.../canvas-detail/canvas-detail-transcript.component.ts` + `.spec.ts` | writer codex (`lane-agents-dedupe-report.md`); Claude review `code-logic-review-agents-dedupe.md` **REVISE 6/10** -> fix round NOT started |
| **C-headers** (row 113): split pane divider + gap, inset primary bar on the active header, quieter inactive header, 1/2 markers that follow Swap | `canvas/.../canvas-rail/canvas-focus-header.component.ts` + `.spec.ts`, `canvas-focus-area.component.ts` + `.spec.ts`, `canvas-rail-board.component.ts` + `.spec.ts` | writer done (`lane-split-headers-report.md`): header 18/18, focus area 10/10, **board 71/74 (3 failures, writer says caused by C-card)**; review NOT started. Deviation: active title stays in base text color (text-primary contrast 3.6:1 dark / 1.5:1 light) |

## 4. Open decisions and problems

1. **USER DECISION FIRST (C-dedupe review finding 2, Serious):** with the dock Agents tab removed, the Electron
   single chat view (canvas hidden) has no place that shows CLI agents and their **permission requests**. Ask the user
   (one AskUserQuestion) with options, e.g. (a) show CLI-agent rows + permission asks inline in the single chat
   transcript/main view now, (b) keep the dock Agents tab ONLY in the single chat view until the tile redesign,
   (c) accept the gap until the tile redesign (not recommended: a permission ask can be unanswerable).
   Evidence: `code-logic-review-agents-dedupe.md` finding 2 (files `chat-view.component.html/.ts`, `chat-view.dock.spec.ts`).
2. C-dedupe finding 1 (Serious): the "Workflow launched" chip (`chat/src/lib/components/organisms/execution/workflow-card.component.ts:56-66,109`,
   "Agents" + panel-right-open icon, probably the user's click) is a dead click in Electron. Reviewer Option A
   (recommended): make it static in Electron (no button, accessible label). Moderates 3 (silent no-op for an unknown
   Rail lane) and 4 (two vacuous negative assertions); Minor 5 (doc residue). See the review for file:line.
3. C-headers: 3 board spec failures (`canvas-rail-board.component.spec.ts`), attributed to C-card. Find the cause
   (probably the card's DOM change: gutter removed / new focused class) and fix in the spec or the card, in the
   C-card/C-headers fix round.
4. **Row 114 (user request, NOT started):** the CLI-agent and sub-agent lane views must show the same session stats
   strip as the main session header (chips MODEL, CONTEXT, TOKENS, COST, TIME, same component and style), not the
   current `codex completed` / `ctx —` / arrow token rows (user screenshot of a codex lane in the focus area).
   Find the main stats strip component (chat) and reuse it in the lane view (`canvas-lane-view` / inline agent bubble
   full mode, R9f) for `cli:`, `bg:`, `sub:` lanes. Writer Claude frontend-developer, review codex.
5. Follow-up tasks to create after 629 (not in this PR): agents/sub-agents as tiles with CLI provider icons in the
   main view (row 112; designer + prototype + Gate 1.7 first); "R9 cleanup follow-up" (row 108).
6. Reviewer lanes with role `code-logic-reviewer` write `code-logic-review.md` by their role contract. One did and
   overwrote the tracked earlier review (restored from HEAD). Every reviewer brief must say: write ONLY the named
   deliverable, never `code-logic-review.md`.

## 5. Next steps (in order)

1. **Gate 0.1**: `ptah_agent_list`; record rows in `context.md`. Do not touch codex lanes from other tasks.
2. **Ask the user** decision §4.1 (one AskUserQuestion; include §4.2 Option A as the stated default, no second question).
3. **One fix round, file-disjoint writers in parallel (max 3 lanes), each then a scoped cross-family re-review:**
   - Fix D (codex lane, C-dedupe family): §4.1 per the user answer, §4.2 Option A, Moderates 3-4, Minor 5.
     Re-review: Claude `code-logic-reviewer`.
   - Fix H (Claude frontend-developer): §4.3 board spec failures + the row-114 lane stats header. Then the FIRST
     review of C-headers + row 114: codex lane (C-headers has had no review yet).
   - C-card needs no fix round (APPROVE 8/10) unless §4.3 needs a card change.
   Findings after the re-reviews: at most one bounded correction each, then recorded (agent-lanes §6).
4. **One fresh team-leader Mode 2 (no commit, row 95)** on all changed paths: FULL + typecheck + lint for
   `@ptah-extension/canvas`, `@ptah-extension/chat`, `@ptah-extension/chat-ui`, and the tribunal-panel project
   (name in its `project.json`), one project per command, serial, through the lock. Baselines: canvas 23/334,
   chat 3728/2 skipped, tribunal 17/336; lint 0 errors.
5. **Commit** in the foreground (orchestrator, no writer running), explicit paths, scopes from `.commitlintrc.json`
   (`canvas`, `chat`, `chat-ui`, `tribunal-panel` exist; multi-scope allowed), subject <= 72, body lines <= 72,
   ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Split into logical commits if clearer
   (card / dedupe / headers+stats). Then a `docs(canvas)` commit of TF.
6. **Renderer rebuild** (background, through the lock, log `.ptah/tmp/final-run/build-renderer.log`):
   `node .ptah/tmp/check-run.mjs r9-renderer -- sh -c "npx nx build-dev ptah-electron --parallel=1 && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev ptah-electron --parallel=1"`.
7. **Relaunch for the user test** from `W\.ptah\tmp\final-run`: `rm -f ready stop`, then in the background
   `node launch.mjs "D:\projects\ptah-final-run-ws"` (wait for the `ready` file). Give the user the step list
   (`handoff-10.md` test list as sent in session 11 + the new checks: ⋮ inside the card, focused highlight light/dark,
   dock Displays only, sub-agent click opens the lane, Workflow chip, split headers 1/2 + divider + active accent,
   lane stats header like the main one). Wait for "done". Then `touch stop`.
8. **After "done"** (`handoff-8.md` step 7): `s-heap` (0 detached `ptah-canvas-lane-view` / `ptah-canvas-detail-transcript`
   / `chat-msg-slot`, no Grid DOM, <= 1 live ChatView in the board host, <= 2 with split), contrast #10 both themes
   incl. M5 and the new focused-card and active-header colors, `TAG=after-r9 node step.mjs s-switch.mjs` vs
   `switch-baseline.md`, screenshots `after-r9-rail-{anubis,anubis-light}.png` via `s-theme` (before/after shown to
   the user, incl. before/after of the split headers and the card), "Re-check" section in `final-run-review.md`.
   Ask before `npm rebuild better-sqlite3` and any package.json change.
9. **Team-leader Mode 3** (parity rows 1-124 + the row-112 approved removal, persistence write-path, screenshots).
10. **Push + PR in one background command** (`git push -u origin feat/task-629-canvas-board && gh pr create ...`),
    title < 70 chars, `## Summary` + `## Test plan`, recorded-not-fixed list (§6 here + `handoff-10.md` §6 +
    `handoff-9.md` §5 + `handoff-8.md` §5 + `handoff-6.md` §6), Grid removal, user-approved removals (rows 80, 83,
    86, 112), body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. A failed pre-push gate
    needs a fix commit. Report the PR link.
11. **When 629 merges**: `SendMessage` to the 628 session (text in `handoff-8.md` §3 step 11).

## 6. Recorded-not-fixed (add to the PR body)

- R9v correction: `native-dropdown` emits `opened` after a cancelled position (pre-existing,
  `native-dropdown.component.ts:203-215`).
- R9w: Minors 1, 3-6 (`code-logic-review-R9w.md`); NEW-5, NEW-7, M1 repeat write failure needs a persistence-service
  counter, M4 real A->B subtree case (`code-logic-review-R9w-fix.md`); C4, C5 (`code-logic-review-R9w-correction.md`).
- R9x: canvas lint +12 warnings incl. `max-lines` on `canvas-rail-board.component.ts` (-> R9 cleanup follow-up).
- Phase: logic F4-F8, style F6-F12, fix A re-review Minors 1-3; fenced-display parse path in the conductor not
  proven by a spec (visual re-check covers it).
- Named later tasks: "R9 cleanup follow-up" (row 108); agents as tiles with provider icons (row 112).

## 7. Decisions this session (rows 104-114, `decisions.md`)

104 R9w fix scope · 105 R9w bounded correction, NEW-3 to R9x · 106 R9w committed, C1-C3 to R9x · 107 R9x fix scope ·
108 phase fix scope (A card/board, B conductor dock; F3 + style -> later task) · 109 fix B correction (hide dock
Agents under the token; superseded by 112) · 110 ⋮ inside the card, full width (user) · 111 focused card highlight
(user) · 112 agents once in the main view, sub-agent click fix, tiles later (user) · 113 split pane headers (user) ·
114 lane stats header like the main one (user, not started).

## 8. Key files

TF: `batches-rail-r9.md` (all 24 batches COMPLETE), `decisions.md`, `context.md`, `implementation-plan-rail-r9-split.md`,
`parity-inventory-layout.md`, `switch-baseline.md`, `final-run-review.md`, reviews `code-logic-review-R9*.md`,
`codex-review-R9*.md`, `code-style-review-R9-phase.md`, `code-logic-review-agents-dedupe.md`,
`codex-review-rail-actions-inside.md`, reports `lane-R9*-report.md`, `lane-rail-actions-inside-report.md`,
`lane-agents-dedupe-report.md`, `lane-split-headers-report.md`, Mode 2 reports `mode2-h{5,6,7}-report.md`,
`mode2-phase-fix-report.md`. Tools: `W\.ptah\tmp\check-run.mjs` (machine-wide lock; logs `%TEMP%\629-check-<label>.log`),
`W\.ptah\tmp\final-run\` (`launch.mjs`, `s-*.mjs`, `step.mjs`).

## 9. Rules (repeat in every lane and sub-agent prompt)

- Every check through `node .ptah/tmp/check-run.mjs <label> -- <command>` from W. Writers: only their `--testFile`
  specs (`npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`,
  never --testPathPattern). Mode 2: FULL, then TC and LINT with `--parallel=1 --skip-nx-cache`.
- One heavy check at a time. No workspace-wide runs, no build/serve/dev/e2e/package except the renderer rebuild, no
  npm install. Filter output.
- Writers/reviewers never run state-changing git and never revert another writer's change. No git in
  `D:\projects\ptah-final-run-ws` without asking the user. Ask before `npm rebuild better-sqlite3` and any package.json change.
- Row 95: no commit while a writer edits W. Commits foreground, push background.
- Lanes: `cli`, `role`, `workingDirectory` = W, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`, `deliverables`,
  `timeout: 1200000`, <= 40 tool calls; max 3 CLI lanes; codex has room (weekly ~23%); opencode near its monthly
  limit (91%); glm/grok/antigravity not for shipping code. Cross-family review for every change (row 79).
- Reviewer briefs: write ONLY the named deliverable, never `code-logic-review.md` (§4.6).
- Keep the display dock (row 77) and Rail split focus (rows 80, 82, 83, 85, 86).
- End each turn with a short summary of what is done and what is left.
