# Batch 7a — ChatRuntimeProfileService

Implemented the runtime preparation seam, registration and focused specs. No other batch's source files were edited.

## Contract and integration

- `chat/session/chat-runtime-profile.service.ts:31`: `ResolvedChatExecution` is the unchanged legacy `{ runtime: 'claude-sdk', providerProfile }` result, or the native resolver result `{ runtime: 'codex-app-server', seed, modelSubstitution? }` plus `workspacePath`, authorized `cwd`, and the complete original `config: AgentSessionStartConfig | AgentSessionResumeConfig`.
- `chat/session/chat-runtime-profile.service.ts:68`: `prepare(config, identity?)` checks both workspace and cwd before invoking the resolver. Uses explicit workspaceId, then persisted identity workspace, then explicit projectPath. No focused-workspace lookup, error fallback, auth manager, proxy pool or environment writes. The resolver receives consumer chat, requested model, the exact persisted identity and host capabilities. Missing capability binding preserves legacy hosts with nativeCodex false.
- `chat/session/chat-runtime-profile.service.ts:135`: reuses `isAuthorizedWorkspace` and `isUnsafeWorkspacePath`; also refuses missing/relative paths. Resume callers keep using `resolveResumeWorkingDirectory` before passing its authorized cwd into config.projectPath.
- `chat/session/chat-runtime-profile.service.ts:94`: `publishModelSubstitution(execution, { tabId, sessionId? })` publishes one labeled model notice containing both names, via three typed CHAT_CHUNK events (message_start, text_delta, message_complete) sharing one messageId. It publishes no turn-state or usage event. It is explicitly called once by the RPC caller, not automatically by prepare; absent substitution is a no-op. A failed broadcast propagates.
- `chat/di.ts:68`, `chat/tokens.ts:11`, `chat/session/index.ts:24`: singleton registered under CHAT_TOKENS.RUNTIME_PROFILE and exported with both contract types.

### 7b

Inject CHAT_TOKENS.RUNTIME_PROFILE. Build the complete session config using existing workspace/cwd resolution. Call prepare(config, persistedIdentity) on resume, or prepare(config) on start. Retain legacy materialization and pass providerProfile unchanged on the legacy branch. On native, use seed.model as the resolved model. Call publishModelSubstitution once after preparation while the target tab exists and before attaching the runtime stream; do not call it again from 8a. This is one message per substitution decision, not a global deduplication cache.

### 8a

Bind SDK_TOKENS.RUNTIME_HOST_CAPABILITIES as a stable instance before resolving this service. For CodexChatAdapterPorts.profile(config, sessionId?), load the persisted runtime identity by sessionId and pass it to prepare. Require the native discriminant. Combine seed (including resolved model/home/provider), workspacePath/cwd and all config inputs with the host's settings, path snapshots and effective MCP/instruction sources through buildCodexExecutionProfile. Return its validated profile and the stored CodexThreadIdentity for resume. The seed is credential-free; the complete config may contain existing caller MCP auth overrides and must not be logged or used directly as a fingerprint.

This batch deliberately does not create a CodexExecutionProfile itself: the assigned contract returns a seed, and the adapter port owns validated profile construction, path observations and stored thread identity. No agent-sdk or app files were changed.

## Verification

- Prettier completed for all five source/spec files.
- Scoped ptah_get_diagnostics first reported its 45-second timeout; its completed result then reported: "No diagnostics in the requested files." Four sibling TS2352 errors were reported in concurrently edited handlers/config-runtime-controls.spec.ts:56–59; outside this batch's ownership.
- One authorized foreground verification invocation started: `npm run verify -- -p @ptah-extension/rpc-handlers -- --testPathPatterns=chat-runtime-profile`. Completion recorded below.
- At the single permitted completion check the verification process was still running (exec session 26585), with no output yet because the command filters to the last 65 lines. No second run or status loop was made. Test/lint/typecheck completion is **pending**, not claimed passed; the team-leader's authoritative verify remains required.
- Quoted diagnostic output: "No diagnostics in the requested files." / "Errors: 4 | Warnings: 0" (the four errors are the sibling file described above).
- Specs cover legacy exact input/result preservation, complete native input preservation and unchanged process environment, invalid/missing/relative/unsafe workspace rejection before resolver invocation, persisted resume identity forwarding, no global fallback, and exactly one visible notice with both names. Proxy/auth isolation inside the real resolver remains covered by the existing auth-providers resolver specs; this service has neither dependency.

## Decisions

1. Return the complete input config with the native seed, rather than duplicating the host's profile builder. Evidence: assigned seed contract; CodexChatAdapterPorts.profile's validated-profile boundary; implementation-plan G1. Reversible by extending this contract if the host needs additional resolved fields.
2. Publish an explicit labeled chat message through the existing typed chunk protocol. Alternatives were CHAT_COMPLETE (frontend ignores non-clear commands) and CHAT_MESSAGE_ADDED (no current frontend consumer found). Evidence: ChatStreamBroadcaster:179 and ChatMessageHandler.handleChatChunk:518. Reversible; a dedicated notice protocol would require shared/frontend ownership outside this batch.
3. Expose publication separately so 7b owns exactly one notice while 8a can prepare independently. Alternative: emit on every prepare, risking duplicate notices across RPC and adapter. Evidence: task explicitly permits exposing notice emission to 7b. Reversible.
4. Reject relative/missing workspace paths before the resolver, rather than allowing process-cwd or focused-folder fallback. Evidence: session workspace isolation requirement, existing authorization helper and native workspace identity validation. Reversible only with an explicit authorized caller resolution contract.
5. Optional capabilities default to nativeCodex false for existing hosts. Alternative: require new registration in every host immediately. Evidence: Electron-first requirement and apps outside batch ownership. Reversible when all hosts bind capabilities.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-runtime-profile.service.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/di.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/tokens.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-7a-report.md
