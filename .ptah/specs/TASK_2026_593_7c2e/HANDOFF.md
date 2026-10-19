# HANDOFF - TASK_2026_593_7c2e Attention-first notifications (snackbars, OS notifications, bell)

Written 2026-10-19 by orchestrator session `c6b9728a` (continuation of `d343b065`).
Sibling task in parallel: TASK_2026_702_594d (Chat start screen), handoff at
`D:/projects/ptah-extension/.claude-worktrees/chat-start-screen/.ptah/specs/TASK_2026_702_594d/HANDOFF.md`.

## Goal

Show only things that need the user (permission requests, ask-user questions, failures) in small
snackbars, a bell with Needs you / Recent, and OS / VS Code host notifications; Clear all; no
"Finished" notifications. Host notifications ALWAYS include the session title (user decision #21).

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/attention-notifications`, branch
  `feat/attention-notifications` from origin/main `eed1fac30`. `node_modules` is a junction (remove
  with `cmd //c rmdir node_modules` before `git worktree remove`).
- Task folder `.ptah/specs/TASK_2026_593_7c2e/` (decisions #1-#32).
- **Nothing is committed. The branch is local only (no remote, no PR).**

## Done this session

| Step | Result | Files |
| --- | --- | --- |
| Gate 2 round 2 | codex lane revised plan (N1-N4, n1-n6, #21); Anthropic re-review **APPROVED**; carry-forward R2-1..R2-3 written into the plan opening section | `implementation-plan.md`, `implementation-plan-revision-2.md`, `implementation-plan-review.md` "## Round 2 re-review", #22 |
| User decisions | #21 session title always in host notices (supersedes #18); #23 bell focus to first enabled row | `decisions.md` |
| Phase A implemented | A1 core model, A2 chat source/dispatcher, A3 bell, A4 snackbar/sound, A5 shell mounts, A5b ledger deleted, A6 shared wire, A7 renderer host consumer | `batch-A*-report.md` |
| B1b implemented | settings `notifications.hostEnabled` (true) and `notifications.failureHostEnabled` (false), both guard specs updated | `batch-B1b-report.md` |
| Phase A review | Anthropic code-logic review REVISE 4/10 (2 Blocking, 9 Serious); contracts for #27 adopted as #29 | `code-logic-review.md`, #29 |
| Fix round | F1 (model/wire) + F2 (presentation, failed-turn projection) | `phase-A-fix-F1-report.md`, `phase-A-fix-F2-report.md` |
| Re-review | **APPROVED**; new N1-N3 Moderate, N4-N5 Minor (#31); S8 remainder moved to batch A8 (#30) | `code-logic-review.md` "## Re-review after fix round" |
| Scoped checks (after F1+F2) | typecheck 7/7; lint 6/6 libs; tests core 1298, shared 3691, notification-center 27, chat 4452, chat-streaming 638, webview 526, platform-core 1107; no-alpha 11/11; audit 294 (baseline) | #32 |

Orchestrator edits: typed two shell `viewChild` reads; moved then restored the `attention:getSnapshot`
RPC registry entries (#24 superseded by #28).

## In progress / open

- No lane or subagent is running.
- **Bounded correction NOT started** (#31): fix N1-N5 from the re-review, then an independent review of
  the changed code, then the Phase A commit:
  - N1 dead unchanged-item skip in `chat-attention-source.service.ts:87-92` + fresh `actions` array
    defeats `Object.is` in `notification.service.ts:95-96`;
  - N2 user Stop (`aborted_*`, `tab-manager.service.ts:1927`) projected as "Session failed" - project
    only real failures;
  - N3 snapshot retry every 2s forever (`chat-attention-host-message-handler.service.ts:130-135`) -
    capped backoff;
  - N4 snackbar dispatch catch sets no status; Electron `openNotifications()` no-op without bell;
  - N5 `ChatFailedTurnAttentionService` drains only when `MODEL_REFRESH_CONTROL` is provided - confirm
    Electron and CLI webview roots provide it.
- **RPC guard specs are red by design** until B2a+B2b (#28): `attention:getSnapshot` is in the
  registry without a handler. Do not push before B2a/B2b and B4a land (also the di-lint rule).
- Known pre-existing failure: `ptah-extension-webview` lint (circular dependency webview <->
  command-center, `app.routes.ts:224`), reproduced on base (#32). Not this task's change.

## Exact next steps

1. Read this file, `decisions.md` (#1-#32), `code-logic-review.md` (incl. "## Re-review after fix
   round"), `phase-A-fix-F1-report.md`, `phase-A-fix-F2-report.md`, `implementation-plan.md`.
2. `ptah_agent_list`, then one codex correction lane for N1-N5 (scope: the files named above and their
   specs; focused Jest only at the end; 30-call cap; deliverable `phase-A-correction-report.md`).
   F2 can be resumed: CLI session `01a1550d-1c14-7890-9fbc-b515304c9d39`; F1: `01a15500-2989-7b20-b0e7-fe8421a087c4`.
3. Independent review of the correction diff (Anthropic; different family from codex).
4. Re-run scoped checks (one heavy check at a time, never workspace-wide):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/attention-notifications
   P="@ptah-extension/core @ptah-extension/shared @ptah-extension/notification-center @ptah-extension/chat @ptah-extension/chat-streaming ptah-extension-webview @ptah-extension/platform-core"
   npx nx run-many -t typecheck -p $P --parallel=1 --output-style=static 2>&1 | grep -E "error TS|Successfully ran|failed|Running target"
   npx nx run-many -t lint -p $P --parallel=1 --output-style=static 2>&1 | grep -E " error |Successfully ran|failed"
   for p in $P; do npx nx test $p --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL "; done
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   The test run takes more than 10 minutes: run it in the background.
5. Commit in the foreground with hooks (read `.commitlintrc.json`): first `docs(task-specs): ...`
   for `.ptah/specs/TASK_2026_593_7c2e`, then Phase A
   (`feat(notification-center,chat,core,shared): ...` - check scope names), then B1b
   (`feat(shared,platform-core): ...`).
6. Phase B: B1a ports (use #29 contracts: `attentionRequestKey`, `workspaceIdFromPath`, `surfaceKind`)
   -> B3a coordinator -> B2a+B2b one integration commit (adds handler + guard specs; makes the RPC
   guards green) -> B3b, B3c -> B4a/B4b Electron (R2-2 teardown) -> B5a/B5b VS Code -> B6a/B6b CLI.
   Order per plan and #22 (R2-3). Then A8 (#30) and Phase C (C1-C3). After each phase: Anthropic
   code-logic review -> one codex fix round -> commit. Max 3 codex lanes; `ptah_agent_list` before
   every spawn; never AT LIMIT; parallel lanes run no nx/jest.
7. Electron visual check (dark + light) vs prototype: announce "Electron: <session> launching, port
   <free port>, private APPDATA" to every peer (ListAgents) first, "Electron: free" after.
8. Push + `gh pr create` in one background command only after B2 and B4a are in. Tell the
   TASK_2026_702 orchestrator when the PR containing A2-A5 merges (702 phase 3 waits for it).
   No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement; Anthropic subagents do document and
code-logic reviews; memory-safe scoped checks only; never `text-base-content/NN`; audit must not rise;
commit foreground with hooks, push background; no `--no-verify`; never edit
`orchestra-canvas.component.ts`; `BackOfficeActivityService` stays. Codex weekly 55% at handoff.
