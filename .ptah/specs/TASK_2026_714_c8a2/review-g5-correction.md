# Review G5 coordinator correction

Verdict: APPROVE  
Score: 9/10

## Defects

None.

## Notes

- The mock covers the value imports used by the loaded resume path. `codex-chat-host-ports.ts:4-7` imports `PTAH_MCP_PORT` and `PTAH_UI_HINT_CODEX`. `codex-chat-approval-presentation.ts:2-9` imports `UNROUTABLE_PERMISSION_TIMEOUT_MS`, `buildSystemAbortPermissionMessage`, and `presentCodexApproval`. The spec supplies all five values at `codex-chat-host-ports.resume-permission.spec.ts:21-28`. It also supplies `SDK_TOKENS.RUNTIME_HOST_CAPABILITIES`, which the service decorator reads at `chat-runtime-profile.service.ts:107`.
- One loaded value import has no stub: `legacyClaudeSessionRuntimeIdentity` at `chat-runtime-profile.service.ts:4-7`. This is non-blocking. The module references it only inside `storedChatRuntimeIdentity` at `chat-runtime-profile.service.ts:72-85`. The spec never calls that function. The resume path constructs the service and calls `prepare` at `chat-runtime-profile.service.ts:120-140`. A missing CommonJS mock property therefore does not break module load or this path. A stub would make the mock more complete, but it is not required for these specs.
- `codex-chat-event-callbacks.ts:1-5` has only type imports from agent-sdk. The host and profile service also import the broadcaster types only. Those modules do not add runtime agent-sdk imports to this spec.
- The UI hint stub cannot mask the permission behavior. The host can add `PTAH_UI_HINT_CODEX` to `developerPrompt` at `codex-chat-host-ports.ts:403-415`. The fingerprint contains only `permissionLevel`, `sandboxPolicy`, and `approvalPolicy` at `codex-execution-profile.ts:315-324`. It excludes `developerPrompt`. The spec config also omits `ptahUiFence`, so this path does not read the hint stub. Use of the same stub for save and resume is safe.
- The specs still detect a wrong restored level. `saveAndClose` saves the original profile fingerprint at `codex-chat-host-ports.resume-permission.spec.ts:168-185`. The resume call supplies no level at line 195. The host must select the saved level at `codex-chat-host-ports.ts:387`. The direct assertion at line 201 checks the expected level. The saved-versus-resumed fingerprint assertion at lines 202-205 also distinguishes every level, including Ask from Auto-edit.
- The two earlier defects are resolved. The spec has no cross-project source import and no circular reference fingerprint assertion. Static inspection found no unused import, `any`, `as unknown as`, `@ts-ignore`, or `@ts-expect-error`. `buildCodexExecutionProfile` and `CodexExecutionProfile` are absent from the spec.
- This was a read-only static review. Tests, lint, typecheck, diagnostics, builds, Nx, and npm were prohibited and were not run.
