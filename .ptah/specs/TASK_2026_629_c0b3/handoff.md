# Handoff: TASK_2026_629_c0b3 — Orchestra Canvas mission board

Date: 2026-10-13. Branch: `feat/task-629-canvas-board` (local only, not pushed yet).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Base: `43803ee7e`. `origin/main` is 77+ commits ahead (TASK_2026_628 PR #715 merged as `0d892085c`).

## 1. Approvals and user decisions

- `task-description.md` and `implementation-plan.md` are approved. One commit per batch after
  its scoped checks pass. Do not stop at gates. Push + PR at the end (global CLAUDE.md rule).
- Implementation runs on CLI lanes (codex, role `frontend-developer`). Review is cross-side:
  lane-written code → Claude sub-agents (`code-logic-reviewer`, `code-style-reviewer`);
  orchestrator-written (in-process) code → a codex lane, read-only.
- 2026-10-13: the todos and git +/- metrics ARE in scope → new batch BM (decisions.md row 27).
- 2026-10-13: the orchestrator records video of the real Electron app itself at the end to
  find defects, then fixes them (decisions.md row 28). The user may still test by hand after.

## 2. Documents (all in `.ptah/specs/TASK_2026_629_c0b3/`)

1. `decisions.md` — rows 1-28. The source of truth for every decision, deferral and open item.
2. `implementation-plan.md` (§1 D1-D8, §4, §5, §7), then `batches.md` (task text; its PENDING
   states are NOT updated — use §3 below).
3. `plan-part-1..4.md`, `task-description.md` (acceptance criteria), `prototypes/01-board.html`.
4. Reviews: `code-logic-review*.md`, `code-style-review*.md`, `*-rereview-*.md`, lane reports
   `lane-*.md`, `spike-detail-row.md`.

## 3. Progress

| Batch / step | State | Commit |
|---|---|---|
| docs, B0, B1, B2a, B2b, B2c | done | `c7ca2dec4` `5e843c69f` `74adfd690` `b8f529c74` `15bf287d5` `df07eb2b5` |
| Phase A review + Fix-1, Fix-2, re-review | done (PASS) | `46fce6a69` `fa90d4920` `6f3542c7d` |
| B3 cap of 9 running sessions, B4 needs-you queue | done | `4b3f0b411` `d498dd294` |
| Phase B review + Fix-B + correction | done | `8f1334415` `0ce422101` |
| B5a forced-card token, B5b live budget | done | `599deb687` `fd290fac9` |
| Phase C review + Fix-C1, Fix-C2, re-review | done | `2d9da4357` `b65fdd59e` `06e888c70` |
| B6 detail-row spike (PROVISIONAL GO, option b) | done | `f5fe143b9` |
| B7a detail service/panel, B7b wiring, B7c card callouts | done | `be6dc1744` `b9c12a173` `1ddb4f705` |
| B8a lane tabs/views, B8b mini panel responder | done | `110fdc635` `d1cf223d7` |
| BL detached tile leak (ran late, see row 23) | done, Phase E review PASS | `d7042e545` |
| Phase D review → Fix-D1 | done | `e80021cab` |
| **Fix-D2** | **NEXT** | — |
| Re-review of Fix-D1 + Fix-D2 (one, read-only) | pending | — |
| Rebase onto `origin/main` | pending | — |
| B10 send-path cap guard + canvas-tile buildTree test | pending | — |
| BM todos + git +/- metrics (new) | pending | — |
| Phase F review (B10 + BM) | pending | — |
| Final: Electron run, video recording, defect round | pending | — |
| B9 manual perf record | pending (user, or recorded in the final run) | — |
| Push + PR, tell the 628 session | pending | — |

Check results at `e80021cab`: canvas 24 suites / 308 tests pass; canvas and chat typecheck
pass; lint 0 errors (canvas 11 warnings, chat 38, chat-ui 8 — all warnings, mostly old or spec `any`).

## 4. Next steps in order

1. **Fix-D2** (one codex lane, canvas only). Items, from decisions.md rows 24 and 25:
   - Phase D M2: detail-slot geometry uses a skyline row: the row bottom is the closure over
     tiles that overlap the opened tile vertically (`canvas-detail-geometry.ts`, `belowIds`).
   - Phase D M3: slot geometry reads the same frozen measurements the grid uses while the
     detail is open (`canvas-workspace-grid.component.ts`).
   - Phase E M1: release stale Gridstack nodes when the tile set shrinks even while the canvas
     is locked or inactive (release only, no layout apply).
   - Phase E M3: real-engine spec case that moves a pinned node to a new target (close a middle tile).
   - Phase E M4: fix the stale gravity comment in the grid (~:216-219).
   - Keep the grid file at or under its current size (877 lines; it is over the 700 limit from
     before this task — do not grow it; put logic in `canvas-detail-geometry.ts` /
     `canvas-grid-release.ts`).
2. **One re-review** of `e80021cab` + Fix-D2 (Claude `code-logic-reviewer`, read-only, no
   checks). No second fix round: record new findings in decisions.md.
3. **Rebase** onto `origin/main` (`git fetch origin main`, `git rebase origin/main`, clean tree,
   no lane running). The 628 session expects no textual conflicts in 629 files. After the
   rebase run the scoped checks once per changed project (canvas, chat, chat-ui, chat-streaming).
4. **B10** (batches.md "B10"): the running-cap guard in the chat send / start-turn path, NOT in
   the `AGENT_SUMMARY_CHUNK` handler. A turn started from an existing idle canvas tile must be
   refused at the cap (decisions.md row 17). May need an optional token so `chat` can read the
   canvas count without importing canvas. Also add the canvas-tile level test "one buildTree
   per published tab snapshot" on the `tab-<id>` key (628 handoff, row 16).
5. **BM metrics** (row 27): first a short `software-architect` step (or researcher) to find the
   sources: todos = latest `TodoWrite` tool input of the session (frontend), git +/- = host data
   (check existing git RPCs and `libs/frontend/git-ui` first; a new RPC needs the shared
   contract in `libs/shared` and an implementation in all three platform adapters). Then lanes.
   Show the values in the card metrics zone (chat-ui activity / stats) and the detail details
   column (`canvas-session-details.component.ts`), replacing the "—".
6. **Phase F review** of B10 + BM (cross-side), one fix round, one re-review.
7. **Final run with video** (row 28): no lane or check running. Start the Electron dev instance
   from the worktree (`npx nx serve ptah-electron`: rebuild-native, build-dev, copy-renderer-dev,
   launch). Find how to drive and record the renderer first (remote debugging port + the
   `ptah_browser_*` record tools, or the `run` skill). Record in dark and light themes. Check:
   - card zones vs `prototypes/01-board.html`; "+N more lanes" fits a 244 px tile;
   - 3+ tiles → unfocused tiles show cards; drafts survive a card flip; dock stays in a user-chosen compact mode;
   - cap of 9 (button disabled with reason; frees after a hidden-workspace turn ends);
   - needs-you queue: Allow/Deny, Open session → detail;
   - detail row (B6 manual gate): panel top within 8 px of the row bottom, rows below visible
     and clickable, scroll height grows — a FAIL means NO-GO → option (c) bottom panel;
   - Esc / ←/→ in the detail, lane tabs, CLI lane card, sub-agent transcript, Stop, permissions;
   - drag release or text selection in card mode must not open the detail (Phase D M7);
   - BL heap snapshot: no detached `ptah-canvas-tile` / `gridstack-item` tree after a tile
     closes (steps in `lane-BL-report.md` / plan-part-4.md §5); Phase E M2 says BL may be a no-op;
   - streaming continues in a tile after the detail closes (Phase D S1).
   Write `final-run-review.md` with defects, fix them in one round, re-check.
   Note: `rebuild-native` switches `better-sqlite3` to the Electron ABI; run all Jest checks
   BEFORE starting the instance (node_modules is a junction to the main checkout).
8. **B9** perf record (plan-part-3.md procedure) during the final run if possible, else leave to the user.
9. **Push** the branch and **open the PR** to `main` with `gh` (title < 70 chars, `## Summary`
   + `## Test plan`, end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`).
   Tell the 628 session that 629 merged-ready / merged (it runs one combined M-final measurement).

## 5. Open items carried (do not lose)

- Recorded, not fixed (see decisions.md): pulse target list (row 10), sampler spec coverage and
  Retry (row 11), N1-N3 (row 14), M3 refused external new-session request (row 18), partition
  map not a signal + 1 s poll (rows 19, 21), Phase C N2-N4 (row 21), Phase D M5, M7 and Minors
  (row 24), BL M2 + Minors (row 25), standalone background Stop (row 26), activity component
  over 700 lines, tile component 871 lines.
- Real-card screenshots in dark and light (row 13) are now part of the final video run.

## 6. TASK_2026_628 coordination

- 628 is MERGED (`0d892085c`). Its files are now normal main files, but keep the 629 diff away
  from them unless a batch needs it: `compact-session-summary.ts`, `chat-transcript.component.ts`,
  `libs/frontend/markdown`, `batched-update.service.ts`, the execution tree builder,
  `chat-lifecycle.service.ts`, `agent-monitor.store.ts`, agent-card output files,
  `tab-manager.service.ts`, `stream-presentation-store.service.ts`,
  `apps/ptah-extension-webview/src/styles.css`.
- After the merge, `AgentMonitorStore.onAgentOutputBatch` stays public; 629 does not call it.
- 628 session name: `ptah-ptah-extension-task-628-follow-up-v-14993500006vo2qb1g1i30j`.
  `ptah_agent_report` returns `unattributed-caller`; send reports with `SendMessage` instead.
  Tell it when 629 merges (combined M-final measurement).

## 7. How to run lanes

- Load the `orchestration` and `agent-lanes` skills first.
- `ptah_agent_spawn`: `cli: codex`, `role: frontend-developer` (or `backend-developer` for a
  host RPC), `workingDirectory` = the worktree, `taskFolder: .ptah/specs/TASK_2026_629_c0b3`,
  `deliverables: ["lane-<batch>-report.md"]`, `timeout: 1200000`, at most 40 tool calls.
- One lane that runs checks at a time. Read-only reviewers may run in parallel.
- After a lane: read its report, `git diff -w`, run the scoped checks yourself, then commit
  with commitlint `type(scope): subject` (scopes: canvas, chat, chat-ui, chat-streaming, and
  others in `.commitlintrc.json`). End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- To resume a lane, read its real CLI Session ID with one `ptah_agent_status` call. Never type a session id by hand.
- Lessons: lanes often miss one real-runtime case (spec models a flat signal, a guard that
  matches the host itself, an effect created in a reactive context). Read the diff, not only the report.

## 8. Verification rules (STRICT, CLAUDE.md — repeat in every lane and sub-agent prompt)

- Only the changed project:
  `npx nx test <project> --testFile=<spec-file-name> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  (never `--testPathPattern`), the whole changed project with
  `npx nx test <project> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`,
  then `npx nx typecheck <project> --parallel=1 --skip-nx-cache` and
  `npx nx lint <project> --parallel=1 --skip-nx-cache`.
- One heavy check at a time. No workspace-wide runs, no `nx run-many` over unchanged projects,
  no build/serve/dev/e2e/package (the final Electron run is the one user-approved exception),
  no npm install, no `--max-old-space-size`, no `content-visibility`. Filter output.
