# Batch 6e report

Implemented the approved synchronous lookup composition, optional native bindings and package exports. No task state or host files changed.

## Absolute files created or modified

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/tokens.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts (new)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6e-report.md (new)

## Tokens and bindings

All new tokens use Symbol.for with their class/type name.

| SDK_TOKENS key | Binding and default |
| --- | --- |
| SESSION_APPROVAL_ROUTER | Cached SessionApprovalRouter; SDK_PERMISSION_HANDLER handles legacy responses, host presentation.cancelPrompt handles cancellation. The native adapter receives this same instance. |
| CODEX_CHAT_ADAPTER_PORTS | Host-supplied nullable ports; guarded default `{ useFactory: () => null }`. |
| RUNTIME_HOST_CAPABILITIES | Host-supplied capabilities; guarded default `{ nativeCodex: false }`. |
| SESSION_RUNTIME_IDENTITY_LOOKUP | Host-supplied initialized lookup; guarded default `{ useFactory: () => null }`. |
| LEGACY_SESSION_CONTROL_PORTS | Host-supplied LegacySessionControlPorts constructor tuple; guarded default `{ useFactory: () => null }`. |
| NATIVE_SESSION_CONTROLS | Host-supplied SessionRuntimeControls; guarded default `{ useFactory: () => null }`. |
| CODEX_CHAT_ADAPTER | Cached factory constructs only with both host ports and initialized identity lookup; otherwise null. Registration opens no runtime. |
| ROUTING_AGENT_ADAPTER | Cached RoutingAgentAdapter only when native adapter and lookup exist; otherwise null. |
| LEGACY_SESSION_CONTROLS | Cached LegacySessionControls only with host constructor ports; otherwise null. |
| SESSION_RUNTIME_ROUTER | Cached SessionRuntimeRouter only with lookup, legacy controls and native controls; otherwise null. |

Nullable defaults respect parent-container bindings via isRegistered(token, true). Host registration must finish before first resolution. registerSdkServices invokes exported registerCodexChatServices. Public exports include P6 adapters, routers, errors, events, sinks, their ports/types and the initialization/metadata helpers. No auth-providers imports were introduced.

## Identity cache and host lifecycle

Hosts await initializeSessionRuntimeIdentityLookup(store), then register the result under SESSION_RUNTIME_IDENTITY_LOOKUP before native activation. It preloads getAll(), subscribes before preload, and does not overwrite entries touched during preload with older snapshot data. Outstanding refreshes observed during preload are awaited. Native rows retain codexExecution; existing legacy rows become explicit claude-sdk identities using persisted provider/workspace (missing historical provider defaults to claude-cli).

onMetadataChanged reloads only the changed session through store.get. Per-ID sequences reject out-of-order responses and responses predating a completed write. Deleted events remove entries immediately. Failed refreshes invalidate that entry instead of retaining a potentially stale binding.

The initialized lookup exposes updateCodexExecution as its write-through port. It calls the existing sole writer, then synchronously updates the cache before resolving, normalizing workspace identity with the same helper/platform as the store. DI always supplies this port to createCodexChatMetadataPort; hosts persisting native runtime identity must also use this write-through port. No direct writer or storage mutation was introduced. The helper checks sessionId equals native threadId and persists only durable identity fields.

Hosts call releaseSession(id) on final release and dispose() on host shutdown. Release/delete invalidate outstanding reads and pending writes; disposal unsubscribes, clears caches and rejects new writes. The 6b/6c synchronous lookup interfaces are unchanged. No per-session timer or observer exists.

## Default behavior and routing (requirement 5)

wireAgentAdapterAliases resolves ROUTING_AGENT_ADAPTER only when configured; otherwise it returns the exact SDK_AGENT_ADAPTER instance, preserving default identity and behavior. If host chat ports or the initialized lookup are absent, no native adapter/routing is constructed. The default capability is false.

With native composition present, RoutingAgentAdapter receives the persisted identity lookup, legacy SDK adapter, native adapter and host capabilities. Existing-session dispatch uses persisted identity, never focus. Native exceptions propagate; no catch retries on legacy. The DI spec exercises a native resume failure with capability still false, asserting no legacy resume call. New native admission remains capability-controlled and the adapter retains its sole resolveGatedCodexRuntime path.

## Approval release (requirement 6)

Confirmed in codex-chat-adapter.ts: present stores the release function returned by SessionApprovalRouter.register; dismiss invokes it, deletes it, then calls the host presenter. CodexChatApprovalSink settlement invokes dismiss even after cancellation-presentation failure. Timeout/abort/disposal use settlement; adapter close aborts and disposes its sink. No duplicate release hook or changes under codex-app-server were needed. Legacy approval responses use SDK_PERMISSION_HANDLER; cancellation notifications forward to host presentation.cancelPrompt.

## Verification

- Final scoped ptah_get_diagnostics after all edits: `Source: typescript-compiler`, `Errors: 0 | Warnings: 0 — No issues found.`, `Coverage: clean`; zero diagnostics in requested and sibling files.
- Formatted all four source/spec files with repository Prettier.
- Nine authored DI/cache tests cover default object identity/null bindings, inherited capability, metadata mapping/mismatched IDs, preload/disposal, write-through superseding stale reads, out-of-order events, release/deletion, and native failure without legacy fallback.
- Previous partial-turn verify was queued; resuming its process returned `Unknown process id 35699`. It produced no Nx result.
- Started once for the completed changes: `npm run verify -- -p @ptah-extension/agent-sdk`, foreground with 30000ms command yield. Full log: C:/Users/abdal/AppData/Local/Temp/ptah-batch-6e-completed-verify.log. Result pending; no test counts, lint outcome or Nx summary claimed yet.
- No git, dependency installation, host edits, paid/live model calls, or separate lint/test/build commands.

## Decisions

1. Keep lookup synchronous and initialize it asynchronously, as explicitly approved by the orchestrator. Options: async router contract, synchronous store accessor, or initialized cache. Evidence: synchronous IAgentAdapter methods and async SessionMetadataStore reads. Chosen cache has write-through, per-ID sequencing and explicit teardown. Reversible through a host port without changing 6b/6c.
2. Nullable host-owned constructor ports for legacy controls and native controls, as approved. Options: compose host settings/slash behavior in agent-sdk or let hosts supply existing behavior. The constructor requires settings persistence, model resolver, lifecycle and slash ports; agent-sdk cannot infer host scope. Reversible at host composition.
3. Preserve default SDK object identity and gate native construction on ready ports/lookup. Options: eager routing or optional lazy construction. Evidence: requirements 2/3/5 and the approved null-lookup rule. Reversible by registering host bindings before first resolution.
4. Keep DI-owned approval singleton and metadata writer, using the adapter's existing release-on-dismiss path. Evidence: requirement 6 and inspected sink settlement. Reversible composition; ownership/release guarantees must remain.
5. Do not bypass updateCodexExecution for optional title. It accepts only sessionId/updater, retains existing name, and initializes new name to sessionId. Optional adapter titles need a writer-contract extension in the owning batch; the report flags this limitation rather than using another persistence path. Reversible in 6d/host follow-up.

## Remaining integration boundaries

Host wiring remains batches 8a/8d/8e: await/bind lookup, provide ports/capabilities, persist through the write-through port, release cache entries on final session release, and dispose the subscription at shutdown. Controls remain null without host ports. Host compilation belongs to team-leader verification. Optional metadata title is not supported by the current sole-writer contract. No implementation decision remains pending.

## Team-leader binding confirmation

Re-read the final implementation against the orchestrator decision. Confirmed:

- SessionRuntimeIdentityLookup.lookup remains synchronous. Exported initializeSessionRuntimeIdentityLookup(store) awaits getAll() and returns the initialized lookup; hosts must await it before registering/enabling native composition.
- The initialized lookup's updateCodexExecution delegates to the sole store writer, then updates the cache synchronously before its returned promise resolves. DI supplies this write-through port to the adapter metadata helper.
- onMetadataChanged re-reads through store.get; per-ID sequence numbers reject older reads after later events or completed writes. Release/delete remove entries and invalidate pending reads/writes. dispose unsubscribes.
- The host lookup token defaults null. With null lookup, native adapter and routing adapter bindings resolve null; default AGENT_ADAPTER remains the existing SDK instance. After native selection there is no fallback to SDK on failure.
- LegacySessionControlPorts is a nullable host constructor tuple. SessionRuntimeRouter stays null unless lookup, legacy controls and native controls all exist.
- Cancellation notifications forward to presentation.cancelPrompt. The legacy router dependency resolves SDK_PERMISSION_HANDLER and forwards legacy approval responses to handleResponse. It does not synthesize a user response for UI cancellation; SessionApprovalRouter documents that cancellation is not a user response and the core/sink owns denial. The existing adapter invokes register() release on dismiss, including settlement from timeout/abort/disposal.
- Specs exist for preload, write-through, out-of-order event, release/delete and native failure without legacy retry. The ninth spec uses the real SessionMetadataStore, supplies a title, and verifies persisted name equals sessionId.
- updateCodexExecution remains the sole identity writer. Its missing title parameter is explicitly accepted as a batch-6d/host follow-up; no alternate title write was added.

The prior title verification session 30113 no longer exists. This confirmation turn started the exact package verification command once, foreground with a 30000ms yield, filtered to its final 75 lines. Full output is retained at C:/Users/abdal/AppData/Local/Temp/ptah-batch-6e-confirm-verify.log. Final scoped diagnostics again report Errors: 0, Warnings: 0, Coverage: clean. Final package result is still pending; previous queued attempts are not represented as successful checks. This turn changes only this report; implementation and nine specs were already present.
Confirmation verification outcome: started exactly once in this confirmation turn, session 89856. After the initial foreground 30-second command wait and one 300-second completion wait, it remained queued. Actual latest evidence: `[verify 2026-10-25T20:07:58.593Z] waiting on pid 37600`, wizard-library-alignment worktree, `(queue position 3)`. It has not reached Nx. There are no actual Nx summary lines, executed test counts or lint results to quote; package verification remains incomplete. The known lint/EPERM issues are not claimed as observed failures. No command rerun, workspace-wide target, install, git or live model call occurred in this turn. The team-leader must collect completion from the log/session or arrange verification once the FIFO admits the task.