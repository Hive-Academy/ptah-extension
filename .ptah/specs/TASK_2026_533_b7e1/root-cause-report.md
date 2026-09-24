## Summary

- **COST:** message-derived totals become unknown when any agent node lacks a cost, independently of the priced model table; **confirmed mechanism, likely explanation of this session**. A matching history response with all rows priced does not produce this mismatch.
- **TOKENS:** the chip adds input, cache reads and output, while the table adds only input and output; the chip also omits cache creation from its supposedly total count; **confirmed**. Live message totals and resumed history totals additionally have different aggregation scopes.
- **Cache columns:** live transport drops per-model cache creation, replay drops both per-model cache classes, and both table layouts render only uncached input/output despite displaying costs that include cache usage; **confirmed**.
- **AGENTS:** the chip counts every agent-node occurrence (or loaded agent files), whereas the strip counts deduplicated active foreground agents plus retained background agents; **confirmed population mismatch, likely explanation of 9 versus 5**. Duplicate reconciliation is not established for the reported session.

Investigation is read-only except this report. Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/session-stats-disagreement`. Evidence is from this checkout, inspected 2026-09-23. Related task/context files were read first; TASK_2026_475_e4b7 has no context.md in this checkout. `ptah_search_files` returned no AGENTS.md; native targeted reads/searches were used for implementation bodies. No source/spec files or git history were changed, and no test suite was run. An in-memory Node/TypeScript probe executed the actual two shared utility modules without writing generated files; results are identified below. No live-session event trace was supplied or inspected.

## Defect 1 — COST

### Code path

1. **Live producer:** `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:435` handles SDK result messages. Direct Anthropic rows use `usage.costUSD` at line 458 and the aggregate uses `sdkMessage.total_cost_usd` at line 538. Proxy rows are repriced using input/output/cache read/cache creation at line 465; the aggregate is null if there are no rows or any row is unpriced, otherwise their sum (lines 539–550). Result emission carries `cost`, four token fields and `modelUsage` at line 573. Thus all-priced proxy rows cannot themselves generate a null aggregate in that same result.
2. **Transport:** `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1324` forwards the result callback unchanged. `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:135` registers the callback; line 403 broadcasts `MESSAGE_TYPES.SESSION_STATS` with cost/tokens/modelUsage. Its shared contract is `libs/shared/src/lib/types/agent-adapter.types.ts:29`; the event name is `libs/shared/src/lib/types/messages/message-constants.ts:132`. `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:563` passes the payload to ChatStore, whose line 511 in `services/chat.store.ts` delegates to the stats aggregator.
3. **Two frontend destinations:** `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:97` installs the model list via line 115 or 123. `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2018` writes it to the tab. The aggregator separately accumulates an existing `preloadedStats` at line 135, then delegates message stats at line 156. It does not create preloaded totals for a fresh session.
4. **Message cost:** `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:597` stores pending stats when streaming; `message-finalization.service.ts:160` takes their cost and line 236 puts it on the last new assistant message. When already finalized, `streaming-handler.service.ts:638` replaces the last assistant message's tokens/cost/duration. The empty-tree pending-stats path also replaces those fields on the last assistant (`message-finalization.service.ts:194`).
5. **Agent cost:** `libs/frontend/chat-execution-tree/src/lib/agent-stats.service.ts:84` scans child events by `parentToolUseId`. Only truthy `complete.cost` contributes (line 97); zero or absent aggregate becomes `undefined` at line 120. `builders/agent-node.fn.ts:111` obtains those stats and spreads them into the agent node at line 127; placeholder agents do the same in `builders/tool-node.fn.ts:391` and line 412.
6. **Panel bindings:** `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:753` selects the tab's preloaded stats, and line 767 selects its model list. The template binds messages and both inputs at `chat-view.component.html:27`. The other selector use is `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:403`, which explicitly binds surface totals and empty messages; it is a different input path.
7. **Chip nullification:** `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:757` uses preloaded stats if present; otherwise it calls `calculateSessionCostSummary`. In `libs/shared/src/lib/utils/subagent-cost.utils.ts:110`, missing agent cost becomes null. A null message cost (line 188) or any null agent cost (line 201) sets `hasUnknownCost`; line 208 then returns null even if the message cost already contains the billed session/turn total. The chip binds that result at component lines 117 and 344. `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:64` rejects non-finite/non-number values and its line 43 renders “cost unavailable”.
8. **Independent table:** `session-stats-summary.component.ts:743` sums known model-row costs, independently of messages, agents and preloaded cost. Rows render at line 507 and the total at line 526. It even permits a partial known sum when other rows are null; a priced table total alone is not a coverage guarantee.
9. **Replay alternative:** `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:252` calls `aggregateUsageStats`; lines 1092–1097 sum the same priced model rows into `totalCost`. `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:60` returns this history to `chat-session.service.ts:805`; that service extracts stats at line 829 and returns them at line 943. The RPC shape is `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:260`. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:862` applies the snapshot and line 863 applies its model list; `tab-manager.service.ts:2069` installs `preloadedStats`. The panel prefers this snapshot, so unknown agent nodes do not poison a freshly loaded, fully priced snapshot.

### Root cause

The chip's message summary treats missing *per-agent attribution* as missing *aggregate accounting*, although it sums message costs and does not add agent costs. A priced parent total can therefore be discarded merely because a child has no detailed telemetry. A legitimate child cost of zero also becomes undefined in AgentStatsService, then null in the breakdown. `aggregateAgentStats` does **not** calculate the agent count.

The existing `libs/shared/src/lib/utils/subagent-cost.utils.spec.ts:353` explicitly pins this nullifying behavior with a priced message and one unpriced agent. By contrast, `calculateSessionTotals` at `libs/shared/src/lib/utils/session-totals.utils.ts:65` sums top-level known message costs and ignores the tree; the stats panel does not call it. These are different policies, not successive stages of one calculation.

The reported 25m 2s is useful evidence: this component's preloaded branch hardcodes duration to zero (`session-stats-summary.component.ts:763`). If that duration came from this exact panel, it strongly indicates the message-derived branch was active. That makes missing agent attribution a stronger explanation than a null replay snapshot. The actual offending message/agent cannot be identified from the symptom alone.

**Later payloads:** replacement is possible, but not demonstrated for this incident. A later accepted null-cost result replaces the last assistant's cost at `streaming-handler.service.ts:642`, while an omitted model list leaves the previous table intact because the aggregator only changes it for a nonempty list. With preloaded stats, either an earlier null or a new null makes the accumulated cost null permanently until a new snapshot replaces it (`session-stats-aggregator.service.ts:137`). A completely empty SDK result is already suppressed at `stream-transformer.ts:566`; do not re-report TASK_2026_474's old empty-resume defect as unfixed here. Compaction can snapshot an already-null message summary (`compaction-lifecycle.service.ts:556`) and then request history reload (line 611). A coherent fully priced history reload should restore a numeric total; compaction is not inherently a producer of null. Background-only finalization has a replacement path at `message-finalization.service.ts:194`, but no evidence identifies it as the trigger in this session.

### Live vs resume

Directly reproducible in fresh/live message-derived panels, including retained finalized agent trees. A pure coherent resume with all model rows priced does not reproduce this COST discrepancy. Resumed/compacted sessions can acquire it from a later null result, a poisoned preloaded snapshot, or independently updated inputs. Cumulative model costs being consumed as additive turn costs is a separate scope issue already owned by TASK_2026_418; this report does not infer that it caused null.

### Owning task

**NEW — TASK_2026_533_b7e1:** aggregate cost nullified by missing/zero agent attribution and disagreement between panel authorities. Extend/coordinate **TASK_2026_474_5c9f** for late-payload and unknown-cost coverage regressions, preserving its intentional unknown-cost semantics. Coordinate cumulative-versus-turn authority with **TASK_2026_418_a91c**. This is not evidence of **TASK_2026_475_e4b7** substring mispricing or **TASK_2026_513_a7c2** CLI tile contamination.

### Proposed fix direction

Establish an explicit, same-scope aggregate cost authority and coverage marker. When a parent aggregate is known to cover its agents, missing child attribution must affect the breakdown's completeness rather than erase that aggregate; known zero must survive AgentStatsService. Use the per-model total as an authority only when its scope and completeness match the chip. Preserve genuinely unknown contributions instead of indiscriminately falling back to any numeric table sum, and keep the existing empty-result guard. Resolve cumulative/delta behavior with TASK_2026_418 before changing accumulation.

### Reproduction spec shape

- Component fixture: required `messages` contains one assistant with `cost: 38.18`, `duration: 1502000`, nonzero tokens and a message execution tree containing one `type: 'agent'` node with no cost. Set `preloadedStats: null`; set three model rows with costs `37.17`, `0.99`, `0.02` and valid model/context fields. Actual: `summary().totalCost === null`, badge “cost unavailable”, `totalModelCost()` approximately 38.18. Expected for an aggregate explicitly covering the children: chip 38.18 with incomplete child attribution identified separately. Removing the agent makes the cost numeric; setting its cost to zero directly also avoids null, while zero through AgentStatsService becomes undefined.
- Shared-utility probe **executed** with that shape: `calculateSessionCostSummary` returned null; `calculateSessionTotals` returned 38.18. Extend `libs/shared/src/lib/utils/subagent-cost.utils.spec.ts` (revise the scope assumption in its line-353 test) and `libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts` with a zero-cost completion. Preserve unknown-only behavior in `libs/shared/src/lib/utils/session-totals.utils.spec.ts`.
- Payload sequence spec: populated preloaded cost/table; next result has `cost: null`, nonzero tokens and no modelUsage. Actual: preload becomes null and table persists. Then send a priced result: preload remains null. Expected depends on explicit coverage, not automatic replacement with the old table. Extend `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.spec.ts` and `libs/frontend/chat-streaming/src/lib/streaming-handler.service.spec.ts` to distinguish legitimate unknown coverage from stale/empty replacements.
- No `session-stats-summary.component.spec.ts` exists beside this component, and no existing frontend spec referencing its class was found. The component-level rendering regression needs that new adjacent spec; no spec was written here.

## Defect 2 — TOKENS

### Code path

1. Live result tokens come directly from SDK `usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens` in `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:553`. Lines 569–571 explicitly distinguish these per-turn values from cumulative model rows. The transport/message path is Defect 1 steps 2–4.
2. `libs/shared/src/lib/utils/subagent-cost.utils.ts:182` sums all four fields from **top-level message.tokens only**. It traverses trees for agent attribution/count (line 197), not to add their token usage. `calculateTotalTreeTokens` at line 77 separately recurses through all descendants and all four fields; the panel does not call it.
3. Replay sums main-message usage after the last compact boundary (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:978`) and **all loaded agent-session usage** (line 1039), carrying all four fields at line 1114. Thus replay explicitly includes subagents, whereas live panel inclusion is whatever the upstream aggregate in message.tokens covers; there is no renderer-side subagent token roll-up.
4. Preloaded stats win unchanged in `session-stats-summary.component.ts:759`. The TOKENS chip's `totalTokenCount` at line 782 adds **input + cacheRead + output**, omitting cacheCreation. Its tooltip nevertheless lists cache creation at line 797 and prints the incomplete total at line 800.
5. The table totals use only `inputTokens` and `outputTokens` at component lines 721 and 728. Those are separate cumulative per-model fields in live results (`stream-transformer.ts:500`), and separate replay counters (`session-history-reader.service.ts:1079`).

### Root cause

14.8M and approximately 412k need not represent duplicated usage: cache reads alone can explain that magnitude gap. However, neither presentation is an honest *all-token total*: the chip omits cache writes, and the table omits both cache classes. The IN/OUT values are honest measurements of their named fields if IN is explicitly labeled uncached input; they are not the full cost-bearing usage. Add all four disjoint normalized classes for a total, retain the breakdown, and distinguish repeated cached processing across turns from current context size.

`calculateSessionTotals` only provides input/output counters (`session-totals.utils.ts:67`); substituting it would discard cache detail rather than resolve the defect. Scope also matters: summing tree tokens into an aggregate that already covers subagents would double-count. The code confirms different live/replay collection paths, not the exact SDK coverage of the reported 14.8M.

### Live vs resume

Cache-creation omission and table/chip class mismatch occur in both branches. Main-versus-tree and post-compaction-versus-session scope differences can change the count when resuming; they are not necessary to reproduce the omitted-cache defect.

### Owning task

Extend **TASK_2026_418_a91c** for shared accounting scope and live/replay parity. **NEW — TASK_2026_533_b7e1** owns the local chip formula/label regression; coordinate it with that scope work. Do not duplicate TASK_2026_474's already-removed cumulative-model-to-turn-token fallback.

### Proposed fix direction

Use one documented scope and four-class token contract for the chip and model breakdown. Include cache creation in the all-token total and make tooltips reconcile arithmetically. Keep model-cumulative snapshots separate from turn deltas, and do not add execution-tree totals until upstream subagent coverage is established. Align replay's compaction boundary policy with TASK_2026_418.

### Reproduction spec shape

- For a minimal component fixture use one message with `{input: 10, output: 20, cacheRead: 100, cacheCreation: 40}`, numeric cost and no agents; the preloaded variant puts those fields in `preloadedStats.tokens`. Actual chip: 130; tooltip lists all four values but total 130. Expected all-token count: 170. Two model rows totaling input 10/output 20/cacheRead 100 let the existing table render: its IN+OUT is 30.
- Magnitude probe **executed**: `{input: 15200, output: 396700, cacheRead: 14388100, cacheCreation: 100000}` yields chip formula 14,800,000, IN+OUT 411,900 and four-class total 14,900,000. This is a synthetic explanatory fixture, not recovered session telemetry.
- Shared-utils fixture: a parent message with those tokens and a child carrying `{input:20, output:30, cacheRead:40, cacheCreation:50}`. Actual summary remains the parent's totals; `calculateTotalTreeTokens` on the tree returns the child totals. Both results were verified. Pin scope deliberately in `libs/shared/src/lib/utils/subagent-cost.utils.spec.ts`; keep the intentionally narrower contract explicit in `session-totals.utils.spec.ts`.
- Extend `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` with pre-boundary/post-boundary main messages and one agent file, proving the current replay population before changing scope. Use the new adjacent component spec described in Defect 1 for both preload/message chip branches.

## Defect 3 — Cache columns

### Code path

1. Normalization preserves distinct uncached input, output, cache read and cache creation: `libs/backend/agent-sdk/src/lib/helpers/usage-extraction.utils.ts:46`.
2. Proxy pricing explicitly consumes cache read/creation at `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:471`. Shared pricing adds input + output + cache-read cost + cache-creation cost at `libs/shared/src/lib/utils/pricing.utils.ts:339`. Direct Anthropic takes the SDK-provided row cost instead (`stream-transformer.ts:458`).
3. Live per-model output retains `cacheReadInputTokens` at `stream-transformer.ts:506` but never emits `cacheCreationInputTokens`. Both `ResultModelUsage` at line 88 and shared `ResultStatsPayload` at `libs/shared/src/lib/types/agent-adapter.types.ts:39` lack that creation field.
4. Replay `accumulatePerModel` receives both caches and prices them (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:943`, line 961), but its stored counters only retain input/output/cost (line 920). Emitted rows at line 1077 therefore lose both per-model cache counters. The resume RPC row contract likewise lacks them (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:284`).
5. The component row interface only exposes optional cache reads (`session-stats-summary.component.ts:35`). Neither compact table rows (line 231 onward) nor expanded rows (line 486 onward) display cache counters. Expanded IN/OUT/cost render at lines 499, 504 and 507; totals at lines 518, 521 and 526 independently omit cache counts.

### Root cause

Cost-bearing cache usage is hidden and partly discarded before rendering. The displayed “992 input” is uncached input, not all tokens used to calculate $37.17. Also, the Opus row has 360.4k output tokens: it is incorrect to attribute that entire price to 992 input or infer a wrong price solely from those numbers. This checkout establishes the missing explanatory dimensions; it does not establish the actual rate/cache breakdown of $37.17.

### Live vs resume

Both. Live already carries per-model cache reads, but omits them from the table and discards creation. Replay loses both caches per model even though aggregate preloaded stats preserve them.

### Owning task

**NEW — TASK_2026_533_b7e1** for end-to-end cache counters and table presentation, coordinated with **TASK_2026_418_a91c** for scope. **TASK_2026_475_e4b7** is relevant only if separate evidence shows incorrect model/rate resolution; this presentation defect does not prove such a pricing error.

### Proposed fix direction

Preserve per-model read/write cache counters in live and resume contracts and accumulators, then expose them in both table layouts, with a total matching the chip. Label input as uncached if it remains a separate column. Keep unknown historical counters distinguishable from real zeros, and keep cost coverage separate from token coverage. Showing cache reads alone would leave cache-creation spend unexplained.

### Reproduction spec shape

- Component input: at least two model rows (the table is enabled only for two or more at component line 705); Opus `{inputTokens:992, outputTokens:360400, cacheReadInputTokens:10000000, costUSD:37.17, contextWindow:1000000}` plus a second priced row. Actual: row shows 992/360.4k/$37.17 without cache reads anywhere in the row. Expected: those 10M cache reads are visible/attributable, with creation shown when known. Use the new component spec and cover both layouts.
- Extend `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`: an SDK modelUsage entry with read and creation counters, valid result usage and known pricing. Actual emitted row preserves read but has no creation; expected wire round-trip preserves both.
- Extend `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`: a priced assistant usage record with nonzero input/output/read/creation. Actual aggregate stats preserve all four, but `modelUsageList` has only input/output/cost; expected per-model counters also survive. These fixtures should use explicit synthetic pricing, not assume the reported Opus price is reproducible from public default rates.

## Defect 4 — AGENTS

### Code path

1. Live chip: `calculateSessionCostSummary` calls `countAgents` on every message tree at `libs/shared/src/lib/utils/subagent-cost.utils.ts:200`. `countAgents` increments once for every `node.type === 'agent'` and recursively visits children (line 146). No status filter or session-wide identity Set exists. `session-stats-summary.component.ts:767` takes that result and line 378 renders it (collapsed counterpart line 139).
2. Agent nodes are constructed from dispatch/hook data, with stable ID `agent:${toolCallId}` (`libs/frontend/chat-execution-tree/src/lib/builders/agent-node.fn.ts:86`) and `type: 'agent'` at line 118. Placeholder agents have the same ID strategy (`builders/tool-node.fn.ts:366`). Dispatch detection uses `isTaskTool`, a known dispatch name, or a subagent-type input (`builders/tool-node.fn.ts:57`). The known names are defined at `libs/shared/src/lib/type-guards/guards/exec.ts:276`; this is not a count of all tool-use nodes or of the CLI process registry. CLI spawn tools contribute only if represented as agent nodes through those paths.
3. Replay chip: `session-stats-summary.component.ts:764` instead reads `preloaded.agentSessionCount`. That is `agentSessions.length` in `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1123`: the number of successfully loaded qualifying agent JSONL files. `helpers/history/jsonl-reader.service.ts:802` searches the parent's subagents directory; line 819 falls back to legacy files only when no nested paths exist, and line 856 accepts matching parent files. This is a file population, not a deduplicated UI identity count.
4. Strip input: `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.ts:210` builds a Map keyed by parentToolUseId/toolCallId. It excludes completed/error/stopped foreground records at line 216 because `isActiveSubagent` only admits running/pending/paused (line 240). It then adds **all retained background records** at line 222, overriding matching keys. Entries are the Map's values at line 235.
5. Strip display: `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:486` takes entries, counts each status, prints list.length at line 488 and completed count at line 491. Exactly five completed entries therefore prints “5 agents · 5 done”.
6. Scope is also different on the main panel: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:389` passes null scope there (all sessions), but the owning session in a canvas tile. The tray applies that filter at lines 217 and 223. Reconciliation itself deletes the former key before installing the real ID (`libs/frontend/chat-streaming/src/lib/background-agent.store.ts:293`); the tray further deduplicates by unchanged toolCallId. This code does not establish a reconciliation duplication bug.

### Root cause

The same word “agents” labels different populations. Nine historical agent nodes, of which four completed in the foreground and five remain as completed background records, produces 9 versus 5 without any duplicates. This is a sufficient, plausible explanation, not a recovered inventory of the user's session. Node-occurrence counting can also overcount repeated identities across trees/messages; the absence of deduplication is confirmed, but whether it happened here is unknown. `AgentStatsService.aggregateAgentStats` supplies model/tokens/cost/duration, not either displayed count (`agent-stats.service.ts:63`).

### Live vs resume

Both can disagree, for different chip sources: tree occurrences live; qualifying agent files on resume; filtered/deduplicated store entries in the strip. Existing preloaded agentSessionCount is merely spread through live stats accumulation (`session-stats-aggregator.service.ts:142`), so subsequent agent launches do not update that count through SESSION_STATS.

### Owning task

**NEW — TASK_2026_533_b7e1** for identity/status/surface-scope agreement. Coordinate shared session-scope policy with **TASK_2026_418_a91c**. Do not assign this to **TASK_2026_513_a7c2** without evidence that spawned CLI process records are actually entering this panel.

### Proposed fix direction

Give both views the same session-scoped set of agent identities and a consistent completed-agent retention policy, as this task's acceptance criterion requires. Reconcile tool-call and real-agent IDs before counting; retain status as a separate dimension. Replace the loaded file count as a display authority with identities, or explicitly map it into the same identity set. Do not force agreement by arbitrarily decrementing the chip or retaining a count computed before new agents started.

### Reproduction spec shape

- Minimal paired fixture: one assistant tree with nine distinct completed agent nodes, all known-cost; monitor store has those nine completed foreground records, and background store has five completed records for five of the same tool-call IDs, all in one session. Actual summary chip: 9; tray strips all completed foreground records, retains five background entries, and strip prints “5 agents · 5 done”. Expected under the requested all-session-identity policy: both count nine and the completed status count is nine.
- Identity variant: nine agent-node occurrences using only five toolCallIds across messages; tray Map has five keys. Actual chip 9, strip 5; expected unique-identity count 5. The shared utility probe **executed** and returned 9 for this synthetic duplicate-identity shape; it does not show that a real reconciler emitted duplicates.
- Resume variant: messages may be empty, `preloadedStats` has nonzero tokens and `agentSessionCount:9`, while the strip has five completed entries; actual chip still 9. An aggregator update spawning more agents leaves the preloaded count unchanged unless another path replaces it.
- Extend `libs/shared/src/lib/utils/subagent-cost.utils.spec.ts` for identity counting; `libs/frontend/chat/src/lib/components/organisms/background-agent-tray.component.spec.ts` for completed foreground/background membership; `background-agent-tray.scope.spec.ts` beside it for session filtering; `libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.spec.ts` for the exact label. Extend `libs/frontend/chat-streaming/src/lib/background-agent.store.spec.ts` with reconciliation cardinality as a control, and `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` for file-count versus identity behavior. The new summary component spec covers both chip branches.

## Open questions

- Which exact message or agent lacked cost in the reported session, and was there a later null result? The smallest decisive capture is the panel's messages/preloadedStats/modelUsageList plus ordered SESSION_STATS and compaction/resume payloads for that session. The duration strongly favors the message-derived branch but cannot substitute for that capture.
- Which agent identities make up the reported nine and five, and was this the global main panel or a session-scoped tile? Capture tree toolCallIds/agentIds and the two stores' records/statuses/session IDs. Code demonstrates population differences, not the incident's identity inventory.
- What scopes did that installed provider/SDK actually include in its aggregate usage and cumulative modelUsage, especially for background subagents? The renderer forwards the aggregate; it cannot prove upstream coverage. Compare a sanitized main-plus-one-subagent trace before choosing a tree roll-up or asserting exact live/replay equality.
- What were the unrounded cache counters and rates underlying $37.17/$38.18? The code proves cache omission, but the screenshot does not establish a numerical pricing error or cache-only attribution of the full amount.
