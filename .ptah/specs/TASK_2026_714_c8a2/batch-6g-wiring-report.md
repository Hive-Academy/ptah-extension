# Batch 6g — WIRING2

## Findings

All assigned implementation findings are addressed; verification status is recorded below. Paths in this section are relative to libs/backend/agent-sdk/src.

| Finding | Status and evidence |
| --- | --- |
| Logic M1 / decision 15 | Fixed: lib/wiring/codex-runtime-composition.ts:27 checks admission before constructing the native adapter. Lookup or native ports with null admission throws missing-admission-port naming RUNTIME_ADMISSION_PORT. lib/di/register.codex-runtime.spec.ts:75 exercises both bindings through both aliases. Existing exact-default-SDK test remains. |
| Logic M4 / decision 16 | Fixed: lib/wiring/session-runtime-identity-cache.ts:108 captures the updater result and publishes it only after persistence succeeds. The normalized authoritative re-read replaces it on success; rejection or missing identity logs and retains it. Specs cover failed/missing re-read and rejected persistence. Existing sequence, deletion, disposal and stale-read guards remain. |
| Logic M6 / decision 18 | Fixed: lib/di/tokens.ts:28 documents stable instances for all five guarded tokens. lib/wiring/codex-runtime-composition.ts:17 throws the coded unstable-binding error with the token name and “bind a stable instance”. lib/wiring/codex-runtime-composition.spec.ts:34 covers a fresh-object useFactory for every guarded token. |
| Style S1-R / decision 20 | Fixed: index.ts:151 removes createCodexChatMetadataPort and CodexChatAdapter value exports. No external consumer needs a CodexChatAdapter type export. |
| Style minor M4 | Fixed: lib/wiring/codex-runtime-composition-error.ts:1 supplies one closed code union and Error class; metadata mismatch, disposed cache, unavailable persisted identity, unstable binding and missing admission use it. |
| Style minor M5 | Fixed: lib/wiring/legacy-session-controls-composition.ts:1 now owns the Claude factory and its port interface; codex-runtime-composition.ts owns only the guard. No compatibility shim or parallel copy. |
| Style minor M6 | Fixed: lib/di/register.ts:36 merges the routing adapter value/type imports. |
| Wiring log prefixes | Fixed: cache refresh/re-read warnings use [CodexRuntimeComposition], without logging raw exceptions or identity data. |
| Decision 14 follow-up query | Documented: lib/di/tokens.ts:35 tells hosts to compose NATIVE_SESSION_CONTROLS.canSendFollowUp from the DI-resolved CODEX_CHAT_ADAPTER.canSendFollowUp(sessionId), preserving its receiver. The implementation of that public method belongs to ADAPTER2. |

## Final export changes

Removed createCodexChatMetadataPort and CodexChatAdapter from the public barrel. Native construction remains SDK DI-owned. The requested grep over apps and other libs (excluding agent-sdk) returned no CodexChatAdapter or createCodexChatMetadataPort references, so no type-only CodexChatAdapter export was retained. Internal imports remain direct source imports.

Added CodexRuntimeCompositionError and its code type so host callers can branch on code. Preserved LegacySessionControlPorts as a type export from its new file. Preserved initializeSessionRuntimeIdentityLookup, SDK_TOKENS, adapter port types, native/legacy controls, routing/approval types, AuthOperationContext and all other existing 8a/8d/8e exports.

## Host contract for 8a

1. Register SDK services, await initializeSessionRuntimeIdentityLookup(store, logger), and finish all runtime port bindings before resolving AGENT_ADAPTER, ROUTING_AGENT_ADAPTER or consumers holding those adapters. Bind session controls before resolving SESSION_RUNTIME_ROUTER.
2. SESSION_RUNTIME_IDENTITY_LOOKUP, CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT, RUNTIME_HOST_CAPABILITIES and the SDK-owned CODEX_CHAT_ADAPTER must resolve to stable instances: registerInstance or a cached factory. A factory returning a new object on each resolve violates the contract. Rebinding after the first adapter resolution requires a fresh container. The guard cannot revoke references already retained; audit direct SDK_AGENT_ADAPTER consumers, including broadcaster cleanup, in 8a.
3. If lookup or native ports are non-null, RUNTIME_ADMISSION_PORT is mandatory. Missing admission throws CodexRuntimeCompositionError with code missing-admission-port and the missing token name. Fully default bindings preserve the exact SDK adapter.
4. A changed/unstable guarded value throws CodexRuntimeCompositionError with code unstable-binding, token name, and “bind a stable instance”. Other wiring codes are identity-lookup-disposed, persisted-identity-unavailable and session-thread-mismatch. Hosts must inspect code rather than string-match. persisted-identity-unavailable during post-write re-read is logged while retaining the successful write.
5. Native metadata writes remain routed through the initialized lookup inside SDK composition. Hosts own lookup disposal and await writes before publishing sessions.
6. Compose the host NATIVE_SESSION_CONTROLS.canSendFollowUp function by calling the DI-resolved native adapter’s public canSendFollowUp(sessionId), preserving its receiver (e.g. an arrow wrapper). Bind controls before resolving SESSION_RUNTIME_ROUTER. Hosts do not construct or import the adapter class as a value.

## Changed absolute paths

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/tokens.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-chat-metadata-port.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition-error.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/legacy-session-controls-composition.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/session-runtime-identity-cache.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/session-runtime-identity-cache.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-wiring-report.md

## Verification

Prettier completed successfully for the assigned source/spec paths. Unchanged wiring files reported “unchanged”.

ptah_get_diagnostics was requested with the 11 changed TypeScript files:
> Source: typescript-compiler — Unavailable.
> TypeScript check still running after 45s. It was not cancelled — retry shortly and the completed result is served from cache.
> 11 files unchecked.

One cached-result follow-up returned the same unavailable/45s result; no clean diagnostic result is claimed. The single permitted scoped test command was still running at its one completion check (exec session 14636, no output yet because the requested tail filter emits on completion):
> npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="wiring/|register.codex-runtime"

> Completion check: session_id 14636; process still running; output empty.

Tests are pending, not passed. No second scoped run or repeated status polling was performed. The team-leader must obtain the authoritative test result; the existing run was not cancelled.

No git operations, installation, build, live model call or host edits were performed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep admission validation in the composition guard before native construction | Guard; duplicate checks in aliases/factories | Both public adapter resolution paths invoke the guard through ROUTING_AGENT_ADAPTER registration (register.ts:1032); the guard resolves admission before native adapter. | Yes |
| Capture the actual updater result and cache only after a successful write; prefer the normalized re-read | Capture updater; duplicate store normalization; change persistence return contract | SessionMetadataStore.updateCodexExecution returns Promise<void>, invokes updater then validates/normalizes; decision 16 requires retaining the written identity when re-read fails. No store contract changes or duplicated normalization. | Yes |
| Document host follow-up composition rather than add another factory | JSDoc; automatic native control factory | NATIVE_SESSION_CONTROLS already is a nullable host token; decision 14 adds a public adapter query, and the assignment explicitly permits documenting host composition. | Yes |
| Remove CodexChatAdapter entirely from public exports | Remove; retain type-only | Required grep found no app or other-library consumer; decision 20 requires type-only only if needed. | Yes |
| Separate legacy factory while retaining guard filename | Split; rename combined file | Existing two responsibilities are explicit in style M5; split keeps imports focused and preserves named public port type. | Yes |

## Limits and handoff

No edits to other lanes’ files or task state. ADAPTER2 owns canSendFollowUp implementation. Host composition and direct SDK-consumer audits remain 8a work. The team-leader owns authoritative verification and copying the host contract into batches.md.
