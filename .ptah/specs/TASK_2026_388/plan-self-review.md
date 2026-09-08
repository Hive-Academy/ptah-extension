# Plan Self-Review - TASK_2026_388

## Verdict

**PASSED AFTER TWO CORRECTION PASSES.** The plan is implementable and covers the binding findings from TASK_2026_304. My first pass found seven concrete gaps. A late review emitted by the originally invoked architect (`plan-review-claude.md`) found six more; I verified those against the code and folded all thirteen into `implementation-plan.md` and `batches.md`. None is intentionally deferred.

## Review method

I reopened every production file cited by the plan, re-ran targeted `rg` searches for query creation, reset routes, persistence version gates, tab close, composition registration and the three host smoke manifests, and compared the result to the twelve proof tests in TASK_2026_304 section 4. Line numbers below are from the workspace on 2026-09-07, not copied from the older task documents.

## Findings and corrections

### 1. BLOCKING - UUID durability could not be achieved by the existing synchronous registry

**Evidence:** `SessionIdResolvedCallbackRegistry` explicitly requires synchronous subscribers (`libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts:24-33`) and inherits a `void` `notifyAll` (`callback-registry.base.ts:51`). The two adapter emit sites are `sdk-agent-adapter.ts:821` and `:918`; the new-session callback itself is currently invoked without awaiting its promise (`sdk-agent-adapter.ts:876-923`). A vague “awaited/tracked callback” would leave a restart race between UUID exposure and durable metadata/rekey.

**Correction applied:** the plan now requires a backwards-compatible durable lane on the same registry (`registerDurable`/`notifyDurable`), keeps existing synchronous fan-out unchanged, widens `StreamTransformer`'s resolution callback to `void | Promise<void>`, and awaits the durable lane at both adapter resolution sites. The ordered transaction is metadata create/touch -> execution-config write -> add real-ID mapping/lease rekey -> emit external resolution -> remove placeholder-only mapping. A durable failure tears down the private route and does not publish a usable private session.

### 2. HIGH - persistence file names in the draft were stale

**Evidence:** the production helper is `libs/frontend/chat-state/src/lib/tab-persistence.ts`, not `tab-persistence.service.ts`. The hard version rejection is in `tab-manager.service.ts:2306`; the serializer version and sanitizer are `tab-persistence.ts:54-60,152-174`.

**Correction applied:** all plan/test/batch references use `tab-persistence.ts`, `tab-manager.service.ts`, `tab-manager.persistence.spec.ts`, and `tab-manager.lifecycle.spec.ts`. The migration owns both the writer version and reader gate.

### 3. HIGH - Ptah CLI lease ownership needed an explicit dependency-safe bridge

**Evidence:** `PtahCliRegistry` is in `libs/backend/cli-agent-runtime`, not `auth-providers`, and it already imports `@ptah-extension/auth-providers` (`ptah-cli-registry.ts:54`). `auth-providers` does not import `cli-agent-runtime`, so moving Ptah-specific knowledge into the lease manager would invert the dependency.

**Correction applied:** `ProviderProfileLeaseManager` stays provider-generic in `auth-providers`. `cli-agent-runtime` adds a narrow `PtahCliProfileResolver` that resolves the catalogue agent into the shared fixed-provider request, then calls the generic lease port. The SDK/router sees only the port; no auth-provider -> CLI-runtime edge is added.

### 4. HIGH - close semantics covered only normal close, not reset/force close

**Evidence:** `ClosedTabEvent.kind` includes `close | forceClose | reset` (`tab-manager.service.ts:51-72`) and all paths carry the prior session identity. A `/clear` reset can otherwise orphan the old private runtime while reusing the tab ID.

**Correction applied:** the frontend lifecycle bridge sends `chat:close` for every close event that detaches a non-null session (`close`, `forceClose`, or `reset`), deduplicated by tab/session. Reset may then reuse the tab as an unbound inherit draft. Stream-router cleanup remains separate.

### 5. MEDIUM - composer ownership was insufficiently concrete

**Evidence:** the current stateful selector lives in `libs/frontend/chat/src/lib/components/molecules/chat-input/model-selector.component.ts`; `chat-ui` contains only presentational atoms/molecules and exports them from `src/index.ts`. The task explicitly requires the picker surface in `chat-ui`.

**Correction applied:** the plan names a new dumb `execution-config-picker.component.ts` in `chat-ui` with input/output only. `chat-input.component.ts`/the existing model-selector orchestration bind it to the session-context tab. The immutable-session “Start new session” decision stays in smart `chat`, preserving the repository split.

### 6. MEDIUM - session duplicate was described but lacked an enforceable owner

**Evidence:** `TabManagerService.duplicateTab` (`tab-manager.service.ts:2101-2120`) shallow-copies state, and no production caller currently exists. Leaving that method public would allow a future second live binding to bypass the runtime lease.

**Correction applied:** the plan makes `duplicateTab` reject a bound session and introduces/uses a `ChatStore` duplicate command that calls `session:forkSession`; only the returned new session ID/config is materialized locally. Unbound drafts may still use the pure local copy helper. A regression test pins both cases.

### 7. MEDIUM - fork/resume conflict and inactive source behavior needed exact precedence

**Evidence:** fork currently enters at `session-rpc.handlers.ts:972` and creates metadata in `session-fork.service.ts:108-135`; an inactive private source has no router runtime from which to copy configuration. Resume has a legacy `ptahCliId` field at `rpc-chat.types.ts:222-223`.

**Correction applied:** fork always reads source metadata first, independent of runtime activity, copies execution config in the metadata operation, then chooses/reacquires the corresponding runtime. Resume precedence is valid stored config > absent-field legacy hint > inherit. Any hint conflicting with valid stored config is `EXECUTION_CONFIG_IMMUTABLE`; malformed stored config is a typed failure.

## Binding checks with no finding

- `chat:continue` still has no provider/config field (`rpc-chat.types.ts:115-145`).
- No `ALLOWED_METHOD_PREFIXES` change is required because `'chat:'` is already present (`vscode-core/.../rpc-handler.ts:44-47`).
- All production interactive query call sites are enumerated; gateway calls at `gateway-rpc.handlers.ts:711,723,754` are deliberately excluded as a separate-task gap.
- All four global reset call sites in `auth-rpc.handlers.ts` (`:791,:909,:1190,:1307`) and the singleton config subscription (`sdk-agent-adapter.ts:210-220`) remain global-only.
- Both tab persistence version gates are assigned to one batch.
- All three hosts have explicit registration and smoke-manifest work.
- Each of TASK_2026_304's twelve proof tests maps to a concrete spec and batch, including the no-private-session regression floor.

## Residual risks accepted by the plan

- The durable UUID callback change touches a hot stream path. The plan contains ordering and failure tests and keeps the existing synchronous registry API intact.
- `ProviderProxyPool` gains a second, owned lifetime API. Legacy global workspace ownership stays untouched and receives regression coverage.
- The frontend picker adds a new public `chat-ui` export, but no secondary entry point or dynamic-dependency exception is needed.

## Second-pass architect findings adopted after verification

### 8. HIGH - pre-UUID crash window

The original UUID-time write still allowed a host crash after SDK UUID emission but before config adoption. The final plan now stages the secret-free config durably by tab ID before the private process starts, versions new metadata, and atomically adopts the staged record on UUID resolution. Only genuinely pre-feature metadata with no stage defaults to inherit; new-format missing config fails closed.

### 9. HIGH - published RPC backward compatibility

Making `chat:start.executionConfig` required would break existing headless/TUI/external callers. The final contract makes it optional and Zod-defaults omission to inherit. Updated first-party UI sends it explicitly; continue remains immutable.

### 10. HIGH - batch verification arrived too late

The initial eight-batch cut put all specs last and made the SDK batch too broad. The final eleven-batch cut gives each component its own unit specs before commit and reserves the final tester batch for cross-library proofs/regression only.

### 11. MEDIUM - model service isolation was wasteful

`SdkModelService` performs expensive CLI discovery. It now remains shared; explicit provider identity and identity-scoped invalidation make its cache safe without paying a fresh discovery spawn per private runtime.

### 12. MEDIUM - duplicate adapter implementation risk

The final plan does not create another adapter class. It introduces `AdapterRuntimeMode` and constructs the same `SdkAgentAdapter` in private mode with fixed profile, initialized state and no global subscriptions. The root/default mode retains existing behavior.

### 13. LOW - ownership clarity

The agent-sdk barrel belongs solely to the runtime-registration batch. `SESSION_CONTEXT` belongs solely to the frontend integration batch, and the state batch explicitly leaves it untouched. The final ownership scan reports zero duplicate paths.

No known architectural gap remains only as a note in either review.
