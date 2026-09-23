# Implementation Plan - TASK_2026_533_b7e1

## Inputs and constraints

- Requirements: context.md, especially “Scope decision (2026-09-23): lean backend authority” at lines 15–29. This revision replaces the rejected architecture in place.
- Evidence: root-cause-report.md, TASK_2026_418_a91c/implementation-plan.md, and current source cited below. TASK_2026_474_5c9f retains unknown-price semantics; TASK_2026_475_e4b7 owns model lookup; TASK_2026_513_a7c2 owns spawned CLI telemetry.
- Source/spec files remain read-only during architecture. Only this plan is overwritten; no suites or history-changing git commands were run.
- No AGENTS.md or CLAUDE.md was found in the inspected root/ancestor directories or affected library trees. The request's project guidance applies.
- Missing decision-critical input: none blocks the chosen architecture. SDK counter reset remains an explicit external-contract assumption with a verification seam.

## Decision summary

- One in-memory agent-sdk owner keeps a fixed history prefix plus the latest cumulative result per query run, keyed by existing SessionRecord.token. Same-run replacement is idempotent; different runs are summed.
- Reuse aggregateSessionUsage for history, list and live snapshot arithmetic; keep I/O and state outside that pure function.
- Extend SessionStatsEntry. Live SESSION_STATS carries sessionStats; resume stats returns the same type.
- Backend snapshots supply totalCost, pricing coverage, all four token classes, tokenCount, model rows including both cache classes, and unique subagent count.
- Freeze usageCostSource at query creation from effective auth/route data. Accounting distinguishes reported from unreported cost, never provider names.
- Preserve per-turn/footer fields and the independent context badge. Neither is a session-total accumulator.
- Tabs/surfaces install snapshots; panel and compact card display them. Delete panel message/tree aggregation and row reductions.
- Label the background population explicitly. Count session subagent identities across all statuses, not files, tool-use nodes or CLI lanes.
- No checkpoint, delta-ledger dependency, source watermarks, list-scope redesign, or dashboard redesign.

## Codebase evidence

Paths are relative to D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement. “Verified” describes current source; new identifiers/behavior are marked Proposed.

| Verified evidence | Location | Consequence |
| --- | --- | --- |
| Existing canonical stats DTO has four token classes, coverage and model rows. | libs/shared/src/lib/types/rpc/rpc-session.types.ts:180 | Extend it; do not duplicate it. |
| Resume repeats that DTO and adds context metadata. | libs/shared/src/lib/types/rpc/rpc-chat.types.ts:260 | Reuse SessionStatsEntry and retain context metadata. |
| Pure list aggregator owns token math and own-model pricing. | libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:108,134,174 | Reuse its bucket/finalization logic. |
| Aggregator exposes partial known cost as total, counts files, drops cache fields. | libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:217,220,222 | Correct these shared semantics once. |
| New registration mints token; active reuse skips query creation. | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:195; libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:782 | Existing token identifies a run. |
| Effective auth override/route is known at query creation. | libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:152 | Freeze cost authority there. |
| Live accounting branches on route. | libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:445,537 | Replace with the cost-source flag. |
| Hook carries parent session, agent ID and tool alias. | libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:217,223,230 | Count identities at this backend seam. |
| Frontend tab and surface paths add tokens/cost. | libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:135; libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts:99 | Replace addition with assignment. |
| SDK DI already registers history and stats readers. | libs/backend/agent-sdk/src/lib/di/register.ts:155,161; libs/backend/agent-sdk/src/lib/di/tokens.ts:29,34 | Register one sibling owner; no new library. |

## Architecture decision

Chosen: fixed prefix plus Map<run token, latest cumulative result> in an SDK-internal owner. aggregateSessionUsage handles arithmetic; owner handles lifecycle and identity. This follows the binding scope without persistent state or incremental deltas.

Rejected: a checkpoint expands storage/recovery scope; a delta ledger couples delivery to TASK_2026_418; frontend reconstruction recreates the disagreement; rereading growing JSONL into an active prefix double-counts live work. No competing accounting DTO or “V2” implementation is added.

Effect: replace history's separate accounting loop, live cost branch and frontend accumulation/reconstruction. Keep footer handling, SDK query flow, independent context tracking, public list request scopes and shared utilities still used outside this panel.

Assumptions: a fresh SDK process's cumulative figures exclude its resumed history; cumulative model rows cover the billed run; cold resume has no independently continuing writer for the same session. A new token alone does not prove these numerical assumptions.

## Contract

Proposed target in libs/shared/src/lib/types/rpc/rpc-session.types.ts:180. Extend SessionStatsEntry in place. Existing required fields/unions remain. New fields are optional at the shared boundary to avoid unrelated dashboard/fixture migration; every new backend producer must populate tokenCount, model cache fields, count, scope and coverage. Missing fields mean unavailable, never frontend recomputation.

~~~ts
export interface SessionStatsEntry {
  readonly sessionId: string;
  readonly model: string | null;
  readonly totalCost: number | null;
  readonly knownCost?: number | null;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheCreation: number;
  };
  readonly tokenCount?: number;
  readonly messageCount: number;
  readonly agentSessionCount?: number; // unique canonical subagent IDs
  readonly cliAgents?: readonly string[];
  readonly modelUsageList?: ReadonlyArray<{
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheRead?: number;
    readonly cacheCreation?: number;
    readonly costUSD: number | null;
    readonly contextWindow?: number;
  }>;
  readonly status: 'ok' | 'error' | 'empty';
  readonly coverage?: SessionStatsCoverage; // existing complete | partial
  readonly pricingCoverage?: SessionStatsPricingCoverage; // full | partial | none
  readonly untimestampedCount?: number;
  readonly scope?: 'session' | 'current-context' | 'range';
  readonly revision?: number; // one backend owner lifetime only
  readonly durationMs?: number | null;
  readonly contextSnapshot?: {
    readonly model: string;
    readonly contextTokens: number;
    readonly contextWindow?: number;
  };
}
~~~

The public SessionStatsScope request union at rpc-session.types.ts:242 remains current-context | range. Only internal SessionStatsScopeSelection at session-usage-aggregator.ts:29 gains session for a lifetime resume prefix; output scope identifies the chosen selection.

Exact additional changes:

- ResultStatsPayload in libs/shared/src/lib/types/agent-adapter.types.ts:29 gains sessionStats?: SessionStatsEntry. Preserve existing cost/tokens/duration/modelUsage fields for message footers/context.
- Replace the anonymous resume stats at libs/shared/src/lib/types/rpc/rpc-chat.types.ts:260 with stats?: SessionStatsEntry | null. Preserve contextSnapshot and row contextWindow through that canonical DTO.
- Internal SessionRecord (session-registry.service.ts:42), ExecuteQueryResult (session-lifecycle-manager.ts:246), and StreamTransformConfig gain usageCostSource: 'reported' | 'unreported'. Existing sessionToken at session-lifecycle-manager.ts:269 identifies the run and stays backend-only: it is a registry capability.
- StreamTransformConfig/local callback types in stream-transformer.ts:136 carry run identity and snapshot. Validate existing footer fields separately and attach the snapshot; validateStats at :184 returns its input at :235.
- TabState in libs/frontend/chat-types/src/lib/chat-types.ts:518 gains sessionStats?: SessionStatsEntry | null. Existing unrelated tab fields remain for non-panel callers.
- SurfaceSessionStats at libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts:25 retains its name and live field; replace totals/modelUsage with snapshot: SessionStatsEntry | null.
- SessionStatsSummaryComponent accounting inputs at :629/:635/:657 become snapshot: SessionStatsEntry | null. Retain liveModelStats, presentation state and existing non-accounting compactionCount input. Remove accounting dependency on messages.

Reported numeric zero is known. Any genuinely unpriced contribution makes totalCost null; pricingCoverage becomes partial/none. knownCost is cheap because aggregateSessionUsage already tracks pricedCost at :170. Update the existing comments that currently say “null exactly when none” and “agent files.” Coverage describes missing usage; pricingCoverage describes monetary coverage, including reported cost.

## Component specifications

### Backend owner and aggregator

Purpose: one authoritative accounting result per canonical session. Proposed SessionStatsOwnerService owns prefix, runs, roster and revision; existing aggregateSessionUsage owns math. No SDK dependency enters shared.

Verified boundaries: registry token, query result/config, transformer result handling (:435), history load (:245), hook start/stop (:196/:375), SDK DI (:155). Dependencies are existing aggregator/pricing and session identity, not UI or persistence. Invalid inputs retain accepted state; read failures preserve partial coverage. Verification seams: pure aggregate specs, owner replacement specs and adapter cold-resume ordering. Exact files: handoff A.

### Frontend storage and display

Purpose: route/install/display snapshots while preserving footer/context flows. State remains in tab manager and surface registry. Component keeps OnPush/signals (session-stats-summary.component.ts:623) and uses shared DTOs via aliases.

Verified bindings: chat-view.component.html:27, harness-builder-view.component.ts:403, session-loader.service.ts:862. Missing values render unavailable; zero renders zero. Verification seams: input/DOM tests and replacement tests. Exact files: handoff B.

## Backend producer

1. **Shared pure arithmetic.** Extend aggregateSessionUsage at session-usage-aggregator.ts:108 with an internal discriminated input for normalized prefix/run contributions alongside existing history-ledger input (:45). Both use the same bucket/finalization logic; owner must not implement pricing/math again. Preserve own-ID lookup (:174), retain row cache fields (:222), and null partial totals (:217). Accept explicit subagent identities instead of counting array length (:220). Keep identity metadata beside ledgers, so SessionUsageLedger/cache storage needs no schema change. Prefix amounts are already priced and are not repriced during each merge. A proven empty prefix/run is a neutral contribution: its display-level null cost must not poison a later priced run. Missing or unreadable usage is not proven empty.

2. **History and list.** Replace session-history-reader.service.ts aggregateUsageStats at :885 with existing ledger construction plus aggregateSessionUsage, using internal session scope. Use full loaded main/agent arrays (:245/:348), not the paginated replay slice. Preserve separate latest-context extraction (:535). SessionStatsReaderService at session-stats-reader.service.ts:179/:191 passes canonical agent IDs alongside ledgers while retaining public range/current-context selection. Unreadable transcripts preserve coverage and count an identity only if known.

3. **Owner state/lifetime.** Proposed session-stats-owner.service.ts owns per workspace/canonical session: fixed prefix, Map<SessionRecord.token, latest normalized result>, canonical agent-ID Set, revision. Proposed operations: seedHistoryOnce, replaceRun, recordAgent, snapshot, clear. Keep completed run values across query replacement/compaction. Rebind a provisional session ID when the adapter learns the canonical ID; do not clone its state. Clear only after deliberate release with no active query or backend disposal. No disk state.

4. **Cold resume ordering.** sdk-agent-adapter.ts seeds a missing owner before executing a new resumed query. Reuse an already loaded complete history result, otherwise read once. New sessions have a known-empty prefix. Existing-query reuse at :782 retains owner/token and never reseeds. A later history RPC can return the current owner snapshot but cannot overwrite its prefix. One pending initialization promise per owner prevents concurrent seed/query races. This is lifecycle ordering, not a source watermark.

5. **Run key and authority.** Registry token is minted at session-registry.service.ts:195; executor registers at session-query-executor.service.ts:120, resolves effective auth at :152, returns token at :359. Derive usageCostSource once, honoring authEnvOverride. Existing route classification is libs/shared/src/lib/utils/auth-env.utils.ts:3: SDK-priced native route -> reported; translated/custom endpoint whose SDK dollar values are not authoritative -> unreported. This classifies cost authority, not provider/model names. Freeze it on the record; pass it/token through fresh, resumed, slash-command and active-reuse transforms in sdk-agent-adapter.ts:742/:787/:901/:1117. No registry capability field or provider-name switch. A zero placeholder alone does not establish “reported.”

6. **Normalize a cumulative result.** Replace stream-transformer.ts:445/:537 accounting branches. Reported uses finite SDK total_cost_usd and modelUsage[].costUSD, including zero. Unreported prices all four classes for each model's own reported ID through the existing seam (:465). Cumulative modelUsage supplies accounting tokens; sum once in the backend. Do not add footer usage at :553 to that map. Without cumulative model attribution, do not interpret a per-turn usage object as cumulative: retain prior accepted run accounting or mark partial/unavailable. Parent SDK cost already includes its subagents (context.md:33); hooks contribute identities, not additional cost. A reported aggregate may remain known if only row attribution is missing; mark coverage partial and keep unknown rows instead of manufacturing a row sum.

7. **Replacement/publication.** Validate finite nonnegative counters in all four classes and costs. Complete newer result replaces its run entry; exact duplicate is a no-op; demonstrably stale/decreasing or truncated input retains the accepted entry. Do not merge fieldwise maxima or invent deltas. A complete new result with a genuinely unpriced model is accepted and can null the total. Recompute prefix + run entries with aggregateSessionUsage; publish one immutable SessionStatsEntry/revision. Attach to ResultStatsPayload; forward at libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:403. Keep unconditional onTurnEnd (:438) and footer semantics. Accounting cannot be skipped just because the UI callback is absent (:439 currently exits early).

### Required reset and overlap checks

**Verified:** new registration has a fresh token (session-registry.service.ts:195); resume ID enters the new SDK query (session-query-executor.service.ts:281); active reuse keeps its query (sdk-agent-adapter.ts:782). This establishes identity, not counter reset.

**Assumption:** modelUsage and total_cost_usd restart at zero for the new query process, even with a resume ID. Source comments conflict: stream-transformer.ts:194 calls figures cumulative, :569 calls sdkTokens a per-turn delta, :570 calls model usage cumulative per session. Inspected repo specs do not prove external SDK cold-reset behavior. Pin an SDK-boundary fixture in sdk-agent-adapter.spec.ts: history prefix cost 10; first fresh resumed-run cumulative cost 3 -> snapshot 13; next same-run cumulative 5 -> 15. Verify/capture that fixture against the pinned SDK, including cold resume. Mocked owner arithmetic alone is insufficient proof. If the first new SDK figure is instead 13, this design's premise fails: report it before release; do not silently add subtraction/checkpoints or claim 418 resolves it.

**Fixed prefix:** freeze accepted history arrays before launching this new query. Later JSONL growth from the query is never reread into its prefix. JsonlReaderService.readJsonlMessages (helpers/history/jsonl-reader.service.ts:413/:437) uses an unbounded stream, so the repo does not prove an atomic stat-time cut across files. “Resume time” here is completed accepted cold read preceding query launch. Active reopening uses the existing owner. Independent/orphan writers crossing that read remain outside the single-owner assumption; no overlap-watermark protocol is added.

## Frontend consumer

- SessionStatsSummaryComponent reads totalCost, tokenCount, agentSessionCount, tokens and modelUsageList directly. Delete message-derived summary at :757, token math at :782, and table reductions at :721–753. Both table layouts (:231/:486) show IN, OUT, CACHE READ, CACHE CREATION, COST. Table totals read snapshot totals. IN means uncached input.
- Missing snapshot/optional field displays unavailable, never calculateSessionCostSummary, calculateSessionTotals, row reduction or execution-tree counting. CostBadge keeps null/zero semantics. Use backend durationMs when supplied; otherwise omit/show unknown duration instead of deriving from messages. Formatting/tooltips remain frontend responsibilities.
- SessionStatsAggregatorService accepts sessionStats at :48 and removes the :135 addition block. Keep workspace/session routing and unchanged payload forwarding to StreamingHandlerService for footers. Keep separate context derivation at :97. Install via TabManagerService setter; absent snapshot means no replacement.
- SurfaceSessionStatsRegistry.record (:84) assigns snapshot/live; remove :99–121 addition and redundant model-row storage. Retain the session-keyed facade for harness workflow consumers.
- SessionLoaderService.applyLoadedStats (:862) installs canonical snapshot, preserving contextSnapshot handling (:880). CompactionLifecycleService (:556) stops manufacturing totals via calculateSessionCostSummary; retain snapshot while context/compaction state changes.
- ChatStore's forwarding type (:491) includes optional snapshot. ChatView binds tab.sessionStats. Harness builder (:403) binds surface.snapshot/live separately and removes copied model totals (:575). Compact-session card (:107) uses snapshot cost/tokens/agents while retaining independent model-selection presentation.
- Existing old tab fields needed elsewhere can receive direct projections of backend fields, never accumulated values. No broad DTO/dashboard cleanup.
- Revision comparison applies only within one attached backend lifetime. Reset comparison state on new backend attachment; never compare persisted UI revision to restarted backend's counter. Reject session mismatch. Duplicates are harmless assignment. If that reconnect seam cannot be established, prefer arrival-order replacement to inventing a durable epoch protocol.
- Boundary evidence: shared/chat-types are util, chat-state is data-access. chat-ui/project.json:7 is actually feature in this checkout, but this change follows the requested stricter UI import rule: only shared/util types, no chat/backend/state-service/tree dependency. Use public aliases, not deep imports; no retagging or suppression.

## Agent count

Population: unique query-managed subagent identities belonging to the canonical root session, including descendants and all statuses; exclude the root itself. Repeated start/stop hooks, tool aliases and replay do not increase it. Standalone spawned CLI process/lane telemetry remains TASK_2026_513.

Live IDs arrive at subagent-hook-handler.ts:196; parent resolution at :217 and real ID/tool alias at :223–230. Record the real ID even without toolUseId: the existing registry gate at :222 must not gate membership. Stop (:375) confirms membership and never removes it. Reconcile aliases to real identities and canonical parent once.

Resume IDs come from discovered agent sessions (session-history-reader.service.ts:245) and file membership (session-stats-reader.service.ts:179). Normalize IDs, deduplicate aliases/repeated files, union with live membership. Unreadable known-ID files still establish membership; unidentified files only establish partial coverage. Count the set, never prefix count + run counts.

Tray population differs: background-agent-tray.component.ts:210 merges foreground/background entries and :240 filters foreground statuses. Preserve behavior but mark origin. For background-only entries, strip at background-agent-strip.component.ts:478 says “N background · M done.” For mixed entries explicitly label both populations, e.g. “N background · K active foreground · M done”; do not mislabel all entries background. The chip remains lifetime count. Roster changes appear on the next normal stats publication/history response; no new roster broadcast channel.

## Failure behaviour

| Case | Behavior |
| --- | --- |
| Unknown price | Retain tokens, null row/total cost, partial/none pricing coverage; never coerce to zero. |
| Partial pricing | knownCost is a labeled subtotal only, never the chip/table total. |
| Missing usage/history | coverage partial; do not claim a complete total or replace known data with a complete-zero prefix. |
| Malformed/partial/stale result | Reject atomically; retain accepted prefix/run. Validate cache fields too. |
| Complete result adds an unpriced model | Accept replacement; null the total even if formerly known. |
| Empty result/resume payload | Preserve snapshot. Empty result still ends turn. Truly new empty session can have status empty, zero tokens, unknown cost. |
| Cold resume | Await fixed prefix, then launch new run. Read errors remain partial/error. |
| Active resume / growing JSONL | Reuse owner/token; never reseed or add history over retained runs. |
| Compaction | Keep lifetime prefix/runs, update context separately. |
| Restart | Rebuild from JSONL; no persistent checkpoint/revision. Missing/unflushed usage stays partial. |
| Reset assumption disproved | Report concrete protocol discrepancy; no unplanned checkpoint/delta workaround. |

## Integration architecture

Data flow: SDK result + run/cost-source -> normalization -> owner replacement -> aggregateSessionUsage -> SessionStatsEntry -> existing SESSION_STATS callback/broadcast -> tab/surface assignment -> display. Cold JSONL/ledger aggregation seeds the fixed prefix and same resume DTO.

State is SDK memory only. Keep complete run values for owner lifetime; release only inactive owners. History errors use existing status/coverage. Invalid inputs retain accepted state. Do not log raw SessionRecord.token, whose capability semantics are documented at session-registry.service.ts:128. New owner must not import vscode-core merely for logging.

## Composition with TASK_2026_418 and TASK_2026_474

418's reviewed plan proposes query-owned ResultUsageLedger deltas and frontend accumulation (implementation-plan.md:34–49). New context.md:26–29 supersedes that frontend addition: this owner consumes raw cumulative values and replaces run entries. No 418 ledger is needed. If 418 lands first, snapshot normalization consumes raw figures before delta conversion; deltas must never be installed as cumulative run snapshots.

418 keeps Codex-proxy normalization, latest-request context, capacity precedence and compaction-context correctness. Shared transformer/context seams require merge coordination, not a delivery dependency. Do not pull its translations, named multi-scope DTOs or capacity resolver into this task.

474's goals remain: unknown is not zero; empty payload cannot erase accepted stats. c10d0438f's regression involved reconstructing cost from child nodes whose usage was already folded into parent SDK cost. Remove that panel reconstruction, not shared null handling. 475 owns exact model lookup; pass each model's own ID. List partial-price totals changing to null is intentional and tested.

## Architecture-level quality requirements

- Same snapshot drives every accounting chip and both table layouts. Footer/context regressions stay covered.
- Duplicate result -> unchanged totals; new run -> counted once; active resume/compaction -> no reseed.
- One retained normalized value per run, not per event. Memory scales with sessions/runs/models; no message bodies/credentials. No JSONL reread per result.
- Immutable publication, finite nonnegative validation, OnPush/signals, existing keyboard/table accessibility.
- No new runtime boundary leak, any cast, deep import or lint suppression.

## Team-leader handoff

Complexity: MEDIUM; risk is query/history ordering and existing transport/state seams. Two file-disjoint component boundaries follow for team-leader decomposition. A must land before B for a working build. B can compile/test fixtures against A's shared contract alone, without a running owner or TASK_2026_418.

## Batches

Executor/file ownership below is a component handoff; the team-leader owns implementation decomposition. All paths resolve against the absolute worktree above. Unmarked files are MODIFY; CREATE is explicit. No broad source expansion is authorized; report exact compile evidence for any additional required consumer adjustment.

### A — backend/shared component handoff

Recommended executor: backend-developer.

**Failing specs first:**

- session-stats/session-usage-aggregator.spec.ts under agent-sdk — “returns unknown total for mixed pricing and preserves both cache columns”: known model cost 2 + unpriced model -> null total, knownCost 2, both cache fields and all-four tokenCount. Current code returns partial numeric cost and omits row caches.
- CREATE session-stats/session-stats-owner.service.spec.ts under agent-sdk — “replaces cumulative results within a run and adds separate runs once”: A=10 then 15 then duplicate15, B=3 ->18, not28/43. Also prefix10+run3=13; growing-history refresh cannot add13 again; empty/stale/partial retains state; new unpriced model nulls total; aliases for five agents count five.
- sdk-agent-adapter.spec.ts under agent-sdk — “seeds cold history before launching a resumed query and never reseeds active reuse”: delayed prefix blocks launch; reuse retains token/prefix. Current code has no owner seam. Add the cold-reset fixture above, distinguishing mocked math from verified SDK reset.
- helpers/stream-transformer.spec.ts under agent-sdk — “uses frozen cost authority and attaches snapshot without changing footer fields”: reported zero; four-class own-ID pricing; empty preservation; latest model result replaces. Current callback lacks snapshot and branches on route per result.
- Existing history/reader/hook/callback specs below cover parity, identity and transport.

Exact files:

~~~text
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\rpc\rpc-session.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\rpc\rpc-chat.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\shared\src\lib\types\agent-adapter.types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts [CREATE]
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.spec.ts [CREATE]
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-usage-aggregator.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-stats-reader.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-stats\session-stats-reader.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-registry.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle\session-query-executor.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\session-lifecycle-manager.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\helpers\subagent-hook-handler.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\di\tokens.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\agent-sdk\src\lib\di\register.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.spec.ts
~~~

~~~sh
npx nx run-many -t test,typecheck,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime
~~~

### B — frontend component handoff

Recommended executor: frontend-developer. No shared/backend overlap with A.

**Failing specs first:**

- CREATE libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.spec.ts — “displays one backend snapshot in both layouts without message-derived totals”: cost 38.18, input 15200, output 396700, cacheRead 14388100, cacheCreation 100000, tokenCount 14900000, agentSessionCount 9, matching rows ->14.9M, both cache columns, cost 38.18. Current component cannot accept this input and omits cache creation from chip/cache columns from rows. Include null, zero, absent snapshot and absent optional aggregate with no fallback.
- libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts — “installs snapshots 10 then 15 without addition for tabs and surfaces”: expected 15 after duplicate; older revision 10 cannot regress; footer fields unchanged. Current paths add values.
- libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts — “binds stored snapshot and independent live context badge”: same values as chat, no copied table or accumulation.
- libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.spec.ts — “labels five completed background entries as five background”: expect “5 background · 5 done” with chip count 9; mixed entries get explicit population labels. Current label says agents.
- Listed loader/compaction/card/state specs verify assignment and retention without message/tree reconstruction.

Exact files:

~~~text
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.spec.ts [CREATE]
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\background-agent-strip.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-ui\src\lib\molecules\background-agent-strip.component.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-types\src\lib\chat-types.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\tab-manager.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\tab-manager.intent-mutators.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\surface-session-stats.registry.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat-state\src\lib\surface-session-stats.registry.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\templates\chat-view.component.html
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\organisms\background-agent-tray.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\components\organisms\background-agent-tray.component.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat.store.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\chat\src\lib\services\chat-store\compaction-lifecycle.service.spec.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.ts
D:\projects\ptah-extension\.claude-worktrees\session-stats-disagreement\libs\frontend\harness-builder\src\lib\components\harness-builder-view.component.spec.ts
~~~

~~~sh
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-ui,@ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat,@ptah-extension/harness-builder
~~~

Project names are verified in project.json. This handoff lists 49 files including focused specs, versus roughly 87 rejected previously. One new production service. No workspace-wide verification.

## Deferred

| Excluded work | Owner |
| --- | --- |
| Persistent checkpoint, durable accounting/recovery schema | NEW future persistence task if requested; not TASK_2026_533. |
| Delta ledger and Codex-proxy normalization | TASK_2026_418_a91c; frontend session addition is superseded here. |
| Capacity precedence and compaction-context correctness | TASK_2026_418_a91c. |
| Multi-writer JSONL/live overlap watermarks | NEW follow-up if required; coordinate scopes with TASK_2026_418. |
| Public sessions-list range/current-context redesign | TASK_2026_411 stats-list scope work, coordinated with TASK_2026_418; existing selection retained here. |
| Dashboard changes beyond demonstrated compile adjustment | NEW dashboard follow-up. |
| Pricing recovery/repricing accepted live contributions | NEW pricing-recovery task; TASK_2026_475 retains lookup correctness. |
| Spawned CLI tile telemetry | TASK_2026_513_a7c2. |

## Risks

- SDK reset/cumulative coverage require the stated boundary fixture. Source comments conflict; a fresh token is not numerical proof. There is no TASK_2026_418 prerequisite.
- Cold read is not atomic across files. Launch-after-read prevents this owner's self-overlap; external/orphan writers remain excluded.
- JSONL costs use current rate estimates; live reported cost can differ after restart. No persisted checkpoint/repricing guarantee.
- Revision ordering is one owner lifetime only. Establish/reset the frontend attachment seam; do not invent a persistent epoch protocol.
- Completed run snapshots consume memory proportional to run count. Release only inactive owners; never evict prefix while retaining a subset of its runs.
- Optional additive DTO fields limit compile impact but require producer assertions for complete new snapshots. Old data displays unavailable, without frontend math.
- Compile may reveal a mutable-array or removed surface-field consumer. Report concrete evidence before expanding scope; no wholesale DTO/dashboard migration.
