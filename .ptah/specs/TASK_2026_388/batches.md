# Batches - TASK_2026_388

Total tasks: 11 | Batches: 11 | Complete: 0/11

## Plan validation

Status: **PASSED AFTER TWO REVIEW PASSES**

The batches are dependency-ordered and file-disjoint. Each code batch owns the focused unit specs that prove it before commit; Batch 11 is cross-library integration and the inherit-only regression floor. The late architect review's six findings are incorporated: pre-query durable staging, optional/defaulted start config, smaller SDK batches, shared model service, one mode-aware adapter class, and explicit barrel/token ownership.

### Hard construction rules

- `TOKENS.AGENT_ADAPTER` remains the singleton `SdkAgentAdapter`; no batch replaces or mutates that alias.
- The same adapter class is instantiated with global or private runtime mode; there is no second adapter implementation.
- `inherit` delegates through the singleton and preserves current profile resolution, env/model behavior, resets and gateway routing.
- No batch edits `gateway-rpc.handlers.ts`, `auth-rpc.handlers.ts`, `ALLOWED_METHOD_PREFIXES`, or a concrete platform adapter.
- No secret, token, proxy port, CLI credential path, resolved auth env or raw fingerprint is persisted or returned.
- A file has exactly one owner below. Newly discovered required files must be assigned by the team leader before edit.

## Dependency order

| Batch | Depends on | Purpose                                        | Executor           |
| ----- | ---------- | ---------------------------------------------- | ------------------ |
| 1     | -          | Shared contract/RPC types                      | backend-developer  |
| 2     | 1          | Versioned metadata and pre-query staging       | backend-developer  |
| 3     | 1          | Fail-closed provider/CLI leases                | backend-developer  |
| 4     | 2          | Durable UUID callback + adapter mode seam      | backend-developer  |
| 5     | 1, 3       | Safe env and shared identity-keyed model cache | backend-developer  |
| 6     | 2-5        | Private runtime factory/router/query funnel    | backend-developer  |
| 7     | 1, 6       | RPC integration and explicit close             | backend-developer  |
| 8     | 1          | Per-tab state/persistence                      | frontend-developer |
| 9     | 7, 8       | Picker, session projection and close UX        | frontend-developer |
| 10    | 3, 6, 7    | Three composition roots                        | backend-developer  |
| 11    | 1-10       | Cross-lib twelve proofs/regression floor       | senior-tester      |

---

## Batch 1 - Shared execution and RPC contract

**Lib:** `shared`

**Files owned**

- New `libs/shared/src/lib/types/session-execution-config.types.ts`
- New `libs/shared/src/lib/types/session-execution-config.types.spec.ts`
- `libs/shared/src/lib/types/provider-profile.types.ts`
- `libs/shared/src/lib/types/provider-profile.types.spec.ts`
- `libs/shared/src/lib/types/agent-adapter.types.ts`
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `libs/shared/src/lib/types/rpc.types.ts`
- `libs/shared/src/lib/types/execution/node.ts`
- `libs/shared/src/lib/types/execution/schemas.ts`
- `libs/shared/src/lib/types/execution/index.ts`
- `libs/shared/src/index.ts`

**Exact changes**

1. Add/export the strict `inherit | private-provider | ptah-cli` Zod union and the exact twelve required-nullable tier keys. Fixed fields are provider ID, auth route, model, stable provider base URL and tier snapshot; Ptah adds agent ID.
2. Structurally reject secrets and extra fields. Use `export type` for type-only exports.
3. Add optional `executionConfig` on start with schema-level/default semantic inherit, resume-only `executionConfigHint`, authoritative config on resume/session summaries, and `chat:close` request/result/map entries. Continue receives no config/provider field.
4. Extend adapter input types without changing existing global call signatures.

**Done when:** `session-execution-config.types.spec.ts` and `provider-profile.types.spec.ts` prove all variants/exact fields, lease contract shape, strict rejection and secret-free serialization; shared typecheck proves optional start compatibility and no continue mutation.

**Global/default untouched:** omitted start config is inherit. No runtime/provider code changes.

---

## Batch 2 - Versioned metadata, pending journal and fork copy

**Lib:** `agent-sdk`

**Files owned**

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
- `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.spec.ts`

**Exact changes**

1. Version metadata created after this feature and add `executionConfig`.
2. Add durable `stageExecutionConfig(tabId, config)` before a private query, atomic `adoptStagedExecutionConfig(tabId, realId)` on UUID resolve, cleanup on pre-start failure, and recovery lookup after restart.
3. Interpret absent config as inherit only for pre-feature metadata with no pending record. New-format missing -> `SESSION_EXECUTION_CONFIG_MISSING`; present invalid -> `SESSION_EXECUTION_CONFIG_INVALID`.
4. Fork reads source metadata whether active or inactive and copies config into target metadata atomically. Duplicate helpers preserve it.

**Done when:** `session-metadata-store.spec.ts` proves crash-before-UUID recovery, atomic adoption, real legacy inherit, new-format missing failure, corrupt-present failure and no secrets; `session-fork.service.spec.ts` proves inactive/private copy.

**Global/default untouched:** old metadata remains inherit; global metadata creation semantics otherwise remain unchanged.

---

## Batch 3 - Provider profile leases and Ptah CLI resolver

**Libs:** `auth-providers`, `cli-agent-runtime`

**Files owned**

- New `libs/backend/auth-providers/src/lib/auth/provider-profile-lease.ts`
- New `libs/backend/auth-providers/src/lib/auth/provider-profile-lease-manager.ts`
- New `libs/backend/auth-providers/src/lib/auth/provider-profile-lease.errors.ts`
- New `libs/backend/auth-providers/src/lib/auth/provider-profile-lease.spec.ts`
- `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.ts`
- `libs/backend/auth-providers/src/lib/auth/provider-proxy-pool.spec.ts`
- `libs/backend/auth-providers/src/lib/auth/index.ts`
- `libs/backend/auth-providers/src/lib/di/tokens.ts`
- `libs/backend/auth-providers/src/lib/di/register.ts`
- `libs/backend/auth-providers/src/index.ts`
- New `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-profile-resolver.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.proxy-lease.spec.ts`
- `libs/backend/cli-agent-runtime/src/lib/ptah-cli/index.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/tokens.ts`
- `libs/backend/cli-agent-runtime/src/lib/di/register.ts`
- `libs/backend/cli-agent-runtime/src/index.ts`

**Exact changes**

1. Implement typed fail-closed acquire, fixed profile/identity, single-flight, current/retiring credential generations, refcount, idempotent release and serialized acquire/close/rekey.
2. Index holders by tab ID, real session ID and workspace. A close tombstone releases a late acquisition.
3. Add owned private-session proxy leases keyed by provider/auth route/credential generation; proxy failure is typed. Preserve legacy workspace pool methods.
4. Translate Ptah catalogue entries through a narrow CLI-runtime resolver into the provider-generic lease API. No reverse auth-provider -> CLI dependency.

**Done when:** the three owned specs prove proof tests 5, 9 and 10: `AUTH_REQUIRED` with no fallback, one acquire under races, fingerprint retirement, double close, close/acquire cleanup and one surviving shared holder.

**Global/default untouched:** legacy pool/catalogue/default selection and global auth are regression-tested and unchanged.

---

## Batch 4 - Durable UUID lane and one adapter-class isolation seam

**Lib:** `agent-sdk`

**Files owned**

- New `libs/backend/agent-sdk/src/lib/runtime/adapter-runtime-mode.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- New `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.private-mode.spec.ts`

**Exact changes**

1. Add global/private adapter runtime mode. Default/root global mode executes the current constructor subscriptions and initialization unchanged. Private mode uses a fixed profile, begins initialized, and skips config/auth/workspace event subscriptions and ambient initialization.
2. Add a durable async subscriber lane to the session-ID registry while preserving synchronous `notifyAll` exactly for existing trigger consumers.
3. Widen/await stream resolution callbacks. At both adapter UUID emit sites: metadata create/touch -> durable subscribers -> external resolved event. Rejection prevents publishing a usable private route.
4. Do not implement another `IAgentAdapter` class.

**Done when:** registry/stream specs prove sync compatibility plus awaited failure/order; private-mode spec proves the same adapter class bypasses the global initialization latch, has zero global subscriptions, while default mode registers every existing subscription.

**Global/default untouched:** default runtime mode is global and pins current initialization/reset/config behavior. The alias is not edited in this batch.

---

## Batch 5 - Safe private env and shared provider-aware model cache

**Lib:** `agent-sdk`

**Files owned**

- `libs/backend/agent-sdk/src/lib/helpers/build-safe-env.ts`
- `libs/backend/agent-sdk/src/lib/helpers/build-safe-env.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-model-service.spec.ts`

**Exact changes**

1. Add internal ambient/private query environment mode and explicit provider identity.
2. Private env is whitelist -> explicit absence for all twelve tier keys -> fixed auth/tier values -> required SDK controls. It never spreads `process.env`.
3. Leave the ambient/global builder branch unchanged.
4. Keep `SdkModelService` singleton. Private lookup/cache keys and invalidation include provider ID, auth route, stable base URL, fingerprint and tier hash; global active-auth key stays current.

**Done when:** builder tests prove proof 11 and missing private auth cannot read ambient credentials; model tests prove same-URL distinct identities do not share cache and credential rotation retires only its identity. Existing global env/model specs remain green.

**Global/default untouched:** ambient env construction and global active-auth cache key are pinned by existing/regression assertions.

---

## Batch 6 - Private runtime factory, router and query funnel

**Lib:** `agent-sdk`

**Files owned**

- New `libs/backend/agent-sdk/src/lib/runtime/private-session-runtime.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/private-session-runtime-factory.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/private-session-runtime-factory.spec.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/interactive-session-router.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/interactive-session-router.types.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/interactive-session-router.spec.ts`
- New `libs/backend/agent-sdk/src/lib/runtime/index.ts`
- `libs/backend/agent-sdk/src/lib/di/tokens.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/index.ts`
- `libs/backend/agent-sdk/src/index.ts`

**Exact changes**

1. Register a private child subgraph: runtime/lifecycle registries, message/stream state, query builder/runner/executor, callback/turn state, slash/fork and the same `SdkAgentAdapter` in private mode.
2. Share platform ports, logger, config/filesystem/workspace readers, metadata, module loader, process spawner, CLI detector and singleton identity-keyed model service. Do not resolve private `SdkAdapterEvents`/`SdkConfigWatcher`.
3. Router implements `IAgentAdapter` plus slash/fork/rewind/close/rekey. Bind by tab and real ID; workspace is diagnostics/shutdown only.
4. Start: default/validate; inherit delegates singleton; private stages metadata, acquires lease, constructs child, then queries. Resume loads authoritative metadata/pending recovery. Continue routes existing binding or same resume preparation; no provider re-resolution.
5. UUID durable callback adopts staged config, adds real-ID mapping, rekeys lease/broadcaster, then removes placeholder. Close/host shutdown release idempotently.
6. All selected instances converge on `SessionQueryExecutor -> SdkQueryOptionsBuilder -> SdkQueryRunner` for start/resume/slash; active continue only feeds the existing query.

**Done when:** factory/router specs prove proofs 1, 2, 4, 6-10 at unit scope: concurrent identity, global flip isolation, unhealthy-global private success, restart/rekey, slash/fork/rewind selection, conflict handling, and close/refcount behavior.

**Global/default untouched:** router inherit delegates `TOKENS.AGENT_ADAPTER`; `register.ts` retains the existing alias and singleton registrations.

---

## Batch 7 - RPC routing, immutable resume and explicit close

**Lib:** `rpc-handlers`

**Files owned**

- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- New `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.private-runtime.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/di.ts`
- `libs/backend/rpc-handlers/src/lib/chat/di.spec.ts`
- `libs/backend/rpc-handlers/src/index.ts`

**Exact changes**

1. Zod-default omitted start config to inherit; parse resume-only legacy hint and close. Continue accepts no execution config.
2. Route start (`chat-session.service.ts:539`), resume activation (`:853-865/:1193`), inactive continue (`:667-674/:1193`), active send (`:726-729`), slash (`chat-slash-command-router.service.ts:117`), fork (`session-rpc.handlers.ts:972`) and rewind (`:1052-1062`) through the router.
3. Remove Ptah CLI direct global start/continue. Return authoritative config from resume/list/fork.
4. Precedence: valid stored config > staged/absent-field legacy hint > legacy inherit. Conflict -> `EXECUTION_CONFIG_IMMUTABLE`; invalid/missing new metadata -> typed failure.
5. Broadcaster captures/ends tokens on the selected adapter and rekeys. `chat:close` releases idle routes. Map lease failures to `AUTH_REQUIRED`.

**Done when:** owned specs prove optional-start compatibility, no mutable continue, all interactive call sites, proofs 1, 3, 6-8 and 10, plus distinct proxy/profile routing. A source assertion confirms gateway remains the only listed out-of-funnel exception.

**Global/default untouched:** `auth-rpc.handlers.ts`, its four reset calls, gateway and allowlist are not edited. Inherit still performs current workspace profile resolution before singleton delegation.

---

## Batch 8 - Per-tab frontend state and persistence migration

**Libs:** `chat-types`, `chat-state`

**Files owned**

- `libs/frontend/chat-types/src/lib/chat-types.ts`
- `libs/frontend/chat-types/src/index.ts`
- `libs/frontend/chat-state/src/lib/tab-persistence.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.persistence.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.lifecycle.spec.ts`
- `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
- `libs/frontend/chat-state/src/index.ts`

**Exact changes**

1. Add per-tab immutable config beside model; drafts default inherit.
2. Bump v2 -> v3 and update both writer and `tab-manager.service.ts:2306` reader gate. Migrate v2 to inherit; sanitize with shared Zod.
3. Bound-session local state is provisional until backend projection. Add typed projection mutators.
4. Reject direct duplicate of a bound session; allow unbound draft copy. Preserve the structured close event and prior session ID.

**Done when:** owned specs prove v2 migration, v3 sanitization, distinct restored selections/models, backend-projection-ready state, all close kinds, and bound-duplicate rejection.

**Global/default untouched:** migrated/new tabs are inherit. `SESSION_CONTEXT` is explicitly not owned here and is changed only in Batch 9.

---

## Batch 9 - OnPush picker, authoritative projection and close bridge

**Libs:** `chat-ui`, `chat`, `canvas`, `core`

**Files owned**

- New `libs/frontend/chat-ui/src/lib/molecules/chat-input/execution-config-picker.component.ts`
- New `libs/frontend/chat-ui/src/lib/molecules/chat-input/execution-config-picker.component.spec.ts`
- `libs/frontend/chat-ui/src/index.ts`
- `libs/frontend/chat/src/lib/tokens/session-context.token.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.ts`
- `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat.store.ts`
- New `libs/frontend/chat/src/lib/services/session-runtime-close.service.ts`
- New `libs/frontend/chat/src/lib/services/session-runtime-close.service.spec.ts`
- `libs/frontend/chat/src/index.ts`
- `libs/frontend/canvas/src/lib/canvas-tile.component.ts`
- `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`
- `libs/frontend/core/src/lib/services/ptah-cli-state.service.ts`

**Exact changes**

1. Add dumb OnPush picker in `chat-ui`, inherit first; inputs/outputs only. Smart chat input/model layer resolves `SESSION_CONTEXT`.
2. Provide ordinary context at app shell and retain canvas tile override. Background sends use the tile's own config/model.
3. Unbound selection updates tab; bound selection offers **Start new session**/cancel. Smart duplicate/fork materializes backend-returned ID/config.
4. Sender includes config only on start. Ptah state becomes catalogue/explicit draft default, never an existing session source.
5. Resume/list/fork project backend config/model over stale or empty local storage.
6. Close bridge deduplicates `chat:close` for close/forceClose/reset that detaches a session, including idle tabs. Stream-router cleanup remains separate.

**Done when:** owned specs prove frontend portions of proofs 10 and 12, start-only config, ordinary/canvas context, immutable-session picker, metadata-wins projection and smart duplicate.

**Global/default untouched:** inherit remains obvious/default and current global model behavior is retained.

---

## Batch 10 - VS Code, Electron and CLI composition

**Hosts:** all three product roots

**Files owned**

- `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts`
- `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`
- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
- `apps/ptah-electron/src/di/phase-2-libraries.ts`
- `apps/ptah-electron/src/di/expected-resolvable.ts`
- `apps/ptah-electron/src/di/container.smoke.spec.ts`
- `libs/backend/cli-engine/src/lib/container.ts`
- `apps/ptah-cli/src/di/expected-resolvable.ts`
- `apps/ptah-cli/src/di/container.smoke.spec.ts`

**Exact changes**

1. Keep auth before SDK; after both, register interactive runtime factory/router before chat handlers. CLI-runtime supplies Ptah resolver.
2. Add lease/factory/router to expected-resolvable manifests, not expected-absent.
3. Dispose router-owned runtimes on host shutdown separately from singleton disposal.
4. Smoke each host with inherit and private resolution, then reconstruct container and resume staged/real metadata.

**Done when:** all three smoke specs prove proof 6 and clean disposal/resolution. The inherit smoke resolves the same `TOKENS.AGENT_ADAPTER` as before.

**Global/default untouched:** registration order/alias/platform boundaries remain; only additive interactive registrations and shutdown ownership are introduced.

---

## Batch 11 - Cross-library proof matrix and regression floor

**Executor:** senior-tester

**Files owned**

- New `libs/backend/rpc-handlers/src/lib/chat/session/private-session-proof-matrix.spec.ts`
- New `libs/frontend/chat/src/lib/services/private-session-frontend-integration.spec.ts`
- New `.ptah/specs/TASK_2026_388/test-report.md`

**Exact changes**

Run and record the twelve binding proofs:

1. Same-workspace concurrent tiles have distinct env/model/route/tier and, where proxy-backed, distinct provider endpoints.
2. Global flip leaves private midstream unchanged; next inherit sees the new default.
3. Config change, saveSettings, applicable Copilot login/logout, Codex login and clear-workspace affect global only.
4. Unhealthy global does not block private.
5. Missing credentials/proxy returns `AUTH_REQUIRED`, zero ambient fallback.
6. All hosts restart/resume; staged pre-UUID private recovers; genuine legacy becomes inherit.
7. Slash/fork/rewind after restart retain config.
8. Active/inactive conflicts reject; explicit fork/new session succeeds.
9. Single-flight, retirement, double close and close/acquire leave no orphan.
10. Idle close releases one holder while another remains.
11. Ambient credentials/tier absent; platform whitelist remains.
12. Frontend distinct choices/models restore; backend wins stale/empty storage; background tile uses its selection.

Run all affected Nx targets and three host smoke suites with every session inherit/omitted config. Record commands/results in `test-report.md`. Add a production-source query-callsite inventory and verify the only explicit exception is the separately scoped gateway.

**Done when:** all twelve proofs and affected existing suites pass, and `test-report.md` demonstrates no-private-install equivalence.

**Global/default untouched:** this batch changes integration specs/report only; the regression floor fails on any singleton/env/model/reset/gateway drift.

---

## Completion gate

Each batch is testable before commit. Implementation completes only after Batch 11 records all twelve proofs and the inherit-only regression floor; a private happy path alone is not acceptance.
