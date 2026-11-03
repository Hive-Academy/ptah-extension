# Task 10d.P-C1 — corrective batch: native Codex lane account binding on the default account (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip MCP. Do not convert line endings. UTF-8 without BOM. Touch ONLY the files in Scope.

## Defect (found by the 10d.P activation spec)

`AgentProcessManager` always passes `onAccountBinding` to `runSdk`
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts:875-900). It spreads
`options.accountReference` (with `accountBinding` / `accountBindingId`) only when a named account was selected.
The Claude adapter treats "no binding fields" as the default account and does not persist anything
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\claude-cli.adapter.ts:326-336); it refuses only a
partial or unadmitted binding. The native Codex adapter
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts:318-325)
throws `Codex lane account binding is incomplete` whenever `onAccountBinding` is set and the binding fields are
absent. So every native Codex lane on the default account fails after the context opens (the context also leaks
unless the catch path closes it — check).

Coordinator evidence: test "native Codex lane activation at the manager boundary > carries native terminal usage
through the manager gate and ledger, then routes an attributed report"
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\codex-lane-activation.spec.ts:~290-330) fails with that error.

## Fix

1. In the native adapter: when BOTH `accountBinding` and `accountBindingId` are absent, do not call
   `onAccountBinding` (default account, same as Claude). When BOTH are present, call it as today. When exactly ONE is
   present, keep refusing (a bound context must never silently downgrade). Confirm that a throw after the context
   opened closes the context exactly once (read the surrounding try/catch); fix it in the same file only if it leaks.
2. Read how the legacy Codex SDK lane (W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts)
   handles the same fields and match its default-account behavior; note it under ## Decisions.
3. Specs in W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts:
   (a) `onAccountBinding` set + no binding fields -> run starts, callback not called; (b) both present -> callback
   called once with the thread id; (c) only one present -> refused, context closed once.
4. Do NOT edit codex-lane-activation.spec.ts (the coordinator re-runs it as the regression check).

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-P-C1-report.md
(write a skeleton early): what changed (file:line), `## Decisions`, anything not done.
Reply `WROTE: <path>` plus one headline line.
