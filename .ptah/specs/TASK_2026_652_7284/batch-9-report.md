# Batch 9 report — session-scoped MCP proposal writer

## Files written

- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/messages/payload-map.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-9-report.md

## Tasks and evidence

- 9.0: Added required, documented real SDK `sessionId` only to `HarnessConfigProposedPayload` (`payload-map.ts:217-220`). Shared and harness-builder typechecks passed.
- 9.1: The namespace receives caller identity and the store save function (`harness-namespace.builder.ts:383-389`), validates with Zod, rejects an unresolved caller, awaits persistence, then broadcasts the typed payload using the saved record's normalized ID (`:1080-1107`). The missing-broadcaster path is nonfatal via optional invocation; the host's absent-webview callback also returns without throwing. Tests: `rejects an unresolved session without saving or broadcasting` (`harness-namespace.builder.spec.ts:458`), `does not broadcast when persistence fails` (`:468`), `broadcasts only after saving and uses the stored session id` (`:477`). The store port is `IHarnessProposalStore.save(sessionId, update, complete): Promise<HarnessProposal>` in `platform-core/src/interfaces/harness-proposal-store.interface.ts`; it was read, not changed.
- 9.2: `PtahAPIBuilder` resolves the real SDK ID through its existing lifecycle method and resolves the proposal store token from its container on every save; absent container or store throws (`ptah-api-builder.service.ts:876-884`). No proposal path uses `resolveSessionWorkspaceRoot`; no tab ID is sent to the store. Tests: `resolves the real SDK id and the proposal store on every call` (`ptah-api-builder.service.spec.ts:259`) and `throws when the proposal store is unavailable` (`:301`). The correlation ID remains unresolved until the lifecycle manager supplies `realSessionId`, addressing R5.
- 9.3: The dispatcher needed an edit: its generic catch already returned `isError`, but exposed raw Zod issues and lock paths and did not state retry guidance. The proposal-specific mapper (`protocol-dispatcher.ts:2697-2702,2728-2755`) now handles ZodError, FileLockTimeoutError, `HARNESS_PROPOSAL_NO_WORKSPACE`, file-system codes, unresolved sessions, and other save failures with bounded messages and retry guidance. RL2's lock timeout is retryable; invalid identity requires a valid session, and no workspace requires an open workspace. Tests: `reports a proposal lock timeout as a retryable tool error` (`protocol-dispatcher.spec.ts:599`) and `reports an unresolved SDK session as a tool error` (`:618`). No raw Zod issue dump crosses the MCP boundary.

## Verification

- Targeted Jest: `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <three changed specs> --coverage=false --maxWorkers=2` — PASS, 3 suites and 426 tests.
- Prettier write and check ran on all seven source/spec files. Check tail (PASS):
  ```text
  Checking formatting...
  All matched files use Prettier code style!
  PRETTIER_EXIT=0
  ```
- Final verification ran after the last source edit, with Nx parallelism 1. Tail (PASS):
  ```text
  NX   Running targets typecheck, test, lint for 2 projects:
  - @ptah-extension/shared
  - @ptah-extension/vscode-lm-tools
  NX   Successfully ran targets typecheck, test, lint for 2 projects
  FIRST_EXIT=0
  NX   Successfully ran target typecheck for project @ptah-extension/harness-builder
  HARNESS_EXIT=0
  ```
  Nx Cloud also printed an account-disabled warning; local target results were successful. `ptah_get_diagnostics` was unavailable while its compiler check was still running, so the completed Nx typechecks are the diagnostic evidence. No constructor, injection decorator, or DI token definition changed; `di-lint` was not required.

## Decisions

| Decision                                               | Options                                                  | Evidence                                                                                                                             | Reversible |
| ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Use the save result's session ID for the event         | Caller ID or normalized store ID                         | Store port returns the saved proposal; normalization is covered by the order/payload spec at `harness-namespace.builder.spec.ts:477` | Yes        |
| Resolve the store per call from the existing container | Capture once or resolve per call                         | Existing container pattern and lifecycle timing in `ptah-api-builder.service.ts:876-884`; spec at `:259`                             | Yes        |
| Map proposal errors at the dispatcher boundary         | Generic raw exception text or proposal-specific messages | Generic catch is an `isError` result but leaked raw diagnostics; mapper at `protocol-dispatcher.ts:2728`                             | Yes        |

## Verification 1 fix

Changed files (absolute paths):

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-9-report.md`

The namespace now throws named `HarnessConfigUpdatesError` and `HarnessProposalNoSessionError` errors (`harness-namespace.builder.ts:39-45,1093,1100`). The dispatcher maps these by error name (`protocol-dispatcher.ts:2728-2737`), preserving the formatted invalid field path and telling the agent to correct `configUpdates`. It no longer matches the no-session message with a regex. The existing lock timeout and storage mappings remain. The invalid-input path returns an `isError` tool result.

Specs: new `reports an invalid configUpdates field path with correction guidance` (`protocol-dispatcher.spec.ts:639`); updated `reports an unresolved SDK session as a tool error` (`:618`) to use the named error. Existing `reports a proposal lock timeout as a retryable tool error` (`:599`) passed.

Prettier write: PASS. Prettier check tail: PASS.

```text
Checking formatting...
All matched files use Prettier code style!
PRETTIER_EXIT=0
```

Required final verification tail: PASS. The first header said `Running targets typecheck, test, lint for 2 projects`.

```text
NX   Successfully ran targets typecheck, test, lint for 2 projects
RUN_MANY_EXIT=0 HEADER_SEEN=True
NX   Successfully ran target typecheck for project @ptah-extension/harness-builder
HARNESS_EXIT=0
```

Nx Cloud printed an account-disabled warning; the local Nx commands exited 0. `ptah_get_diagnostics` was unavailable while its TypeScript check was still running, so the completed Nx typechecks are the diagnostic evidence.

Decisions:

| Decision                                              | Options                                                  | Evidence                                                                                                                                                                   | Reversible |
| ----------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Use named namespace errors at the dispatcher boundary | Error names or message matching                          | The prior message regex was fragile; names at `harness-namespace.builder.ts:39-45` and matching at `protocol-dispatcher.ts:2729-2737`                                      | Yes        |
| Keep field-level validation detail for the agent      | Preserve formatted path or return generic retry guidance | Namespace formats Zod issues into actionable paths at `harness-namespace.builder.ts:1089-1093`; dispatcher spec at `protocol-dispatcher.spec.ts:639` checks the field path | Yes        |
