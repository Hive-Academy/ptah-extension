# Code Logic Review — Batch 2b (TASK_2026_575_74a4)

Scope: `git diff HEAD -- libs/backend/agent-sdk` only (session-stats-owner.service.ts, its spec, stream-transformer.spec.ts). libs/frontend changes ignored (concurrent Batch 3). Read-only review; nothing modified. Tests run: `npx jest -c libs/backend/agent-sdk/jest.config.ts` over session-stats + stream-transformer.spec.ts — 5 suites passed, 194 passed, 1 skipped (pre-existing skip).

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Verdict             | APPROVE  |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 3        |
| Failure modes found | 0 new (R11 fixed; 2 residual, both minor and bounded) |

## Verification of the new rules (question 1)

`usageCostSource` is frozen per query stream (stream-transformer.ts:192-194, :358) and `isGrown`/`isSameUsage` compare only results of one run (applyResult, session-stats-owner.service.ts:736-738). So a mixed reported/unreported pair inside one run is unreachable; the `dollarsAreObserved` mixed branch (session-stats-owner.service.ts:911-913) is defensive only. Combination table:

| Combination | isGrown | isSameUsage | Result |
| ----------- | ------- | ----------- | ------ |
| reported/reported | dollars + tokens (unchanged) | dollars + tokens (unchanged) | test (e): total 10 -> 8 rejected even with token growth; same tokens at total 9 rejected (not a duplicate). Pinned. |
| unreported/unreported | tokens only (:961-985); every prev model present, every counter >= | tokens only (:923-938) | test (a): rate R1 $4 -> R2 $3 with token growth accepted, turnCost null, runCostDecreased true, snapshot tokens 300/30, duration 3000, total repriced at R2. Test (d): input 200->190 rejected; model dropped rejected; snapshot stays 4. |
| mixed | stricter dollar check | stricter dollar check | test "mixed cost sources keep the stricter dollar check": unreported $4 then reported $3 -> rejected. Defensive only (unreachable in one run). |

Freeze check: on `'unreported'`, `isGrown` can reject only on tokens. A rate drop with token growth is accepted (a, b); a rate drop with identical tokens is a `duplicate` — the snapshot stays priced at the rate in force at the latest ACCEPTED result (documented at :919-921, :953-954; pinned by (c): total stays 4, revision unchanged, duration unchanged). A row losing its pricing mid-run gives totalCost null -> accepted with unknown turnCost; the snapshot degrades to knownCost/partial, it never freezes (runContribution :838-860).

Restored base: the base enters only `resolveRunBase` (token guard :200-213 — restored only when every model's current counters >= base) and `subtractRunBase`. `isGrown`/`isSameUsage` compare cumulative values, which include the base on both sides, so base restoration cannot create a false accept or reject. Question 3 (base saved at old rates -> negative net): no. The unreported branch of `subtractRunBase` (:239-252, :270-273) stores and subtracts TOKENS, never dollars; deltas are >= 0 by the resolveRunBase guard, priced at the row's current rate. The reported branch (:253-258, :274-281) uses observed SDK dollars (rate-independent) and clamps through `nonNegativeUsd`. No other code depends on dollar monotonicity: `isGrown`/`isSameUsage` have no callers outside applyResult (grep verified); `acceptedTurnCost` (:781-799) is unchanged and handles a net decrease via null + runCostDecreased.

Failing-on-base (f1c4a365f), confirmed from the old code: (a) old isGrown dollar check rejects R2 $3 < R1 $4 -> 'accepted' assertion fails; (b) same; (c) old isSameUsage compares dollars (2 != 4, 8 != 4) -> not a duplicate, so both 'duplicate' assertions fail (the dearer case was ACCEPTED under old code). (d), (e) and the mixed test are guards that also pass on base — consistent with the batch's claim that (a),(b),(c) failed on f1c4a365f.

## The three modified tests (question 2)

All three adaptations are legitimate; assertions were not loosened.

1. Owner spec "mid-run rate change (restored base)" real-decrease test (session-stats-owner.service.spec.ts:1138-1153): old fixture had identical tokens in both results (input 1000, output 0, cacheRead 1000), differing only in dollars. Under the new tokens-only duplicate rule that is a `duplicate`, so the scenario (net cost falls across token classes) was unreachable. Growing one output token (free at both rates) makes it a genuine new turn; the original assertions stand: turnCost null, runCostDecreased true, snapshot 10.5 (= prefix 10 + net 0.5). Arithmetic checks: RATE_2 raw = 1000x0.002 + 1000x0.0005 + 1x0 = 2.5; own = 1000x0.0005 = 0.5.
2. Same describe, noise test (:1155-1167): same reason; own = 1000x(0.001-4e-10) = 1 - 4e-7, delta -4e-7 within TURN_COST_NOISE_USD 1e-6 -> turnCost 0, not flagged. Assertions unchanged.
3. Transformer end-to-end test (stream-transformer.spec.ts:3015-3096): second result grows one output token at the new rate; raw 2.502 > 2, own = 10000x0.00005 + 1x0.002 = 0.502; turnCost = 0.502 - 1.0 < 0 -> null + warning; snapshot PREFIX_COST + 0.502. The +0.002 is exactly the one new token. Assertions unchanged.

Could a legitimate new turn have identical cumulative tokens? Only a turn consuming zero tokens in every class (an interrupted or empty turn with no usage). Under the old code such a result was also a duplicate (identical dollars), so no regression. What identical-tokens-at-a-new-rate-as-duplicate loses is finding 1 below — bounded and self-healing.

## Findings

### Finding 1 (Minor): unpriced -> priced with identical tokens stays unpriced until tokens grow

- File: session-stats-owner.service.ts:923-938 (isSameUsage tokens-only), policy doc :919-921
- Scenario: turn N has an unpriced model row on an unreported run (pricing undefined -> totalCost null, coverage partial). The catalog hydrates. Turn N+1 arrives with IDENTICAL cumulative tokens but the row now priced. Outcome `duplicate`; snapshot unchanged. The session total shows the knownCost lower bound although the final usage is now fully priceable.
- Numbers: 200/10 tokens at $2 known cost, unpriced row -> totalCost null; after hydration a duplicate leaves totalCost null until any counter grows; then the whole run reprices at once (e.g. one more output token -> full total).
- Impact: display-only, labeled as a lower bound, never a wrong number, never frozen; self-heals on the next token growth. If it happens on the session's LAST result, the session ends with the partial label. The executor documented this trade-off.
- Fix (optional, not required for approval): on `duplicate`, if the new result's per-model pricing differs from run.current's, reprice run.current in place (refresh the snapshot) without publishing a turn payload — this keeps the Batch 2 r1 contract (one payload per NEW turn) while advancing the rate card. If deferred, record it next to the existing "reload prices at the current rate card" deferred item.

### Finding 2 (Minor, pre-existing): a rate INCREASE bills the repricing of earlier tokens to the current turn

- File: session-stats-owner.service.ts:787-798 (acceptedTurnCost, unchanged), :239-252 (subtractRunBase repricing)
- Scenario: unreported, no base. Turn 1 = 100/10 tokens at R1 ($2). Rate doubles. Turn 2 = 200/20 at R2 = $8 cumulative. now = 8, before = 2 -> turnCost 6, but turn 2's own spend at R2 is 4. The extra 2 is turn 1's tokens repriced at R2.
- Impact: the per-turn footer overstates after a mid-run rate rise; the sum of turn costs still telescopes with the snapshot total (2 + 6 = 8), which is the documented policy ("priced at the rate card in force at its latest accepted result"). Symmetric to the rate-drop case, where the same distortion surfaces as turnCost null + runCostDecreased instead of an overstated number. Pre-existing (acceptedTurnCost and subtractRunBase unchanged in this diff); the batch documents the policy on isGrown (:949-957).
- Fix: none in this batch. A per-turn token ledger would be needed to attribute repricing to the turn that earned it; not worth the complexity for a rate-change event.

### Finding 3 (Minor, informational): the mixed-source branch is unreachable defensive code, and if it ever becomes reachable it re-introduces the freeze

- File: session-stats-owner.service.ts:911-913, :962, :980-983; stream-transformer.ts:192-194, :358
- Scenario: `usageCostSource` is fixed per query, so `dollarsAreObserved` is always false inside one real run; the mixed branch only fires for hand-built results (the mixed spec test). If a future change ever lets the source flip mid-run, the stricter dollar check compares a rate-card dollar figure against an SDK figure and can reject every later result — the exact R11 symptom.
- Impact: none today. The branch is cheap, tested, and matches the plan's "keep the stricter check" instruction.
- Fix: none required. The existing comment (:908-909, :959) covers the intent; a future source-flip feature must revisit this.

## Five logic questions

1. Silent failure: none new. The unreported path can no longer fail silently on a rate change; a token decrease is still rejected loudly (first rejection logged once per run, :515-518). The duplicate path deliberately publishes nothing (documented; finding 1 is the bounded loss).
2. Unexpected user behaviour: a zero-token turn (no usage of any class) at a new rate publishes no footer cost where $0 would be technically right. Practically unreachable for a real conversational turn; the prior turn's footer is preserved.
3. Wrong answer from input data: none found. Non-negative deltas guaranteed by resolveRunBase (:205-211); clamps at :257, :272, :280, :864-866; unpriced rows yield null, never 0.
4. Dependency failure: pricing catalog absent -> row pricing undefined -> totalCost null -> accepted with unknown turnCost, snapshot degrades to knownCost (never frozen). Catalog hydration mid-run is now a normal accepted path (tests a, b). Stale owner / invalid / zero-usage results unchanged.
5. Missing from requirements: nothing material. The plan's four policy points (Task 2b.1 in batches.md) are each implemented and pinned by a test.

## Test quality (question 4)

The new tests assert concrete numbers, not shapes: (a) turnCosts [2,2] then null + runCostDecreased, tokens 300/30, duration 3000, total at(R2,300,30), turn 4 turnCost at(R2,100,10); (b) prefix arithmetic 10 + at(R2,...); (c) total stays 4 (the rate at the latest ACCEPTED result), revision and duration unchanged for BOTH a cheaper and a dearer reprice; (d) two distinct rejection causes; (e) same-tokens-new-total rejected on the reported path. The adaptations to the three old tests keep every original assertion. (a),(b),(c) fail on f1c4a365f by construction of the old dollar checks; (d),(e),mixed are guards that pass on base.

## Requirements fulfilment

| batches.md Task 2b.1 point | Status | Evidence |
| -------------------------- | ------ | -------- |
| (1) isGrown tokens-only for unreported | COMPLETE | :961-985; tests (a),(b),(d) |
| (2) isSameUsage tokens-only for unreported | COMPLETE | :923-938; test (c) |
| (3) snapshot repriced at latest accepted rate, policy documented | COMPLETE | :919-921, :949-957; tests (a),(b),(c) |
| (4) acceptedTurnCost unchanged (null + runCostDecreased on drop > 1e-6) | COMPLETE | :781-799 unchanged; tests (a),(b), noise test |
| (4) mixed sources keep the dollar check | COMPLETE | :911-913; mixed test |
| Task 2b.2 tests (a)-(e) + mixed | COMPLETE | spec :1171-1315; (a),(b),(c) fail on f1c4a365f |
| JSDoc updates on both functions | COMPLETE | :903-913, :941-960 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Finding 1 — a session that ends on an identical-token result right after a pricing hydration shows a labeled lower bound instead of the now-computable total, until tokens grow (or forever if the run ended).
- What a robust implementation would add: the optional duplicate-reprice of Finding 1; a guard test that a row losing its pricing mid-run yields accepted with coverage 'partial' and a non-frozen snapshot (currently reasoned from :838-860, not pinned by a test).