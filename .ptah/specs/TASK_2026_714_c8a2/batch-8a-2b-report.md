# Batch 8a-2b report

Implemented the six scoped source/spec files. This is source-level delivery, not a verified integration pass. No task state or host-port source was edited.

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-session-settings-record.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-session-settings-record.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts

Deliverable: D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8a-2b-report.md

## Event mapping

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/. Factory implementation: libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts.

| Codex callback/event | Existing presentation | Evidence |
| --- | --- | --- |
| content(text) | CHAT_CHUNK / text_delta with source complete, original block index | factory:67; shared/src/lib/types/execution/stream.ts:119; frontend/chat-streaming/src/lib/accumulator-core.service.ts:318 |
| content(reasoning) | CHAT_CHUNK / thinking_delta with source complete, original block index (replacement, not append) | factory:67; libs/shared/src/lib/types/execution/stream.ts:135; libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:359 |
| result | Reconcile complete text blocks; broadcaster remains owner of message_complete/CHAT_COMPLETE, adapter remains owner of SESSION_STATS | factory:79; libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:294; libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:490 |
| compaction(started) | CHAT_CHUNK / compaction_start | factory:90; libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:344 |
| compaction(completed) | CHAT_CHUNK / compaction_complete | factory:90; libs/shared/src/lib/types/execution/stream.ts:292 |
| compaction(failed) | compaction_complete clears in-flight UI; CHAT_ERROR reports failure | factory:90; same existing complete contract plus broadcaster error path |
| live(file) | CHAT_CHUNK / tool_start + tool_result carrying path, operation and diff; FILE_CONTENT_CHANGED carrying filePaths and truncated | factory:104; libs/shared/src/lib/types/execution/stream.ts:145/:168; libs/shared/src/lib/types/messages/payload-map.ts:151 |
| live(image) | CHAT_CHUNK / tool_start + tool_result carrying structured base64 image output | factory:104; libs/shared/src/lib/types/execution/stream.ts:168 |
| live(approvalRequested) | PERMISSION_REQUEST with same correlation-key encoding and session/tab routing as host ports | factory:125; libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:140/:251 |
| live(approvalSettled) | PERMISSION_AUTO_RESOLVED with matching correlation id | factory:145; host ports:274 |
| error | delivery.publishTerminal(CHAT_ERROR), sessionId + tabId + error | factory:59/:193; libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:194 |

No new message type. The factory uses the SAME ChatStreamDeliveryCoordinator.publish / publishTerminal as ChatStreamBroadcaster; it does not start a second broadcaster loop that could tear down the live adapter session. Evidence: broadcaster:174-198; coordinator:117. This retains hidden-tab delivery and terminal flush semantics. Host composition must pass the shared coordinator.

Every callback contains synchronous throws and asynchronous rejection, logs a fixed non-sensitive error, and contains a failing logger too. Content/result publications are enqueued synchronously before yielding, preserving their position before the adapter's terminal event.

## Settings record and auth derivation

- createCodexSessionSettingsRecord records model, validated effort, permission and workspace from profileResult.profile.
- Auth key is resolveAuthProviderKey('thirdParty', profile.providerId). Native Codex is the third-party route, including openai-codex OAuth. Evidence: libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:25-35 (apiKey/claudeCli force Anthropic; the other branch binds the third-party provider), active-provider-resolver.spec.ts:16-26 (thirdParty/openai-codex), libs/backend/settings-core/src/schema/provider-schema.ts:40 (thirdParty.openai-codex).
- The legacy route uses resolveAuthProviderKey(authMethod, providerId): libs/backend/rpc-handlers/src/lib/handlers/auth/effective-route-method.ts:204 and auth/workspace-scope-methods.ts:88-95. The helper itself is libs/backend/platform-core/src/settings-auth-key.ts:12-24.
- Inactive sessions use SessionRuntimeIdentityLookup.lookup(sessionId).persisted, checking native runtime and session identity, then providerSelectedModelDef/providerReasoningEffortDef through readForPath(key, identity.workspaceId, true). No focused-provider fallback. This lookup is the synchronous public agent-sdk contract; createCodexThreadIdentityStore shares its persisted codexExecution record (libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts:54-77).
- Unknown/non-native identity throws CodexSessionSettingsError(code='unknown-session'); malformed settings throw code='invalid-settings'.
- Wrapper chosen: record.wrapPorts(ports), without changing codex-chat-host-ports.ts. Resume profile results are recorded directly; fresh profiles are staged by contextId and bound when metadata.save supplies the actual thread/session id after successful persistence (adapter:227-233). Pass record.settings to native controls.
- Lifecycle APIs: release(sessionId), discardProfile(contextId) for failed opens, dispose() for host teardown. Host composition must call them.

## Specs authored

Callbacks spec: text and reasoning snapshot routing; result reconciliation; preserving multiple final text block indexes; each compaction phase; file change payload and tool output; structured image output; both approval phases and matching ids; error terminal routing; synchronous sink throws, rejected promises and throwing logger across all five callback methods.

Settings spec: recorded session, inactive persisted provider/workspace, unknown typed error, custom third-party namespace despite focused auth, invalid persisted effort, disposal, wrapper preparation followed by fresh-id binding on metadata persistence.

Schema spec: UUID v7 accepted for continue, resume, abort, pending questions and history page (history uses its required cursor and strict shape). Depends on the parallel shared UUID_REGEX v4|v7 change.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Reuse broadcaster's delivery coordinator | Start extra stream consumers; direct unbuffered chat messages; shared coordinator | Broadcaster:174-198 and stream teardown ownership; coordinator:117 | Yes, internal factory dependency |
| Complete-source block replacement | Append final reasoning; replace complete blocks | Accumulator:318-364 explicitly replaces complete-source blocks | Yes |
| Leave terminals/stats to existing adapter+broadcaster | Duplicate CHAT_COMPLETE/SESSION_STATS; reconcile content only | Adapter:490-505 and broadcaster:294 | Yes |
| Use existing tool-result output for native artifacts | New wire type; existing structured tool output | Shared stream.ts:168 accepts structured output | Yes; visual rendering still needs integration verification |
| Wrapper around profile and metadata | Edit host-port source (7th file); wrapper | Adapter assigns fresh id after profile/open, before metadata save; six-file cap | Yes |
| Derive native auth namespace from bound provider | Focused auth state; bound native third-party identity | Legacy active-provider resolver and known provider namespace cited above | Yes |
| Expose explicit lifecycle release | Keep pending profiles for process lifetime; host release | Failed open can skip metadata.save | Yes |

## Verification and remaining work

- No npm verify, Nx, Jest, shell tsc, lint, install, build, serve, e2e or git command was run. Six files were formatted with the installed Prettier API.
- Required ptah_get_diagnostics was called on the four new files. It returned UNAVAILABLE: compiler-backed check still running after 45 seconds, four files unchecked, not cancelled. No passing typecheck is claimed; no retry was issued. Team leader owns deciding checks and should account for this tool-started background compiler before running its FIFO-locked checks.
- ptah_code_search_symbols returned an empty index (symbolCount 0); targeted native search was used. ptah_ast_analyze also reported ENOENT for the guessed flat-stream-event.types.ts; the actual shared execution/stream.ts was then located.
- No broader working-tree audit was performed because git is prohibited. No claim is made that pre-existing or parallel edits are absent; only the six files listed and this report were written by this lane.
- Host integration is next batch, not implemented here. In particular callbacks require messageId() returning JSON.stringify([threadId, turnId]). The current content/result callback signatures expose no turn id, and callbacks(sessionId) alone cannot supply it. The host must obtain authoritative turn correlation; if its composition cannot, the adapter contract needs a separately owned change. Do not substitute a session-only or random message id, which would split final reasoning from streamed reasoning.
- Compaction callback carries only phase: the existing start contract requires trigger and preTokens, currently mapped to auto/0 (no token-reduction measurement is fabricated). Exact manual trigger and pre-token parity need upstream metadata if required. Failed compaction uses existing completion signal to clear the banner followed by an error, which needs UI review for boundary side effects.
- Artifact payloads preserve file diffs and image bytes in existing tool output, but actual rendered image/file-card parity has not been visually verified. Native file event paths are forwarded as supplied; relative-path normalization needs host/runtime confirmation.
- Approval notifications use the host's correlation key. Next composition must ensure the live notification path and the existing approval presentation sink do not double-present the same request/attention generation.
- The fresh-profile staging map requires discardProfile on failed open and dispose on teardown. No timer or observer was added.

