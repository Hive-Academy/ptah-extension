# Batch A1-1 report: turn utils + chat-ui formatter export

Executor: frontend-developer (Claude). Worktree: `D:\projects\ptah-extension\.claude-worktrees\clean-session-view`.
Status: implemented. The team-leader runs the nx checks on the combined tree (decisions.md row 59).

## Files

- CREATED `libs/frontend/chat/src/lib/utils/turn-facts.utils.ts`: `COMPACTION_CONTINUATION_PREFIX`,
  `isCompactionContinuationMessage`, `TurnMessageMetrics`, `TurnContext`, `buildTurnContexts`,
  `turnElapsedLabel` (uses `formatAgentDuration` from `@ptah-extension/chat-ui`, M-6), `summarizeTurnMetrics`
  (+ `TurnElapsedLabel`, `TurnMetricTotal`, `TurnTokenTotal`, `TurnMetricsSummary`).
- CREATED `libs/frontend/chat/src/lib/utils/turn-answer-split.utils.ts`: `splitTurnMessage` (WeakMap memo by root
  identity and option set), `rootHasActivity`, `TurnMessageSplit`, `TurnMessageSplitOptions`.
- MODIFIED `libs/frontend/chat-ui/src/lib/atoms/token-badge.component.ts`: new exported pure `formatTokenCount(count)`;
  the badge's `formatTokens()` now returns `${formatTokenCount(total)} tokens`, the same text as before.
- MODIFIED `libs/frontend/chat-ui/src/index.ts`: appended one export (`formatTokenCount`) and a 3-line comment after the
  C-1 lines. No existing line touched.
- NOT MODIFIED `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts`: see Deviations 1.

No chat barrel touched. The utils are not exported from any barrel; A1-2/A1-3 import them by relative path inside
`@ptah-extension/chat`. No spec added or changed.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| 1 | `formatTokenCount` returns the unit-less compact number (`950`, `1.2k`, `1.2M`); the badge appends ` tokens` | (a) unit-less [chosen]; (b) return `1.2k tokens` like the badge body | design-spec §3.11 renders `18.2k in · 3.1k out`, which (b) cannot produce; badge text is unchanged either way | yes |
| 2 | Consecutive user messages open ONE turn; `S` = first finite timestamp among its non-continuation user messages; a continuation still ends the previous turn but never sets `S` | (a) group [chosen]; (b) every user message opens its own turn | plan A1:61 "first qualifying user timestamp" implies several candidates; spec §3.9 row S; for the common `[user][assistant...]` shape both give the same result | yes (one function, `draftTurns`) |
| 3 | `TurnContext.hasActivity` = any assistant message of the turn has a non-text top-level child, using the same predicate as `splitTurnMessage` (`rootHasActivity`) | (a) same predicate [chosen]; (b) tool/agent only | the disclosure row must exist whenever a message has log content (§3.1 "hidden when the log is empty"); one definition for row and log | yes |
| 4 | `splitTurnMessage`: a root without non-text children is all answer (`hasActivity=false`) even while streaming; with activity, the answer split applies only for `isLastAssistant && !streaming`, otherwise all log | plan A1:74-78 order of rules | spec §3.1 row 3 (reply without tool calls: no log, answer shown) | yes |
| 5 | `peek`: tool -> `toolName`; agent -> `agentDescription`, then `agentType`; thinking -> `Extended Thinking`; text/system -> first non-empty line of `content` | plan names text/tool/agent only | §3.8 "text of the newest log row"; `Extended Thinking` is the thinking row's visible label (`chat-ui/.../thinking-block.component.ts:57`) | yes |
| 6 | Per-message metrics memoized in a `WeakMap` keyed by message object | none / memo [chosen] | `buildTurnContexts` re-runs on every message-list change and `extractMessageSummary` walks every tree; messages are immutable | yes |
| 7 | `TurnContext.index` is 0-based (`Message {index + 1} of {count}`) | 0- / 1-based | plan gives no base | yes |

## Deviations

1. **`formatCostUsd` not created; `cost-badge.component.ts` not modified.** Plan A1:171 cites the cost-badge text at
   `:39`/`:70+`; that is stale. The badge already delegates its text to the shared `formatUsdCost` from
   `@ptah-extension/shared` (`libs/shared/src/lib/utils/usage-format.utils.ts:2`, used at `cost-badge.component.ts:7,41,78`).
   A second `formatCostUsd` in chat-ui would duplicate it. A1-2/A1-3 should import `formatUsdCost` from
   `@ptah-extension/shared` (it returns `string | null`; `null` only for a non-finite cost). The chat-ui barrel
   comment says so. Acceptance "formatters exported" holds: tokens from `@ptah-extension/chat-ui`, cost from
   `@ptah-extension/shared` (reachable by `chat`, `scope:shared`).
2. **Bubble not switched to the new constant.** Plan A1:57-58 says the bubble should import the moved
   compaction literal. `message-bubble.component.ts` is not in this batch's file list, so the literal still sits at
   `message-bubble.component.ts:239-241`. Whoever owns the bubble (A1-3) should replace its `isCompactionContinuation`
   body with `isCompactionContinuationMessage(this.message())` from `../../utils/turn-facts.utils`.
3. `turnElapsedLabel` returns `{ text, live }` as planned. `summarizeTurnMetrics` returns
   `{ messageCount, tokens | null, cost | null, toolCount, filesChanged }`, each with a `knownCount`. `tokens`/`cost`
   are `null` when no message knows them.

## Notes for later batches

- `filesChanged` in the summary is a sum of per-message unique-file counts (the plan says "sums"), so a file edited in
  two messages of one turn counts twice. Today the transcript shows one assistant message per user prompt (§3.11), so
  the effect is limited to multi-message turns.
- `hasActivity` and the metrics read `message.streamingState`. If the live message's tree is not on
  `vm().messages[i].streamingState` while streaming, the live turn reads `hasActivity=false` until finalization.
  A1-3 should confirm the live tree source it binds.
- No `TurnAgentChip` type and no `providerId` field were added (plan §6.3).

## Verification

- `ptah_get_diagnostics` with `files` = the 4 changed files: **no diagnostics in the requested files**
  (typescript-compiler, coverage clean). The same run listed pre-existing type errors in sibling spec files I did
  not touch (e.g. `chat-ui/.../streaming-quotes.component.spec.ts:22`, `chat/.../send-message-chip.component.spec.ts:6`).
  None is in a file of this batch.
- nx test/typecheck/lint: not run, per decisions.md row 59. The team-leader runs them after the wave. Existing
  token/cost badge specs should stay green: the badge text is unchanged and cost-badge was not touched.
