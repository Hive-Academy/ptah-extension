# Implementation Plan - TASK_2026_418_a91c

## Inputs and constraints

- Binding intent: .ptah/specs/TASK_2026_418_a91c/context.md, “Re-scope (2026-09-23, with TASK_2026_533_b7e1).”
- Base contract: APPROVED .ptah/specs/TASK_2026_533_b7e1/implementation-plan.md and context.md. Another developer is implementing 533 in this worktree. This plan targets the approved result, not unfinished source seen during inspection.
- Prior 418 implementation-plan.md and research-report.md were read as historical evidence; their delta-ledger and scope-migration recommendations are superseded below.
- CORRECTED (2026-09-23): the earlier "SDK 0.3.278 resets on resume" claim was wrong. Resume restoration is conditional: Claude sessions restore from the transcript `cost-state` entry, proxy sessions sometimes reset. 533 Batch A detects it per run (see `TASK_2026_533_b7e1/context.md`, "Resume combination"). This plan does not own that rule.
- Root/library instruction-file inventory from this worktree found no AGENTS.md/CLAUDE.md in the inspected affected paths. No design handoff is needed for these correctness changes.
- Only this plan is overwritten. No source/spec changes, SDK execution, live provider calls, suite execution, or history-changing git commands were performed.
- All relative references below resolve under D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement. Line references describe inspected definitions; 533 may move them. Apply changes by named symbol after its commits land.

## Decision summary

- **No confirmed Codex-specific under-count blocker for 533:** the proxy emits per-request usage, but the SDK result's modelUsage is cumulative and is the field 533 consumes. Do not make the proxy cumulative or make the owner add result.usage. Pin that boundary with regression fixtures.
- Keep provider-aware context capacity: only evidence for the effective provider and exact model can supply the denominator. An SDK generic proxy fallback, static catalog default, or another provider's discovery is unknown.
- Keep compaction measurement provenance: only a valid pair from one compact-boundary payload can support “shrank”; mixed tracker/history/boundary samples remain neutral.
- Defer main-only cumulative accounting. 533's lifetime execution-tree snapshot already makes cost, tokens and agent count consistent; the independent context badge is explicitly the main latest-request context.
- Preserve 533's fixed prefix + latest cumulative value per SessionRecord.token, usageCostSource flag, SessionStatsEntry snapshot and frontend assignment. No delta ledger, frontend addition or accounting checkpoint.
- Extend shared types additively for context evidence and compaction measurement only. No new totals DTO or pricing algorithm.
- TASK_2026_414 is **done**, not a future prerequisite. Preserve its boundary-ready reload, per-session timers, post-context seed and marker behavior except the tighter provenance condition.
- Deliver after 533 commits on fix/task-418-codex-session-statistics in this same worktree; stacked PR targets fix/session-stats-disagreement until 533 merges. Implementation is a codex lane (it wrote this plan), reviewed by a Claude code-logic-reviewer subagent.

## Superseded

| Removed from the old 418 plan | Why / current owner |
| --- | --- |
| ResultUsageLedger, per-result subtraction, statsEventId/fingerprint ring, query-process delta protocol | 533 owns latest cumulative run replacement using the existing SessionRecord.token. No alternative ledger or IDs. |
| Frontend delta accumulation and event dedupe in tab/surface totals | 533 installs complete SessionStatsEntry snapshots; replacement is idempotent. |
| Reload accounting dedupe and a new deduplicate-assistant-usage helper | 533 reuses aggregateSessionUsage and its history ledger. Do not change its dedupe policy or reintroduce first-record-wins from the old plan. |
| mainSession/executionTree duplicated totals DTO and compatibility aliases | One lifetime execution-tree snapshot already solves the panel mismatch. Main-only breakdown has no remaining acceptance requirement. |
| Model-only capacity fallback and unconditional preference for SDK proxy contextWindow | The proxy SDK can report a generic window. Provider/model evidence outranks an unverified fallback. |
| Adding CLAUDE_CODE_MAX_CONTEXT_TOKENS for guessed proxy capacity | Current sdk-query-options-builder.ts:999 deliberately has no such synthesized override; preserve it. |
| Old worktree/base/CLI delegation instructions | Latest context selects the 533 worktree/commits, codex implementer (user request, replacing opencode) and a Claude different-family reviewer. |

## Codex-proxy normalization finding

**Verdict: per-request translation is confirmed; an under-count at the 533 owner is NOT established. No additional production token accumulator is required for this path.** Per-request Anthropic-compatible HTTP messages are inputs to the Claude SDK query, not the final cumulative result consumed by SessionStatsOwnerService.

Verified path:

1. libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts:130 selects Responses for Codex. Model mapping at :93 resolves SDK tier/Claude aliases to actual upstream IDs.
2. libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:984 creates a new ResponsesStreamTranslator for each HTTP response. There is no session/run accumulator in the proxy.
3. responses-stream-translator.ts:458 takes response.completed usage, translates it at :464 and emits final Anthropic message_delta.usage at :514–517. Duplicate terminal events are ignored (:459/:488).
4. translation-proxy-helpers.ts:25–38 maps inclusive Responses input to uncached input plus cache read: input - min(input, cached); output is already inclusive of reasoning. No cache-creation measurement exists in this Responses shape; do not invent one or reclassify cache reads as writes. The SDK/result four-class contract represents absent creation as zero for this translated request.
5. Existing responses-stream-translator.spec.ts:126–144 verifies cached input and duplicate completion; :147 explicitly verifies usage remains scoped to each tool turn. Collect/non-stream paths share translateResponsesUsage at responses-stream-collector.ts:190 and translation-proxy-base.ts:1062.
6. The installed pinned SDK distinguishes the result fields explicitly: D:\projects\ptah-extension\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts:5370 says result.usage is main-loop only and per-turn; :5374/:5376 defines cumulative query-pipeline modelUsage, including subagents/sidechains/compaction. The success result repeats this at :5456/:5460/:5462. Its ModelUsage includes cacheCreationInputTokens at :1368. Repo stream-transformer.ts:91/:99 also documents cumulative model fields.
7. Approved 533 “Backend producer,” item 6, consumes cumulative modelUsage, not sdkMessage.usage. The former is replaced per run; the latter stays in existing footer/current-request paths. Cost authority remains 533's reported/unreported decision, with own-model-ID rate-card pricing for unreported cost.

**Concrete under-count counterexample to guard against:** request A emits input=30, cacheRead=12, output=9; request B emits input=20, cacheRead=30, output=7. Installing raw B into the owner would give 57 tokens instead of cumulative 108 (input50 + cacheRead42 + output16). SDK result.modelUsage must give A's 51 then A+B's 108. 533 must replace 51 with108, never add them to159. A fixed history prefix of1000 produces1108; replaying result B stays1108. A new resumed run adds its own contribution once (its cumulative value minus the restored `cost-state` when 533 detects a restore).

**Spec seam:** extend agent-sdk/helpers/stream-transformer.spec.ts with “uses cumulative modelUsage while proxy request usage remains per-turn.” Feed final stream request frames A/B, SDK modelUsage snapshots A/A+B, and deliberately smaller per-turn result.usage B. Assert current-request frame B is57, owner session contribution is108, duplicate result unchanged, and cache creation remains zero. Preserve existing translator per-tool-turn/cache tests in auth-providers. These are regressions against accidentally selecting the wrong input, not a claim that the current translator test should fail.

**Conditional release gate:** if a real pinned-SDK boundary fixture instead shows modelUsage itself resetting each turn, that is a blocking normalization defect for 533. Fix the SDK adapter/transformer seam to produce cumulative-per-run values before the owner; never change the HTTP translator to cumulative or add an owner “sometimes add” mode. That would require a bounded request-identity accumulator and explicit approval of the changed scope. The inspected evidence does not justify building it now.

The installed declaration comments (:5366/:5374) say saved totals are restored on resume when the transcript has them. Local transcripts confirm this for Claude sessions and show resets for some proxy sessions. 533 owns the per-run restore detection; this plan must not add a second rule. Cumulative-within-run behavior is separately documented. No private log fixture or live billing inference is permitted.

## Codebase evidence

| Verified evidence | Location | Architectural implication |
| --- | --- | --- |
| Discovery windows are keyed only by normalized model ID. | libs/shared/src/lib/utils/pricing.utils.ts:366,393,450 | Capacity registry must include provider identity; telemetry cannot use unscoped entries. |
| Exact proxy discovery currently outranks SDK, but SDK fallback and general lookup still win on a miss. | libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:71–81,479–498 | A miss must become unknown for proxies, not generic200000/regex. |
| Discovery knows provider ID; persisted entries lose evidence provenance and static metadata can fill context length. | libs/backend/auth-providers/src/lib/provider-models.service.ts:182–210,286,324,450,520 | Carry capacity provenance through cache/persistence; do not promote static fallback to discovery. |
| OpenRouter prefetch also feeds the global discovery registry. | libs/backend/auth-providers/src/lib/provider-models.service.ts:1024,1058 | Scope prefetch to openrouter; it cannot populate Codex capacity. |
| Effective session auth is resolved before SDK query creation. | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:152 | Capture non-secret capacity identity per run rather than consult mutable global auth. |
| Missing latest-request context currently falls back to cumulative input/cache/output. | libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:75–97 | Remove that fallback; totals are not a context numerator. |
| Resume/post-compaction state can synthesize a window from model-only lookup. | libs/frontend/chat-state/src/lib/tab-manager.service.ts:1954–1958,2060–2065 | Preserve backend evidence or display unknown; never guess on reload. |
| PreCompact samples latest live/resume usage; completion forwards SDK metadata. | libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts:344–369; libs/backend/agent-sdk/src/lib/helpers/live-usage-tracker.ts:100–109,138; libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts:87–96 | Start sample and completion pair are different sources. |
| Marker currently gates “shrank” only on numeric decrease. | libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:104–112 | Add provenance gate. |
| Marker state merges each endpoint with old state independently. | libs/frontend/chat-state/src/lib/conversation-registry.service.ts:263–280 | Persist/replace a pair atomically; never combine boundaries. |

## Architecture decision

Two kept components share additive transport types, not accounting logic. Context-capacity resolution stays a pure shared utility consumed by backend; provider discovery supplies qualified evidence. Existing compaction event/state flow carries a self-contained measurement. Frontend remains a formatter of session totals and may compute a percentage only from an independently supplied current-context frame and verified denominator.

Rejected alternatives: model-only prices/windows leak across providers; trusting any positive SDK proxy window preserves generic defaults; restoring the old main/tree DTO migration duplicates 533; marking an arbitrary pre/post pair comparable in frontend hides its origin; changing Responses usage to cumulative makes the SDK count prior requests again.

No new service/DI token, library, persisted accounting schema or cross-library deep import is needed. Pricing and capacity remain separate concerns even though the existing pricing utility houses the bounded discovered-capacity map.

## Component 1 — Provider-aware context capacity

### Purpose and verified boundaries

Supply honest capacity and current-context display for direct Anthropic, Codex, OpenRouter and other routes. Preserve the SDK harness, PR490 final message_delta handling, and 533 totals. Evidence and callers appear in the table above. Shared utility is exported already by libs/shared/src/index.ts:52; provider discovery is the existing registration caller.

### Additive contract and change

Proposed exported ContextCapacity in libs/shared/src/lib/utils/pricing.utils.ts:

~~~ts
export interface ContextCapacity {
  readonly tokens: number | null;
  readonly source: 'sdk-native' | 'provider-catalog' | 'unknown';
  readonly providerId: string | null;
  readonly model: string; // exact effective model, not a tier label
}
~~~

Add contextCapacity?: ContextCapacity to ResultStatsPayload.modelUsage rows (shared/types/agent-adapter.types.ts:29), and to SessionStatsEntry.contextSnapshot plus its optional per-model context metadata (shared/types/rpc/rpc-session.types.ts, approved533 shape). Keep contextWindow numeric/optional as the compatibility projection of tokens, using0 for an explicit unknown live window. Do not add main/tree totals or alter tokenCount/cost fields. A missing older evidence field is unknown; a bare positive window is not new authority.

Add contextLengthSource?: 'provider' to ProviderModelInfo in shared/types/rpc/rpc-providers.types.ts:50. Only genuine remote catalog/dynamic-fetcher evidence sets it; static/missing lengths leave it absent. Persist it in the existing catalog object, not a new checkpoint. Older persisted entries without the field remain usable for model selection but not as authoritative telemetry capacity until refreshed. Validate positive finite values at read/registration.

Extend existing registerModelContextWindows(entries, providerId?: string) and getDiscoveredContextWindow(modelId, providerId?: string) with provider qualification. Proposed resolveContextCapacity({ route, model, sdkContextWindow }): ContextCapacity is the pure resolver in that same utility; route is the frozen capacityRoute described below. Use one bounded map keyed by provider + exact model; do not create a parallel global “V2” registry. An unqualified legacy entry cannot satisfy a qualified telemetry lookup. Keep explicit provider-qualified ID aliases only within that provider; do not use arbitrary substring, stripped vendor collisions or fuzzy/dotted model substitutions for capacity. Model resolution, not approximate matching, establishes the exact ID.

ProviderModelsService.recordContextWindows receives providerId and accepts only entries with provider evidence. Set evidence on raw transformApiModels (context fields at :1103) and successful live dynamic-fetcher results before static enrichment; all cached, persisted, discovery and prefetch routes must pass the original provider. mergeStaticMetadata (:520) cannot give an inherited static length provider provenance. Prefetch is qualified openrouter even when the active chat provider is Codex. Register no staticModels lengths.

Capture proposed capacityRoute: { kind: 'native' | 'proxy'; providerId: string | null } on the existing SessionRecord and pass it through ExecuteQueryResult and StreamTransformConfig, alongside 533's token/cost flag. It contains no credentials. Derive at SessionQueryExecutor's effective auth seam (:152), honoring profile overrides, and retain it on active reuse. Existing getActiveProviderId in sdk-query-options-builder.ts:169 supplies a candidate provider, but its hostname substring match (:189) is not sufficient authority: accept only an exact effective route/known proxy-token match; otherwise unknown. Use strict isDirectAnthropic at shared/utils/auth-env.utils.ts:3 for native identity. Unknown custom route must not inherit native authority merely because provider lookup returned null. No changes to 533's cost-authority algorithm.

Replace resolveResultContextWindow's fallback selection with a pure resolver in the existing shared utility:

1. Native route + finite positive SDK model window -> sdk-native.
2. Exact provider/model catalog capacity from the qualified registry -> provider-catalog. This is the primary proxy source; known provider response/discovery metadata can feed this same path.
3. Otherwise tokens:null/source:unknown. No bundled family regex, static128000, generic SDK proxy200000, or another provider's catalog.
   
No new provider-response capacity field is assumed to exist. If future metadata exists, its producer must prove authority before adding another source. A configured SDK limit/user environment override is a policy setting, not observed provider capacity; preserve explicit options, do not display them as verified capacity. sdk-query-options-builder.ts:993–1000 already preserves inherited env and avoids generating the obsolete override; leave production option behavior alone.

History: after533, use its contextSnapshot from the latest main frame, not totals. SessionHistoryReader's model-only knownWindow fallback (inspected :938–940) must not recreate capacity without matching provider evidence. If the historical provider cannot be proven, attach unknown capacity. Do not guess from the currently active global provider or rewrite533's aggregation.

Frontend: carry evidence in existing LiveModelStatsPayload / corresponding TabState and panel LiveModelStats shapes. Add optional contextKnown?: boolean for the numerator, leaving old numeric shape compatible; newly derived unknown values set false and are never presented as zero. deriveLiveModelStats uses only lastTurnContextTokens or the backend history contextSnapshot; remove cumulative fallback even before compaction. Positive finite capacity alone cannot make a missing numerator known. Numeric0 is a valid observed numerator only when explicitly reported.

When context is unknown, retain the model label but render “—”, omit percent/progress and omit fabricated used-token0. Do not preserve a previous provider/model's badge on an authoritative unknown update. Distinguish “no context update” from “explicitly unknown” in tab and surface assignment. Context changes must not erase/modify533's session snapshot. Propagate through SessionStatsAggregatorService, SessionLoaderService and both tab/surface live state; harness uses the same live view model, so no separate harness capacity calculation.

Post-compaction seeding may retain the verified capacity for the SAME provider/model while replacing only context numerator with the valid post value. Remove getModelContextWindow fallback from TabManagerService. Model/provider changes or legacy persisted evidence invalidate the old capacity. Preserve414's nonpositive/missing post-value behavior.

### Failure behaviour and verification seam

Catalog failure, missing provenance, malformed length, route mismatch, unknown provider or unknown historical route -> unknown capacity; query startup and session accounting continue. No fetch on every result; use existing discovery/cache. Context-only unknown explicitly clears stale fill.

Focused specs prove same-slug cross-provider isolation, static/persisted fallback exclusion, profile override isolation, no SDK proxy fallback, no cumulative numerator, resume unknown, provider switch clearing and post-compaction same-provider preservation. Read-side shared utility remains pure and UI imports shared via public aliases. Files are handoff A/B below.

## Component 2 — Honest compaction measurement provenance

### Purpose and evidence

Show a measured reduction only for one valid SDK compact-boundary pair. Keep414's reload/timer/context behavior and533's lifetime snapshot unchanged. PreCompact sample (compaction-hook-handler.ts:348) reads a latest live/resume frame, not session totals; system-message.transformer.ts:94–96 supplies completion metadata. Marker currently compares numbers without origin.

### Additive contract and change

In shared/types/execution/stream.ts, add a proposed exported CompactionMeasurement and optional fields to the existing CompactionCompleteEvent:

~~~ts
export interface CompactionMeasurement {
  readonly source: 'sdk-compact-metadata';
  readonly boundaryId: string;
  readonly preTokens: number;
  readonly postTokens: number;
}
// Add to CompactionCompleteEvent:
readonly boundaryId?: string;
readonly measurement?: CompactionMeasurement;
~~~

The envelope owns both values; do not certify independently merged scalar fields. Keep existing preTokens/postTokens/durationMs for compatibility/context seeding. Clarify CompactionStartEvent.preTokens documentation at :259: latest-request sample, never half a reduction measurement. No start-event ledger or hook accumulator.

SystemMessageTransformer.transformCompactBoundary (:32) assigns a boundary identity from the SDK UUID, already used at :84, or this emitted event's ID when absent. Only emit measurement if BOTH finite nonnegative numbers occur in this same compact_metadata object. Do not fill a missing endpoint from tracker/start/history. Missing data emits a normal completion with no measurement. Pair provenance describes SDK telemetry, not verified physical compression or billing savings.

Carry boundaryId/measurement intact through AccumulatorCore.process (:573–576), both declared result shapes and actual forwarding in StreamingHandlerService (:185/:329/:403), ChatStore.processStreamEvent (:372), and CompactionLifecycleService.handleCompactionComplete (:367). Forward optional metadata rather than reconstructing it. Notification-only completion paths (:655) with no SDK pair remain neutral.

Extend CompactionMarkerRecord and setCompactionMarkerTokens in ConversationRegistry (:38/:263); persist/validate optional boundaryId/measurement in its existing local-storage representation (:324). A new completion replaces measurement atomically. Missing/invalid provenance never inherits a prior boundary's measurement. Repeated identical boundary is idempotent; a duplicate carrying only summary may retain that same boundary's valid pair. Never synthesize a new pair by null-coalescing old and new endpoints (:277–278). Old stored markers deserialize with unknown provenance.

ChatView template (:54) passes the measurement to CompactionMarkerComponent. Only this envelope's valid same-boundary pair with pre>post allows “shrank.” Equal/increasing same-boundary values are neutral. Mixed/unknown data shows “Context compacted” and, if useful, separately labeled samples; no reduction arrow, amount or percentage implying comparability. Reload preserves valid envelope and treats old records neutrally.

### Failure behaviour and verification seam

Missing UUID uses local emitted event identity, not timestamp coincidence for pairing. Invalid/missing endpoint, mixed sources or different boundaries -> no measurement claim; compaction still completes and reloads. Do not delay completion waiting for accounting. Preserve414's session-isolated timers and generation/readiness handling; preserve533 snapshot identity/value throughout.

Specs prove valid decrease, increase/equality, invalid/one-sided pairs, legacy records, sequential boundaries, duplicate completion and summary-only persistence. Exact files below; no new service or transport channel.

## Main/tree scope decision

No separate main-only cumulative scope is needed for this panel after533: snapshot cost and all token classes already refer to lifetime execution-tree/query-pipeline accounting. Context badge is separate and must say “Main context” or equivalent tooltip text describing the latest main request. This labeling is part of Component1; it is not a second totals scope.

Do not add mainSession/executionTree/currentRequestContext duplicate accounting DTOs, alter SessionStatsEntry.scope, or modify sessions-list range/current-context selections. Main-only cumulative breakdown is Deferred pending an explicit consumer requirement.

## Integration architecture and failure behavior

533 supplies the stable totals snapshot. This task adds orthogonal context evidence and compaction envelopes along existing callback/event paths. Result model metadata travels intact in existing modelUsage (sdk-callbacks.ts:408 already forwards that array), so no new broadcast message or stats owner method is needed.

Unknown capacity cannot affect cost or tokens. Unknown compaction provenance cannot prevent completion, replace totals, or reset the owner. All state modifications use the existing session/tab/conversation ownership; no cross-session fallback. New shared fields are optional to keep533 consumers compiling. No direct frontend/backend import; shared DTOs and existing public barrels are the only bridge.

## TASK_2026_414 overlap

Verified .ptah/specs/TASK_2026_414/task.md:3 says status:done. Its old context still says active; the task status/current implemented behavior take precedence. It is not a new blocking dependency.

Direct overlap with this plan: libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts and its spec; compaction-lifecycle.service.ts and its spec; libs/frontend/chat-state/src/lib/tab-manager.service.ts (414's tab-manager.service.spec.ts versus this plan's intent-mutators spec); libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts and its spec; libs/backend/agent-sdk/src/lib/session-history-reader.service.ts and history specs. 414 batches.md lists reload at :42, timers at :62, context seed/marker at :82–86. Conversation-registry and stream propagation are additional418 seams, not a reason to rework414.

Preserve boundary-ready immutable history/staleSnapshot handling, per-session timers, ownership checks, nonpositive seed rules and diagnostic warnings. Tighten only414's “pre>post” marker rule with provenance. Do not copy the obsolete old418 requirement to wait for414 to land.

## Architecture-level quality requirements

- No change to533 arithmetic/owner/usageCostSource or PR490 inclusive-input/cache mapping.
- Qualified exact context lookup only; bounded registry size and existing cache lifetime; no provider network request per streamed token/result.
- Unknown remains unknown through reload, model/provider switch, surface assignment and compaction.
- Measurement envelopes move and persist atomically; legacy records never imply comparability.
- Retain OnPush/signals, Native UI components, readable “—”/tooltip behavior and accessible marker text.
- No any casts, suppressions, logging credentials or private fixture content. No pricing/billing/quota/cache-efficiency claims.

## Team-leader handoff

The codex implementation lane cannot receive clarification from the user; this plan supplies the decisions, exact paths, failure behavior and expected tests. Use a different-family reviewer after implementation. Do not substitute a lane silently. No lane is started by this architecture task.

Delivery base is the completed533 commits (including frontend contract adoption), not the concurrently changing worktree state. Then create branch fix/task-418-codex-session-statistics in this same worktree; stacked PR targets fix/session-stats-disagreement until533 merges. Do not reuse the deleted old418 worktree, branch off old main, or modify533's owner to accommodate this task. No source edits or branch actions are performed now.

Complexity: MEDIUM. Two file-disjoint component ownership groups below support team-leader decomposition. A's additive contract precedes B; B can compile against that contract and fixtures without live provider access. Shared/backend files belong only to A. No third accounting batch.

## Batches

These are file-ownership and verification handoffs; implementation decomposition remains the team-leader's responsibility. All listed files are MODIFY after533, no new production module. session-stats-summary.component.spec.ts is currently absent but is explicitly CREATE in approved533 Batch B; extend that delivered spec rather than treating it as an unverified existing file. If533 renames a seam, resolve its approved replacement and report the mapping before expanding file scope.

### A — shared/backend context evidence and compaction producers

Recommended executor: backend-developer skill set, executed by the codex lane.

**FAILING SPEC first (exact file + test name + expected versus current behavior):**

- libs/shared/src/lib/utils/pricing.utils.spec.ts — “does not borrow another provider's context capacity for the same model”: register openrouter/m=400000; lookup openai-codex/m ->unknown, not400000. Proxy SDK fallback200000 with no qualified evidence ->unknown. Native SDK1000000 ->known. Current global map/fallback cannot establish this isolation.
- libs/backend/auth-providers/src/lib/provider-models.service.spec.ts — “does not promote static or legacy persisted context lengths into provider evidence”: a live entry lacks length, static enrichment supplies128000; expected unknown telemetry while model selection stays usable, versus current unqualified re-registration of enriched persisted values.
- libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts — “publishes unknown capacity for a proxy with only a generic SDK window”: expected contextWindow0 and contextCapacity.tokens null, versus current positive SDK fallback. Include simultaneous per-profile sessions using the same model slug.
- libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts — “emits a measurement only for a complete same-boundary SDK pair”: expected envelope for1000->600; missing/NaN/negative endpoint yields no envelope and still a completion. Current event has no origin envelope.
- libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts — “leaves historical context capacity unknown without historical provider evidence”: latest main context preserved, no model-only capacity fallback.
- Regression, not fabricated red test: stream-transformer.spec.ts “uses cumulative modelUsage while proxy request usage remains per-turn” uses the51/108/57 fixture in the normalization finding; sdk-agent-adapter.spec.ts preserves533's prefix1000 + resumed-run108=1108 and run reuse. Existing auth-providers translator per-tool-turn/cache/reasoning/duplicate specs remain unchanged and must pass.

Exact files:

~~~text
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\utils\pricing.utils.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\utils\pricing.utils.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\rpc\rpc-providers.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\rpc\rpc-session.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\agent-adapter.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\execution\stream.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\auth-providers\src\lib\provider-models.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\auth-providers\src\lib\provider-models.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\auth-providers\src\lib\provider-models.prefetch-context-windows.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-registry.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\message-transform\system-message.transformer.spec.ts
~~~

~~~sh
npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/auth-providers,@ptah-extension/agent-sdk
~~~

### B — frontend context display and compaction provenance

Recommended executor: frontend-developer skill set, executed by the codex lane after A.

**FAILING SPEC first:**

- libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.spec.ts — “never substitutes cumulative usage for a missing main context frame”: cumulative108, known capacity, absent lastTurnContextTokens ->contextKnown false and no percentage; current pre-compaction fallback publishes cumulative context. Unknown new provider must clear previous known fill.
- libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts — “renders unknown main context as an em dash without changing tree totals”: session snapshot stays unchanged, unknown numerator or capacity ->“—”, no progress and no fake0. Current window-only gate/fallback allows stale or fabricated fill.
- libs/frontend/chat-state/src/lib/conversation-registry.service.spec.ts — “does not carry a measurement across compaction boundaries”: valid boundaryA pair, then boundaryB missing pre ->no measurement forB, versus current independent null-coalescing of old/new values.
- libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts — “does not say shrank for legacy or mixed-source decreasing values”: pre1000/post600 without envelope ->neutral; valid same-boundary envelope ->shrank. Current numerical gate says shrank in both.
- libs/frontend/chat-streaming/src/lib/accumulator-core.service.spec.ts and streaming-handler.service.spec.ts — “forwards the compact-boundary measurement unchanged”: metadata reaches ChatStore/lifecycle rather than disappearing in scalar projection.
- Extend tab-manager.intent-mutators.spec.ts, loader/aggregator/surface/lifecycle specs listed below for provider switch, unknown clearing, post-compaction verified capacity retention, legacy persisted marker and533 snapshot retention. Do not re-test unrelated UI styling or workspace-wide projects.

Exact files:

~~~text
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\tab-state.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-types\src\lib\chat-types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\tab-manager.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\tab-manager.intent-mutators.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\surface-session-stats.registry.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\surface-session-stats.registry.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\conversation-registry.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\conversation-registry.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-streaming\src\lib\streaming-handler.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat.store.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-live-stats.util.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-live-stats.util.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\notifications\compaction-marker.component.spec.ts
~~~

~~~sh
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat-streaming,@ptah-extension/chat,@ptah-extension/chat-ui
~~~

Nx names verified in the affected project.json files. Run commands once with a captured concise failure summary; no workspace-wide affected/test/build sweep. No project.json edit or Nx reset is planned.

## Deferred

| Item | Owner/reason |
| --- | --- |
| Main-only cumulative breakdown / scope selector | Future explicit consumer request;533 already aligns lifetime tree totals. |
| Sessions-list range/current-context redesign | TASK_2026_411/533 scope decisions; not needed for context badge correctness. |
| Query result delta ledger, frontend addition, reload accounting dedupe | Superseded by TASK_2026_533, not pending418 work. |
| Additional per-request -> cumulative adapter normalizer | Only if pinned-SDK modelUsage boundary test disproves its cumulative contract; no current evidence warrants it. |
| Persistent accounting checkpoint, overlap watermarks, repricing | Explicitly deferred by533. |
| New provider response-capacity integrations | Future provider-specific evidence; this task accepts existing authoritative discovery and native SDK metadata only. |
| SDK compaction policy/threshold redesign or environment overrides | Separate concern; preserve current option behavior and explicit user settings. |
| Standalone Codex CLI turn.completed/session tile statistics | TASK_2026_513; this finding concerns the Claude SDK's Codex HTTP proxy path. |
| Model-price matching and pricing recovery | TASK_2026_475 and separate recovery work; no cost algorithm in418. |

## Risks

- Resume restoration is conditional (Claude restores from `cost-state`, some proxy sessions reset). 533 owns the per-run detection; any 418 change at the transformer seam must keep its inputs intact and must not add a second restore rule, rather than reopening the approved533 architecture.
- Raw proxy usage and SDK result usage are easy to confuse. Replacing owner values with per-turn result.usage would under-count; making HTTP usage cumulative would double-count inside the SDK. The boundary fixture is mandatory.
- Effective route identity must be frozen per query. Global auth/provider changes cannot alter a running session's denominator. Unknown route is not native merely because provider lookup returned null.
- Historical provider identity or catalog provenance may be absent. More “—” displays are the intended honest outcome, not a reason to restore heuristics.
- Provider model discovery currently enriches/persists static metadata. Ensure the new provenance field survives genuine discovery but is never acquired through static merge or old-cache rehydration.
- Completion events and summary notifications can arrive separately; never merge measurement halves across boundaries. Preserve414's recovery and session ownership.
- Source was changing during architecture. Treat533's approved contract as the base and re-anchor cited symbols after its commits. Any compile-only additional consumer must be identified with concrete evidence; do not broaden this into another stats rewrite.
