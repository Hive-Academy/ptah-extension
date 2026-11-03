# Batch 6f WIRING report

## Item status

Source references below are relative to libs/backend/agent-sdk/src/.

| Item | Status | Evidence |
| --- | --- | --- |
| 1: updated contracts | Fixed | index.ts:176 exports identity contracts from session-runtime-identity; lib/di/register.ts:1002 registers guarded nullable RUNTIME_ADMISSION_PORT; :1043 requires admission alongside lookup/native and passes the five constructor arguments. Native controls use NativeSessionControls. :1089 injects TOKENS.LOGGER into the chat adapter. lib/wiring/codex-chat-metadata-port.ts:5 forwards branded SessionId to the store and preserves store error rejection. |
| 2: extracted wiring | Fixed | lib/wiring/session-runtime-identity-cache.ts:17 and codex-chat-metadata-port.ts:5 own behavior. register.ts retains registrations. Same-stem specs accompany all three new implementation files. |
| 3: release keeps native binding | Fixed | lib/wiring/session-runtime-identity-cache.ts:125 keeps native entries on release. Only deletion/disposal removes native entries; the deletion handler invalidates pending refreshes/writes. Specs :150 and :175 cover native release and outstanding-read deletion. Missing entries remain unbound for legacy routing. |
| 4: failed refresh / composition order | Fixed with explicit host contract | cache.ts:71 logs sanitized failure and retains old binding. lib/wiring/codex-runtime-composition.ts:33 snapshots runtime bindings on first routing resolution; later port or routing resolutions throw when a host changes those bindings. lib/wiring/codex-runtime-composition.spec.ts:11 covers late lookup, host ports, admission and native adapter binding after SDK resolution. lib/di/tokens.ts:30 documents order. See limitations below. |
| 5: public API | Fixed | index.ts:143-195 exposes host composition contracts, factories, catchable errors and adapter types. Removes public registerCodexChatServices, RoutingAgentAdapter value, approval sink/choices and event projection implementation. Routers and LegacySessionControls are type-only exports. AuthOperationContext at :153; CodexSessionMetadataError at :53. Existing unrelated SDK public API is preserved. |
| 6: named legacy ports | Fixed | lib/wiring/codex-runtime-composition.ts:12 names sessions, persistence, modelResolver, lifecycle and slash; :20 maps them to the unchanged legacy constructor. No ConstructorParameters tuple remains. |
| 7: registration/cache hygiene | Fixed | register.ts merges store imports by removing the duplicate type import; :982 documents SDK-owned registrations versus guarded host tokens. Cache interface uses SessionId for release. Store remains sole workspace normalizer: cache reads persisted metadata after the write and before its own promise resolves. Delete clears per-id sequences and pending-write state; disposal clears every cache collection and unsubscribes. |
| 8: Linux fixture failure | Fixed in code, execution pending | lib/di/register.codex-runtime.spec.ts:17/:38 and all extracted wiring specs choose absolute workspace/home paths by process.platform; no platform skip. The failing write-through regression moved intact to lib/wiring/session-runtime-identity-cache.spec.ts:92. |

## Final P6 public exports

The unrelated pre-existing SDK API remains unchanged. Final native-runtime-facing exports are:

- Values/factories: SDK_TOKENS, registerSdkServices, wireAgentAdapterAliases, initializeSessionRuntimeIdentityLookup, createCodexChatMetadataPort, CodexChatAdapter.
- Catchable errors: CodexChatAdapterError, SessionRuntimeRoutingError, LegacySessionControlError, CodexSessionMetadataError.
- Types: InitializedSessionRuntimeIdentityLookup, SessionRuntimeIdentityLookup, LegacySessionControlPorts, AuthOperationContext, CodexChatAdapterPorts, CodexChatMetadataPort, CodexChatScope, RuntimeAdmissionPort, NativeChatAdapter, SessionApprovalRouter, SessionApprovalAddress, SessionApprovalReply, SessionRuntimeRouter, NativeSessionControls, LegacySessionControls, LegacyControlledSession, LegacySessionLookup, LegacySettingsPersistence, LegacySlashCommands, CodexChatApprovalReply, CodexChatApprovalPresentation, CodexChatApprovalFollowUp, CodexChatEventCallbacks.

Internal implementation values removed: registerCodexChatServices, RoutingAgentAdapter, SessionApprovalRouter, SessionRuntimeRouter, LegacySessionControls, CodexChatApprovalSink, CODEX_CHAT_APPROVAL_CHOICES, CodexChatEvents. CodexChatTurnIdentity and CodexChatResult are also no longer exported.

## Host composition order contract

1. Register SDK services once and provide TOKENS.LOGGER. Default nullable ports preserve SDK-only behavior.
2. Await initializeSessionRuntimeIdentityLookup(store, logger). Hosts own its disposal. The logger parameter is now required.
3. Bind SESSION_RUNTIME_IDENTITY_LOOKUP, CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT and RUNTIME_HOST_CAPABILITIES before resolving either AGENT_ADAPTER or ROUTING_AGENT_ADAPTER, or any service retaining them. Bind legacy control ports as the named object and native controls with canSendFollowUp(SessionId) before resolving SESSION_RUNTIME_ROUTER. NativeChatAdapter must implement listSessionModels(SessionId).
4. Then resolve adapters and consumers. The internal factory supplies approvals, metadata write-through and logger. All native identity writes must pass through the initialized lookup; await them before publishing a session.
5. Treat host bindings as immutable after first adapter resolution. Native activation after SDK-only resolution requires a fresh container and fresh consumers; never keep an earlier SDK adapter. Release does not erase native routing identity; persisted deletion does.

The composition guard detects late bindings on resolution, not at raw tsyringe registerInstance itself (tsyringe exposes resolution interceptors). This is an explicit startup contract, not a mechanism to revoke already-held SDK references. Hosts must obey it; the spec proves late resolution fails rather than returning a cached SDK fallback. No apps were edited. Electron/VS Code/CLI/TUI host typechecks remain the team leader's responsibility.

## Verification

All ten changed source/spec files were formatted with repository Prettier.

Final ptah_get_diagnostics included index.ts, register.ts, tokens.ts, the composition spec and every new source/spec; sibling coverage was clean:

> Source: typescript-compiler
> Errors: 0 | Warnings: 0 ? No issues found.
> Coverage: clean
> Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)

One verification attempt was started, with no rerun:

`npm run verify -- -p @ptah-extension/agent-sdk`

It remained queued and was cancelled before acquiring the machine-wide lock. Only this lane's process descendants were stopped; the lock holder was not touched. Temporary output was removed. Last output:

> [verify 2026-10-25T21:26:40.256Z] waiting on pid 26940 [verify lint,test,typecheck (@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime,ptah-electron,ptah-extension-vscode,ptah-cli)] in D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment since 2026-10-25T21:16:31.645Z (queue position 2)

Lint and Jest are NOT claimed passed. The team leader must run authoritative verification. No git, build, installs, live model tests or non-owned source edits were performed.

## Decisions

- Use the existing store get port after updateCodexExecution to obtain the normalized persisted identity, rather than changing the other lane's store return contract or duplicating normalization. Evidence: store writer returns Promise<void>, normalizes internally and emits metadata changes after durable flush. Cache save resolves only after its binding refresh. Reversible: yes; cost is one extra metadata read per native write.
- Preserve native entries on release, and retain bindings on failed/null refresh. Only delete/dispose removes a known native identity. Evidence: binding decisions P6 fix 1 and 9. Reversible: yes.
- Use globally increasing refresh sequence values with per-id map deletion, plus pending-write identity markers, rather than permanently retaining deletion/release tombstones. This prevents stale refresh resurrection after delete/recreate while permitting per-id cleanup. Reversible: yes.
- Enforce the explicit immutable host binding order with tsyringe resolution interceptors instead of introducing a forwarding adapter or replacing container registration methods. Evidence: P6 fix 9 permits a documented host contract with a spec; current registration already caches services. Reversible: yes. Contract limitations are stated above.
- Inject the existing TOKENS.LOGGER in adapter construction rather than require each host to construct another logger. Evidence: register.ts already resolves this token for SDK services; adapter lane requires Logger. Reversible: yes.
- Preserve the existing legacy constructor and adapt a named ports object in wiring rather than edit routing-lane-owned code. Evidence: batch ownership and existing five constructor collaborators. Reversible: yes.
- Keep pre-existing unrelated index exports and narrow only the P6 surface. Hosts still need the established SDK API. Reversible: yes.

## Changed absolute paths

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\di\register.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\di\tokens.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\di\register.codex-runtime.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\session-runtime-identity-cache.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\session-runtime-identity-cache.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-chat-metadata-port.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-chat-metadata-port.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-runtime-composition.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\wiring\codex-runtime-composition.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-6f-wiring-report.md
