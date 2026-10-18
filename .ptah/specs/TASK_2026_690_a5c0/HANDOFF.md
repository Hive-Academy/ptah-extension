# HANDOFF 4 — TASK_2026_690 (chat layout + display sheet), 683 (PR #748), MCP card, 685

Written 2026-10-17 (session token budget). Covers four tasks/branches. Earlier hand-off for 683/685:
`D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\.ptah\specs\TASK_2026_683_3c29\HANDOFF.md`
(HANDOFF 3; its rules section still applies).

## 0. Rules (user, binding)
- CLAUDE.md memory-safe checks: scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, ONE heavy check at a
  time, never `--maxWorkers` on typecheck. No build/serve/e2e except what the user asks (the user asked for
  dev-app runs to test 683/690 by hand).
- Implementers = codex CLI lanes (`ptah_agent_list` first; load the `agent-lanes` skill). Reviewers =
  Claude subagents (`code-logic-reviewer`; plans: `software-architect` as reviewer). Lanes never commit
  and never run checks; the orchestrator runs checks. One fix round per review, then a bounded correction.
- Commit in the foreground; `git push` (+ `gh pr create`) as ONE background command. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Scopes in `.commitlintrc.json`.
  Never bare `git stash`.
- Electron is a shared slot: announce "Electron: 683 launching" and send "Electron: free" after, to
  the queued peers (ListAgents). Peer 687/689 = `ptah-ptah-extension-task-687-command-cen-9aedd90000nb42qhydm5m08`
  is waiting for "Electron: free" from us. 684 =
  `ptah-ptah-extension-task-684-ollama-deci-a2f8d20000nb42qhydm5m07`, 679 =
  `ptah-ptah-extension-chat-3f2db70000nb42qhydm5m04` (679 does not need it now).
- Ask the user only about removals, scope changes, irreversible actions. End each turn with done / left /
  every local-only branch.

## 1. State per branch

| Worktree (`D:\projects\ptah-extension\.claude-worktrees\…`) | Branch | Head | Pushed / PR |
| --- | --- | --- | --- |
| `nav-session-motion` | `feat/nav-session-motion` (TASK_2026_683) | `454954094` | pushed, **PR #748** |
| `sidebar-mcp-card` | `feat/sidebar-mcp-card` (based on 683) | `7235c046c` | local only |
| `chat-layout-display-sheet` | `feat/chat-layout-display-sheet` (TASK_2026_690, based on the MCP card) | `3ce6bf2c5` + this HANDOFF | local only |
| `lane-execution-stream` | `feat/lane-execution-stream` (TASK_2026_685/633) | `6cae83be2` | local only |

All four worktrees are clean (except `.ptah/tmp`). Each has a `node_modules` junction to the main checkout.

### 683 (PR #748) — done this session
- `7776a8162` CI fix (degradation-audit: swallowed catch in `prefersReducedMotion`).
- `312b54f36` NG0956 fix (`canvas-lane-view` tracks a computed `laneBlocks` key).
- `68d7bb39e` + `69a1ee814` **O22**: session switch = transcript pane fade + 12 px rise
  (`--ptah-motion-switch` 260 ms); per-message cascade and `transcript-session-entrance.ts` removed.
  User chose this after a manual test. Review APPROVED 8/10.
- `d8c607ae0` + `454954094` **O23**: no `AbortError: Transition was skipped` dev log — same-surface /
  reduced-motion navigations set `html.ptah-vt-none` (no capture) instead of `skipTransition()`;
  generation token, destroy cleanup. Review APPROVED 8/10 after one fix round.
- Earlier this session: S7 probe run 5 passes every gate (O21), visual review APPROVED 8/10,
  `m1-summary.md`, PR #748 opened. Decisions O1-O23 in
  `nav-session-motion\.ptah\specs\TASK_2026_683_3c29\decisions.md`.
- Open on #748: CI result after the last pushes not checked; M1 numbers in the PR body measure the old
  cascade (O22) — offer the user one more M1 run; light-theme capture gap (recorder has no theme switch);
  PR body does not yet mention O22/O23/NG0956/CI fix.

### MCP sidebar card (`feat/sidebar-mcp-card`) — done
- `7235c046c`: collapsed "MCP servers" card at the bottom of `WorkspaceSidebarComponent`; list and logic
  shared with the chat-input chip via `McpServerStatusService` + `McpServerListComponent`; failed/empty
  recovery reads retry. Review APPROVED 7/10 + fix. No task folder (reports in `.ptah/tmp` there).
- User tested the card in the dev app: no complaint. PR not opened (stacked on #748).

### 690 (`feat/chat-layout-display-sheet`) — implemented, NOT yet confirmed in the app
Task folder: `chat-layout-display-sheet\.ptah\specs\TASK_2026_690_a5c0\` (`context.md` = user request and
binding answers; `implementation-plan.md` APPROVED 8.5/10 + user-approved; `reports\` = batch reports and
reviews; `implementation-plan-review.md`).
- `1c1803fd3` plan. `a4099e5a2` Batch 1 (ChatSessionLayout, one bounded transcript scroller,
  `--chat-content-max-width`, `scrollbar-gutter: stable both-edges`) APPROVED 8.5. `2c5aac040` Batch 3
  (every ptah-ui block incl. `display [id]` inline; `openInDisplayRequested`) APPROVED 8. `9994ed8f7`
  Batch 2 (Canvas orchestrator lane one scroller, 240 px stacked floor, `effectiveCanvasLaneKind`)
  APPROVED 8.5. `9e4e3ae7c` Batch 4 (peek-bar display sheet "Display · N" between transcript and
  composer; ~40% auto-open, full height keeps composer visible, Escape, pin, turn summaries, open in
  display -> sheet; right DISPLAY rail + toggle/width/separator/overlay removed — user-approved;
  `DisplayDockComponent` deleted; VS Code Agents panel unchanged) APPROVED 8 after a fix round.
  `0aaa9cecf`, `3ce6bf2c5` reports.
- `chat-view.component.ts` 2080 -> 2041 lines.
- Checks green at `3ce6bf2c5`: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1`
  (3 projects) and `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2` (24/24).

### 685/633 (`feat/lane-execution-stream`) — paused
- A1 (`4399b1d25`, run-duration rule) and A3 (`c84b1a6be`, execution header for the flat CLI lane) committed,
  each APPROVED after one fix round. A3 dark/light screenshots (1440 + 760) not taken yet.
- Next: A4 only after PR #748 is on main (A4/B5 rebase on 683 B6), then Phase B (B1/B2/B3 -> B4 -> B5 ->
  B7 -> B6). Plan: `lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\implementation-plan.md`.
- The 685 docs session (`ptah-docs-lane-header-proof-…`) was not running: PR #748 link still to send.

## 2. State at hand-off (updated after the rebuild ended)
- The dev-app rebuild from the 690 worktree FAILED: `ptah-electron:build-dev` stopped at
  `nx build-state-storage-worker ptah-electron` (non-zero exit, no error text). Log:
  `D:\projects\ptah-extension\.ptah\tmp\690-dev-build2.log`. The launch step ran anyway and opened the OLD
  dist (Batches 1+3 only); it was stopped. `dist/apps/ptah-electron` in the 690 worktree is therefore stale
  and partly rebuilt — do not test from it.
- Electron slot was released ("Electron: free" sent to 687). After that, 687/689
  (`ptah-ptah-extension-task-687-command-cen-9aedd90000nb42qhydm5m08`) announced its launch on port 9334.
  Its "free" message goes to the OLD 683 session, so before launching, ask 687 via SendMessage whether it
  is done (or check `tasklist | grep -i electron` and ListAgents), then announce "Electron: 683 launching".
- First action next session: run `npx nx build-state-storage-worker ptah-electron --verbose` alone in the
  690 worktree to see the error (a file lock from the killed app, or a real build error), fix it, then
  rebuild + launch with CDP (section 5). Make the launch conditional on the build (`&&`), not `;`.

## 3. Open problem (user's last report) — do this first
User screenshot (Canvas orchestrator lane, light theme): composer not at the bottom of the session
(empty area under it), and two vertical scrollbars (inner at the transcript, outer at the far right next
to the DISPLAY rail). That screenshot came from the OLD build (Batches 1+3 only: the right DISPLAY rail is
still visible), so Batches 2 and 4 were not in it. Nothing is proven yet for the new build.
1. After a successful rebuild (section 2), launch with CDP (section 5) and attach to CDP port 9370 (e.g. Playwright
   `chromium.connectOverCDP('http://127.0.0.1:9370')`, or `curl http://127.0.0.1:9370/json`) and, for the
   Canvas orchestrator lane AND normal chat mode at the current window size, list every ancestor of the
   transcript scroller and of the composer with: `clientHeight`, `scrollHeight`, computed `overflowY`,
   `display`, `height`, and the composer's bottom vs its layout host's bottom. Find the element that still
   scrolls or that is taller than its parent. Do not hide scrollbars.
2. Fix the measured offender (codex lane; Claude review; scoped checks), likely candidates from the plan's
   height audit: `app-shell.component.html` main column/active content without `min-h-0` (plan note N3:
   change only with measurement), `canvas-rail-board.component.ts` tile, `canvas-lane-view.component.ts`
   host, `chat-session-layout.component.ts`.
3. Ask the user to retest in the app. Also show the Batch 4 sheet.
4. Pending user decision: the "Display · 0" bar shows in every Electron session — recommendation: hide
   the bar until the session has its first panel.

## 4. Next steps after the layout is confirmed
1. 690: dark + light screenshots at 1440 + 760 (normal, Canvas side-by-side, stacked, sheet peek/full,
   composer menus) via the `visual-reviewer` subagent → `visual-review.md`; set `status: in_review`;
   commit.
2. PRs (each as ONE background `git push -u origin <branch> && gh pr create …`): `feat/sidebar-mcp-card`
   (base `feat/nav-session-motion` or main after #748 merges) and `feat/chat-layout-display-sheet` (stacked
   on the MCP card). Rebase on main after #748 merges.
3. PR #748: check CI (`gh pr checks 748`), update the body with O22/O23/NG0956/CI fix and the open
   light-theme gap; offer one more M1 run for O22.
4. 685: A3 screenshots, then A4 after #748 merges, then Phase B.
5. Send "Electron: free" to 687 whenever the dev app is closed.

## 5. Commands
- Stop only our dev app (PowerShell): `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*chat-layout-display-sheet*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
- Rebuild + launch with CDP (bash, worktree `chat-layout-display-sheet`):
  `node apps/ptah-electron/scripts/rebuild-native.js && npx nx build-dev ptah-electron && node scripts/copy-wasm.js dist/apps/ptah-electron && npx nx copy-renderer-dev ptah-electron && node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9370`
  (or `npx nx serve ptah-electron` without CDP).
- 690 checks: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/canvas --parallel=1`
- 683 checks: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat --parallel=1`, `npx nx typecheck ptah-electron-e2e`
- 685 checks: `npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas @ptah-extension/chat-streaming --parallel=1`

## 6. Local-only branches at hand-off
- `feat/lane-execution-stream` (685, 6 commits on main 71820e0c0)
- `feat/sidebar-mcp-card` (1 commit on `feat/nav-session-motion`)
- `feat/chat-layout-display-sheet` (690, 7 commits + HANDOFF on `feat/sidebar-mcp-card`)
- Pushed: `feat/nav-session-motion` (PR #748)
