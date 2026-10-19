# HANDOFF — TASK_2026_703_2b9e (2026-10-19)

## Goal

Follow-up of PR #751 (TASK_2026_685): visible message input for sub-agent and CLI lanes, a shared
lane stats bar, open #751 review/visual defects, and full removal of the dead
`agent:summary-chunk` path. Brief: `context.md`. Plan: `implementation-plan.md` (see its
"User decisions (2026-10-19)" section).

## Location

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\lane-input-and-stats`
- Branch: `feat/lane-input-and-stats`, based on `main` at `15fe6031a` (#751 merge).
- `node_modules` is a junction to the main checkout. Never `npm install` here. Remove it with
  `cmd /c rmdir <worktree>\node_modules` before `git worktree remove`.

## User decisions

- Decision 1: the lane does NOT show summary-chunk text. F5 skipped. `summaryContent` deleted.
- Decision 2: the VS Code single chat uses the full lane when a monitor record exists (F6).
- Plan approved: F1-F4, F6. Later the user added F7: remove the whole `agent:summary-chunk`
  path ("our new subagent streaming has a flag for that" = `forwardSubagentText`).
- Deferred to other tasks: D2 (restored lane has no facts, backend `subagent:history-page`),
  m2, m4, m5 tail (`WorkflowPermissionPresenterService`).

## Done (NOT committed)

All work is uncommitted in the worktree (~67 changed files). Batch reports are in
`reports/batch-F1..F7-report.md`.

| Batch | Content | Checks reported by the developer |
|---|---|---|
| F1 chat-streaming | `taskDescription` on the monitor record (D6); m1, m3, D5a store fixes | test 688 pass, typecheck, lint 0 errors |
| F2 chat-ui | new `molecules/agent-lane-stats/agent-lane-stats.component.ts`; `agent-steer-input` `draft` is `model('')` | test 1471, typecheck, lint |
| F3 chat | `utils/lane-stats.adapters.ts`, `utils/subagent-follow-up-prompt.ts`, `organisms/subagent-lane/subagent-lane-composer.component.ts`; lane rework; CLI bar; deleted `subagent-usage-summary.component.ts` | test 4491, typecheck, lint |
| F4 canvas | CLI follow-up input under the CLI lane card (`canvas-lane-view.component.ts`) | test 421, typecheck, lint |
| F6 chat | `single-chat-subagent-view.component.ts` shows the lane | Jest 50, typecheck |
| F7 many | removed constant, baseline entry, router entry, IPC batching entry, handler, accumulators (`agentSummaryAccumulators`, `agentContentBlocksMap`), `buildInterleavedChildren`, `SessionManager.bufferAgentChunk`, `ExecutionNode.summaryContent`, e2e emitter | typecheck on 10 projects; tests shared 3675, core 1285, chat-execution-tree 30, chat-streaming 684, chat-ui 1471, chat 4479; Electron `ipc-bridge.batching.spec.ts` 9 |

The orchestrator did NOT yet review the diff or re-run checks.

## Related work already finished

- PR #768 (`fix/chat-plain-text-and-paths`) MERGED 2026-10-19 02:51 UTC: tool rows show the file
  name only, short plain-text fences become `code-block-note`, lane "result card" for trailing
  `WROTE:` lines (`libs/frontend/chat-ui/src/lib/utils/lane-result.utils.ts`,
  `molecules/lane-result/`), wired in `execution-node.component.ts` and
  `agent-card-output.component.ts`. Its worktree and local branch are removed.

## Open problems

1. **Rebase needed.** `main` now contains #768 and possibly more. Likely conflicts:
   `libs/frontend/chat-ui/src/index.ts` (both add exports), `execution-node.component.ts`,
   `agent-card*` files, prettier-only hunks.
2. **One reference left** to the removed type in
   `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts` (Grep
   `summary-chunk|SUMMARY_CHUNK|agentSummaryAccumulators`). Confirm it is a comment, or remove it.
3. **Stale comment** in `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:443`
   mentions `summaryContent`. The parallel task is merged now, so fix it here.
4. **Baseline gate:** `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` says a
   change needs a "Gate 2 exception in TASK_2026_610". The entry was removed. Record the
   exception in the commit body / PR, or check that file's rule.
5. **Formatting-only diffs** in `agent-card.component.ts` and `session-history-replayer.service.ts`.
   Prettier dropped the space in `Status: `; the developer added a margin class and made
   assertions whitespace-tolerant. Check it visually.
6. Send button says "Send steer message" in follow-up mode (finished agent). Consider a
   mode-specific label.
7. Canvas tests were not re-run after F7 (typecheck passed).
8. Left on purpose (separate cleanup): `AgentInfo.summaryContent` / `hasSummary`, unused
   `AgentExecutionComponent`.

## Next steps

1. Read `implementation-plan.md` and `reports/batch-*.md`. Review `git diff --stat` and the key files.
2. Fix open problems 2, 3 (and 6 if quick).
3. Commit the work in the worktree in the foreground, one commit per batch or one feature commit
   (read `.commitlintrc.json`; scopes include `chat`, `chat-ui`, `chat-streaming`? — check the enum;
   subject <= 72 chars, body lines wrapped at 72).
4. `git fetch origin && git rebase origin/main`, resolve conflicts.
5. Re-run scoped checks, ONE at a time (never workspace-wide, never build/serve/e2e):
   ```
   npx nx run-many -t test -p shared core chat-execution-tree chat-streaming chat-ui chat canvas --parallel=1
   # confirm the header says "Running target test for 7 projects"
   npx nx run-many -t typecheck -p shared core chat-types chat-execution-tree chat-streaming chat-ui chat canvas ptah-electron ptah-electron-e2e --parallel=1
   npx nx run-many -t lint -p chat-streaming chat-ui chat canvas --parallel=1
   npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/ipc/ipc-bridge.batching.spec.ts --coverage=false --maxWorkers=2
   ```
   Pipe output through `| tail -40`. Use the exact Nx project names (check with `npx nx show projects`).
6. Run a code review (code-logic-reviewer and code-style-reviewer) on the branch diff.
7. Push and open the PR in one background command:
   `git push -u origin feat/lane-input-and-stats && gh pr create --base main ...`
   (pre-push runs di-lint and Electron `validate-deps`). Report the PR link.
8. Electron coordination: sessions announce "Electron: <task> launching" and "Electron: free".
   At handoff, task 699 (port 9391) and task 662 (port 9390) had both sent "Electron: free".
   This task's next steps
   need no Electron; if you start it, confirm first that no other session uses it.
