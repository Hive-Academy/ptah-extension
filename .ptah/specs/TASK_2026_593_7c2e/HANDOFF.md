# HANDOFF - TASK_2026_593_7c2e Attention-first notifications (snackbars, OS notifications, bell)

Written 2026-10-19 by the orchestrator session that continued `c6b9728a`.
Sibling task in parallel: TASK_2026_702_594d (Chat start screen), handoff at
`D:/projects/ptah-extension/.claude-worktrees/chat-start-screen/.ptah/specs/TASK_2026_702_594d/HANDOFF.md`.

## Goal

Show only things that need the user (permission requests, ask-user questions, failures) in small
snackbars, a bell with Needs you / Recent, and OS / VS Code host notifications; Clear all; no
"Finished" notifications. Host notifications ALWAYS include the session title (decision #21).

## Where

- Worktree `D:/projects/ptah-extension/.claude-worktrees/attention-notifications`, branch
  `feat/attention-notifications` from origin/main `eed1fac30`. `node_modules` is a junction (remove
  with `cmd //c rmdir node_modules` before `git worktree remove`).
- Task folder `.ptah/specs/TASK_2026_593_7c2e/` (decisions #1-#37).
- **Commits (local only, no remote, no PR):**
  - `0a56a8ba0 docs(task-specs): add TASK_2026_593 attention notification specs`
  - `c6b32da8e feat(notification-center,chat,core,shared): attention bell, snackbars` (Phase A + N1-N5)
  - `3dc6b4e2b feat(shared,platform-core): host notification settings` (B1b)

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| N1-N5 bounded correction | codex lane; Anthropic review APPROVED | `phase-A-correction-report.md`, #33 |
| Phase A checks + commits | typecheck 7/7; lint only the pre-existing webview circular dep; tests green (one load flake in `chat-view.keepalive.spec.ts`, passes alone); no-alpha 11/11; audit 294 | #34 |
| M1-M3 follow-up (uncommitted) | snapshot backoff after queued reconcile; union-key equality; behavioural Electron pending-open spec | `phase-A-minor-followup-report.md` |
| Phase B implemented (uncommitted) | B1a ports (request/failure union), B3a coordinator, B2a+B2b snapshot RPC + guards, B3b VS Code ingress, B3c resolution hooks, B4a+B4b Electron, B5a+B5b VS Code, B6a+B6b CLI | `batch-B*-report.md`, #35 |
| Phase B review cycle | REVISE 6/10 -> fix round F1-F3 -> REVISE 7/10 -> round 2 L1/L2 + orchestrator edits -> final **APPROVED 8/10** | `code-logic-review.md` (last 4 sections), #36, #37 |
| Typecheck before round 2 | 15 projects; only error `vscode-host-attention-notifications.ts:75` (fixed by orchestrator) | #37 |

Orchestrator edits this session: `runHostAttentionContract` moved to the testing barrel
(`@ptah-extension/platform-core/testing`); `Thenable.catch` fix at
`vscode-host-attention-notifications.ts:75`; `chat-failed-turn-attention.service.ts` uses the
10-reason failure allowlist (+ spec); census `host-attention-ingress.spec.ts` exempts the ownerless
MCP producer.

## In progress / open

- No lane or subagent is running.
- **Phase B + M1-M3 are uncommitted and NOT checked after revise round 2.** Revise cap is exhausted:
  if checks fail, fix only the failing lines (orchestrator edit or one bounded lane), then an
  independent review of that change.
- Carry-forward (#37): Moderate X1 Electron burst resolve re-shows a toast without `isEligible()`
  (`electron-host-attention-notifications.ts:100-108`); Moderate X2 no `isReplayMessage` guard on the
  result branch (`sdk-message-transformer.ts:327-335`); Minors listed in #37.
- Accepted limits (#37): MCP approvals in-app only; metadata-missing requests dropped from host
  attention; VS Code burst summary not retractable. Tell the user in the PR description.
- Still to do after Phase B: A8 (#30: `SURFACE_FOCUS_ROUTER` registration, tab-less owner mapping,
  `surfaceKind`), Phase C (C1 chat notice migration, C2 git notice migration, C3 back-office
  failures; rows in `implementation-plan.md` "Phases and file-disjoint lane batches").
- Known pre-existing failure: `ptah-extension-webview` lint circular dependency (`app.routes.ts:224`).

## Exact next steps

1. Read this file, `decisions.md` #33-#37, `code-logic-review.md` (sections from "## Phase B review"
   to the end), `phase-B-fix-F*-report.md`, `phase-B-round2-L*-report.md`.
2. Scoped checks (one heavy job at a time on the machine; tell peers; tests > 10 min, background):
   ```bash
   cd /d/projects/ptah-extension/.claude-worktrees/attention-notifications
   P="@ptah-extension/platform-core @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/vscode-core @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/cli-engine @ptah-extension/cli-agent-runtime @ptah-extension/vscode-lm-tools ptah-electron ptah-cli ptah-extension-vscode @ptah-extension/core @ptah-extension/chat"
   npx nx run-many -t typecheck -p $P --parallel=1 --output-style=static 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "error TS|Successfully ran|failed"
   npx nx run-many -t lint -p $P --parallel=1 --output-style=static 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\s+[0-9]+:[0-9]+\s+error|Successfully ran|failed"
   for p in $P; do echo "== $p"; npx nx test $p --parallel=1 --output-style=static -- --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL |●.*›" | head -8; done
   npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep Tests:
   npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts | tail -1   # must stay 294
   ```
   Confirm the run-many headers say 15 projects. RPC guard specs (`rpc-surface.spec.ts` x3) must be
   green now (B2a+B2b landed).
3. Commit in the foreground with hooks (read `.commitlintrc.json`, subject <= 72, body lines <= 100):
   - `fix(notification-center,chat,core): ...` for M1-M3 (libs/frontend files of the follow-up);
   - Phase B as one or a few commits by area, e.g. `feat(platform-core,agent-sdk,rpc-handlers,...)`;
     keep B2a+B2b in the same commit as the coordinator (#28); B3a and B4a in the same push (di-lint);
   - `docs(task-specs): ...` for the new task files and this handoff.
4. Push + `gh pr create` in one background command now that B2 and B4a are in (#28). PR body: list
   the accepted limits and carry-forward X1/X2. Tell the TASK_2026_702 orchestrator when the PR
   containing A2-A5 merges (702 phase 3 waits for it).
5. Then A8 (#30) and Phase C (C1-C3) per plan; after each phase: Anthropic code-logic review -> one
   codex fix round -> commit. Max 3 codex lanes; `ptah_agent_list` before every spawn; never AT LIMIT;
   parallel lanes run no nx/jest.
6. Electron visual check (dark + light) vs prototype: announce "Electron: <session> launching, port
   <free port>, private APPDATA" to every peer (ListAgents) first, "Electron: free" after.
7. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex lanes implement; Anthropic subagents do document and
code-logic reviews; memory-safe scoped checks only; never `text-base-content/NN`; audit must not rise;
commit foreground with hooks, push background; no `--no-verify`; never edit
`orchestra-canvas.component.ts`; `BackOfficeActivityService` stays. Codex weekly 59% at handoff.
