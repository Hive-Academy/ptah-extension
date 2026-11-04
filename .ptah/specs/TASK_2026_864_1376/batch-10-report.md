# Batch 10 report

## File written

- `/home/amun/ptah-extension/.claude-worktrees/provider-readiness/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.connection-switch.spec.ts`
- One parameterized Jest case runs for each `applyTo` value: `global` and `workspace` (two test instances).

## Four steps and assertions

1. Launch a chat on `tab` through `launchSdkSession` with `logLabel: 'chat:start'`. Assert the first adapter start uses `claude-sdk` and exactly one start occurred.
2. Invoke the captured `auth:saveSettings` handler with `thirdParty` / `openai-codex`. Assert success and the in-memory store values. Global asserts one adapter `reset` and no workspace change; workspace asserts `applyWorkspaceAuthChange(workspace, write)` and no reset.
3. Launch a new chat on `tab`. Assert the second adapter start uses `codex-app-server`, the Claude start count remains one, and the real runtime profile received a new-session preparation with the workspace-scoped resolver consulted.
4. Continue the pre-switch stored Claude session through `autoResumeIfInactive`. Assert an `AUTH_REQUIRED` result naming stored provider `anthropic`, with no adapter `resumeSession`; assert the real runtime profile received the stored Claude identity and the resolver checked current active auth.

## Decisions

- Used the real `ConnectionSettingsMethods` and `ChatRuntimeProfileService`, plus the real `WorkspaceProviderProfileResolver.resolveExecutionProfile` prototype method with stubbed external collaborators. This exercises routing and mismatch behavior while keeping SDK and process creation out of the spec. Reversible: yes.
- Kept the spec's small harness local, as the implementation plan directs; the existing harness is local to its file. Reversible: yes.
- Retained the `AUTH_REQUIRED` continuation result as the expected banner trigger, per decision rows 37, 38, and 41. Reversible: yes.
- Used a temporary workspace folder to satisfy real workspace authorization, following the native session spec. Reversible: yes.

## Verification and least-sure assertions

- Test execution was prohibited for this lane; the orchestrator owns `npm run verify -- -p @ptah-extension/rpc-handlers`.
- Scoped `ptah_get_diagnostics` did not finish within 45 seconds. A retry failed because the Ptah transport became unavailable, so no compiler result is available here.
- Least sure: the stubbed resolver and settings dependencies may omit a runtime-used collaborator that only execution will reveal; the `resolveActiveAuthWithDefault(undefined, workspace)` call shape follows the existing native spec; the exact initial Claude provider profile is intentionally undefined in the fake and is asserted only by runtime selection.
