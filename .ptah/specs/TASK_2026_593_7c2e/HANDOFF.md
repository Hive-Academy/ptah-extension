# HANDOFF - TASK_2026_593_7c2e Attention-first notifications (snackbars, OS notifications, bell)

Written 2026-10-20 by the orchestrator session `task-593-702` (it continued the 2026-10-19 handoff).
Sibling task: TASK_2026_702_594d (Chat start screen), handoff at
`D:/projects/ptah-extension/.claude-worktrees/chat-start-screen/.ptah/specs/TASK_2026_702_594d/HANDOFF.md`.

## Goal

Show only things that need the user (permission requests, ask-user questions, failures) in small
snackbars, a bell with Needs you / Recent, and OS / VS Code host notifications; Clear all; no
"Finished" notifications. Host notifications always include the session title (decision #21).

## Where

- Task folder `.ptah/specs/TASK_2026_593_7c2e/` (decisions #1-#47).
- **PR #780 MERGED** 2026-10-20 (phases A + B, M1-M3, merge of main, 5 CodeRabbit fixes).
- **Phase C PR**: branch `feat/attention-phase-c`, worktree
  `D:/projects/ptah-extension/.claude-worktrees/attention-notifications` (node_modules junction).
  Opened against `main` at the end of this session (link in the final message; find it with
  `gh pr list --head feat/attention-phase-c`). Contains A8, C1-C3, the phase C fix rounds and the
  CodeRabbit post-merge follow-up on #780 (lane-release guard), merged with main.
- Extra worktree `D:/projects/ptah-extension/.claude-worktrees/attention-pr780` (branch
  `feat/attention-notifications`, already merged). Remove it only when the user says:
  `cmd //c rmdir .claude-worktrees\attention-pr780\node_modules` then
  `git worktree remove .claude-worktrees/attention-pr780`.

## Done this session

| Step | Result | Evidence |
| --- | --- | --- |
| Phase B checks + fixes | TS null narrowing, no-control-regex, 3 audit suppressions, ~25 spec suites (codex lane, 2 turns) | #38-#40 |
| PR #780 | opened, conflict merged (electron-shell), 5 CodeRabbit comments fixed + replied, merged | #46 |
| A8 | surface focus routers (setup-wizard, harness-builder, mcp-apps), per-lib providers registered in webview `app.config.ts`, tab-less Open mapping | #41, #42 |
| C1-C3 | `NOTICE_ACTION_HANDLER` (core), ActionBanner + voice failures to attention, old voice toast deleted (move, not removal), root git status attention (observe-only; shell keeps the push gate), back-office failures | #42-#45 |
| Phase C review | REVISE 6/10 -> fix round -> APPROVED 8/10; check-fix round + #780 follow-up -> APPROVED 8/10 | `code-logic-review.md`, #44-#47 |
| Phase C local checks | after the last fix round only the changed specs ran (review-shell 51, chat-view 89, coordinator 38, eslint 0 errors, audit 291). The full scoped re-run was skipped at the user's request; **CI is the check** | #47 |

## Open / next steps

1. **Watch CI on the Phase C PR.** If a job fails, read only the failing job log
   (`gh run view --job <id> --log-failed | grep ...`), fix with one bounded codex lane, independent
   Anthropic review, commit, push. Address CodeRabbit comments the same way (verify each first).
   Scoped local re-check if needed:
   `npx nx run-many -t typecheck,lint,test -p @ptah-extension/core @ptah-extension/chat @ptah-extension/git-ui @ptah-extension/setup-wizard @ptah-extension/harness-builder @ptah-extension/mcp-apps-page @ptah-extension/agent-sdk --parallel=1`
   plus `ptah-extension-webview` typecheck, the webview `git-dock-arming-identity` and
   `no-alpha-base-content` specs, and the audit (must stay <= 291).
2. **Tell the TASK_2026_702 session/user that #780 is merged** (done in the 702 handoff): 702
   phase 3 (needs-you chip removal) is unblocked.
3. **Electron visual check** of the attention UI (bell, Needs you / Recent, snackbars, OS
   notification flow) in dark + light vs the prototype: it was never done. Announce
   "Electron: <session> launching, port <free port>, private APPDATA" to every peer first.
4. **Deferred later tasks** (decision #44, carry-forward #37): M4 git warning cannot clear while
   the git dock is closed and a first-read failure without last-good data raises no warning
   (accepted limit #43); M6 stable voice key per direction; M7 ActionBanner API cleanup + dedupe;
   M8 Open routability computed at projection time; M9 wizard/harness Open disabled for another
   workspace (confirm against #30); X2 no `isReplayMessage` guard on the result branch
   (`sdk-message-transformer.ts`); Minors in `code-logic-review.md`.
5. No local-only branch at the end.

## Standing user rules

Orchestration + agent-lanes skills; codex CLI lanes implement (`ptah_agent_list` before every
spawn, never AT LIMIT, max 3, parallel lanes run no nx/jest); Anthropic subagents do document and
code-logic reviews; memory-safe scoped checks only; one heavy job at a time on the machine
(coordinate with ListAgents/SendMessage, "checks: free" hand-offs); never `text-base-content/NN`;
audit must not rise; commit foreground with hooks, push background; no `--no-verify`; never edit
`orchestra-canvas.component.ts`; `BackOfficeActivityService` public API stays. The user accepts
pushing without a full local re-run and letting CI check. Codex weekly 63% at handoff.
