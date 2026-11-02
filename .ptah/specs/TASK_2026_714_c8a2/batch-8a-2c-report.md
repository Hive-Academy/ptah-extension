# Batch 8a-2c: Electron native chat binding implemented; verification pending

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/activation/bootstrap.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/activation/shutdown.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/expected-resolvable.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/container.smoke.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/rpc-surface.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/surface-composition.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8a-2c-report.md

Only the eight allowed Electron source/spec files and this deliverable were edited. Existing agent-sdk and rpc-handlers lifecycle patches belong to the team leader and were read, not edited or reverted. The previous lane's lazy scope work is retained.

## Binding

`bindElectronCodexChat` awaits the identity initializer and then registers all six guarded tokens literally, as stable useValue instances, before adapter resolution. Dependencies capable of resolving back into the router use deferred delegates. A binding failure disposes the initialized identity subscription.

| Token | Value source |
| --- | --- |
| SESSION_RUNTIME_IDENTITY_LOOKUP | awaited createElectronCodexIdentityLookup(metadataStore, logger) |
| CODEX_CHAT_ADAPTER_PORTS | spread createCodexChatHostPorts result, profile routing wrapper, sessions: record.lifecycle |
| RUNTIME_ADMISSION_PORT | createCodexRuntimeAdmission with workspace resolver, platform, webview and routing capabilities |
| RUNTIME_HOST_CAPABILITIES | createElectronCodexRouting(input).capabilities |
| NATIVE_SESSION_CONTROLS | createNativeSessionControls; record.settings(id), shared settings store and native adapter delegates |
| LEGACY_SESSION_CONTROL_PORTS | createLegacySessionControlPorts; SDK lifecycle lookup, model resolver, adapter slash stream, workspace-scoped settings persistence |

ProviderInfo.id is codex-app-server. The complete host-port object is preserved, including handlePermissionResponse for Batch 8b. Thread identity persistence uses createCodexThreadIdentityStore(lookup, metadataStore). Callbacks pass the supplied turn and resolve the same CHAT_TOKENS.STREAM_DELIVERY_COORDINATOR used by the broadcaster.

Prepared results are weakly associated with tabs. record.lifecycle records settings and installs the session/tab and usage-profile associations only on opened; closed removes them and releases native control state. Failed/cancelled opens retain no strong prepared-profile entry. Inactive legacy controls recover workspace from persisted lookup, validating stored model/effort/permission settings.

Native off does not resolve the binary, pin, spawner, or home auth service. First native scope creation finds the reviewed platform/architecture pin, restricts the resolved executable to bundledRoot, hashes its bytes with sha256 and captures --version (10-second timeout, hidden Windows process). Runtime verification remains authoritative. The scope factory registers only in a child container. A missing binary or missing pin throws inside the adapter open boundary, which converts it to runtime-failed; bind itself succeeds.

usage.auth resolves AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_AUTH. profileForHome uses an opened session bound to that normalized home to build a validated usage profile with the real provider/model/workspace, canonical home/cwd, consumer usage and ask permissions. It refuses homes without an opened session. No new auth watcher or invalidation subsystem was added.

## Bootstrap/shutdown order

Bootstrap awaits workspaceStateStorage.whenReady(), registers WEBVIEW_MANAGER, then awaits bindElectronCodexChat. It passes app.isPackaged verbatim and process.env. This precedes activateSessionLifecycleNotifier and startAgentAdapterInitialization, and completion of bootstrap precedes the runtime RPC registration stage. Packaged bundledRoot is resources/app.asar.unpacked/node_modules; development uses app.getAppPath()/node_modules.

An active binding makes requiresDeferredDisposal true. Before SQLite closes, shutdown awaits binding disposal: mark binding disposed (reject future scopes), lookup.dispose(), record.dispose(), clear associations, await all scope disposals. Each scope closes runtime, then usage, then child container in nested finally blocks. Scope disposal is idempotent; all scopes are attempted and aggregate failures propagate. A binding removes itself from the shutdown registry even when scope closure fails.

## Spec cases

Added complete-binding cases for native-off default, packaged dev-switch rejection, and unpackaged development capability. They assert all six tokens are stable/non-null, the legacy initialize path resolves through the SDK adapter alias, permission-response handling survives, no binary inspection occurs at bind, and lookup unsubscribes at disposal.

Added a real CodexChatAdapter first-open test for runtime-failed after successful binding when the executable is missing. Existing helper coverage retains chat-only gating (gateway/lane refused), missing binary without child allocation, bundle containment, and runtime/container cleanup order.

Updated expected-resolvable.ts and the smoke, RPC-surface and surface-composition guards. Smoke checks pre-bootstrap SDK nullable defaults; composition checks all six literal registrations and bootstrap ordering. The expected token census distinguishes defaults from the six bound host ports.

Tests were written but NOT executed. The composition spec imports SDK implementation classes/registration directly for its isolated real-adapter fixture because those implementation values are not public exports; lint acceptance remains for the team leader.

## 8a acceptance list

- Await identity initialization before resolution: implemented in bind; the six registrations are synchronous after preparation, with lazy adapter/stream delegates.
- Literal DI registrations: each of the six SDK_TOKENS appears directly in container.register(..., { useValue }). Runtime internals retain the library's literal registration helper. di-lint not run.
- Native canSendFollowUp and single persistence owner: native controls delegate eligibility to CodexChatAdapter and use createNativeSessionControls persistence/rollback; no additional host settings write is introduced. Legacy controls use the existing serialized control/persistence factories.
- Validated CodexExecutionProfile and model notice: createCodexChatHostPorts owns validation; composition does not publish another model notice. Usage profiles also pass buildCodexExecutionProfile.
- FM-R2 effort rollback: legacy setters route through library LegacySessionControls, whose commit operation restores the live predecessor after a failed persistence operation. Native rollback is owned by createNativeSessionControls.
- FM-R6 permission scope: control persistence uses the explicit caller scope supported by the factory and session/persisted workspace, never the focused workspace. Remaining caveat: the legacy auth namespace is resolved from that workspace's current auth selection; no immutable legacy auth-key snapshot is exposed by the session record. Provider changes within the same workspace therefore remain a review item.
- Overlapping model predecessors: library legacy controls serialize per session and native controls serialize settings changes. No competing Electron write path was added.
- runtime-admission-mismatch wire taxonomy: library/shared RPC error-code taxonomy is outside these eight files; this host does not alter it. Carried minor finding remains for library review.
- Direct SDK_AGENT_ADAPTER users: deliberate here only for the legacy delegate; routed alias remains SDK-owned. Existing library chat-session callers were not rewritten. Full repository-wide call-site audit remains a deciding review task.
- Broadcaster cleanup: callbacks use the shared delivery coordinator; follow-up/slash streams use the existing broadcaster. No second stream pump is added. Existing broadcaster finally cleanup stays library-owned.
- Same session in two tabs: adapter open retains duplicate-session checks; host associations are installed only by the accepted opened lifecycle. Adapter behavior was source-inspected, not exercised live.
- Pending-resume thread-id cleanup: resume identities read through the shared context/thread store; adapter retains opening-key cleanup in finally. Host adds no strong pending-profile cache.
- Cancellation during prepare: prepared-tab WeakMap entries need no explicit release; settings/usage entries are only created by opened and released by closed. Adapter generation/cancellation checks precede scope creation/publication.
- Notice message_complete versus queued content: shared event callbacks receive the actual turn and shared delivery coordinator, preserving library event ordering and terminal flushing. No duplicate notice publisher was added; visual/runtime ordering remains unverified.
- M2/DS1: app.isPackaged is passed verbatim; packaged override is null, default native remains off, and gateway/lane stay gated in helper coverage. No VS Code, CLI, TUI or gateway composition file was changed.

## Needs a lib change

The two original blockers are resolved by the team leader's lifecycle patch. No additional library change was required to install this binding, and no library was edited by this lane.

Carried review items remain: immutable legacy auth namespace across provider changes within one workspace, RPC error-code taxonomy for runtime-admission-mismatch, and the broader direct-SDK caller audit above. These are not claimed fixed by this host patch.

## Decisions

- Defer binary inspection until first native scope. Alternative: eagerly inspect at bind. Evidence: synchronous createScope contract and adapter's coded open-error boundary; native-off and missing-bundle startup requirements. Reversible in host composition.
- Use synchronous bounded --version and file hashing at first open. Alternative: change library scope creation to async. Evidence: createScope returns CodexChatScope synchronously. This avoids a library edit but can block the Electron main thread during first inspection; performance is unmeasured. Reversible with a future async scope contract.
- Preserve and extend record.lifecycle rather than wrapping metadata. Alternative: obsolete wrapPorts approach. Evidence: updated library opened/closed contract and SDK-owned metadata replacement. Reversible entirely in host code.
- WeakMap prepared-tab association; strong session associations only after opened. Alternative: pending context map requiring failed-open callbacks. Evidence: failed/cancelled opens call neither lifecycle method. Reversible.
- Usage profiles derive from opened native sessions for the requested explicit home. Alternative: invent a default model/provider or read focused settings. Evidence: profileForHome requires a complete profile and account usage should retain session ownership. Homes without an opened session fail explicitly. Reversible.
- Track shutdown bindings in the composition module. Alternative: expand BootRefs, which is outside the allowed file set. Evidence: shutdown already centralizes deferred disposal; module registry supports multiple test containers and idempotent close. Reversible.
- Legacy settings use session/persisted workspace and workspace-specific auth resolution. Alternative: focused global auth. Evidence: session config and lookup expose workspace, not a frozen auth-key namespace. Reversible; provider-change caveat recorded above.

## Not verified

No verify, Nx, Jest, tsc, eslint, build, serve, dev, e2e, packaging or install commands were run. No git writes were performed. Scoped ptah_get_diagnostics calls reported TypeScript unavailable because the compiler remained running after 45 seconds; they did not establish a clean result. Final source edits therefore remain unchecked.

Team leader must run deciding Electron checks, di-lint and four-host typechecks. Also unverified: actual packaged/development bundle layout, real native launch and auth refresh, live IPC permission replies (Batch 8b), usage polling, shutdown under active opens, and visual streamed-notice ordering. Do not treat this report as a passing verification result.
