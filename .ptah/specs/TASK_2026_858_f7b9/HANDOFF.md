# HANDOFF — TASK_2026_858_f7b9 (Ptah remote workers)

Written 2026-11-04 ~18:15 UTC by the orchestrator session. Supersedes every earlier HANDOFF.md
(including the one on branch `feat/remote-workers-v2`).

## Goal

Control Ptah on the LAN machines Horus, Anubis and Chappie from the Electron desktop (later a
mobile PWA). The worker exposes WS `/rpc` on port 41873, reached through an `ssh -W` client;
JSONL event log. Libs: worker-protocol, worker-runtime, remote-machines, machines-ui, worker-host
(Round 6: headless Electron worker = desktop binary in Node mode via a `ptah-worker` launcher).

## User decisions (this session)

- 2026-11-04: Mark PR #927 ready; start Phase D on a NEW branch. Phase D needs Phase A–C code, so
  the new branch is stacked on `feat/remote-workers-v2`; its PR #928 targets
  `feat/remote-workers-v2` and moves to `main` after #927 merges.
- Approved and done: removed temporary worktree `.claude-worktrees/rw2-ci-merge` (it held only an
  old merge of origin/main; checked file by file).
- User asked to fix PR #927 CodeRabbit comments and conflicts "so I can merge it" — done (below).
- Still unanswered: fleet ops O1–O5 and G-M on Horus (ask before Phase F); the user did not
  confirm the decision-model 60 s timeout in the Ptah UI. Earlier decisions: decisions.md rows 12–24.

## Done

### PR #927 — https://github.com/Hive-Academy/PtahCode/pull/927 (branch feat/remote-workers-v2)

- Ready for review (not draft). Head **2feae6acf**. `MERGEABLE`, state `BLOCKED` only by
  `REVIEW_REQUIRED` (a human approval). CI: 17 pass, 4 skipped, 0 fail (macOS `git-real-git`
  was cancelled once and `webview-e2e` failed once on `marketplace-servers.e2e.spec.ts:322`, a
  remount race unrelated to this PR; both passed on rerun).
- 0e526814d `fix(platform-core,rpc-handlers,worker-protocol): address pr 927 review` — all 6
  CodeRabbit inline findings + 1 nitpick (Claude subagent). Codex review APPROVED 8/10
  (`.ptah/specs/TASK_2026_858_f7b9/pr927-coderabbit-round-1-review.md` on that branch).
- 5045265f5 merge of origin/main (conflicts in package.json, apps/ptah-electron/package.json,
  nx.json, libs/shared/src/lib/types/rpc.types.ts, package-lock.json — kept both sides; lock =
  main's regenerated with `npm install --package-lock-only --ignore-scripts`). Verify `shared`
  passed; typecheck `rpc-handlers,ptah-electron,ptah-extension-webview` passed.
- 2feae6acf docs: review record. All 6 review threads replied to and resolved.

### PR #928 — https://github.com/Hive-Academy/PtahCode/pull/928 (draft, branch feat/remote-workers-phase-d, base feat/remote-workers-v2)

Worktree: `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-d` (node_modules
symlink to the main checkout). Head **9c010737f**, pushed. Implementers: Codex lanes; the
orchestrator ran every verify and made small corrections (recorded in each batch report).

| Commit    | Batch                                                                                                 | Verify                         |
| --------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| 8acca2282 | 14 worker state stores, pairing window                                                                | worker-runtime pass            |
| 62448b674 | 15 event log, writer, fan-out                                                                         | pass                           |
| 1d03d48fc | 16 method table, authorizer, in-process RPC, capabilities (+ Jest reflect-metadata/vscode/wasm mocks) | pass                           |
| c23f8e052 | 17 session driver, transcript, approvals (fixed no-unsafe-finally)                                    | pass                           |
| 64837933b | 18.1–18.2 server, connection, readiness, service                                                      | pass                           |
| b30a0feb6 | 18.3 security spec suite (Claude senior-tester) + redact.ts admin-key fix                             | 24 suites, 98 tests            |
| dbc8f54d8 | 19.1 worker-host scaffold (scope:cli, alias, nx globs, commit scope)                                  | worker-host pass               |
| 9c010737f | 19.2 PARTIAL: operator commands, serve boot, lazy engine load                                         | worker-host 3 suites, 16 tests |

## In progress

Task 19.2 (`libs/backend/worker-host/src/lib/**`), see `batch-19.2-report.md` "Not done":

- Remote session and permission methods are not composed into the worker service handler
  (only `machine.info`, `workspaces.list`); `maxActiveTurns` parsed but unused; push adapter tap
  and lock-release callback are placeholders.
- `admin.status` returns an empty locks array; readiness auth route uses a synthetic Claude CLI
  config, not the engine's provider config; pairing status attempt count not updated.
- `workspace remove` / `grants add` rewrite files without a cross-process lock.

## Open problems and notes for the Phase D review

- worker-runtime imports the full `@ptah-extension/rpc-handlers` barrel (heavy graph:
  vscode-core, workspace-intelligence) for the host profile — check for a narrower import.
- Internal `CODEX_UNAVAILABLE` maps to wire `INTERNAL` (W12 fallback) — Batch 18 decision.
- redact.ts: a bare 8-char pairing code (no dash) in free text is not masked; `code` keys not
  redacted (error codes use `code`).
- Batch 14 has thin specs (8 tests originally).
- Open minor follow-ups from Phase C: decisions.md row 24.
- Known load flakes (pass alone): mcp-bench `snapshot-audits`, platform-core
  `file-settings-manager.bench`, `agent-pack-download` A2, ptah-electron `git-watcher.real-git`.

## Key files

- `/home/amun/ptah-extension/.claude-worktrees/remote-workers-phase-d/.ptah/specs/TASK_2026_858_f7b9/batches.md` — batch status (14–18 COMPLETE, 19.1 COMPLETE, 19.2 IN PROGRESS, 19.3/19.4 PENDING).
- `.../TASK_2026_858_f7b9/implementation-plan.md` — W1–W12, C6, C7, Round 6 (R6.x, AD-26…29).
- `.../TASK_2026_858_f7b9/batch-14…19.2-report.md`, `batch-18.3-test-report.md` — per-batch decisions and orchestrator corrections.
- `.../TASK_2026_858_f7b9/decisions.md` — user decisions.
- `/home/amun/ptah-extension/libs/...` is the MAIN checkout: never edit it.

## Background work

None running. Last lane 581a7c0d (Task 19.2 continuation, Codex session
01a1a7a2-b84f-7e73-8aa8-739a7ab04a25) reported; its work is committed in 9c010737f. A late
`<agent-lane-completed>` for it needs no action.

## Next steps

1. Watch PR #927: it waits only for the user's approval/merge. Re-check
   `gh pr view 927 --json mergeStateStatus,reviewDecision` and new CodeRabbit comments
   (`gh api repos/Hive-Academy/ptah-extension/pulls/927/comments`); fix task-related findings in
   `.claude-worktrees/remote-workers-v2`.
2. Finish Task 19.2 (open items above). Resume the Codex session with `resume_session_id`
   01a1a7a2-b84f-7e73-8aa8-739a7ab04a25, or start a new lane with a narrow brief. Verify:
   `npm run verify -- -p @ptah-extension/worker-host` (and `-p @ptah-extension/worker-runtime`
   if it changes).
3. Task 19.3 desktop packaging (ptah-electron project.json `build-worker-host`, launcher,
   systemd unit, electron-builder extraResources, validate-deps, packaging spec), then 19.4
   `docs/worker.md` + table spec. Verify: `npm run verify -- -p @ptah-extension/worker-host,ptah-electron`.
   Never run build/build-worker-host/serve/package targets.
4. Phase D review (Batches 14–19): code-logic + style + review-security, by a different family
   than the implementer (implementers mostly Codex → Claude reviewers; Claude-written parts:
   18.3 specs, redact fix, orchestrator corrections → Codex reviewer).
5. After #927 merges: in the phase-d worktree, `git fetch origin main && git merge origin/main`
   (no rebase, no force push), verify, push, then `gh pr edit 928 --base main`.
6. Before Phase F: ask the user about fleet ops O1–O5 and G-M.
