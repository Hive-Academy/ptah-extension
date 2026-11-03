# Code Logic Review - Batch 5 (cost labels, R1 once-per-turn guard)

Score: 8/10. Verdict: APPROVE. Blocking 0, Serious 0, Moderate 2, Minor 2.
Read-only review; no tests, builds or lint were run (a verify was in progress).

## Scope read
costBasisLabel and CostBadge (`libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts`), session-stats-summary ts/html, `session-stats-view.ts`, the aggregator spec, `codex-chat-turn-stream.ts` and the lifecycle spec.

## Five logic questions
1. Silent failure: none new. `costBasisLabel` (cost-badge.component.ts:10-18) returns null for any non-finite or missing cost, so a basis can never label an unavailable cost. For `unknown`, `reported` and `undefined` it returns null, so legacy and Claude snapshots render exactly as before.
2. Unexpected user action: expanding and collapsing the stats chip both pass `[costBasis]` (html:103, :315), so the two layouts stay consistent.
3. Wrong-answer input: a provisional snapshot with `costBasis: 'estimated'` shows both the "~" marker and the "estimated" text. This is redundant but not wrong. The spec at `session-stats-summary.component.spec.ts` pins that the two markers stay separate.
4. Dependency failure: in `publishStats` (`codex-chat-turn-stream.ts:192-193`) the claim happens before any work. If `recordTurnPrice` or `usageOwner.snapshot` throws, the turn is marked published and no later path (drain) can retry. The previous code could in principle have recovered through the second call. That is a weak recovery path, so I rate it Moderate.
5. Missing: no spec covers the real `publishStats` ordering (in-turn path first, then drain). The new spec reimplements the guard around a local `emit` closure (lifecycle.spec.ts:227-247). It proves the helper but not the wiring.

## Findings
- Moderate, `codex-chat-turn-stream.ts:193` and `lifecycle.spec.ts:227`: the claim-before-work guard makes the first caller win. When the in-turn `finally { publishStats(result) }` (about line 335) runs before a terminal event carrying usage, the drain's later, fuller result (about lines 406 and 593) is dropped. `markMissingEvidence` would then have been called with stale `turnUsageObserved`. Confirm that the terminal event is always observed before the `finally` runs. Otherwise claim only after the price is recorded, or release the claim on throw.
- Moderate, `lifecycle.spec.ts:227-247`: the test does not exercise `streamCodexChatTurn`. It is tautological with respect to the wiring, because deleting line 193 would not fail it. Add a test that drives the in-turn and drain terminals through the real stream.
- Keying is correct. The Set is created per `streamCodexChatTurn` invocation (line 191) and keyed by `receipt.turnId`. A new or resumed turn gets a new closure and a new Set, so it still publishes. The drain receives the same `publishStats` closure through `drainUsage` (line 293), so the guard is shared across the in-turn and detached paths.
- Minor, `session-stats-view.ts` compact aria-label: for a provisional estimated cost it reads "Cost estimated 0.50 US dollars, estimated". The wording is duplicated.
- Minor, `session-stats-view.ts costDetailsText`: the basis is emitted as a bare lowercase word ("estimated") as its own tooltip paragraph. A sentence such as "Estimated cost, not a charge" would better meet the "never call an estimate an actual charge" requirement. Display text only.

## Angular and requirements checks
- OnPush, `input()`, `computed` and template control flow are used. There is no innerHTML. There is no Codex-specific branch in the UI; the labels are provider-neutral.
- Null cost with any basis: unavailable, tested in cost-badge, summary and aggregator specs.
- Old producers without `costBasis`: the aggregator spec asserts the legacy snapshot is passed through without the property.
- The aggregator spec is pass-through only. That is acceptable, since the aggregator needs no change.

## Verdict
APPROVE. The Moderate items can be addressed in a follow-up or before the PR.

## Round 2

Score: 8.5/10. Verdict: APPROVE. Blocking 0, Serious 0, Moderate 0, Minor 2. Read-only; nothing was run.

Moderate items from round 1:
- Claim-before-work and first-caller-wins: resolved. `recordTurnPriceOnce` (`codex-chat-turn-stream.ts:115-124`) adds the turn id only after `record()` returns, so a throw leaves the turn retryable. `publishStats` no longer returns early, so a later fuller payload still refreshes stats. Pricing waits for `turnTerminalObserved && turnUsageObserved` (about line 225), so an early publish cannot price a turn from partial usage.
- Tautological spec: addressed. The lane replaced the clone with real `streamCodexChatTurn` cases plus a direct helper test for throw, retry and duplicate. I did not re-read the spec bodies in full; I rely on the lane report. The in-turn then drain sequence cannot occur in a single stream, because the in-turn terminal precludes the drain. I accept that rationale. The three `publishStats` call sites (lines 344, 415, 602) all originate from a terminal.

Regression check:
- `markMissingEvidence` now runs only after the turn's terminal is observed (`turnTerminalObserved && !turnUsageObserved`). Since every `publishStats` caller follows a terminal, this does not lose the partial-coverage marker. If a future caller publishes without a terminal, that turn would be neither priced nor marked partial, so the lifetime total would silently read as complete. Minor, and worth a comment on the invariant.
- `observeUsage` now sets the terminal flag before the `evidence` check, which is correct for terminals without evidence. It matches `threadId === session.id` and `turnId`, consistent with the guards at lines 402 and 593.
- Previously a missing-evidence turn recorded `{ totalCost: null }`. It now records nothing and relies on `markMissingEvidence` having made lifetime coverage partial. Confirm via the helper test that `lifetimePrice` returns null or partial in that case (owner line 194-198 supports it).
- UI: the tooltip copy now says the estimate is not a charge and subscription coverage is a published-rate value. The compact aria label no longer repeats "estimated". A null cost still takes the unavailable branch. No regression for snapshots without `costBasis`.
- Minor: the `'covered by subscription'` tooltip branch is keyed on the label string from `costBasisLabel`. Keying on the `SessionCostBasis` value would not break if the label text changes.
