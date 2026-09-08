# Architecture review — TASK_2026_304

## Verdict

Reject the 10-batch plan in its current form.

It does not create an encapsulated private session. It creates a per-query `AuthEnv` overlay while leaving the query inside the process-global `SdkAgentAdapter`, its global initialization latch, its global `SessionLifecycleManager`, its global config/auth event subscriptions, its global model services, and its process-wide reset semantics. That is useful plumbing, but it is not the isolation promised by the task.

The right design is an in-process private-session runtime with a fixed, durable session configuration and an owned provider-profile lease. A worker or Electron utility process is not justified yet. The Claude Agent SDK already launches a separate CLI subprocess for each query, and `Options.env` is already a per-query seam. The missing isolation is ownership and lifecycle in Ptah's JavaScript objects, not another OS boundary.

The existing Ptah-CLI lane is evidence for profile and proxy-lease reuse, but it is not already a private-session runtime: it calls the same singleton `SdkAgentAdapter` (`chat-ptah-cli.service.ts:153-164`), tests liveness through that singleton (`:245`), and keeps its route in an in-memory map (`:64`, `:213-220`). A global adapter reset still kills it.

## 1. Correctness and encapsulation gaps

### 1.1 A pinned session still depends on the global adapter

`SdkAgentAdapter.startChatSession` rejects before considering `providerProfile` when the global adapter is not initialized (`sdk-agent-adapter.ts:652-668`). Initialization itself configures the ambient provider and writes global runtime state (`:398-463`). Therefore a perfectly configured private Codex session cannot start if the default Claude/global provider is unhealthy. Its auth error also names the ambient provider (`:241-252`), not the requested private provider.

The plan never removes that dependency. Passing `providerProfile` is not an isolated composition root.

### 1.2 Resets and config events still destroy private sessions

`reset()` calls `dispose()`, and `dispose()` starts `disposeAllSessions()` and clears global authentication/model state (`sdk-agent-adapter.ts:526-545`, `:603-635`). `auth:saveSettings` invokes that reset (`auth-rpc.handlers.ts:790-795`), but it is not the only reset path: Copilot login does it at `:909`, Codex login at `:1190`, and workspace-override clearing at `:1307`. Separately, the adapter's config-change subscriber awaits `disposeAllSessions()` and reinitializes (`sdk-agent-adapter.ts:210-220`). Batch 6 discusses only `auth:saveSettings`, so it does not close the reset surface.

Batch 6 is also not implementable as written. “Scope `sdkAdapter.reset()`” is not a local handler edit: the adapter has one lifecycle manager and `reset()` has no scope. Retrofitting scoped reset means changing the adapter/lifecycle ownership model—the architectural decision the plan is avoiding.

There is an additional race in the existing reset: `dispose()` launches `disposeAllSessions()` without awaiting it, then `doReset()` immediately calls `initialize()` (`sdk-agent-adapter.ts:526-540`, `:624-635`). A plan that makes reset routing more conditional must first specify which sessions and registries are owned by which runtime.

### 1.3 Provider identity is not immutable and `providerId` alone is insufficient

The proposed resolver accepts only `sessionProviderId`, then skips the normal auth-method resolution. Current profile construction branches first on `authMethod` (`workspace-provider-profile-resolver.ts:111-140`). Direct Anthropic via Claude CLI and direct Anthropic via an API key are different configurations even when they target the same provider family. A private configuration therefore needs at least a discriminated auth route, provider id, model, and relevant endpoint/tier snapshot—not a bare provider id.

The current workspace resolver returns `undefined` on missing credentials, unknown providers, proxy startup failure, or any exception (`workspace-provider-profile-resolver.ts:89-151`). On this call path, `undefined` means “silently use global auth.” That behavior is acceptable for legacy workspace inheritance; it is unacceptable for an explicit private-session choice. If the user chooses Codex and Codex cannot be built, the session must fail closed with `AUTH_REQUIRED`/configuration error. It must never answer from Claude.

Batch 1 explicitly preserves the unsafe fallback, contradicting Batch 8's promise to surface `AUTH_REQUIRED`.

### 1.4 Continue semantics are internally inconsistent

For an already-active session, `chat:continue` sends a message directly to the existing query (`chat-session.service.ts:725-731`); it does not resolve a profile. `SdkAgentAdapter.resumeSession` likewise returns the existing stream and ignores the supplied profile when a record is active (`sdk-agent-adapter.ts:754-783`). Thus Batch 3's “param wins” rule is false for active sessions.

Allowing `providerId` to change on `ChatContinueParams` creates two meanings for one request: while active it is ignored; after inactivity it changes the provider used to resume the same transcript. Provider selection must be immutable for a live session. A picker change should start/fork a new session, or be rejected explicitly.

`ChatContinueParams` currently has no provider identity (`rpc-chat.types.ts:115-145`), but adding one is not the right persistence mechanism. Continue should carry the session id; the backend should resolve its durable execution configuration.

### 1.5 Restart/resume is not solved by an in-memory map or webview localStorage

`SessionMetadata` persists session id, workspace, timestamps, usage and CLI child references, but no provider/auth/model execution binding (`session-metadata-store.ts:51-92`). `create()` likewise stores none (`:838-875`). SDK JSONL owns messages, not Ptah's private-provider contract.

Batch 3's tab/session map disappears on host restart. Batch 7's per-tab localStorage can help restore a webview, but it is not authoritative for the headless CLI, a session opened from the sidebar on another renderer, or any backend-driven resume. The `chat:resume {activate:true}` path even constructs an `AutoResumePreflight` object that drops model/provider fields (`chat-session.service.ts:853-865`).

The plan also misstates the existing frontend restore path. `session-loader.service.ts:855-862` restores CLI-agent cards from `cliSessions`; it does not restore the root `ptahCliId` selection. `PtahCliStateService` remains one root signal (`ptah-cli-state.service.ts:22-35`), and `MessageSenderService` reads it only for `chat:start` (`message-sender.service.ts:398-415`). There is no `ptahCliId` field in `TabState`; the per-tab execution fields currently stop at `overrideModel`/`overrideEffort` (`chat-types.ts:592-610`).

Durable backend metadata must be the source of truth. Frontend tab state is a projection.

### 1.6 Slash commands, forks, rewinds, and secondary resume paths are missed

Slash-command re-queries read the ambient model (`chat-slash-command-router.service.ts:117-131`) and `SdkAgentAdapter.executeSlashCommand` uses the global CLI path with no `providerProfile`/auth override (`sdk-agent-adapter.ts:960-984`). A private session can therefore switch provider on `/compact`, `/orchestrate`, or another new-query slash path.

The plan names start/continue/resume but does not cover slash commands, rewind activation, fork inheritance, session duplication, or any other path that creates a new SDK query for an existing conversation. The durable session execution configuration must be consumed by one query-creation funnel, not threaded independently through selected RPC methods.

### 1.7 The environment is still process-derived

The query builder correctly chooses `authEnvOverride` for model resolution (`sdk-query-options-builder.ts:659-692`), but subprocess env is built from `...process.env` first (`:831-840`). Current profile tier population writes only truthy model-tier values (`workspace-provider-profile-resolver.ts:414-438`), so absent tier and metadata keys can inherit ambient values. Batch 4 notices the three model values, but the authoritative set is all twelve `ALL_TIER_ENV_KEYS` (`sdk-model-service.ts:130-137`), including names, descriptions, and capability allowlists.

More broadly, `process.env` contains ambient provider credentials because auth strategies write it. A private query should use the existing safe-env construction (`build-safe-env.ts:43-84`) or an equally explicit whitelist, not inherit every host secret and then try to blank known collisions. Tier blanking is necessary but not sufficient for a “full private configuration.”

The model preflight also detects a cross-provider profile by comparing base URLs, not provider identity (`sdk-query-options-builder.ts:995-1041`). Equal endpoints with different provider definitions/configurations can be validated against the ambient cache. A private runtime should carry explicit provider identity into model resolution and cache keys.

### 1.8 Proxy ownership and races are underspecified

`ProviderProxyPool` is a map keyed by workspace/provider (`provider-proxy-pool.ts:115-145`). `acquire()` has no per-key single-flight: two concurrent misses can both start proxies, after which the later `entries.set` overwrites the first and leaks its listening socket (`:187-229`). Changing the key to `tabId` does not fix that race.

Changing `disposeForScope` to a generic prefix also breaks existing ownership semantics. Workspace removal currently disposes workspace-keyed entries (`:419-435`); tab-keyed entries are no longer discoverable from a workspace. The plan needs an explicit lease object and indexes by tab id, real session id, and workspace, plus idempotent release.

Tab close is not a reliable backend end signal. The frontend dispatches `chat:abort` from an AbortController only for a streaming tab (`message-sender.service.ts:197-230`). Closing an idle tab performs frontend routing cleanup, not necessarily backend runtime disposal. Batch 5's “session end” and Batch 10's “kill one tab” therefore need a real `chat:close`/release route or a backend session-end callback, including tab-id-to-real-id rekeying.

The existing Ptah-CLI registry has the better lifetime pattern: ref-counted leases, retired-but-still-live configurations, and holder keys (`ptah-cli-registry.ts:136-171`, `:366-438`). Generalize that ownership idea; do not copy the current proxy pool's prefix map.

### 1.9 Frontend model/provider state is only partially designed

Canvas already provides a tile-local `SESSION_CONTEXT` through a child Angular injector (`canvas-tile.component.ts:203-246`) and freezes a per-tab model (`:171-183`). That is the correct UI seam. But Batch 7 does not define a discriminated per-tab selection (inherit vs private provider vs Ptah-CLI agent), how provider and model change atomically, how invalid restored values are handled, or how normal non-canvas tabs use the same record.

The persisted tab projection spreads unknown fields (`tab-persistence.ts:93-111`, `:152-169`), so a new field would happen to persist, but relying on that is not a migration design. The persistence version, sanitizer, duplication/reset behavior, and session-opening-from-metadata path all need explicit rules.

## 2. Honest comparison

| Dimension            | A. Thread a session key through the singleton path                                                                                                                                                         | B. Private in-process session runtime                                                                                                                                                                                                           | Worker / utility process variant                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blast radius         | High and diffuse: RPC DTOs, resolver, model selection, query builder, lifecycle maps, reset callers, slash/fork/rewind paths, proxy pool, frontend singletons. Every new query path must remember the key. | Moderate and concentrated: a runtime factory/router, durable session config, profile lease, and frontend selection. The legacy global path stays intact.                                                                                        | Highest: everything in B plus serialization and transport for streams, hooks, permissions, questions, MCP events, aborts, stats and errors.                           |
| What stays untouched | Little. Even “default unchanged” depends on every branch preserving absent-key behavior.                                                                                                                   | The current singleton adapter and global auth/reset behavior can remain the default lane. Auth handlers need not learn session scope.                                                                                                           | Global path stays untouched, but every host needs process lifecycle and packaging work.                                                                               |
| Failure isolation    | Weak. A reset, global initialization failure, shared lifecycle defect, or missed ambient read affects pinned sessions.                                                                                     | Strong enough for provider isolation if the runtime owns its lifecycle and fixed profile, does not subscribe to global reset events, and uses a safe per-query env. Shared read-only services/auth token stores can remain shared deliberately. | Strongest crash/memory isolation; a worker/process can die independently.                                                                                             |
| Cost                 | Lowest steady-state memory, highest long-term maintenance risk.                                                                                                                                            | Small JS-object overhead per private session. The dominant cost—the Claude CLI subprocess/query—already exists. Proxy leases may be shared by identical immutable fingerprints.                                                                 | One extra worker/process per private session (or a pool), more memory/handles, startup latency, shutdown complexity and log routing.                                  |
| Streaming/RPC        | Existing direct async iterable.                                                                                                                                                                            | Existing direct async iterable; router delegates by session id.                                                                                                                                                                                 | Must frame and backpressure every stream event across IPC, correlate callbacks, and preserve ordering of `turn_state`, chunks, permissions and session-id resolution. |
| VS Code              | Works, but contaminates extension-host singleton state.                                                                                                                                                    | Works in the extension host with shared platform ports.                                                                                                                                                                                         | `worker_threads`/child process is possible but adds bundle/resource-path and extension deactivation issues.                                                           |
| Electron             | Works, with global main-process coupling.                                                                                                                                                                  | Works in main using the same factory.                                                                                                                                                                                                           | Electron `utilityProcess` is attractive here only, but is not a shared-core abstraction.                                                                              |
| CLI                  | Works if every request carries the key; restart remains weak without backend persistence.                                                                                                                  | Works identically in the JSON-RPC process; no renderer is required as source of truth.                                                                                                                                                          | Must keep stdout JSON-RPC clean and forward child events on a separate channel; utilityProcess is unavailable.                                                        |

Recommendation: choose B in-process. Add a worker/process only after a measured SDK static-state leak, unacceptable event-loop CPU work, or a requirement to survive/crash-contain native faults. None is demonstrated here. Off-thread process spawning already addresses the known synchronous spawn problem.

## 3. Recommended design and revised batches

### Minimal seams

1. **Durable `SessionExecutionConfig`.** Add a Zod-validated discriminated union in shared contracts: `inherit`, `private-provider`, or `ptah-cli`. A private-provider record contains auth route, provider id, chosen concrete model, endpoint/tier snapshot or configuration version, and workspace. Persist it with session metadata when the SDK UUID resolves. Never persist raw secrets; persist secret-slot identity and re-resolve credentials on host restart. Backend metadata wins over RPC hints.

2. **Fail-closed `ProviderProfileLease`.** Replace “profile or undefined” for explicit private choices with `{ profile, release, fingerprint }` or a typed failure. Build a complete safe subprocess env, including explicit absence for all tier metadata. Use per-key single-flight, reference counting, retirement on config rotation, and idempotent release. Reuse/generalize the Ptah-CLI registry's lease mechanics.

3. **`PrivateSessionRuntimeFactory` and `InteractiveSessionRouter`.** The router maps tab id and real SDK session id to either the existing global adapter or a private runtime. A private runtime owns its session lifecycle/profile lease and handles start, resume, continue, slash re-query, abort/close, model changes and disposal. It must not subscribe to global `SdkAdapterEvents` and must not call `AuthManager.clearAuthentication()` or clear global model caches on dispose.

   A naive tsyringe child container is insufficient: virtually the whole SDK graph is registered `Lifecycle.Singleton`, including the lifecycle manager, query builder and adapter (`agent-sdk/di/register.ts:107-499`). Child resolution would inherit/share parent singletons. Add a dedicated `registerPrivateSessionRuntime(child, fixedConfig)` that re-registers only the stateful subgraph, or use an explicit factory. Share platform ports, logger, module loader, immutable helpers, metadata/history stores, and deliberately machine-global OAuth token services.

4. **One query-creation funnel.** Every new SDK query for an existing session—including auto-resume, slash commands, rewind and fork—asks the router for the durable execution config. A provider change on a live session is rejected or creates a new/forked session; it is never silently applied on the next inactive resume.

5. **Per-tab frontend projection.** Put the discriminated execution selection and model in `TabState`; use `SESSION_CONTEXT` for both canvas and ordinary chat components. `PtahCliStateService` becomes catalogue/default state only. Persist and sanitize the selection explicitly, restore it from backend session metadata when opening historical sessions, and send it only when creating a new session or backfilling legacy metadata.

### Keep/drop/reorder the existing batches

- **Replace Batch 1.** Do not add a resolver that silently falls back. Build the durable selection plus fail-closed profile lease first.
- **Rewrite Batch 2 and move it first.** Keep a typed/Zod contract, but do not put a freely mutable `providerId` on every continue. Add `executionConfig` to start and a legacy/backfill hint to resume; make backend session metadata authoritative.
- **Drop Batch 3's ad-hoc map.** Replace it with the runtime router and durable binding. Include tab-id/real-id rekeying.
- **Keep Batch 4's tier/model concerns, move them into profile construction, and expand it.** Blank all tier metadata and use a safe env. Provider/model must be one immutable configuration.
- **Replace Batch 5.** Use leases, single-flight acquisition, retirement and explicit close/session-end release; do not overload `disposeForScope` with unrelated key types.
- **Drop Batch 6.** Leave global auth reset behavior on the global adapter. Private runtimes are outside its lifecycle, so `auth:saveSettings`, login/logout and config events cannot dispose them. Credential rotation affects a live private proxy only according to the lease's documented policy.
- **Keep Batch 7, but implement it before the picker and make backend metadata authoritative.** Include Ptah-CLI selection in the same union rather than a second singleton path.
- **Keep Batch 8 after state/runtime support.** Changing provider on an existing session must offer “start new session” rather than mutate it.
- **Split Batch 9 into a separate task.** Gateway workspace inheritance is a valid bug, but it has no tile/private-session semantics and should not expand this acceptance surface.
- **Keep and expand Batch 10.** Run project-targeted tests first, then the repository sweep; add real multi-host integration coverage.

Suggested order: contract + persistence; profile lease/env; private runtime + router; all query-creation paths; frontend tab state/restore; picker; lifecycle/reset isolation; cross-host verification.

## 4. Risks and proof tests

The main risks are accidental sharing through a parent singleton, losing the profile lease on tab/UUID rekey, resuming from stale frontend state, proxy acquisition/release races, and query paths that bypass the router.

Tests that prove isolation—not merely parameter threading—must include:

1. **Two concurrent tiles, same workspace:** Claude and Codex both stream; assert distinct effective provider env/model, correct event routing, and no cross-provider tier/capability metadata.
2. **Flip global provider mid-stream:** start a private Codex turn, switch global Claude/OpenRouter settings, and start a global turn. The private stream/query handle and proxy port remain unchanged; the global turn uses the new default.
3. **Auth reset during private streaming:** invoke each reset-producing route (`saveSettings`, Copilot login/logout as applicable, Codex login, clear workspace override, config-change event). Assert the global session is reset where expected and the private query is neither aborted nor removed.
4. **Unhealthy global provider:** make global initialization fail, then start a valid private session. It must succeed and report private-provider errors if it fails.
5. **Fail closed:** select Codex with missing credentials or forced proxy-start failure. Assert `AUTH_REQUIRED`/typed failure and zero calls through ambient auth.
6. **Host restart:** persist a private session, destroy all in-memory maps/containers, recreate the VS Code, Electron and CLI composition roots, resume using only session id/workspace, and assert the same execution config is restored. Also cover historical sessions without the new metadata as explicit `inherit` migration.
7. **Slash/fork/rewind:** after restart, run a slash-command new query, rewind-resume and fork. Each inherits the private configuration unless the user explicitly starts a new configuration.
8. **Provider-change rejection:** send a conflicting provider hint on an active and inactive existing session. Both must reject or fork consistently; neither may switch only because the record happened to be inactive.
9. **Proxy races:** concurrent acquire for the same fingerprint starts one proxy; config rotation retires the old lease without stopping live holders; double close is harmless; close racing with acquire leaves no orphan socket.
10. **Idle tab close:** close a non-streaming private tab and assert its runtime and lease are released. Close one of two sessions sharing a lease and assert the other remains usable.
11. **Environment secrecy:** seed `process.env` with another provider's credential and tier metadata, build a private query, and assert those keys are absent from `Options.env` while required platform variables remain.
12. **Frontend restoration:** two tabs retain different execution selections and models through webview reload; opening a session from backend metadata reconstructs the same selection even with empty localStorage; a background-workspace tile sends its own selection, not the active tab's.

Until those tests pass, the feature should not claim that a tile is private or isolated. The current plan proves only that a provider id can reach selected start/resume calls.
