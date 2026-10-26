# HANDOFF — chat layout declutter (Electron)

Worktree: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter`
Branch: `feat/chat-layout-declutter` (base `main`). **Not pushed. No PR yet.**
Task folder: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/.ptah/specs/chat-layout-declutter/`

## Goal (user request)
Declutter the Electron chat layout:
1. No duplication between the chat header and the right stats sidebar ("Session details").
2. The avatar agent strip (orchestrator pill + avatars + "N agents ›") replaces the vertical Agents list.
3. ACTIVE SUBAGENTS section in the sidebar; passive per-lane CONTEXT/TOKENS/COST removed from the chat area.
4. 56px compact stats rail (like the left session rail) showing only small stat tiles.
5. Quiet empty states for unknown usage (single `—`, "Usage unavailable" once).
6. Wider chat column: 1100px (user-chosen), centered, full height.
Revision 2 (user feedback after screenshots) — see `design-spec.md` `## Revision 2`, items 1–9:
title + strip shown ONLY in the sidebar at every width; chat header row removed (controls to the
sidebar top bar / rail; split panes get a floating control group); rail shows active agents'
avatar icons with tooltip, click expands + selects; expanded strip wraps to 2 rows with the
"agents" label; overlay sheet when chat pane < 560px; fix lane-usage mismatch; "Hand off" button
style; lane detail rebuilt with DaisyUI `collapse` + `table table-xs` (item 9).

## Done
- Spec: `design-spec.md` (approved by user "as written", width 1100px; Revision 2 appended),
  `parity-inventory.md`, spec review `design-spec-review.md` (APPROVED after 1 revise round).
- Implementation batches A–E (reports `batch-*-report.md`), code review `code-logic-review.md`
  (REVISE) → `fix-round-1-report.md`, `fix-round-2-report.md` → final review
  `code-logic-review-final.md` **APPROVED 8/10** (reviewer Glm; implementers codex/Glm/Claude).
- Verify after round 2: chat-ui 1591/1591, chat 4706 (+2 skipped), canvas 480/480 tests pass;
  typecheck pass in all 3. chat lint failed only on a pre-existing `main` problem (fixed below).
- Commits on the branch:
  - `13f2a6233 fix(chat): exempt shared from the lazy-import boundary check` — `eslint.config.mjs`
    `checkDynamicDependenciesExceptions` += `@ptah-extension/shared`. Cause: main commit
    `89d2d6720` lazy-imports `@ptah-extension/shared/mcp-apps-contracts`, so the project-granular
    rule rejected every static `shared` import in chat and the pre-commit lint gate failed.
    **Mention in the PR body.**
  - `103db1a1e feat(chat,chat-ui,canvas): declutter the chat layout and stats sidebar`
  - `f9f43dc49` merge of `origin/main` (PR #828: 2-slot verify lock with memory gate).
- First visual review (before Revision 2): `visual-review.md`, screenshots in
  `screenshots/after/` (PNG files are git-ignored; user's "before" shots: `screenshots/1-5.png`).

## In progress at handoff
- Codex lane `385ef119-8fee-42e9-92f8-03506d2d2ea9` (CLI session `01a17892-f4ac-7ba1-a4a1-3dd4b718ff42`)
  implemented Revision 2 items 1–8 (one turn) and was then STOPPED at handoff. Nothing is
  running now. Its changes are UNCOMMITTED in the worktree. See "Lane result" below.

## Lane result (Revision 2 — INCOMPLETE, UNCOMMITTED)
Lane `385ef119…` finished its first turn, then was STOPPED by the orchestrator at handoff before
its queued item-9 turn started. Report: `revision-2-report.md`. 18 files modified, uncommitted
(canvas focus-header/focus-area/inspector-dock/rail-board/lane-tabs/agent-dock-card + specs;
chat session-inspector.html + spec, `services/session-stats/session-stats-source.ts` + spec;
chat-ui `lane-tiles.ts`, `stats-limit-view-model.types.ts`).
- Items 1–8 implemented per the report; item 9 (DaisyUI lane detail) NOT started.
- Item 7 root cause (fixed): the session-inspector mapper forwarded only structured
  `agent.usageTotals`; agent cards fall back to `usageTotalsFromSegments`. The mapper
  (`session-stats-source.ts:88`) now uses the same fallback, keeping the partial marker.
- Last verify (14:41 UTC): chat-ui PASS (1591); chat tests/typecheck PASS (4708, 2 skipped), chat
  lint FAIL only in 2 untouched pre-existing files; **canvas tests FAIL 16/467**.
- After that run the lane changed the default dock-open threshold to 1200px board width to break a
  reactive cycle (dock-open ↔ effective left-rail width) and fixed the 900px overlay test. NOT
  retested. Remaining failures per the report: old narrow-breakpoint defaults in board specs,
  missing compact expand control, no dialog after closing split Details with the new overlay.
- `canvas-rail-board.component.ts` is 1237 lines (cap 1241).
- Do not trust the report: read the diff (`git diff -- libs/`) before continuing.

## Open problems / decisions
- Revision 2 item 7: the sidebar lane card shows usage (tokens/$) while Lanes rows, Known subtotal
  and Session Cost show `—`. Also on `main`. Lane was asked to find the root cause; check the report.
- Pre-existing, out of scope (list as PR follow-ups): light-theme "Review changes" contrast 1.97:1
  (Git panel); white artifacts beside workspace tabs in light theme; 2 other chat lint errors in
  unchanged files (`attention-context.util.ts`, `chat-attention-source.service.ts`).
- Lane-runtime follow-ups for the user (not started; user has not decided):
  1. A lane that fails with a quota error (`429 RESOURCE_EXHAUSTED`, antigravity this run) stays
     "unknown (reader failed)" in `ptah_agent_list`; it should become AT LIMIT with the reset time.
  2. A lane (fix round 1) spawned its own helper lanes in the same worktree; the agent-lanes
     contract says only the coordinator decides parallel writers.
  3. agent-lanes SKILL §1 wording: make clear that "unknown" lanes are eligible.
- Lane limits this run (`context.md`): antigravity exhausted until ~2026-10-27 00:11 UTC;
  opencode AT LIMIT until 2026-11-04. codex had confirmed room (~24% weekly used).

## Key files
- canvas: `libs/frontend/canvas/src/lib/canvas-rail/{canvas-focus-header,canvas-focus-area,canvas-rail-board,canvas-inspector-dock}.component.ts`,
  `canvas-detail/{canvas-lane-tabs,agent-dock-menu,canvas-lane-view}.component.ts`, `dock-overflow.ts`
- chat: `components/organisms/session-inspector/{session-inspector.component.ts,.html,inspector-agents-section.component.ts}`,
  `services/session-inspector/{inspector-open-state.service,inspector-dock-width}.ts`,
  `components/molecules/execution-header/execution-header.component.ts`, `agent-card`, `subagent-lane`,
  `templates/{chat-session-layout.component.ts,chat-view.component.html,chat-content-width.spec.ts}`
- chat-ui: `molecules/session/{session-stats-view.ts,inspector-stats/*,plan-limits/{lane-tiles,plan-limit-tiles,lane-usage-tile,lane-subtotal-tile,plan-limit-tile}*}`,
  `molecules/agent-lane-stats/agent-lane-stats.component.ts`
- Rule: `canvas-rail-board.component.ts` must stay ≤ 1241 lines (its size on main).

## Next steps
1. Read `revision-2-report.md`; inspect `git diff -- libs/` (encoding of `— · ≥ ‹ ›` must stay
   UTF-8; LF). Check that no header row remains in single/split view and that title + strip render
   only in the sidebar.
2. Fix the canvas test failures (and behavior where the spec is right), then implement Revision 2
   item 9 (DaisyUI lane detail; files `chat-ui/.../plan-limits/{lane-tiles.ts,lane-usage-tile.component.ts,
   lane-subtotal-tile.component.ts}`, `inspector-stats/inspector-limits-lanes.component.ts`).
   Options: resume codex CLI session `01a17892-f4ac-7ba1-a4a1-3dd4b718ff42` (likely starts fresh with a
   handoff brief — give full instructions, forbid sub-agents) or an in-process `frontend-developer`.
   The two chat lint errors in `attention-context.util.ts` / `chat-attention-source.service.ts` are
   pre-existing on main and outside scope (CI does not run ESLint; the pre-commit hook lints staged
   files only).
3. Verify (from the worktree root, foreground, long timeout):
   `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`
   Header must say lint, test, typecheck for 3 projects.
4. Independent code review of the Revision 2 diff by a family other than codex (in-process Claude
   `code-logic-reviewer` subagent or the Glm ptah-cli lane `pc-355b645d-35af-4974-84cf-9cf961ea0164`).
   Max 2 revise rounds.
5. Commit (foreground; stage by explicit path; scopes `chat`, `chat-ui`, `canvas`; Co-Authored-By line).
6. Rebuild and relaunch Electron (user approved dev start for screenshots), each build under the lock:
   `node scripts/verify.mjs --exec --task electron-build-dev -- npx nx build-dev ptah-electron --output-style=static`
   `node scripts/verify.mjs --exec --task electron-renderer -- npx nx copy-renderer-dev ptah-electron --output-style=static`
   `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9334` (background)
7. Visual review (`visual-reviewer` subagent, Playwright `connectOverCDP('http://127.0.0.1:9334')`,
   read-only on user data, dark `anubis` + light `anubis-light`, restore `night`): wide expanded,
   wide compact rail (active-agent icons), split view floating controls, 900px and 400px, lane
   detail table. Show the screenshots to the user and get their OK.
8. Push in the background and open the PR against `main`
   (title < 70 chars, `## Summary` + `## Test plan` with real results, list pre-existing follow-ups,
   end with the Claude Code attribution line). Watch CI and reviews with `gh`; fix confirmed findings.
9. Keep the worktree and branch until the user authorizes cleanup.
