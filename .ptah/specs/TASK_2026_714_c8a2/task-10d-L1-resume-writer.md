# Task 10d.L1 — corrective batch R: resume after a completed native Codex lane (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- Never strip, revert or comment out MCP. Do not convert line endings. UTF-8 without BOM. Touch ONLY the files in Scope.
- Two other codex lanes edit other files in W at the same time (batch M: codex-runtime lane thread config and
  codex-lane-events; batch N: lane completion / parent session id). Do not touch their files.

## Defect (Electron live run, T\live-test-p10dP.md row C and gap G1)

A native Codex lane ends its turn (`Agent exited: completed`), but the adapter keeps its `CodexContext` and its
`codex.exe app-server` process open on purpose, so queue-next-turn messaging (`continue`) still works
(W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts:439-475,
`supportsContinuation: () => !closed`). That live process still holds the thread writer. A later
`ptah_agent_spawn { resume_session_id: <same thread> }` passes the resume gate (`decision resume`), then
`thread/resume` fails with RPC -32600, stderr `thread-store conflict: thread <id> already has an active writer`, and
the user sees `Codex context could not be opened`. Resume after `ptah_agent_stop` works (stop closes the context).

## Fix

1. Read how the adapter instance lives (one per host or one per spawn: check the factory in the three host
   compositions listed in Scope, and `CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY` usage). Record it under
   `## Decisions`.
2. Keep one registry of live lane contexts keyed by thread id (normalized the same way the identity store keys
   threads), owned by the adapter instance if it is host-scoped, otherwise by an object the host composition creates
   once and passes in. Register a context when its identity is persisted; remove it in the single close path.
3. In `runSdk` with a resume identity: if a live context holds the same thread id and has NO active or starting turn,
   close that context (the existing once-only `closeContext` path, so the old handle reports `closed` and
   `supportsContinuation()` becomes false) and await the close BEFORE `this.runtime.open(...)`. If the old context has
   an active or starting turn, refuse the resume with one clear coded error (do not kill a running turn) and emit one
   visible error line. Never open two writers for one thread.
4. A close failure of the old context must not be swallowed silently: log with the injected logger (real Error) and
   refuse the resume.
5. Do not change the resume gate, the identity store schema, MCP config or the turn mapper.
6. Specs in the adapter spec file (fake runtime, no real process): (a) spawn, turn completes, resume of the same
   thread closes the first context exactly once before the second open, and the first handle's
   `supportsContinuation()` is false; (b) resume while the first turn is active is refused and nothing is closed;
   (c) a resume of a different thread does not close the first context; (d) close failure refuses the resume.
   If host composition files change, update their specs too.

## Scope (only these files)

- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts
- New files allowed only under W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\
  named `codex-app-server-lane-writers*.ts` (plus its spec).
- Only if step 1 shows the adapter is per spawn: W\apps\ptah-electron\src\di\codex-lane-composition.ts,
  W\libs\backend\cli-engine\src\lib\codex-lane-runtime-composition.ts,
  W\apps\ptah-extension-vscode\src\di\codex-lane-runtime-composition.ts and their existing specs.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L1-report.md
(write a skeleton early): what changed (file:line), `## Decisions`, specs added, anything not done.
Reply `WROTE: <path>` plus one headline line.
