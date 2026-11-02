# Task 10d.L1 revision 1 — batch R review fixes (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Do NOT convert line endings (keep LF). UTF-8 without BOM. Touch ONLY the files in Scope.
- Another codex lane edits other files in W at the same time (agent-process-manager, lane-completion-outcome,
  agent-sdk codex-chat-adapter). Do not touch them.

## Input

Your earlier batch: T\task-10d-L1-resume-writer.md and T\batch-10d-L1-report.md (current uncommitted diff in W).
Review: T\code-logic-review-10d-L.md, section for batch R (REVISE 6/10).

## Fix

1. MAJOR: `close()` caches `closePromise`, so one failed close stays failed forever and that thread can never be
   resumed in this process. Make a failed close retryable: a later `close()` (the next resume handoff) must try to
   close the context again (note `closeContext` also caches per context in `closePromises`; clear that cache entry
   on failure too). A successful close stays once-only. Keep the coded `CodexLaneWriterCloseError` refusal for the
   resume that saw the failure.
2. MINOR: after `this.writers.set(sessionId, writer)`, re-check `closed`/abort; if the lane was closed or aborted in
   between, remove the entry (only if it is still this writer) and stop. No writer may stay registered after close.
3. MINOR (no code change unless cheap): entries for completed, never-resumed lanes stay until close by design,
   because the live context serves `continue`. Record this under `## Decisions` in the report.
4. Specs in the adapter spec: (a) close fails once, the next resume of the same thread retries the close and opens;
   (b) two concurrent resumes of one thread: exactly one opens, the other gets `CodexLaneWriterConflictError`, the
   prior context closes once; (c) abort during the reservation / between persist and register leaves no registry
   entry, and a later resume of that thread opens normally.

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L1-revision-1-report.md
(write a skeleton early): per finding: what changed (file:line) or why no change; specs added. Reply `WROTE: <path>`
plus one headline line.
