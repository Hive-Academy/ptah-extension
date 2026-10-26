# HANDOFF — chat layout declutter (Electron) — session 2

Worktree: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter`
Branch: `feat/chat-layout-declutter` (base `main`), pushed.
PR: **#829 (DRAFT)** https://github.com/Hive-Academy/ptah-extension/pull/829 — head `27ab89ef7`.
Task folder: `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/.ptah/specs/chat-layout-declutter/`
This HANDOFF.md is the only uncommitted change (commit it with the next fix).

## Goal (user request)
Declutter the Electron chat layout:
1. No duplication between the chat header and the right stats sidebar ("Session details").
2. Avatar agent strip replaces the vertical Agents list.
3. ACTIVE SUBAGENTS section in the sidebar; passive per-lane CONTEXT/TOKENS/COST removed from the chat area.
4. 56px compact stats rail with small stat tiles.
5. Quiet empty states for unknown usage.
6. Wider chat column: 1100px, centered, full height.
Revision 2 (user feedback after screenshots) — `design-spec.md` `## Revision 2`, items 1–9: no chat
header row; controls in the sidebar top bar / rail; split panes get floating controls; rail shows
active-agent avatars; 2-row expanded strip; overlay sheet when chat < 560px; lane usage mismatch
fix; Hand off style; DaisyUI lane detail table (item 9).

## Done
Commits on the branch (all pushed):
- `13f2a6233 fix(chat): exempt shared from the lazy-import boundary check` (eslint.config.mjs).
- `103db1a1e feat(chat,chat-ui,canvas): declutter the chat layout and stats sidebar` (first pass).
- `f9f43dc49` merge of `origin/main`.
- `27ab89ef7 feat(chat,chat-ui,canvas,e2e): move session controls into the sidebar` — Revision 2
  items 1–9, the review fixes, dead-code cleanup, 4 e2e files moved to the rail expand control.

Reviews (family Glm / Ollama Cloud; implementers codex + Claude):
- `code-logic-review-rev2.md` REVISE 6/10 (10 defects) → `fix-round-rev2-1-report.md` →
  `code-logic-review-rev2-round1.md` APPROVED 9/10 → `code-logic-review-rev2-round1-addendum.md`
  APPROVED 9/10 (rail `railPicked` output so key normalization never expands the sidebar).

Local verification on `27ab89ef7` content (worktree root):
`npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`
- chat-ui 87 suites / 1607 tests pass; typecheck pass; lint 0 errors.
- chat 274 suites / 4709 pass + 2 skipped; typecheck pass; lint FAILS only on 2 pre-existing errors in
  files unchanged from main (`services/attention-context.util.ts:1`, `services/chat-attention-source.service.ts:27`).
- canvas 23 suites / 475 tests pass; typecheck pass; lint 0 errors (78 warnings).
- `npm run verify -- -t typecheck -p ptah-electron-e2e,@ptah-extension/webview-e2e-harness` pass.
- Electron `build-dev` + `copy-renderer-dev` pass (`dist/apps/ptah-electron` in the worktree is current).

## CI state at handoff (PR #829, head 27ab89ef7)
- pass: CodeRabbit (skipped review: draft), GitGuardian, docs-build. skipping: electron-e2e-perf.
- **FAIL: `webview-e2e`** (run 40364995165), step "Build webview bundle":
  `bundle initial exceeded maximum budget. Budget 4.00 MB was not met by 21.33 kB with a total of 4.02 MB`
  (project `ptah-extension-webview`). Not yet investigated.
- pending at handoff: checks, typecheck, test shards 1–4, electron-e2e shards 1–4, git-real-git ×3.
- No human review yet (REVIEW_REQUIRED). CodeRabbit does not review drafts.

## Open problems / decisions
1. **Bundle budget (CI blocker).** Find what this branch added to the initial chunk:
   compare with main (`gh run list --branch main --workflow "Webview E2E"` and its build log size, or
   build both under the lock). Likely candidates: the new `lane-detail.ts` + DaisyUI table template in
   `lane-usage-tile.component.ts`, the new lucide `Info` icon, `FloatingUIService` in
   `canvas-focus-header.component.ts`, larger `canvas-inspector-dock.component.ts`. Prefer moving code
   out of the initial chunk (`@defer` / lazy import of the sidebar lane detail) over raising the budget.
   Do NOT raise the budget without the user's OK.
2. **Electron visual review not done (blocks marking the PR ready).** Two `Ptah Dev` instances cannot run at
   once (`app.requestSingleInstanceLock()` on the `Ptah Dev` userData, `apps/ptah-electron/src/main.ts:59-66`).
   The user's other session keeps a dev instance from the main checkout on port 9333 (last seen PID 41576,
   workspace `D:\projects\ptah-extension`). Ask the user to close it, then launch this branch.
   The user chose "push now, screenshots later": add the screenshots to the PR, then mark it ready.
3. **User decision pending:** the expanded sidebar shows no `⋯` button (its menu would only contain Hand
   off, which is beside the title). Spec item 2 lists `⋯` there. Alternative: Hand off only in `⋯`.
4. Pre-existing, out of scope (already in the PR body as follow-ups): light-theme "Review changes" contrast
   1.97:1; white artifacts beside workspace tabs in light theme; the 2 chat lint errors.
5. Separate task (NOT this branch): lane reports injected into a session break the chat message order (exists on
   main). Investigation: `D:/projects/ptah-extension/.ptah/specs/lane-report-message-order/investigation.md`
   (untracked, main checkout). The user starts it in its own session.
6. Lane-runtime follow-ups for the user (not started): quota-failed lanes stay "unknown (reader failed)";
   a lane spawned its own helper lanes; agent-lanes SKILL §1 wording about "unknown" lanes.
7. Tooling note: `jq` is not installed; use `gh ... --jq` for CI polling.

## Session 3 update (2026-10-26)
- CI on 27ab89ef7 failed: webview budget (4.02 MB) and 4 Electron e2e tests with pre-Revision-2
  locators (main fails only the @perf review-canvas test). Fixed: rail inspector in
  `@defer (on immediate)` → initial 3.96 MB; e2e specs + 3 showcase scenes updated.
- User decision (open problem 3 closed): no top bar in the expanded sidebar; controls sit at the
  right of the title row (Stop, view toggle, Hand off icon, Close session, collapse
  `PanelRightClose`); no `⋯`. Recorded in design-spec.md Revision 2 item 2.
- Focus fixes: Close pane / Close split focus the sidebar Session controls
  (`canvas-board-focus.ts`); compact-sheet / dock close wait for the deferred rail
  (`focusRailExpand`).
- Review: Glm `code-logic-review-rev3.md` (1 blocking, 2 minor) → `code-logic-review-rev3-fix.md`
  APPROVED (finding 3 disputed and accepted).
- Visual review still blocked: Ptah Dev PID 39796 from the lane-report-message-order worktree
  holds the single-instance lock; asked that session to release it.

## Key files
- canvas: `libs/frontend/canvas/src/lib/canvas-rail/{canvas-inspector-dock,canvas-focus-header,canvas-focus-area,canvas-rail-board}.component.ts`,
  `libs/frontend/canvas/src/lib/canvas-detail/{canvas-lane-tabs,agent-dock-card}.component.ts` (+ specs).
  Rule: `canvas-rail-board.component.ts` ≤ 1241 lines (now 1203).
- chat: `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html`,
  `libs/frontend/chat/src/lib/services/session-stats/session-stats-source.ts`.
- chat-ui: `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/{lane-detail.ts,lane-tiles.ts,lane-usage-tile.component.ts,lane-subtotal-tile.component.ts,stats-tile.styles.ts,stats-limit-view-model.types.ts,session-limit-summary.ts}`.
- e2e: `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts`,
  `apps/ptah-electron-e2e/src/showcase/{canvas-orchestra,chat-code-edit}.scene.ts`,
  `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts`.
- Specs/reviews: `design-spec.md` (Revision 2), `parity-inventory.md`, `code-logic-review-rev2*.md`,
  `fix-round-rev2-1-report.md`, `revision-2-report.md`, `revision-2-item-9-report.md`, `visual-review.md` (first pass).

## Next steps
1. Read this file, then `gh pr checks 829` and `gh run view <id> --log-failed` for every failed job.
2. Fix the webview bundle budget (problem 1). Verify, from the worktree root, foreground:
   `npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`
   and, for the budget, under the lock (the user asked for builds only for this check / screenshots):
   `node scripts/verify.mjs --exec --task webview-build -- npx nx build ptah-extension-webview --output-style=static`
   (confirm the initial total is below 4.00 MB). Fix any other failed CI job with a new commit.
3. Get an independent review of the fix from a family other than the implementer (Glm ptah-cli lane
   `pc-355b645d-35af-4974-84cf-9cf961ea0164`, role `code-logic-reviewer`; load the agent-lanes skill first;
   resume only works under ~60k tokens, so give a full brief).
4. Commit (foreground, explicit paths, include this HANDOFF.md; scopes from `.commitlintrc.json`), then push in the
   background. Watch CI with `gh pr checks 829` (`--jq`, no `jq`).
5. Screenshots: when the user confirms the other dev instance is closed, rebuild if code changed:
   `node scripts/verify.mjs --exec --task electron-build-dev -- npx nx build-dev ptah-electron --output-style=static`
   `node scripts/verify.mjs --exec --task electron-renderer -- npx nx copy-renderer-dev ptah-electron --output-style=static`
   then launch in the background: `node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9334`
   (if it exits right after "DevTools listening", another `Ptah Dev` instance holds the lock).
6. Visual review (`visual-reviewer` subagent, Playwright `connectOverCDP('http://127.0.0.1:9334')`, read-only on user
   data, dark `anubis` + light `anubis-light`, restore `night`): wide expanded sidebar, wide compact rail with
   active-agent icons and the rail `⋯` menu (fixed, left of the rail), split view floating controls + overlay
   sidebar following pane focus, 900px and 400px (overlay, no right-edge clipping), lane detail table
   (collapse arrow position, 7rem status column). Save PNGs to `screenshots/rev2/`, write `visual-review-rev2.md`,
   show the screenshots to the user and get their OK.
7. Update the PR body Test plan with the real results, then `gh pr ready 829`. Keep watching CI and reviews; fix
   confirmed findings with new commits.
8. Keep the worktree and branch until the user authorizes cleanup. No merge, no force push.
