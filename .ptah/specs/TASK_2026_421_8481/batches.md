# Batches - TASK_2026_421_8481

Total tasks: 2 | Batches: 1 | Complete: 1/1

Workflow: BUGFIX, minimal. The batch was implemented before this file existed
(see `implementation-notes.md`). The team-leader ran in verify-and-commit mode
only.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- Leaving `for await` early runs the SDK cleanup. Verified in
  `node_modules/@openai/codex-sdk/dist/index.js` (0.147.0).
  `runStreamedInternal` iterates `CodexExec.run`. An early exit calls
  `return()` through both generators. The `CodexExec.run` `finally` then runs
  `rl.close()`, `child.removeAllListeners()` and `child.kill()`. `cleanup()`
  does nothing because no output schema is passed.
- `continue()` survives an early return. Verified: `CodexExec.run` spawns a new
  child for each call and pushes `resume <threadId>` when `Thread._id` is set.
  `_id` is set from `thread.started` before the consumer receives the event.
- `error` is not terminal. Verified locally: the SDK's own `Thread.run` reads
  past `error` and stops only on `turn.failed`. The claim that retryable
  "Reconnecting... n/5" errors come before a turn event is recalled, not
  measured.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| The SDK `finally` now kills a child that is still alive and removes its listeners, including Node's abort-listener removal. A later `abort()` in the window between kill and exit could make the child emit `error` with no listener. | LOW | Checked `agent-process-manager.service.ts`. `sdkAbortController.abort()` is called only from `releaseSubprocess` (idle release, at least `MIN_SDK_IDLE_RELEASE_MS` = 10 s, or TTL), not right after `done`. The window is closed in practice. |
| On Windows, `child.kill()` ends only codex.exe, so the powershell.exe grandchild can remain as an orphan. `rl.close()` does not destroy `child.stdout`. | LOW | Out of scope. It needs a tree kill that the SDK does not do. Recorded in the implementation notes. |
| A `turn.failed` with exit code 0 used to resolve `done` with 0. It now resolves with 1. | LOW | This is intended: the terminal event, not the process exit code, sets the result. |
| The Cursor adapter (`cursor-cli.adapter.ts` ~347) has the same iterator-end pattern. | LOW | Reported only, not changed. Apply the same fix on a terminal `status` message if Cursor agents are seen stuck in `running`. |

Edge cases:

- Iterator that never ends after `turn.completed` — handled in Task 1.1, pinned in Task 1.2
- `turn.failed` on an iterator that never ends — Task 1.1 / 1.2
- A non-terminal `error` event — Task 1.1 (deliberately not a return), pinned in Task 1.2
- A continuation after an early return — Task 1.2
- Abort, startup watchdog, error summarization and the iterator-end path — not changed by Task 1.1 (the `catch` and the final `return 0` are the same as before)

## Batch 1: Codex turn completion — COMPLETE (81828c6a9)

- Recommended executor: backend-developer
- Fallback executor: none needed
- Execution mode: sequential
- Rationale: one adapter file and its spec, tightly coupled
- Tasks: 2 | Depends on: none

### Task 1.1: Return from runTurn on the terminal turn event — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-421-codex-agent-completion/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts
- Plan reference: context.md "Fix direction"
- Implementation: after `handleStreamEvent`, `return 0` on `turn.completed` and
  `return 1` on `turn.failed` (lines 704-720), with a comment that explains why.

### Task 1.2: Specs for a stream that never ends — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-421-codex-agent-completion/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts
- Depends on: Task 1.1
- Implementation: helpers `createNeverEndingEventSource` and `settleWithin`, and
  a new describe block with 4 tests: `turn.completed` gives 0 and `return()`
  is called; `turn.failed` gives 1 and `return()` is called; `error` stays
  pending and `return()` is not called; a continuation after an early return
  gives 0 on the same thread. Additions only (0 deleted lines), so the existing
  specs are untouched.

### Batch 1 verification

Run from the worktree root on 2026-09-11 by team-leader.

- Staged diff read and checked against context.md and the SDK source: PASS
- `git status`: only the 2 intended files were staged. Nothing was unstaged or untracked.
- `npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache`:
  header "Running target test for project @ptah-extension/cli-agent-runtime"
  (1 project). 51 suites passed. 672 tests passed, 1 skipped. Exit 0.
- `npx nx run-many -t typecheck -p @ptah-extension/cli-agent-runtime --skip-nx-cache`: exit 0
- `npx tsc --noEmit -p libs/backend/cli-agent-runtime/tsconfig.spec.json`: exit 0
- `npx nx run-many -t lint -p @ptah-extension/cli-agent-runtime --skip-nx-cache`:
  0 errors, 37 warnings. The 2 warnings on the adapter (`setAgentId` empty
  method, `max-lines`) were already there. The file was 1095 lines at HEAD and
  already over the limit. No new findings.
- `npx prettier --check` on both files: PASS
- Reviewer: no separate reviewer was run. The orchestrator gave team-leader
  the verification gate for this minimal BUGFIX workflow. The continuation and
  process-kill behaviour was verified against the SDK source and the
  AgentProcessManager abort call sites.
- Commit: 81828c6a9 `fix(cli-agent-runtime): end codex turns on their terminal event`.
  Hooks ran and made no reformat changes. Not pushed.
