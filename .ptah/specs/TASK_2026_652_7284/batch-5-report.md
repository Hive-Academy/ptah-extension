# Batch 5 report

## Task 5.1 — Complete

`HarnessStartNewProjectResult` is a success/failure union. Successful responses include the validated intake, composed seed prompt, enabled bundled plugin IDs, missing external plugin refs, available skill IDs, and optional toolchain probe result. Intake parsing precedes plugin reads/writes. Plugin save and reconciliation, chat focus, and wizard disposal complete before the success response. Plugin save failure remains a failed RPC. Only this RPC's `HARNESS_OPEN_WORKFLOW` broadcast was removed; its constant, payload type, baseline entry, and relay were left in place.

`HarnessApplyParams` has `config`, `outputFormat`, and optional `workspaceRoot`, but no session ID. No proposal deletion was wired to apply. The proposal store's 30-day prune covers stale records.

## Task 5.2 — Complete

Registered `harness:get-proposal` in the RPC type registry, host-source baseline, handler method list, and registration. The strict Zod boundary trims a nonempty session ID and limits it to 256 characters. The handler resolves `IHarnessProposalStore` through `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` and returns `{ proposal }`. The store returns null for absent or corrupt records. No caller-selected root is accepted.

## Task 5.3 — Complete

The handler spec checks validation before plugin effects, success fields and diagnostics, no New Project broadcast, focus/disposal before response, plugin save failure, invalid get-proposal parameters, and a real store write/read through the same workspace provider root. Targeted Jest result: `Test Suites: 1 passed, 1 total`; `Tests: 83 passed, 83 total`.

## Task 5.4 — Complete

The CLI engine test passed with no CLI engine edit. `CLI_EXPECTED_ABSENT_METHODS` was not changed.

## Plan risks

- R7: The real proposal store integration test writes and reads using one workspace provider root. The RPC only accepts `sessionId`, so a caller cannot select a root.
- R9: The producer broadcast was removed. The constant, payload, baseline event entry, and relay remain. Electron e2e event-injection specs and the 629-owned webview routing spec were not run or retargeted in this batch, per the plan's deferred review item.

## Verification

Command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 && npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`

Observed header: `NX Running targets typecheck, test, lint for 2 projects:`

Observed summaries: `NX Successfully ran targets typecheck, test, lint for 2 projects`; `NX Running target test for project @ptah-extension/cli-engine:`; `NX Successfully ran target test for project @ptah-extension/cli-engine`.

`ptah_get_diagnostics` was called for all six changed source files and returned unavailable after its 45-second TypeScript timeout. The scoped Nx typecheck passed.

## Files modified

- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.types.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc.types.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.schema.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.spec.ts

## Files created

- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-5-report.md

## Not done

- No proposal deletion on `harness:apply`, because the existing params carry no session ID.
- Deferred R9 Electron e2e and 629-owned webview routing retargeting; no e2e run was authorized.

