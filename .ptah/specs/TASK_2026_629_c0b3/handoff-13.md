# TASK_2026_629_c0b3 — HANDOFF (thirteenth handoff: PR #730 fix round, CI almost green)

> File name: `handoff-13.md`. NEVER write `HANDOFF.md` (decision row 91, user rule). The next handoff is `handoff-14.md`.
> Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`
> Branch: `feat/task-629-canvas-board`. PR: https://github.com/Hive-Academy/ptah-extension/pull/730 (OPEN).

## 1. Goal

1. Make PR #730 (Rail board replaces Grid board) green: CI jobs + every CodeRabbit comment.
2. Push, wait for the second CodeRabbit round and CI. If all pass, **merge PR #730 into main** — the user
   authorized this merge (decision row 132).
3. Then Step 0 housekeeping, then build the enhancements in NEW worktrees from main (see §6).

## 2. Done (session 13)

- Merged origin/main into the branch (`59ede9e11`, clean).
- Commits pushed (head `7dbb2d6bc`):
  - `0dccad207` fix(canvas,webview): CodeRabbit canvas comments + CI product regressions (setup card restored on the
    empty Rail board, one `Focused session` landmark, Rail auto-collapse below 640 px, toggle aria-disabled, empty
    board scrolls).
  - `d5c8ba3e4` fix(chat,chat-ui,chat-types): CodeRabbit chat comments, send path (tab-scoped clear, per-draft
    in-flight guard; clear-on-failure kept on purpose, row 133), spec stubs.
  - `329ba76aa` fix(ui,vscode-core): degradation-audit popover log, real-git 30 s timeout.
  - `82b923929` test(e2e): Grid-era specs moved to the Rail DOM.
  - `2f2b37d58` fix(canvas,chat,chat-ui): visual review polish (setup card contrast >= 4.82:1, collapsed empty Rail,
    "in focus" only on the focused compact card, toggle 24x24).
  - `7dbb2d6bc` docs(canvas): reports + decision rows 127-137.
- All 12 CodeRabbit threads: replied; CodeRabbit confirmed each fix in its thread replies. No new actionable comments
  on `7dbb2d6bc` at the time of writing.
- Reviews (all in this folder): canvas by Claude (`code-logic-review-coderabbit-canvas.md` 8/10,
  `code-logic-review-ci-fix-canvas.md` 7/10 -> fixed); chat by codex (`codex-review-coderabbit-chat.md` 5/10 ->
  `codex-rereview-send-guard.md` 6/10 -> `codex-review-final-fixes.md` APPROVED 8/10); visual fixes
  `codex-review-visual-r1.md` APPROVED 8/10; visual `visual-review-pr730-fixes.md` 7/10 ->
  `visual-recheck-pr730-r1.md` APPROVED 9/10 (dark + light).
- Mode 2 (local, before push): full suites canvas 23/367, chat 209/3938 (2 skipped), chat-ui 73/1436, ui 37/679,
  ptah-extension-webview 18/476; typecheck + lint 0 errors for chat, chat-ui, chat-types, ui, canvas,
  ptah-extension-webview, vscode-core, ptah-electron-e2e, webview-e2e-harness.
- Before screenshots: `.ptah/tmp/final-run/shots/after-s12fix-*.png`; after: `after-s13-*`, `after-s13r1-*`.

## 3. CI state on `7dbb2d6bc` (run 38664216088 rerun + 38664216103 + 38664216113)

| Job | State | Cause | Next |
| --- | --- | --- | --- |
| test (shard 2/4) | PASS after rerun | agent-sdk `subagent-budget-monitor.spec.ts:1740` (`waitUntil` 2000 x setImmediate) flaked; code from main (#728), not this PR | none; rerun again if it flakes |
| checks, webview-e2e | FAIL | `bundle initial exceeded maximum budget ... 3.50 MB not met by 2.75 kB` — restored eager `ProjectSetupCardComponent` import in `canvas-rail-board.component.ts` | wrap the card in `@defer` (§5.1) |
| electron-e2e shard 1 | FAIL | `canvas.spec.ts:156` Swap panes: `:172` expects active side not `left`, got `left` | §5.2 |
| electron-e2e shard 4 | FAIL | `task-337-agent-card-refresh.spec.ts:186`: waits for `ptah-inline-agent-bubble` in the focus area; the Rail transcript renders `ptah-subagent-tile` (`chat-transcript.component.html:50`, `execution-node.component.ts:340-372`) | §5.2 |
| electron-e2e, main | FAIL | aggregate jobs of the above | — |

Round-2 failed-job logs: `.ptah/tmp/pr730/r2/job-*.log` (in the worktree).

## 4. In progress / open

- Two sub-agents (`fd-bundle-defer`, `tester-e2e-r2`) were stopped when the session ended. They changed NO files and
  wrote no report (working tree clean at `7dbb2d6bc`). Re-run them fresh (§5).
- Not yet done: Step 0 housekeeping (after merge), all enhancement tasks.
- Follow-ups recorded (add to the right new task):
  - Task 1 (agent tiles / Rail visuals): collapsed Rail has no focus mark (visual Moderate); collapsed "+" new-session
    button has no accessible name; two Rail header chips 17x24 px; Moderate 3 of `code-logic-review-ci-fix-canvas.md`
    (details aside + 44 px button at < ~400 px).
  - Task 3 (R9 cleanup): canvas review Minors 4, 6, 7 (`code-logic-review-ci-fix-canvas.md`); showcase scenes still use
    Grid selectors (`apps/ptah-electron-e2e/src/showcase/*.scene.ts`); `tile-open-longtask-budget.perf.spec.ts` assumes 3
    mounted sessions (selector-only fix + NOTE).
  - Task 2 (R9 parity tests): the task-337 stale selector item is being fixed in PR #730 itself; remove it from task 2.
  - Chat: failures before any optimistic bubble (validation / service readiness,
    `message-sender.service.ts:321-330,375-388`) still lose the only draft copy (pre-existing, row 133).
- Side effect: the visual reviewer created `D:\projects\ptah-s13-empty-ws` (empty folder); the app lists it as a workspace.

## 5. Exact next steps

1. **Bundle budget** (Claude `frontend-developer` sub-agent, worktree above): in
   `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` wrap `<ptah-project-setup-card>` in
   `@defer (on idle) { ... } @placeholder { ... }`, referenced only inside the block; keep the scroll/centering wrapper.
   Do not change the budget. Update `canvas-rail-board.component.spec.ts` with `DeferBlockBehavior.Playthrough` or
   `fixture.getDeferBlocks()`. Checks: that spec, full canvas suite, typecheck, lint (commands in §7).
2. **E2E specs** (Claude `senior-tester` sub-agent, parallel, file-disjoint): `gh run download 38664216103 -D
   .ptah/tmp/pr730/r2/artifacts-electron`; fix `canvas.spec.ts:156` (decide spec vs product from
   `canvas-rail-board.component.ts` swap/activatePane/closePane and `implementation-plan-rail-r9-split.md`; product rule
   wins; if product defect, report, then fix in a separate product batch with review) and `task-337...spec.ts:186`
   (assert on `ptah-subagent-tile`, or open the sub-agent lane where the execution node renders). Checks: typecheck +
   lint `ptah-electron-e2e`.
3. Review: product change (step 1) gets a codex `code-logic-reviewer` lane (Claude wrote it). Spec-only changes need no
   review.
4. Commit in the foreground (scopes `canvas`, `e2e`; subject <= 72; Co-Authored-By line), add decision row 138, push
   in the background, then one background `gh pr checks 730 --watch --interval 120`.
5. When CI is green and CodeRabbit has no open actionable comment: `gh pr merge 730 --merge` (user-authorized, row 132;
   check `.github` / repo merge style first, use the method recent merges used — they are merge commits).
6. **Step 0** after the merge:
   - `SendMessage` to `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30x`: "TASK_2026_629 merged (PR #730).
     BL heap result for 645 M-final: Rail board keeps <= 1 live ChatView in the board host, <= 2 with split on. Grid mode,
     `ptah-canvas-tile` grid hosting and `gridstack-item` were removed in 629 (row 73), so the 645 M-final measurement must
     use the Rail board." (handoff-8.md §3 step 11). If the name does not resolve, use `ListAgents`.
   - Edit only the `status:` line of `task.md` to `done` (on main, via the follow-up worktree or a docs commit).
   - Ask the user before removing this worktree.
7. **Enhancements** (decision row 132): one new task per item (new TASK ID, `task.md` first, then `context.md`), each in
   its own worktree from main (`git worktree add -b <type>/<name> .claude-worktrees/<name> main`), copy
   `.ptah/tmp/check-run.mjs` into it. Order and scope: handoff-12.md §2 items 1-5, plus the user's additions to item 1:
   agent and sub-agent tiles with CLI provider icons in the RIGHT sidebar, a better sub-agent execution display, and a
   smooth staggered animation on session switch. **The orchestrator/Claude sub-agents implement the frontend; CLI
   lanes only review** (user: CLI tools lack frontend taste and icon use). Approval mode lane-review; do not wait for the
   user except for removals / irreversible actions. Item 1 needs designer -> prototype -> cross-side review -> Gate 1.7
   before code. Tasks 2-5 can run in parallel (max 3, file-disjoint).
   Survey of the relevant code (session 13, read-only): no agent list in the right sidebar today
   (`canvas-rail-board.component.ts:187-235` aside = `canvas-session-details`); the agent list is the horizontal
   `canvas-lane-tabs.component.ts:98-163` (text labels, no icons); vendor marks already exist —
   `libs/frontend/ui/src/lib/native/provider-mark/provider-mark.component.ts` (`ptah-provider-mark`, slugs in
   `brand-mark/brand-slugs.ts:75-95`, Claude slug `claude-cli`; ptah-cli lanes need a `ptahCliId` -> provider lookup);
   data in `chat-streaming/.../agent-monitor.store.ts` (`MonitoredAgent`, `SubagentRecord`) and `background-agent.store.ts`;
   stats strip `chat-ui/.../session/session-stats-summary.component.ts` (needs an adapter for lanes); transcript
   sub-agent row `chat/.../execution/subagent-tile.component.ts`; switch path card -> `CanvasStore.focusTile` -> one
   ChatView kept by `canvas-detail-transcript.component.ts:39-96`, keep-alive LRU 4; existing motion tokens
   `--ptah-ease-soft` in `chat-view.component.css:72-73`, `animate.enter` classes; no stagger helper; reduced-motion rule
   `apps/ptah-extension-webview/src/styles.css:673-681`; `switch-baseline.md` long tasks 124 ms median.

## 6. Key files

- Decisions: `decisions.md` rows 127-137 (this session).
- CI: `ci-failure-report.md`, `ci-fix-canvas-report.md`, `ci-fix-e2e-specs-report.md`.
- CodeRabbit: `pr730-coderabbit-comments.md`, `coderabbit-fix-canvas-report.md`, `coderabbit-fix-chat-report.md`;
  replies text `.ptah/tmp/pr730/replies.tsv`.
- Fix rounds: `fix-send-guard-report.md`, `fix-rail-toggle-report.md`, `fix-visual-r1-report.md`.

## 7. Rules (repeat in every lane and sub-agent prompt)

Checks through `node .ptah/tmp/check-run.mjs <label> -- <command>` (machine-wide lock; it prints a log path under
`%TEMP%\629-check-<label>.log` — grep that). Writers: changed specs only, `npx nx test <project> --testFile=<spec>
--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, never --testPathPattern. Mode 2: each changed project's full
suite, then `npx nx typecheck <p> --parallel=1 --skip-nx-cache` and `npx nx lint <p> --parallel=1 --skip-nx-cache`. One heavy
check at a time (the pre-push hook is heavy too — never push while a build or suite runs); no workspace-wide runs; no
build/serve/dev/e2e/package except the Electron renderer rebuild (`nx run ptah-electron:build-dev` then
`nx copy-renderer-dev ptah-electron`); no npm install; ask before `npm rebuild better-sqlite3` or a package.json change; no git
in `D:\projects\ptah-final-run-ws`. Reviewer briefs write only the named deliverable, never `code-logic-review.md`; shipping
code gets a different-family review. UI changes need before/after screenshots dark + light. Commits foreground, explicit
paths, `.commitlintrc.json` scopes, subject <= 72, body lines <= 100, end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; push + `gh pr create` in one background command, PR body ends
with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; one PR per task. At most 3 parallel CLI lanes; do not
touch other tasks' codex lanes. Each new task's handoff is `handoff-1.md` in its own folder; never `HANDOFF.md`.
