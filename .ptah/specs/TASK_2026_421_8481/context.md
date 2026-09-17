# TASK_2026_421 — Context

## User intent

"Why does the codex cli agent never stop after it finishes?" — then: open it as
its own task and fix it.

## Workspace

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/task-421-codex-agent-completion`
- Branch: `fix/task-421-codex-agent-completion` (from `origin/main` @ f7b2c1670)
- Found while running TASK_2026_420 (agent `bc4db206`, stopped manually).

## Strategy

BUGFIX, Minimal workflow: backend-developer (fix + spec) → team-leader verify
and commit. Scope: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
and its spec.

## Root cause (evidence)

1. `CodexCliAdapter.runSdk` → `runTurn` (`codex-cli.adapter.ts:684-726`) does
   `for await (const event of streamedTurn.events)` and returns 0 only when the
   iterator ends. `turn.completed` only prints the `Usage:` line
   (`handleTurnCompleted`, ~1060).
2. `@openai/codex-sdk/dist/index.js:286-290` (`CodexExec.run`): the iterator
   ends only when `codex.exe` stdout closes, then it awaits the child `exit`.
3. Measured 2026-09-11: agent spawned 18:54:59Z; `codex.exe` pid 15900 started
   18:54:59Z and was still alive >1h later, with a `powershell.exe` child
   (pid 26632, since 18:55:10Z) whose encoded command is the "Long-lived
   PowerShell AST parser used by the Rust command-safety layer on Windows".
   Three other Ptah-spawned `codex.exe` processes showed the same shape.
4. So `sdkHandle.done` never resolves → `AgentProcessManager.handleExit`
   (`agent-process-manager.service.ts:1736`) never runs → status stays
   `running` until the timeout.
5. `codex-cli.adapter.spec.ts:18-31` fakes an iterator that ends right after
   the last event, which hides the defect.

## Fix direction

Return from `runTurn` on `turn.completed` (0) and `turn.failed` (1) after
handling the event. Leaving the `for await` early calls the generator's
`return()`, which runs the SDK `finally` (`rl.close()`, `child.kill()`).
Continuation (`continue()` → `runTurn`) must keep working. Add a spec whose
fake iterator stays open after `turn.completed`.
