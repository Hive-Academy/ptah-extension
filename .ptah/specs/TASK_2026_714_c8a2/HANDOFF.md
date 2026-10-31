# Session handoff — TASK_2026_714_c8a2 (session 36)

Written 2026-10-31. Replaces the session 35 handoff (`git show 85a7c64bd:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`;
its Goal, Routing facts and Rules stay valid). Older: session 34 `805991a08`, 33 `ce6d949f4`, 32 `180c7ef68`,
24 `44e3b1102` (full goal, PR table), Electron live-test procedure `e10bb860a`.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823 https://github.com/Hive-Academy/ptah-extension/pull/823,
do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W; the main checkout stays clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and CLI lanes; then
Removal B (P10: 10e/10f, `@openai/codex-sdk` lanes) and Removal A (P15). Electron first. Native UI contracts
identical to Claude's; gaps fixed only in the backend translation layer; no frontend Codex special case; no second
proxy; NEVER strip/revert/comment out MCP. 10e/10f only after the user signs the 10d.P parity proof; then P14
(incl. GAP-3), D9, P15.

Routing: codex (model `gpt-6-sol`, never `gpt-6.1-terra`) implements. The `claude` CLI lane is DISABLED; codex code
is reviewed by the in-process `code-logic-reviewer` subagent (claude family). Code the coordinator writes is reviewed
by a codex lane. The coordinator runs verify, commit, push. Lane limits at end of session 36: codex confirmed room
(weekly ~63%+, resets 2026-11-04 07:03 UTC); Glm, grok, opencode at limit; Kimi unknown, do not use.

## Done in session 36 (all pushed, CI green on every code head)

| Commit | Subject | CI |
| --- | --- | --- |
| 0feebb6ab | fix(cli-agent-runtime,codex-runtime,agent-sdk): fix native lane blockers (10d.L1-L3 + revisions) | green |
| b7f66eacb | docs(docs): record second Electron live run of native Codex lanes | (docs) |
| c4266a3dc | fix(agent-sdk): queue peer messages for a busy native Codex chat (10d.L4 + revisions 1-2) | green: CI, CLI/Webview/Electron E2E success, MCP Bench skipped |

PR #823 head `c4266a3dc`, MERGEABLE, BLOCKED (draft, REVIEW_REQUIRED).

- 10d.L1 (G1 resume after completed lane): per-host writer registry in
  `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts` (+ three host
  compositions create one registry); resume closes the idle prior context of the same thread first; coded refusals
  `CODEX_LANE_WRITER_ACTIVE` / `CODEX_LANE_WRITER_CLOSE_FAILED`; failed close retryable.
- 10d.L2 (G3/G4): `libs/backend/codex-runtime/src/lib/codex-lane-thread-config.ts` adds
  `default_tools_approval_mode: 'approve'` to the lane `ptah` server only (user servers stay `{ enabled: false }`);
  `codex-lane-events.ts` shows error text instead of "null". Coordinator fixed two exact-frame specs
  (codex-runtime.spec.ts:~120, codex-lane-profile.spec.ts:~147), codex-reviewed APPROVED.
- 10d.L3 (G2 parent): `agent-process-manager.service.ts` bounded (256) tab->session map for later spawns; native
  Codex chat accepts `origin: peer` and renders the peer row like Claude; outcome `parent_session_id` only for an
  active resolved session.
- 10d.L4 (G2 busy race): `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts` bounded (32)
  per-session FIFO for peer messages; `require-idle` refused with Claude's `SessionAdmissionRefusedError`.
- Reviews in T: code-logic-review-10d-L.md (6), -L-r1.md (APPROVED 8.5), -L4.md (7.5), -L4-r1.md (REVISE),
  -L4-r2.md (APPROVED 9), codex-review-coordinator-spec-fix.md (APPROVED). Open minors are listed in
  p10-lane-parity-proof.md section "Corrective batches after the first Electron live run".
- Verify on c4266a3dc tree (11 projects): typecheck,lint 20/20; test 53/55, the 2 failures are only the known
  Windows-only specs (agent-sdk plugin-loader 2 tests, rpc-handlers lineage/symlink 17 tests).
- Second Electron live run (user-authorized; T\live-test-p10dP-r2.md, head 0feebb6ab, 7 of 10 turns, settings cmp 0):
  G1 PASS, G3 PASS, G2 PASS for a fresh lane / FAIL for the resumed lane (busy race -> fixed by 10d.L4), G4
  NOT-OBSERVED.

## In progress / open

- **Third Electron live run is AUTHORIZED by the user but did NOT run.** Its subagent was stopped when the session
  process ended while `build-dev` waited in the verify queue (other worktrees held both slots). No app launched,
  0 paid turns, `~/.ptah/settings.json` equals its backup (`cmp` 0), no root electron.exe runs. Leftover folder:
  `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dL3-20261031-233333\` (Playwright scripts copied from run 2, no
  app.log, no shots). No report `live-test-p10dP-r3.md` exists.
- The 10d.P proof (T\p10-lane-parity-proof.md) stays UNSIGNED until run 3 passes G2-B.
- Remaining gaps (record, fix if cheap, not blockers): G5 token columns NULL and 0 rows in
  `lane_outcome_report_receipts`; no reasoning segments stored; a resume replaces the earlier lane's stored output;
  old app-server exit logged as "Codex process failure"; stale "needs you" banner; raw JSON "Not rendered: unknown
  element" in main-agent summaries; `approve` semantics proven live only indirectly (G3 PASS).

## Key files

- T\p10-lane-parity-proof.md — unsigned proof; corrective-batch table and live results.
- T\live-test-p10dP.md, T\live-test-p10dP-r2.md — live runs 1 and 2 (procedure, scenarios, evidence).
- T\task-10d-L1..L4*.md and batch-10d-L*-report.md — corrective batch tasks and lane reports.
- T\plan-p10.md (10d.P :105-109, 10e/10f after), T\decisions.md (D26-D28).

## Background work

- None for this task. Lanes listed by `ptah_agent_status` (agent dock polish, Motion preference) belong to other
  worktrees; ignore them.

## Next steps (in order)

1. Re-run the authorized third Electron live run (no new authorization needed; it was given in session 36). Use a
   `general-purpose` subagent with the brief pattern of run 2/3: procedure in T\live-test-p10dP-r2.md, new folder
   `%TEMP%\ptah-live-p10dL3-<ts>\`, backup settings.json, `node scripts/verify.mjs --exec --task electron-live-test --
   npx nx build-dev ptah-electron`, `node scripts/copy-wasm.js dist/apps/ptah-electron`, `... copy-renderer-dev
   ptah-electron`, launch with `PTAH_CODEX_RUNTIME_DEV=1 PTAH_NO_DEVTOOLS=1 PTAH_DB_PATH=<F>/ptah.db
   PTAH_SESSIONS_DB_PATH=<F>/sessions.db node apps/ptah-electron/scripts/launch.js --remote-debugging-port=9335
   <F>/ws`; main agent OpenAI Codex / GPT-5.6-Luna, Manual; <=8 paid turns. Scenario A (fresh lane: report +
   completion delivered) and B (resume the completed lane, append "second", report; completion must be queued and
   delivered after the report turn, no `Codex chat turn: busy` / `delivery-failed`, both rows in order). Teardown:
   taskkill only this run's root electron.exe, restore settings.json, `cmp` exit 0. Report to
   T\live-test-p10dP-r3.md. Run it in the foreground (do not leave it running at a handoff). The build waits for a
   verify slot: `node scripts/verify.mjs --status` shows the queue.
2. Commit the run-3 report + proof update (foreground, message file, trailer), push in background.
3. If G2-B passes: update the proof rows from PENDING-LIVE to live results and present T\p10-lane-parity-proof.md
   to the user for signing (CLI/TUI/VS Code rows stay PENDING-LIVE unless the user authorizes). If it fails: write a
   corrective codex task (L5), verify, review, commit, push, and ask before another paid run.
4. Only after a signed proof: 10e, 10f (Removal B) per plan-p10.md. Then P14 (incl. GAP-3), D9, P15.

Verify (background, timeout >= 90 min, read rc and "N tasks:"):
`npm run verify -- -t typecheck,lint -p cli-agent-runtime,codex-runtime,agent-sdk,lane-outcomes,cli-engine,rpc-handlers,ptah-electron,ptah-cli,ptah-extension-vscode,degradation-audit,di-lint`
then the same with `-t test`. Expected: 20/20, then 53/55 with only the known Windows-only failures.

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, under the FIFO lock, in the background, timeout
>= 90 min; read rc and the "N tasks:" line; failed task logs are in
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`. Spec files compile only in the test target:
typecheck,lint first, tests second. Never build/serve/e2e except an approved Electron live run. Never npm ci/install
in a worktree. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; bracket `process.env['X']`; swallowing
catches need `// degradation-audit: optional-capability|reported - <reason>`. Specs must pass on Windows and Linux.
Lanes never verify, commit, push or call ptah_get_diagnostics (first lines of each lane task); deliverable paths
absolute; tell lanes to write LF and not convert line endings (a lane converted three agent-sdk files to CRLF in
session 36; check `tr -cd '\r' < file | wc -c` on every lane-written file). Never commit, push or merge while a lane
edits W or a verify runs; never edit W while a verify runs (reviewers write to %TEMP% and the coordinator copies).
Commit in the foreground (commitlint scopes from .commitlintrc.json, subject <= 72, body lines <= 100, no BOM,
message file + `git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the
background. No PR merge, force push, history rewrite, branch deletion or worktree removal. Do not edit
~/.codex/config.toml; ~/.ptah/settings.json only via the approved live-test backup/restore with `cmp`. NEVER strip
MCP. jq is not installed: use `gh --jq`. A live or paid run needs explicit user authorization.
