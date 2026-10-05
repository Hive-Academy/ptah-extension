# Batch 31 report — TASK_2026_614_327a

Executor: backend-developer. Tasks: 31.1, 31.2. Nothing committed; batches.md was not edited.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
  - Task 31.1: `markAllInterrupted` now stamps `lastActivityAt` from the store clock (`this.store.now()`), the same
    clock `update` uses. Only interrupted records are stamped; background, CLI and other-session records are left
    alone.
  - Task 31.2: new `getToolCallIdsByAgentId(agentId, parentSessionId): string[]`. It returns every live
    (non-expired) record in that parent session whose `agentId` matches exactly, and returns `[]` for a blank id or
    session. It returns every match and does not pick one, so the caller can tell "one" apart from "none" and
    "several".
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-core\src\services\subagent-registry.service.spec.ts`
  - Added a `markAllInterrupted` stamping spec, using a `Date.now` spy as the activity spec does.
  - Added a `getToolCallIdsByAgentId` spec: exact match only (a prefix does not match), scoped to the session, all
    matches returned, and `[]` for a blank id or session.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts`
  - Task 31.2 (F-F): the old else-branch handled both "no toolUseId" and "no parent". It is now split:
    - **No parent session:** WARN as before.
    - **Parent known, no toolUseId:** the start goes to the new `bindStartByAgentId`, which works like this:
      - **Exactly one exact match that is `interrupted`:** registered again as running under its own toolCallId,
        keeping its `teammateName` and `taskId` (this is a resume).
      - **Exactly one live match:** `update(id, {})` records the start as activity.
      - **No match, several matches, or the single match is gone on read:** WARN `Subagent NOT registered` with
        `reason` and `matchCount`, and the agent stays unbound.
    - An INFO log records each successful bind.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.spec.ts`
  - The registry mock gained `getToolCallIdsByAgentId` (default `[]`).
  - The existing "missing toolUseId" test now asserts the lookup arguments and the no-match reason with `matchCount: 0`.
  - A new describe covers four cases: the interrupted match is re-registered, the live match only gets an activity
    update, several matches leave it unbound with a WARN, and a single match that vanished leaves it unbound with a
    WARN.

## Checks (worktree root)

- `npx nx run-many -t typecheck,lint,test -p vscode-core agent-sdk --parallel=2` — exit 0. All 6 tasks succeeded.
- `npx prettier --write` on the 4 files: whitespace only, in the hook-handler spec. Re-run
  `npx nx run agent-sdk:test --testFile=subagent-hook-handler.spec.ts` — exit 0 (21/21).
- `npx nx run di-lint:lint` — exit 0.
- `npx nx run degradation-audit:lint` — exit 0.

## Open notes

- **Scope of the F-F binding.** The decision text says to bind "when the Task tool result names that exact id". The
  batch limits the files to the registry and the hook handler, so the only match available is at SubagentStart time,
  against registry records whose `agentId` came from that tool-result line. Those records come from:
  - history replay
  - a restored snapshot
  - an earlier start of the same agent

  This covers resumes and `subagent:send-message` / `subagent:stop` on agents the registry already knows. A brand-new
  foreground subagent whose start has no toolUseId has no record yet, so it stays unbound with a WARN, as F-F
  requires.
- **Gap left open.** A later binding would need two pieces:
  - hold the unbound start, keyed by agentId;
  - bind it when the Task `tool_result`'s `agentId:` line arrives. `background-started-event.ts:56` already parses
    that line.

  Both need the agent-sdk message-transform files and the stream broadcaster, which are outside this batch. If wanted,
  this should be a named follow-up.
- No files from Batches 24A, 28 or 29 were touched. No check failed in their files.
