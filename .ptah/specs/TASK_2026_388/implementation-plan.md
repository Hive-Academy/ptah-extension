# Implementation Plan - TASK_2026_388

> **Architect fallback:** the requested `software-architect` subagent was invoked twice. The first completed its evidence pass but did not emit the requested plan; the retry was unavailable because the agent service reached its usage limit. Per the task instruction, the planning lead completed the architect role with the same evidence and rigor. The first subagent later emitted `plan-review-claude.md`; its six findings were folded into this final plan and batch map. No product source was modified.

## Inputs and constraints

- Binding inputs: this task's `task.md` and `context.md`; TASK_2026_304's `plan-review-codex.md` and `context.md`; the root and requested library `CLAUDE.md` files; and TASK_2026_385's plan/batch format.
- This is a plan only. All implementation changes are deferred, and this task writes only under `.ptah/specs/TASK_2026_388/`.
- The existing global/default SDK adapter remains the exact compatibility path. A session uses a private runtime only after an explicit, valid non-`inherit` selection.
- Private credentials remain process-memory-only. Metadata may identify a provider and immutable session choices, but never an API key, OAuth token, CLI credential path, proxy port, raw credential fingerprint, or resolved `authEnv`.
- The gateway bridge remains global. Closing its routing gap is a separate task.

---

## Codebase evidence

| Evidence                                                                                                                | Current location                                                                                                                                                        | Architectural consequence                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The product composition registers one stateful `SdkAgentAdapter` and aliases `TOKENS.AGENT_ADAPTER` to it.              | `libs/backend/agent-sdk/src/lib/di/register.ts:496-512`                                                                                                                 | Do not replace this alias. Add an explicit interactive router token used only by chat/session orchestration.                                         |
| Session lifecycle, transformers, query builder/runner and model service are stateful or auth-sensitive.                 | `agent-sdk/.../session-lifecycle-manager.ts:270-325`; `sdk-message-transformer.ts:55-114`; `stream-transformer.ts:219-239`; `di/register.ts:303-337,415-458`            | A private runtime needs isolated instances of the session/auth/query state, while platform ports and immutable infrastructure stay shared.           |
| Global adapter subscribes to config/workspace/auth events and reset/dispose tears down its sessions.                    | `sdk-agent-adapter.ts:207-233,526-545,603-635`                                                                                                                          | Private runtimes must not subscribe to `SdkAdapterEvents` or the global config watcher and must not be reachable from global reset paths.            |
| Metadata is created after the SDK exposes the real UUID, then the ID registry is notified.                              | `sdk-agent-adapter.ts:876-923`; `session-metadata-store.ts:838-883`                                                                                                     | Persist the immutable execution config on the UUID-resolution callback, after metadata creation, and rekey router/lease indexes there.               |
| All query execution converges through `SessionQueryExecutor`.                                                           | `session-query-executor.service.ts:253-317`                                                                                                                             | Preserve one options-builder/query-runner funnel; routing chooses the runtime before reaching it.                                                    |
| Private query env currently begins with `process.env`.                                                                  | `sdk-query-options-builder.ts:831-848`; whitelist in `build-safe-env.ts:46-85`                                                                                          | Add an explicit private environment branch; leave the ambient/global branch byte-for-byte compatible.                                                |
| Model auth caching resolves global active auth.                                                                         | `sdk-model-service.ts:287-299`                                                                                                                                          | Private cache identity must include fixed provider identity and credential fingerprint, not merely base URL/global auth state.                       |
| `ProviderProxyPool.acquire` can return no proxy and is keyed only by workspace/provider.                                | `auth-providers/.../provider-proxy-pool.ts:113-115,145-229`                                                                                                             | Put fail-closed, single-flight, ref-counted ownership in `ProviderProfileLease`; do not reuse the legacy workspace lifetime as the session lifetime. |
| `PtahCliRegistry` already models current/retiring generations and idempotent release, but has no acquire single-flight. | `ptah-cli-registry.ts:154-171,897-1020`                                                                                                                                 | Reuse its generation semantics through the new lease abstraction; route `ptah-cli` sessions through private runtimes, not the global adapter.        |
| Start and resume carry legacy `ptahCliId`; continue carries no provider.                                                | `rpc-chat.types.ts:37-102,115-145,210-230`; `chat-rpc.schema.ts:47-75`                                                                                                  | Add `executionConfig` only to start, plus a legacy resume backfill hint. Continue remains immutable.                                                 |
| The allowlist already permits the entire `chat:` namespace.                                                             | `libs/backend/vscode-core/src/lib/rpc/rpc-handler.ts:44-47`                                                                                                             | `chat:close` needs contract/manifest wiring but no `ALLOWED_METHOD_PREFIXES` change.                                                                 |
| Chat start, inactive continuation, slash, fork and rewind currently reach the global adapter through separate services. | `chat-session.service.ts:539,667-674,1193`; `chat-slash-command-router.service.ts:104-133`; `session-rpc.handlers.ts:972,1052-1062`; `chat-ptah-cli.service.ts:153-164` | Replace these entry points with one router-selected query creation path.                                                                             |
| `TabState` owns model override, persistence is version 2, and start reads the global Ptah CLI selection.                | `chat-types.ts:487,601-610`; `tab-persistence.ts:54-60,93-100,152-169`; `message-sender.service.ts:398-414`                                                             | Persist selection per tab, bump/migrate storage, and send it only on `chat:start`.                                                                   |
| `SESSION_CONTEXT` is currently canvas-only; ordinary chat renders directly from the app shell.                          | `session-context.token.ts:3-10`; `canvas-tile.component.ts:235-246`; `app-shell.component.html:680`                                                                     | Provide the token at both ordinary-tab and canvas-tile boundaries so background tiles never borrow the active global selection.                      |
| The three host roots register auth then SDK and expose smoke manifests.                                                 | VS Code `phase-2-libraries.ts:146-147,201`; Electron `phase-2-libraries.ts:179,184,260`; CLI `container.ts:638,642,692,902`                                             | Register the lease bridge, factory and router in all hosts and pin them in resolvability tests/manifests.                                            |

---

## Architecture decision

### Chosen shape

Keep the new runtime machinery in `libs/backend/agent-sdk`. `PrivateSessionRuntimeFactory` and `InteractiveSessionRouter` are the SDK session-lifecycle concern, not a second provider/auth domain. A new Nx library would create another `agent-sdk`-shaped boundary and a dependency problem: auth providers already depend on the SDK contracts. `auth-providers` supplies `ProviderProfileLeaseProvider` through a new SDK token; agent-sdk never imports the concrete provider library.

The global adapter remains registered and globally observable exactly as today. Chat orchestration instead injects `INTERACTIVE_SESSION_ROUTER`, whose implementation satisfies `IAgentAdapter` and adds routing operations for slash, fork, rewind, close and UUID rekey. For `inherit`, every method delegates to the existing `TOKENS.AGENT_ADAPTER`. For either private variant, it obtains a lease and builds an isolated `PrivateSessionRuntime` containing another instance of the **same** `SdkAgentAdapter` configured with `AdapterRuntimeMode: 'private'`. Thus `ChatSessionService` speaks one interface while the router selects its instance; no parallel adapter implementation is created.

The process-boundary seam is the factory plus the `IAgentAdapter`/event contracts. Initially a private runtime is in-process to avoid duplicating platform ports and RPC plumbing. Adopt an Electron `utilityProcess`/Node worker only after measurement shows one of: (1) a private query blocks the event loop for more than 50 ms p95 over 100 turns, (2) private runtimes add more than 150 MiB p95 RSS or leak more than 25 MiB after ten close cycles, (3) an SDK crash terminates a host in two independently reproduced incidents, or (4) provider SDK dependency conflicts cannot coexist in one process. The replacement implements the same runtime handle and event surface behind the factory.

### Rejected alternatives

1. Mutating the singleton adapter's active provider: races concurrent tabs and remains coupled to reset/config events.
2. One singleton per provider: session state, credential retirement and proxy lifetime require generation- and holder-specific ownership.
3. A provider field on `chat:continue`: makes provider choice mutable mid-session and makes resume conflict rules ambiguous.
4. Making private execution the default: violates the regression floor and changes installs that never select it.

---

## Component plan

### 1. Shared immutable session contract

Add `session-execution-config.types.ts` under `libs/shared/src/lib/types/` and export it type-only through the public barrel. Define and export the strict Zod schema beside the type so persistence and RPC consume one contract:

```ts
type SessionTierSnapshot = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: string | null;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string | null;
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string | null;
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: string | null;
  ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: string | null;
  ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: string | null;
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: string | null;
  ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION: string | null;
  ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: string | null;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: string | null;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION: string | null;
  ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: string | null;
};

type FixedProviderSelection = {
  providerId: string;
  authRoute: 'claude-cli' | 'anthropic-api-key' | 'provider-api-key' | 'oauth-proxy' | 'local-native' | 'local-proxy';
  model: string;
  providerBaseUrl: string | null;
  tierSnapshot: SessionTierSnapshot;
};

type SessionExecutionConfig = { kind: 'inherit' } | ({ kind: 'private-provider' } & FixedProviderSelection) | ({ kind: 'ptah-cli'; agentId: string } & FixedProviderSelection);
```

All objects are `.strict()`, identifiers/models are trimmed non-empty strings, base URL is an HTTP(S) URL or `null`, and all twelve tier keys are required but nullable so absence is explicit. The endpoint is the stable provider endpoint, never an ephemeral localhost proxy URL. The schema structurally cannot contain credentials.

Add `executionConfig` and a metadata-format version to `SessionMetadata`. `SessionMetadataStore` gains `stageExecutionConfig(tabId, config)`, `adoptStagedExecutionConfig(tabId, realSessionId)`, `getExecutionConfig`, and copy support for fork. Before the first private query starts, write a small durable pending record keyed by tab ID through the metadata store; only after that succeeds may the SDK process start. This closes the host-crash interval before UUID resolution. On UUID resolution, atomically move/adopt the staged record into the real session metadata and clear the staging key.

An absent field means `{kind:'inherit'}` only for metadata created before the new format and with no staged record. A staged record is authoritative for its tab. A post-feature metadata record lacking both config and a matching staged record is `SESSION_EXECUTION_CONFIG_MISSING`; a present invalid field is `SESSION_EXECUTION_CONFIG_INVALID`. Neither case silently falls back to ambient credentials.

Extend `SessionIdResolvedCallbackRegistry` with a backwards-compatible durable lane (`registerDurable`/`notifyDurable`): existing `notifyAll` and synchronous subscribers remain unchanged. `StreamTransformer` accepts and awaits a `void | Promise<void>` resolution callback, and both adapter UUID sites await the durable lane. The order is metadata create/touch -> staged-config adoption -> add real-ID router/lease indexes -> publish external resolution -> remove placeholder-only state. Fork copies the source value. Metadata duplicate helpers preserve it. No secret-derived value is serialized or logged.

### 2. RPC contracts and immutability

- `chat:start`: add optional `executionConfig`, defaulted by the backend Zod schema to `{kind:'inherit'}`. Updated first-party callers send it explicitly, but existing CLI/TUI/external JSON-RPC callers remain compatible. The backend parses the full strict union before use.
- `chat:resume`: add optional `executionConfigHint` only for legacy records whose metadata has no field. It is a one-time backfill hint, not a command to switch. Existing metadata wins; a conflicting hint returns `EXECUTION_CONFIG_IMMUTABLE` and offers the frontend the fork/new-session path. A non-legacy invalid metadata value fails closed.
- `chat:continue`: no provider/config field is added. Unknown extra provider fields are rejected at the execution-config boundary rather than consumed.
- `chat:resume` result and session summaries include authoritative `executionConfig`, allowing the backend to overwrite stale/empty local persistence.
- Add `chat:close { tabId, sessionId? } -> { success: true }`. It releases routing/runtime ownership even if no stream is active; abort remains a turn operation.
- Update shared RPC maps and backend Zod schemas/handler registration. No change is made to `ALLOWED_METHOD_PREFIXES`, because `chat:` is already allowed.

### 3. Fail-closed provider leases

Add `IProviderProfileLeaseProvider`/lease value types beside the existing shared `ProviderProfile` contract, and add its DI token to `agent-sdk`'s `SDK_TOKENS`. Implement the interface in `auth-providers` as `ProviderProfileLeaseManager`, registered against the SDK token just as existing auth-provider SDK ports are. This preserves the existing auth-providers -> agent-sdk registration direction and prevents agent-sdk from importing the concrete provider library.

`acquire(config, {tabId, workspacePath})` returns a lease with a fixed `ProviderProfile`, provider identity `{providerId, authRoute, credentialFingerprint}`, and idempotent async `release`. Missing credentials, unsupported auth route, failed proxy startup, or incomplete Ptah agent resolution throws a typed acquisition error mapped by RPC to `AUTH_REQUIRED` (or `INVALID_EXECUTION_CONFIG` for malformed identity); it never returns `undefined` and never permits ambient fallback.

The manager has:

- a single-flight `pendingAcquire` keyed by workspace/provider/auth route/agent generation;
- current and retiring generations keyed by a one-way credential fingerprint;
- ref-counted holders indexed by tab ID, real session ID and workspace;
- an idempotent release tombstone so double close is harmless;
- serialized acquire/close/rekey operations so a close that wins a race releases a late acquisition instead of orphaning it;
- credential-change retirement: new acquisition gets a new generation, existing holders finish on the retired generation, and proxy disposal waits for refcount zero.

Extend `ProviderProxyPool` with a private-session owned-lease API whose key includes the credential generation. Keep its existing workspace `acquire`/dispose behavior untouched for global consumers. The new manager owns private proxy lifetime and treats a missing proxy as failure. Keep the manager provider-generic. In `cli-agent-runtime`, add a narrow `PtahCliProfileResolver` that translates a catalogue agent into the fixed-provider acquisition request and calls the generic lease port; this is dependency-safe because `cli-agent-runtime` already imports `auth-providers`, while the reverse edge remains absent. Migrate `PtahCliRegistry`'s current/retiring holder mechanics through that resolver while preserving catalogue discovery; `ChatPtahCliService` no longer starts SDK sessions on the global adapter.

### 4. Private runtime factory and isolation boundary

Add `AdapterRuntimeMode = {kind:'global'} | {kind:'private'; profile; providerIdentity}`. The existing root registration supplies global mode by default, retaining every current constructor side effect. In private mode the same `SdkAgentAdapter` instance skips `events.onConfigChanged`, auth/workspace subscriptions and ambient-auth initialization, uses its fixed profile, and begins initialized. `PrivateSessionRuntimeFactory` creates a child container/runtime handle around that mode-aware adapter. Re-register these per-runtime classes presently wired in `agent-sdk/src/lib/di/register.ts`:

- `SdkRuntimeState` (`:303-307`), `SessionLifecycleManager` and its internal registry/pump/executor/control (`:327-331`);
- `SdkMessageTransformer` (`:159-163`) and `StreamTransformer` (`:333-337`);
- `SdkQueryOptionsBuilder` (`:454-458`), `SessionQueryExecutor`/`SdkQueryRunner` as stateful query collaborators (`:321-325`), and `SdkMessageFactory` (`:427-431`);
- `SessionIdResolvedCallbackRegistry` (`:369-373`), session-end callback registry (`:177-181`), live usage, permission callback state and turn/MCP callback registries;
- slash interceptor (`:484-488`), `SessionForkService` (`:490-494`) and `SdkAgentAdapter` (`:496-500`) itself in private mode.

Share the platform ports, logger, filesystem/workspace/config readers, SDK module loader (`:415-419`), process-spawner implementation (`:315-319`), CLI detector (`:165-169`), immutable feature/config services, metadata store, and singleton `SdkModelService` (`:421-425`). Its cache is safe to share only after Component 7 adds explicit provider identity to every private lookup and identity-scoped invalidation. Do not construct/register `SdkAdapterEvents` (`:309-313`) or a private `SdkConfigWatcher` (`:171-175`).

Consequently the existing `SdkAgentAdapter.reset/dispose` and the reset calls in `auth-rpc.handlers.ts` (`saveSettings`, Copilot login/logout where applicable, Codex login, `clearWorkspaceOverride`) continue to affect only the global adapter. Private runtimes are retired only by close, terminal session end, lease retirement, or host shutdown. This is verified for the config-change subscription and each reset route.

### 5. Interactive session router and UUID rekey

`InteractiveSessionRouter` implements `IAgentAdapter` plus `executeSlashCommand`, `forkSession`, `rewindFiles`, `close`, and resolution lookup. Its maps are by tab ID and real session ID; a workspace index supports shutdown/diagnostics but never selects a runtime by itself.

- Start: validate/default the config. `inherit` delegates unchanged to the global adapter. A private kind durably stages its secret-free config by tab ID, acquires a lease, builds the fixed runtime, and binds the placeholder tab ID before querying. Failed acquisition clears the staged record; a host crash leaves it recoverable.
- UUID resolution: the registry's durable subscribers persist config to the already-created metadata record, add the real-session index, rekey the lease holder, and update broadcaster routing before placeholder-only state is removed. The adapter publishes its external resolved event only after that promise completes. Failure closes the runtime and reports a typed session setup error.
- Resume: load metadata first. Absent legacy config may consume one compatible hint; otherwise metadata is authoritative. Acquire/build if private, then delegate resume.
- Continue: resolve by real ID/tab ID. An inactive route invokes the same resume preparation before the single query funnel. It never re-resolves from global selection.
- End/close: stream completion releases turn resources but keeps an idle interactive runtime resumable; explicit `chat:close`, terminal session deletion/end, and host shutdown release the runtime lease. Refcounting keeps shared generations alive for other tabs.

`ChatSessionService` and `ChatStreamBroadcaster` inject the router token instead of the global adapter. The broadcaster captures and clears tokens through the selected runtime and participates in rekey. `SessionRpcHandlers` and `ChatSlashCommandRouter` use the router. Gateway handlers retain their direct global adapter dependency.

### 6. One query-creation funnel and all call sites

Every interactive query reaches `SessionQueryExecutor -> SdkQueryOptionsBuilder -> SdkQueryRunner`. The router selects the runtime before that funnel. Implementation must update these current production call sites:

| Flow                                | Current call site                                                                              | Planned route                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Start                               | `chat-session.service.ts:539`; global adapter funnel entry `sdk-agent-adapter.ts:679`          | `InteractiveSessionRouter.startChatSession`, then the selected runtime's lifecycle executor               |
| Resume activation                   | `chat-session.service.ts:853-865`, helper call at `:1193`                                      | metadata-authoritative router resume                                                                      |
| Continue auto-resume                | `chat-session.service.ts:667-674`, helper `:1193`                                              | same router resume preparation, then selected send                                                        |
| Active continue send                | `chat-session.service.ts:726-729`                                                              | `InteractiveSessionRouter.sendMessageToSession` resolves the existing binding; it creates no second query |
| Slash commands                      | `chat-slash-command-router.service.ts:104-133`; adapter method `sdk-agent-adapter.ts:960-1000` | router selects runtime, then runtime slash path uses the same builder/runner                              |
| Ptah CLI start/continue             | `chat-ptah-cli.service.ts:153-164,213-259`                                                     | remove global adapter session path; use `kind:'ptah-cli'` runtime                                         |
| Fork                                | `session-rpc.handlers.ts:972`; `session-fork.service.ts:108-135`                               | router source lookup; fork metadata atomically copies config                                              |
| Rewind                              | `session-rpc.handlers.ts:1052-1062`; adapter `sdk-agent-adapter.ts:1016-1049`                  | selected runtime; subsequent auto-resume uses same route                                                  |
| Session duplicate                   | latent `tab-manager.service.ts:2101-2120`                                                      | bound sessions must call backend fork; shallow UI duplication may only duplicate an unbound draft         |
| Selected-runtime query construction | global start/resume currently enter `sdk-agent-adapter.ts:679,791`; slash enters `:960-1000`   | both global and private implementations converge on `SessionQueryExecutor` and the same builder/runner    |

The gateway bridge calls (`gateway-rpc.handlers.ts:711,723,754`) are explicitly excluded and remain global. Frontend branch/rewind invocations (`chat-view.component.ts:987,1050,1130,1150`) retain their RPC surface but consume the returned authoritative config.

### 7. Safe environment and provider-aware model resolution

Extend query input with an internal environment mode and provider identity. With no private marker, preserve the existing global construction and ambient behavior unchanged. For private runtimes, `SdkQueryOptionsBuilder` constructs subprocess env as:

1. the `build-safe-env.ts` platform whitelist;
2. all twelve `ALL_TIER_ENV_KEYS` explicitly set absent/removed;
3. the fixed profile's auth variables and validated tier snapshot;
4. only the existing explicitly required SDK control variables.

It never spreads `process.env`. The profile auth values are in memory only. Tests assert ambient Anthropic/provider credentials and tier metadata are absent while required platform variables survive.

The singleton `SdkModelService` accepts explicit provider identity for private calls. Discovery/cache keys include provider ID, auth route, stable base URL, credential fingerprint and tier snapshot hash; invalidation is scoped to that identity/generation. Global calls retain the current active-auth key. This prevents two providers sharing a base URL from sharing a model cache, avoids a 253 MB CLI model-discovery spawn per private runtime, and retires cached results when credentials change.

### 8. Frontend per-tab state and picker

Add `executionConfig` to `TabState` next to the existing per-tab model. Version tab persistence from 2 to 3 and add an explicit v2-to-v3 migration to `{kind:'inherit'}`; sanitize through the shared Zod schema. Both persistence reader version gates must be updated. Invalid draft-local config becomes inherit; for a bound session, backend resume/list metadata always wins.

Demote `PtahCliStateService` to agent catalogue plus optional new-tab default. It does not determine an existing tab's execution. `MessageSenderService` resolves the target tab through `SESSION_CONTEXT`, uses that tab's model/config, and includes `executionConfig` only in `chat:start`. Continue payload remains unchanged.

Provide `SESSION_CONTEXT` for ordinary chat at the app-shell boundary using the active tab ID; keep the canvas tile override using its tile tab ID. Picker and sender therefore behave correctly for foreground ordinary tabs and background canvas tiles.

Add a dumb, `OnPush` `libs/frontend/chat-ui/src/lib/molecules/chat-input/execution-config-picker.component.ts`, exported from `chat-ui/src/index.ts`; it receives catalogue/options/current selection and emits intent only. Smart orchestration stays in `chat-input.component.ts` and the existing `model-selector.component.ts`, resolving the tab through `SESSION_CONTEXT`. `inherit` is the obvious first entry. On an unbound draft, selection updates the tab. On a session with a real ID, changing provider never mutates the session: the smart layer offers **Start new session** (and may preselect the requested choice there) or cancel. Resume/list projection writes backend `executionConfig` and model onto `TabState`. Session loader and branch/fork results follow this rule.

A frontend lifecycle bridge observes the existing structured close event and sends one deduplicated `chat:close` whenever `close`, `forceClose`, or `reset` detaches a non-null session, even when idle. Reset then leaves/recreates an unbound inherit draft. Abort remains for active generation cancellation. `TabManagerService.duplicateTab` rejects bound sessions; a smart `ChatStore` duplicate command calls backend fork and materializes only the returned new session ID/config. Unbound draft duplication remains local.

### 9. Three-host composition

- VS Code `phase-2-libraries`: after auth-provider registration and SDK registration, register the provider-lease implementation/factory/router. Update `expected-resolvable.ts` and its smoke spec; do not alter the global alias or expected-absent platform rules.
- Electron `phase-2-libraries`: same ordering and manifest updates. Do not connect private runtimes to Electron global reset/config events.
- CLI `container.ts`: register the same lease/factory/router after auth + SDK and before chat services. Add equivalent resolution/lifecycle smoke coverage. Preserve headless JSON-RPC behavior and the global adapter alias.

No adapter-family import is introduced in backend libs; hosts remain composition roots.

---

## Failure behaviour and concurrency invariants

- Explicit private selection plus missing credentials/proxy/model is `AUTH_REQUIRED`/typed failure, never `undefined`, inherit, or ambient fallback.
- Existing-session provider conflict is `EXECUTION_CONFIG_IMMUTABLE`; the recovery is fork/new session.
- A single-flight acquisition creates at most one proxy/runtime generation per key. Double close is a no-op. Close/acquire races cannot leave an unindexed holder.
- Global resets/config changes never reach private runtimes. Host shutdown closes both router-owned private runtimes and the global adapter through separate paths.
- Metadata absence means legacy inherit only when the metadata format predates this feature and no staged tab record exists. A new-format missing value and corrupt explicit metadata fail closed.
- UUID rekey leaves no interval where neither tab nor real-session lookup resolves the runtime.

---

## Verification strategy: twelve proof tests

| #   | Proof                                                                                                                               | Concrete spec home                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Two simultaneous tiles in one workspace retain distinct env/model/routing/tier metadata.                                            | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.private-runtime.spec.ts` plus `libs/frontend/canvas/src/lib/components/canvas-tile/canvas-tile.component.spec.ts`         |
| 2   | Global provider changes midstream leave private unchanged; a new inherit session sees the new default.                              | `libs/backend/agent-sdk/src/lib/runtime/interactive-session-router.spec.ts`                                                                                                            |
| 3   | Config change and saveSettings/Copilot/Codex/clear-workspace reset routes affect global only.                                       | `agent-sdk/.../private-session-runtime-factory.spec.ts` and `rpc-handlers/.../auth-rpc.handlers.private-isolation.spec.ts`                                                             |
| 4   | An unhealthy global adapter does not prevent private success.                                                                       | `interactive-session-router.spec.ts`                                                                                                                                                   |
| 5   | Missing credentials or proxy failure returns `AUTH_REQUIRED` with zero ambient fallback.                                            | `auth-providers/.../provider-profile-lease.spec.ts` and `agent-sdk/.../sdk-query-options-builder.spec.ts`                                                                              |
| 6   | All three hosts restart/resume by ID/workspace; staged pre-UUID private config recovers; genuinely legacy metadata becomes inherit. | VS Code/Electron container smoke specs, CLI container spec, and `session-metadata-store.spec.ts`                                                                                       |
| 7   | Slash/fork/rewind after restart inherit the private config.                                                                         | `rpc-handlers/.../chat-session.private-runtime.spec.ts` and `session-rpc.handlers.private-runtime.spec.ts`                                                                             |
| 8   | Conflicting hints for active and inactive sessions reject consistently or use explicit fork.                                        | `chat-session.private-runtime.spec.ts`                                                                                                                                                 |
| 9   | Proxy races cover single acquire, credential retirement, double close, and close/acquire.                                           | `provider-profile-lease.spec.ts` and `provider-proxy-pool.spec.ts`                                                                                                                     |
| 10  | Idle close releases one holder while a shared lease remains for another.                                                            | `interactive-session-router.spec.ts` plus frontend close bridge spec                                                                                                                   |
| 11  | Private env excludes ambient credential/tier values and retains platform whitelist values.                                          | `sdk-query-options-builder.spec.ts`                                                                                                                                                    |
| 12  | Frontend restores distinct tab choices/models; backend metadata wins empty/stale storage; a background tile uses its own selection. | `chat-state/.../tab-manager.persistence.spec.ts`, `chat/.../message-sender.service.spec.ts`, `chat/.../session-loader.service.spec.ts`, and `canvas/.../canvas-tile.component.spec.ts` |

Regression floor: run existing agent-sdk, auth-provider, RPC chat, chat-state/chat-ui/canvas tests and each host container smoke suite with no private selection. A clean install whose tabs all use `{kind:'inherit'}` must produce the same global provider resolution, env, model, reset behavior, stream routing and RPC results as before.

---

## Risks and mitigations

| Risk                                                               | Severity | Mitigation                                                                                                    |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------- |
| Private state accidentally observes singleton reset/config events. | High     | Child runtime allowlist; absence assertions for `SdkAdapterEvents`/watcher; route-specific reset tests.       |
| UUID callback persistence/rekey races the first stream event.      | High     | Add-real-before-remove-placeholder invariant and awaited/tracked callback completion; failure closes runtime. |
| Proxy acquire/close race leaks a process.                          | High     | Single-flight plus serialized holder mutations and late-acquire tombstone test.                               |
| Existing Ptah CLI path still touches the global adapter.           | High     | Remove `ChatPtahCliService` SDK start/continue branch and grep/test all query call sites.                     |
| Storage upgrade loses existing tabs.                               | Medium   | Explicit v2 migration and backend-authoritative bound-session projection.                                     |
| Model cache leaks results across identities.                       | High     | Identity-rich cache key and same-base-URL/different-provider test.                                            |
| Runtime extraction creates a second monolith.                      | Medium   | Keep public factory/router small; focused runtime assembly/lease ports; use the existing query funnel.        |

---

## Open questions requiring product confirmation

These do not block the architecture, but implementation should confirm them before UI copy freezes:

1. Whether a new tab should remember the last private selection. The safe default in this plan is inherit; `PtahCliStateService` may supply a user-chosen draft default only after an explicit preference is added.
2. Whether `providerBaseUrl` should be shown in session details. It is safe metadata but should remain hidden unless it helps users distinguish endpoints.
3. Whether closing the final view of a persisted session should release immediately or after a short warm timeout. This plan uses immediate release; reopening reacquires from metadata.

## Explicitly out of scope

- Per-workspace credential storage or selection.
- OAuth token scoping/partition changes.
- Migrating the gateway bridge to private runtimes (separate task).
- Making a private provider or Ptah CLI agent the default execution path.
- A worker/`utilityProcess` implementation before the measurable triggers above are met.
- Changes to concrete platform adapter families or the global/default provider behavior.

---

## Acceptance summary

The implementation is complete only when provider choice is immutable per session, persisted without secrets at real UUID resolution, restored authoritatively across all hosts, routed through one isolated runtime/query funnel, explicitly released on tab close, and proven concurrent and reset-independent—while every inherit-only install follows the unchanged singleton path.
