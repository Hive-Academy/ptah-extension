# HANDOFF 2 — TASK_2026_683_3c29 (motion), TASK_2026_685 + 633 (plan), TASK_2026_632 (child session)

Written 2026-10-17 (second hand-off, session token budget). Read this file first, then
`decisions.md` (this folder, O1-O12) and `implementation-plan.md` (approved; U1-U6 and D1-D12 are
binding). The first hand-off is in git history (`git show c6a4cafca:.ptah/specs/TASK_2026_683_3c29/HANDOFF.md`).

## 0. Rules to keep
- CLAUDE.md memory-safe checks: scoped `-p`, `--parallel=1`, Jest `--maxWorkers=2`, ONE heavy check at
  a time (other sessions run heavy jobs on this machine too). NEVER pass `--maxWorkers` to `typecheck`.
- Implementers = codex CLI lanes (`ptah_agent_list` first; load the agent-lanes skill; never AT LIMIT).
  Reviewers = Claude subagents. Lanes never commit. Commit in the foreground; `git push` +
  `gh pr create` as ONE background command (pre-push runs di-lint + the Electron validate-deps gate).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Scopes: `.commitlintrc.json`.
- Electron is a shared slot. Before a launch: SendMessage "Electron: <task> launching" to the other
  sessions (ListAgents); after: "Electron: free". Peers now: 679 = `ptah-ptah-extension-task-679-session-lis-57598a0000s402qggi70y0m`
  (needs Electron later for e2e; it announces first), 685 docs = `ptah-docs-lane-header-proof-451ab2d3f2f3-179ec70000s402qggi70y0i`.
  At hand-off: 679 sent "Electron: free" (01:3x); 683 told 679 it will announce before M1.
- **Any Electron launch MUST set `NODE_ENV=development` and a private userData copy.** Without it the
  userData override is ignored and the app opens the user's PRODUCTION profile (see section 5).
- Build/e2e only as approved: U4 = one renderer build + the Electron perf spec (M1 still due).
- No local-only branch at the end: push + PR every finished branch, report the link.
- Ask the user only about removals, scope changes, irreversible actions.

## 1. Done in this session
- PR #739 merged (main `71820e0c0`). Its 2 CodeRabbit comments are fixed as the FIRST commit of the 683
  branch (user request).
- `feat/nav-session-motion` rebased onto main 71820e0c0 (decision O1). All 683 code committed, NOT pushed:

| Commit | Content |
| --- | --- |
| `824a75319` | fix(chat-streaming,chat): CodeRabbit review of PR #739 (`latestTodoWrite` copy; replayer skips owners missing from `messageEventIds`) |
| `82b40f23f` | feat(core,webview): B1/B2 view transitions + motion tokens |
| `bbc50dcb6` | feat(chat): B2 Electron surface name + B3 deferred URL correction (+ R5 finding 6 re-queue) |
| `b11438470` | feat(chat): B4 visible-turn entrance + B7 first-frame scroll restore (`afterNextRender` write) |
| `653054784` | feat(chat): B5 tab-keyed entrance, CV-2.1 removed (+ R5 findings 1, 2 tests) |
| `8f9961208` | test(e2e): B0 perf recorder, probeVersion 3 (R5 findings 10, 11) |
| `c6a4cafca` | docs(task-specs): reports, reviews, M0 (`m0.json` probe 3) |
| `a3bc82d6a` | feat(canvas): B6 lane fade removed, `rail-pane-enter` on the new split pane |
| `8a994c2a7` | docs(task-specs): TASK_2026_653 cancelled, 674/675/676 done, B6 docs |

- Reviews (Claude vs codex): B5+B3/B4fix+B0fix4+CR739 REVISE -> R5 fix round -> re-review APPROVED;
  B7 APPROVED -> fix round (2 Moderate) -> re-review APPROVED; B6 APPROVED 8/10. Files:
  `code-logic-review-B5-B3B4fix-B0fix4.md`, `-R5-fix.md`, `-B7.md`, `-B7-fix.md`, `-B6.md`.
- Checks run on the final code (all PASS): `nx run-many -t test -p core chat chat-streaming`;
  `typecheck,lint` for core, chat, chat-streaming, ptah-electron-e2e, ptah-extension-webview;
  `nx run-many -t typecheck,lint,test -p canvas`; webview-routing spec 81/81; transcript Jest 20 suites /
  241 tests. Finding-1 mutation (remove `clearTimeout` at chat-view.component.ts:701) fails the destroy
  test (6/7); file restored identical.
- M0 re-recorded with probe 3 on the BASE dist (6c0490f1f, pre-#739; decision O7): `complete: true`,
  `probeVersion: 3`, 102 windows; F6 still present; 43/102 windows have a long task > 50 ms.
  Frame strips (`measurements/m0-frames`, 220 MB) stay local (decision O8, `.gitignore` rule).
- 685: pointer files removed; real-app capture done (18/19 + 2 extras, "71h" reproduced as ~74h);
  docs branch pushed, **PR #742** https://github.com/Hive-Academy/ptah-extension/pull/742 (PNGs local).
- TASK_2026_653 cancelled (user: sidebar-to-modal is done in another session). Folder kept (O10).
- TASK_2026_632 runs in a child session (O11), see section 3.

## 2. TASK_2026_683 — what is left (in order)
1. **M1.** Announce "Electron: 683 launching" to 679, then from the 683 worktree (one heavy job at a time):
   `npx nx build-dev ptah-electron --parallel=1 && npx nx copy-renderer-dev ptah-electron --parallel=1`
   (approved build), then
   `PTAH_MOTION_LABEL=m1 PTAH_MOTION_ASSERT=1 npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts > .ptah/tmp/m1-run.log 2>&1; echo "exit=$?" >> .ptah/tmp/m1-run.log`
   (run in the background; read `exit=` and the soft-assert failures in the log). Check `m1.json`:
   `complete: true`, `probeVersion: 3`, 102 windows. Send "Electron: free" after.
2. **O12 check:** in the M1 S8 frames and layout-shift values, look for a scrollbar flash / shift from the
   B6 `translateX(8px)` pane entrance. If present: fix (opacity only, or clip the container while entering)
   on a codex lane, re-run canvas checks, one short review.
3. **Visual review** (Claude `visual-reviewer`): M1 vs M0 frame strips, dark + light, reduced motion
   (S6) and split pane (S8); write `visual-review.md` + `measurements/m1-summary.md`. Report long tasks
   per U2 (state that M0 is pre-#739, O7).
4. **Commit** m1.json + summaries + visual review (docs(task-specs)); set `task.md` status to `in_review`
   (edit only the `status:` line).
5. **Push + PR** (one background command), base main, title e.g.
   `feat(chat,core,canvas): smooth navigation and session-switch motion`. Body: summary per batch, the
   CodeRabbit commit first, M0/M1 numbers, test plan (checks above + M1), follow-ups below, decisions
   O1-O12. Then message the 685 docs session the PR link (685 task A rebases on B6).
6. Follow-ups for the PR body / new tasks: TASK_2026_629 row 74 (U2 render long tasks: S2 10/10 > 50 ms,
   S4 3/3, S6 331 ms at probe 1); VS Code S7 evidence (U6); tracker timeout for a never-settling
   transition (review finding 7); inspector rows do not restart on a second switch inside 400 ms
   (finding 3); B7 Minor (stale-frame assertion `chat-transcript.component.spec.ts:218-220`);
   `chat-view.component.ts` (2080) and `chat-transcript.component.ts` (1398) over the 700-line limit.

## 3. Work in other places
- **685 + 633 plan: WRITTEN (797 lines, uncommitted, not yet reviewed).** Phase A = one execution
  header + one duration rule (fixes 71h, persists `completedAt`); Phase B = per-subagent live tree that
  survives the parent turn, old subagents rebuilt from the SDK's own saved logs (no new store), then the
  approved removals. It has `## Proposed Removals` P1-P4 (NOT approved: P1 main turn counts drop
  subagent tools/files, P2 restored bubbles show "Load agent output", P3 keep `agent:summary-chunk`,
  P4 leave the stale baseline entry) and `## Clarifications Needed` 1-3 (affect only its batch B5).
  These go to the user together with the plan. Worktree
  `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream`, branch `feat/lane-execution-stream`
  (from main 71820e0c0, no commits). Deliverable:
  `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\implementation-plan.md`
  (Phase A = 685 header + duration fix; Phase B = 685 live stream + 633; parity inventory for the approved
  removals). If the file is missing or incomplete, run the pass again (brief: 685 visual-proof.md in the
  docs-lane-header-proof worktree, 685 section 3b decisions in git history of this file, 633 task.md).
  Then: cross-side review by a codex lane (`implementation-plan-review.md`), max 2 revise rounds, then
  SHOW THE USER the plan before any code (user rule). Commit the plan on `feat/lane-execution-stream`
  and open a docs PR (or keep it until implementation, but report the branch as local-only).
- **685 docs.** PR #742 open (branch `docs/lane-header-proof`, 7 commits incl. `9994e2aa5`). The 685
  session waits; it starts no more work on the branch. Task A rebases on B6 after the 683 PR is pushed.
- **TASK_2026_632: DONE, PR #743** https://github.com/Hive-Academy/ptah-extension/pull/743 (commits
  `32f54f26a` code + `03aeee47c` task-specs; pushed; review NEEDS_REVISION -> one codex fix round ->
  APPROVED). agent-sdk typecheck/lint PASS, tests 3459 pass; 4 suites / 3 tests fail only from the
  environment: worktree Jest maps `marked` to a missing `<worktree>/node_modules/marked` (affects every
  worktree Jest run; also blocks the agent-sdk DI smoke spec and the auth-providers codex-stream-parity
  spec) -> CI must confirm. Open items: default `compaction.subagentHandoffTokens` 150k may be low
  (scope change, not done); the Ptah stop notice is in memory only (replay after restart shows the SDK
  text). Earlier details of the child session: sessionId
  `42eb22f6-656e-4c4f-9146-1a7057e29278`, branch `fix/budget-monitor-stop-reason`, worktree
  `D:\projects\ptah-extension\.claude-worktrees\fix-budget-monitor-stop-reason-63e500ba965b`. Lanes:
  codex/opencode/grok; reviews by its own Claude subagents. First report: fix in agent-sdk
  (`system-message.transformer.ts:665` passes the SDK "stopped by user" summary into `agent_completed`;
  the monitor will record a Ptah stop notice per taskId). It reports again with the PR link. The parent
  session can check it with `ptah_session_status` (a new session is not its parent; read its tab).

## 4. Key files (683)
- Core: `libs/frontend/core/src/lib/routing/surface-view-transitions.ts`; `apps/ptah-extension-webview/src/app/app.config.ts`, `src/styles.css`.
- Chat: `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts`;
  `.../organisms/transcript/{chat-transcript.component.ts, transcript-session-entrance.ts, transcript-entrance.ts}`;
  `.../templates/{chat-view.component.ts, electron-shell.component.ts}`.
- Canvas: `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`, `.../canvas-rail/canvas-rail-board.component.ts`.
- Recorder: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` (probeVersion 3).
- Task: `decisions.md`, `reports/batch-*.md`, `code-logic-review-*.md`, `measurements/{m0.json,m0-summary.md}`.

## 5. Open problems for the user
- **Production-profile incident (00:47-00:50).** The 685 screenshot agent's first launch omitted
  `NODE_ENV=development`, so Electron ran ~3 min on `C:\Users\abdal\AppData\Roaming\Ptah` and
  `~/.ptah/state/ptah.sqlite` while the user's Ptah ran. Read-only actions only; process killed. Logs:
  `docs-lane-header-proof-451ab2d3f2f3\.ptah\specs\TASK_2026_685_64f4\screenshots\_harness\electron-INCIDENT-prod-launch.*`.
  The user's Ptah still ran and wrote the DB at 01:18. No sqlite3 CLI, so no integrity check.
- **Side effect found at hand-off:** at 00:48 that launch rewrote the ptah MCP entry in
  `D:\projects\ptah-extension\.mcp.json`, `D:\projects\seshat\.mcp.json`, `D:\projects\nx-video\.mcp.json`
  to port **51821**, but the production Ptah (PID 36432) listens on **51820**. 679's dev runs did the
  same for `property-hub` and `ptah-final-run-ws` (51821). Not changed by this session (user config);
  the user should reopen those workspaces in production Ptah (or set the port back to 51820).

## 6. Local-only branches at hand-off
- `feat/nav-session-motion` — 9 commits, not pushed (push after M1, section 2).
- `feat/lane-execution-stream` — no commits (architect plan in progress).
- `fix/budget-monitor-stop-reason` — pushed, PR #743 (not local-only).
