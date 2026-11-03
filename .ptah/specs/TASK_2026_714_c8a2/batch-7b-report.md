# Batch 7b: chat session and slash runtime routing

## Changes

- chat/session/chat-session.service.ts:297,924,953: inject CHAT_TOKENS.RUNTIME_PROFILE and prepare complete start configuration before adapter execution. Legacy results pass providerProfile unchanged; native results use seed.model through the existing TOKENS.AGENT_ADAPTER binding.
- chat/session/chat-session.service.ts:1688,1708: resume passes SessionMetadataStore.get(sessionId).codexExecution into prepare, retaining the stored runtime/provider/workspace/home after a workspace provider switch. Existing folder resolution and account admission remain in place.
- chat/session/chat-session.service.ts:966,1724: each prepared substitution is published once before attaching the stream.
- chat/session/chat-slash-command-router.service.ts:238,364,379: inject preparation and optional session controls; prepare slash relaunch configuration with persisted identity before executing it.
- chat/session/chat-slash-command-router.service.ts:432: native compact calls SessionRuntimeControls.compact and returns a settled success. Missing controls fail explicitly without falling back to SDK compact.
- chat/session/chat-slash-command-router.service.ts:344,406,491: preserve pre-resolution coalescing, post-resolution reservation admission, and release in finally.
- chat/session/chat-slash-command-router.native.spec.ts:110: seven tests cover native and legacy compact, preparation ordering, coalescing, substitution notice count, failure release, missing controls, and preparation refusal.
- chat/session/chat-session.native.spec.ts:109: three tests cover complete native start inputs, persisted resume identity, and launch refusal. Both native launch paths assert that the old auth/profile resolver is untouched.

## Legacy preservation evidence

The existing adapter token, session input fields, providerProfile object, legacy executeSlashCommand call, stream attachment, error shaping, compact admission, and reservation release remain. No existing spec expectation was changed. Both original constructors retain their positional dependencies; the newly appended preparation/control dependencies are optional for existing direct callers. Hosts registering chat services receive the 7a preparation service. The fallback is exclusively for callers without that service; a native preparation result never calls the old workspace profile resolver.

Preparing a complete configuration means output-style fields are resolved before preparation; the old implementation resolved the provider before output style. Adapter inputs retain their existing shape. This ordering adjustment is necessary to pass the complete configuration into the agreed prepare contract.

No concrete SDK adapter, proxy pool, or authentication configurator was introduced. Native profile preparation delegates through the 7a credential-safe seam. MCP override resolution remains, as required to preserve effective MCP authentication rather than provider authentication.

## Verification

- Prettier completed on all four source/spec files.
- Initial scoped diagnostics found five incomplete test-fixture fields; all corrected before running tests.
- Final ptah_get_diagnostics, scoped to the four changed files:
  > Errors: 0 | Warnings: 0 ? No issues found.
  > Coverage: clean
  > Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)
- Exactly one permitted test invocation:
  npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns="chat-session|chat-slash-command|chat-continue"
- At the single permitted completion check, the command was still running (exec session 92004); the tail-filtered output was empty: "". Test results are pending and are not claimed passed. No second test run or completion check was made. The team-leader authoritative verification remains required.
- No live model tests, installs, builds, host changes, or git operations.

## Decisions

1. Append optional preparation injection while preserving the legacy direct-constructor path. Options: require injection and rewrite existing fixtures; or preserve callers lacking the new dependency. Evidence: unchanged existing specs construct both services positionally; 7a already registers CHAT_TOKENS.RUNTIME_PROFILE for composed hosts. Chosen: preserve existing callers, with native results always using prepare and no proxy fallback. Reversible when all callers require the registered composition.
2. Use metadata.codexExecution as the persisted native identity. Options: derive from current workspace settings or read the stored identity. Evidence: SessionMetadataStore and createCodexChatMetadataPort persist SessionRuntimeIdentity in codexExecution; P5 requires retaining it across provider switches. Chosen: stored identity. Reversible only with an explicit identity migration.
3. Native compact returns settled success after the compact promise resolves. Options: attach an SDK slash stream or use runtime control and settle the RPC. Evidence: implementation-plan G2, SessionRuntimeControls.compact returns Promise<void>, and existing coalesced compact replies already use settled:true. Chosen: native control with the existing admission lifecycle. Reversible if the control contract acquires a distinct result.
4. Keep other native slash commands on the injected routing adapter after prepare. Options: call concrete SDK or preserve the runtime adapter boundary. Evidence: RoutingAgentAdapter.executeSlashCommand dispatches by session identity. Chosen: routing boundary; unsupported commands retain the native adapter's explicit errors. Reversible within that adapter's contract.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-7b-report.md
