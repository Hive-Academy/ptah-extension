# HANDOFF — chat layout declutter (Electron) — session 4

Worktree: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter`
Branch: `feat/chat-layout-declutter` (base `main`).
PR: **#829 (DRAFT)** https://github.com/Hive-Academy/ptah-extension/pull/829 — remote head `f0c7f4435`.
Local head `9e14549fa` (1 commit NOT pushed) + uncommitted work (see In progress).
Task folder: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/.ptah/specs/chat-layout-declutter/`

## Goal
Declutter the Electron chat layout (no duplication between chat area and the right "Session
details" stats sidebar, wider centered chat, compact 56px stats rail, quiet empty states,
overlay sidebar when chat < 560px, compact sheet when board < 400px). Full history:
`design-spec.md` (`## Revision 2`, items 1–10 with dated decision notes).

User decisions made in sessions 3–4 (all recorded in design-spec.md Revision 2):
1. No top bar / icon row in the expanded sidebar.
2. **Session actions live ONLY in each session card's `⋮` "Session actions" menu in the LEFT
   Sessions sidebar**: Switch compact/full view, Hand off session…, Stop session (only while
   running), Close session — acting on that card's session. Right sidebar keeps only the
   expand/collapse control (sheet collapse uses `PanelRightClose`, not X). Split panes keep a
   "Pane actions" `⋯` menu: Swap panes, Close pane, Close split.
3. **Stats layout "B+"** (user: "i like it"): SESSION totals row `Context │ Tokens │ Cost` with
   vertical dividers (no bordered tiles, ⓘ replaced by dotted-underline label tooltips); one
   AGENTS list (provider avatar + status badge, name + type, status, tokens, cost; running first;
   "Show N more"); the selected row expands in place into a dock detail (Context, In/out,
   Turns or Duration, "Open thread →"); no in-flow hover card, no "N agents" chip, no ACTIVE
   SUBAGENTS block. Mockup: `prototype/stats-ideas.html` (leftmost column "B+").
4. Do not raise the 4.00 MB webview initial budget without the user's OK.

## Done (commits on the branch)
- `13f2a6233`, `103db1a1e`, `f9f43dc49`, `27ab89ef7` — earlier sessions (first pass, Revision 2).
- `a1b66af03` fix(chat,canvas,e2e): fit the bundle budget and put controls in title row —
  rail inspector in `@defer (on immediate)`; e2e moved to Revision 2 UI; focus fixes. Pushed.
- `f0c7f4435` fix(canvas,chat): keep the details overlay inside the board — overlay/sheet
  `absolute` inside the board box (were `fixed`, covered by top bar / Git rail); menu widths;
  composer toolbar wraps in narrow columns. Pushed. **CI on f0c7f4435: all green** (19 pass,
  electron-e2e-perf skipped as usual).
- `9e14549fa` feat(canvas,chat,e2e): move session actions into the session card menu —
  **local only, not pushed.** Verify passed (tests/typecheck all projects; only known lint errors).
- Reviews (Glm / Ollama Cloud, implementers Claude): `code-logic-review-rev3.md` →
  `-rev3-fix.md` APPROVED; `-rev4.md` APPROVED; `-rev5.md` (of 9e14549fa) APPROVED 8/10 with
  5 minor findings — fixed in the working tree, fix not yet re-reviewed.
- Visual reviews: `visual-review-rev2.md` (rejected overlays → fixed), `visual-review-rev3.md`
  (pass at 1600/900/800px; 400px unreachable because `main-window.ts` minWidth is 800).
  Screenshots are git-ignored (`.ptah/specs/**/*.png`): `screenshots/rev2/`, `screenshots/rev3/`.
  These screenshots predate the card-menu and B+ changes.

## Session 5 status
A+B committed after a combined verify (only known lint errors), webview Initial total 3.92 MB,
and review by codex: `code-logic-review-rev6.md` REVISE 7/10 (background usage lost, stale
collapse state, "Show 0 more") → fixed in `inspector-agents-section.component.ts` (+4 tests) →
`code-logic-review-rev6-fix.md` APPROVED 9/10. Remaining: push, CI, visual review, PR ready.

## Was in progress (now committed)
A. **Rev5 fixes** (card/pane menus): shared roving keys `canvas-rail-keyboard.ts`
   (`focusMenuItem`, `handleMenuKeydown`) used by `canvas-rail-card.component.ts` and
   `canvas-focus-header.component.ts`; arrow keys in `handoff-binding-picker.component.ts`;
   pointer Close session restores prior focus (keyboard close → neighbor card);
   last-session close focuses New session (`canvas-board-focus.ts`); failed Stop announced via
   the card `announce()`. Specs updated.
B. **B+ stats layout**: new `session-inspector/inspector-agent-list.ts` (+spec),
   `inspector-agent-usage.ts`, `inspector-agent-row.component.ts`,
   `inspector-agent-dock-detail.component.ts`; rewritten `inspector-agents-section.component.ts`
   (+spec); `chat-ui/.../inspector-stats/inspector-session-stats.component.ts` (+spec);
   `session-inspector.component.{ts,html}`; `canvas-inspector-dock.component.ts` (+spec);
   `canvas-lane-tabs.component.ts` (removed `sidebar` mode, +spec); `agent-dock-card.component.ts`
   (removed `inline` mode); `canvas-rail-board.component.spec.ts`; design-spec.md item 10.
   Agent-reported: Initial total 3.92 MB; numbers use existing `formatTokenCount` ("410.0k").
Both agents ran verify while the other was still editing. **Nobody has verified the combined
working tree yet.** Untracked review file: `code-logic-review-rev5.md` (commit it).

## Open problems and decisions
1. Combined verify + independent review of A and B still to do (see Next steps).
2. No Electron render of the card menu or B+ yet. The user wants screenshots (dark + light).
3. **Ptah Dev single-instance lock**: all dev builds share `%APPDATA%/Ptah Dev`
   (`apps/ptah-electron/src/main.ts` ~59-66). The TASK_2026_719 session
   (`ptah-ptah-extension-task-719-named-claud-cb1e720000pzs2qufktpk0x`) took the lock for a live
   test and promised to message "lock free". Before launching: check no other `Ptah Dev`
   electron.exe runs (PowerShell `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`,
   main process = no `--type=`); never stop another session's instance — ask it via
   SendMessage. Playwright-launched e2e electrons (`playwright-core ... loader`) do not hold it.
4. Follow-ups that exist on main (put in the PR body, do not fix here): W1 split panes keep
   `min-w-[360px]` and overflow a 256px board (800px window + Git dock at max); M4 Sessions rail
   expand does nothing then; light-theme "Review changes" contrast 1.97:1; white artifacts
   beside workspace tabs in light theme; pre-existing lint errors in `chat` (attention files)
   and `ptah-electron-e2e` (`git-watcher.spec.ts`).
5. B+ agent note: `CanvasLaneTabsComponent` non-rail main-view mode (named chips,
   agent-dock-menu) has no consumer left (already true before). Consider deleting it in this PR.
6. Comment at `libs/frontend/core/src/lib/services/electron-layout.service.ts:54` mentions a
   400px chat min-width; still accurate (the floor change was reverted).

## Key files
- `.../canvas-rail/canvas-rail-card.component.ts` — session card + `⋮` menu (≤700 lint lines).
- `.../canvas-rail/canvas-focus-header.component.ts` — split pane "Pane actions" menu only.
- `.../canvas-rail/canvas-inspector-dock.component.ts` — rail / dock / overlay / compact sheet.
- `.../canvas-rail/canvas-board-focus.ts` — focus repair after pane/session close.
- `.../canvas-rail/canvas-rail-board.component.ts` — board; must stay ≤ 1241 lines.
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/` — expanded sidebar (B+).
- `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts` — SESSION row.
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` — card-menu / pane-menu e2e.
- `apps/ptah-electron/src/windows/main-window.ts:125` — `minWidth: 800`.
(`...` = `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/libs/frontend/canvas/src/lib`)

## Background work
None running. All agents and Glm lanes finished. No Electron instance from this branch runs.

## Next steps
1. From the worktree root, foreground, combined verify:
   `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas,ptah-electron-e2e -- --output-style=static`
   Expect only the known lint errors. Then the budget:
   `node scripts/verify.mjs --exec --task webview-build -- npx nx build ptah-extension-webview --output-style=static 2>&1 | tail -30` (Initial total < 4.00 MB).
2. Independent review (load the `agent-lanes` skill first) by a non-Claude family, e.g. Glm
   ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`, role `code-logic-reviewer`, deliverable
   `code-logic-review-rev6.md`: rev5 fixes (A, check against `code-logic-review-rev5.md`) and
   B+ (B, check against the mockup and design-spec item 10). Fix confirmed findings.
3. Commit A+B (foreground, explicit paths, include `code-logic-review-rev5.md`, `-rev6.md`,
   this HANDOFF.md; scopes from `.commitlintrc.json`), then push in the background
   (`git push origin feat/chat-layout-declutter`, capture the real exit code — the first push
   in session 3 failed on a network error). Watch CI: `gh pr checks 829` with `--jq` (no `jq`).
4. When the Ptah Dev lock is free (problem 3): rebuild under the lock
   `node scripts/verify.mjs --exec --task electron-build-dev -- npx nx build-dev ptah-electron --output-style=static`
   `node scripts/verify.mjs --exec --task electron-renderer -- npx nx copy-renderer-dev ptah-electron --output-style=static`
   then launch in the background `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9334`.
5. Visual review (`visual-reviewer` subagent, Playwright `connectOverCDP('http://127.0.0.1:9334')`,
   read-only on user data, restore the original theme — it was `nord`): card `⋮` menu (items,
   Stop only while running, Hand off picker), pane actions menu, B+ sidebar with a session that
   has lanes (selected row dock, Show more, numbers), no layout shift, dark `anubis` + light
   `anubis-light`, widths 1600 / 900 / 800 (+Git dock max). Save to `screenshots/rev4/`, write
   `visual-review-rev4.md`, show the screenshots to the user and get their OK.
6. Update the PR body (Summary + Test plan with real results + follow-ups list), then
   `gh pr ready 829`. Watch CI and reviews; fix confirmed findings with new commits.
7. Keep the worktree and branch until the user authorizes cleanup. No merge, no force push.
