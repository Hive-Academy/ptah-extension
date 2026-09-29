# Test Report - TASK_2026_575_74a4 (Batch 6)

## Scope

- User request: correct per-model pricing, correct accumulated totals in the stats header (not only the last message), and regression tests that prevent recurrence.
- Criteria tested:
  - Scope decision 2 / research-addendum Q1 (live-vs-disk parity): the live owner's `totalCost`, built from cumulative `modelUsage` (unreported/self-priced route), equals the disk aggregator's `totalCost` (`aggregateLedgers`: parent + subagent transcript ledgers), for the same underlying usage and rate card.
  - Scope decision 5 / 6(d) live path: a live cumulative `modelUsage` key carrying a trailing `[1m]` tag prices at the base model's rate end to end (owner `turnCost` and session `totalCost` non-null and numerically correct).
  - Scope decision 6(e), edge case "multi-run": a resumed process (process restart with a restored `cost-state` base) bills only the NET turn against the restored base, and the resulting session total matches the disk aggregate of the combined pre-restart + post-restart ledger.
  - Scope decision 6(e), edge case "Σ turnCost == session total": summed published `turnCost` across a run's accepted results equals the live session total within the documented 1e-6/turn tolerance.
  - Scope decision 2, `recordAgent` count-only: recording a subagent identity changes `agentSessionCount` only — cost and tokens are unaffected.
  - Scope decision 6(f) / A2 (agent-stats guard): `agent-stats.service.ts` sums `message_complete.cost`, which is already PER API CALL (`assistant-message.transformer.ts:379-405` prices each message from its own `message.usage`, never a cumulative figure), so the sum across an agent's child messages is correct; a child with an unknown (`undefined`/`null`) cost is skipped without zeroing the already-known sum; when every child's cost is unknown the agent total stays `undefined`, never `$0`.
- Regressions covered: none — Batch 6 is guard-only (R10); no defect from research-report.md is newly fixed here (Defects 1-4 were fixed in Batches 1/2/2b/3/4).
- Review findings covered: A2 (batches.md line 25) confirmed by inspection and by these guard tests — `message_complete.cost` IS per-call; no production change was made to `agent-stats.service.ts` or `assistant-message.transformer.ts`.
- Deliberately not tested: CLI-lane spend (out of scope per context.md decision 3); long-context (>200K) per-call rate tiering for `[1m]` models (deferred per context.md decision 5); analytics partial-coverage UI (covered by Batch 4's own tests, not this batch).

## Suites

### session-cost-contract.spec.ts — unit (pure functions + `SessionStatsOwnerService`, no DI mocks beyond the class itself)

- Requirement: live-vs-disk parity (6e) and `[1m]` pricing-resolution/owner integration (6d).
- Cases:
  1. `owner totalCost from cumulative modelUsage (parent + subagent) equals the disk aggregate of the equivalent parent+subagent ledgers` — parent ledger with 3 assistant turns (model A, per-call usage 100/50, 80/40, 60/20) + one subagent ledger (model B, 200/100), run through `aggregateSessionUsage`'s ledger overload for the disk total. The live owner is driven through `startNew` → `beginRun` → three `replaceRun` calls with growing cumulative `modelUsage` (model A only, then A+B, then final A+B), mirroring how the SDK's `modelUsage` grows once a Task subagent finishes (Q1). Asserts `snapshot.totalCost ≈ disk.totalCost` (`toBeCloseTo`, 6dp), `snapshot.tokens === disk.tokens`, and Σ of the 3 turns' `turnCost` within `3 × 1e-6` of the session total. Also asserts `recordAgent('agent-s1')` changes `agentSessionCount` by exactly 1 while leaving `totalCost`/`tokens` byte-identical.
  2. `findModelPricing resolves a [1m]-tagged id to the base rate, and SessionStatsOwnerService prices it correctly` (renamed post-review — see "Review round 2" below) — registers a fake base model's rate via `updatePricingMap`, resolves `${MODEL}[1m]` through the real `findModelPricing`, feeds that resolved pricing through a single unreported `replaceRun`, and asserts both `turnCost` and the session `totalCost` are non-null and match `tokens × rate` exactly. Scoped explicitly (by its own doc comment) to `findModelPricing` + `SessionStatsOwnerService` only — it does NOT exercise `StreamTransformer`'s own wiring; that is covered separately (see `stream-transformer.spec.ts` below).
  3. `multi-run case: a resumed process restores the saved base ...` — builds a pre-restart ledger (50/20 tokens, model A) and a full ledger (pre-restart + a 100/50 post-restart turn), both aggregated on the disk side for ground truth. Drives the owner through `prepareRun`/`beginRun` with a `savedCostState` matching the pre-restart ledger, then a single `'reported'` result whose cumulative tokens (150/70) and dollar total match the full-ledger disk total. Asserts the first accepted turn's `turnCost` equals `fullTotal − prefixTotal` (net of the restored base, not the full cumulative amount) and the session `totalCost` equals the full-ledger disk total.
- Files: `D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-cost-contract.spec.ts` (new)

### stream-transformer.spec.ts — unit (existing `StreamTransformer` harness, real `SessionStatsOwnerService`, mocked `IPricingProvider`/`IModelResolver` where the mock's `resolveForCost` calls the REAL `findModelPricing`)

- Requirement: end-to-end wiring for scope 6d's live path — added in review round 2 (see below) because no existing case fed a `[1m]`-tagged `modelUsage` key through the unreported route.
- Case: `a [1m]-tagged modelUsage key prices at the base model rate on the unreported route (scope 6d)` — a cumulative `result` message whose sole `modelUsage` key is `${TAGGED_1M_BASE_MODEL}[1m]` (a fake base model registered via `registerProviderPricing` in this `describe`'s `beforeAll`) on the `'unreported'` cost-authority route. Asserts the published `turnCost` and `sessionStats.totalCost` are both non-null and equal `tokens × the base model's rate` — proving the real `modelResolver.resolveForCost` → `findModelPricing` → `calculateMessageCost` chain inside `StreamTransformer.transform` strips the tag correctly, not just the pure function in isolation.
- Files: `D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts` (existing file, one case + one pricing registration appended to the `'StreamTransformer — session stats authority (TASK_2026_533)'` describe block)

### agent-stats.service.spec.ts — unit (Angular `TestBed`, matches existing file's harness)

- Requirement: agent-stats guard (6f, A2).
- Cases (new `describe` block appended to the existing spec):
  1. `sums three per-call costs (0.10 + 0.20 + 0.30 = 0.60)` — three `message_complete` children with distinct costs; badge cost is their exact sum.
  2. `a child with an unknown (undefined) cost is skipped, without zeroing the already-known sum` — two known-cost children (0.10, 0.20) plus one `cost: undefined` child; badge cost stays 0.30, not `undefined`/`NaN`.
  3. `every child with an unknown cost leaves the agent total undefined, never $0` — two children, one `cost: null` and one `cost: undefined`; badge cost is `undefined`, never `0`.
- Files: `D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat-execution-tree\src\lib\agent-stats.service.spec.ts` (existing file, appended)

## Guard proof — deliberate breaks and reverts (R10)

Every case above is behaviour that is already correct on this branch (guard, not failing-first per batches.md Batch 6 rationale). Each guard was proven to actually bite:

1. **Dropped subagent ledger** (`libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts`, `aggregateLedgers`'s subagent loop turned into a no-op via `continue`): re-ran `session-cost-contract.spec.ts` → parity test failed — `expect(snapshot?.totalCost).toBeCloseTo(disk.totalCost, 6)` — `Expected: 0.00237, Received: 0.00307` (disk total now excludes the subagent's $0.0007, owner still includes it). Reverted; `git diff HEAD -- libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts` is clean.
2. **Removed `[1m]`/variant-tag stripping** (`libs/shared/src/lib/utils/pricing.utils.ts`, `stripModelVariantTags` made a no-op): re-ran → the `[1m]` test failed at `expect(resolved).not.toBeNull()` — `Received: null` (with a `[Pricing] Model 'zz-contract-parent[1m]' not found` console warning from `findModelPricing`, confirming the lookup genuinely misses without stripping). Reverted; diff on `pricing.utils.ts` is clean.
3. **`resolveRunBase` always returns `null`** (`libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts`, body replaced with an unconditional `return null`): re-ran → the multi-run/restart test failed — `expect(outcome.turnCost).toBeCloseTo(expectedTurnCost, 6)` — `Expected: 0.00105, Received: 0.0015` (the first turn after restart billed the FULL cumulative cost instead of the net-of-restored-base delta, because the base was never detected as restored). Reverted; diff on `session-stats-owner.service.ts` is clean.
4. **`agent-stats.service.ts`: removed the truthy guard before summing** (`if (complete.cost) { totalCost += complete.cost; }` → unconditional `totalCost += complete.cost;`): re-ran `agent-stats.service.spec.ts` → the mixed known/unknown test failed with a `TypeError: Matcher error: received value must be a number` (`Received has value: undefined`) — `undefined` poisoned the running sum to `NaN`, which the `> 0` check then also reports as `undefined`, silently losing the two known costs. Reverted; diff on `agent-stats.service.ts` is clean.
5. **`agent-stats.service.ts`: removed the `> 0 ? totalCost : undefined` guard** (`cost: totalCost > 0 ? totalCost : undefined` → `cost: totalCost`): re-ran → 3 tests failed, including 2 pre-existing ones (`returns undefined for token usage when no message_complete carries tokenUsage`, and the new all-unknown case), each with `expect(result.cost).toBeUndefined()` → `Received: 0` — confirming a regression here would silently render `$0` instead of "unknown". Reverted; diff on `agent-stats.service.ts` is clean.

After every mutation+revert cycle, `git diff HEAD -- <production file>` was empty, confirming the production file was restored exactly to `HEAD` before moving to the next guard. No production file has any uncommitted change at the end of this batch.

## Review round 2 (code-logic-review-b6.md, APPROVED 8/10, 2 moderate findings fixed)

1. **Mislabeled `[1m]` test + missing transformer-level coverage.** The original `session-cost-contract.spec.ts` test titled `'a live modelUsage key with a [1m] tag prices at the base model rate end to end (scope 6d live path)'` only exercised `findModelPricing` plus a hand-built `RunUsageResult` fed straight into `SessionStatsOwnerService` — it never touched `StreamTransformer`'s own wiring (`modelResolver.resolveForCost` → `findModelPricing` → `calculateMessageCost`). Fixed by:
   - Renaming the test to `'findModelPricing resolves a [1m]-tagged id to the base rate, and SessionStatsOwnerService prices it correctly'` and adding a doc comment stating exactly what it does and does not cover.
   - Confirming no existing `stream-transformer.spec.ts` case fed a `[1m]`-tagged `modelUsage` key through the `'unreported'` route (existing `[1m]` cases there — `stream-transformer.spec.ts:733-900,1798-1920` — all use the `'reported'` route, where the SDK's own `costUSD` is trusted verbatim and `findModelPricing` is never called for pricing purposes).
   - Adding a new case, `'a [1m]-tagged modelUsage key prices at the base model rate on the unreported route (scope 6d)'`, to `stream-transformer.spec.ts`'s `'StreamTransformer — session stats authority (TASK_2026_533)'` describe block (registers a fake `zz-tagged-1m-575` base rate via `registerProviderPricing`, feeds `${base}[1m]` through the unreported route, asserts non-null `turnCost`/`sessionStats.totalCost` at the base rate).
   - Proved this new case bites: disabled `stripModelVariantTags` in `libs/shared/src/lib/utils/pricing.utils.ts` (body replaced with `return modelId;`), re-ran `stream-transformer.spec.ts` → 5 tests failed, including the new one — `expect(priced.turnCost).not.toBeNull()` — `Received: null` (plus 4 pre-existing `[1m]`-related failures, confirming the mutation was a genuine regression, not a test artifact). Reverted; `git diff HEAD -- libs/shared/src/lib/utils/pricing.utils.ts` is empty.
2. **Inline `try/finally` pricing-map cleanup.** Replaced the per-test `try { ... } finally { resetPricingMapForTesting(); }` in the (now-renamed) `[1m]` test with a describe-level `afterEach(() => resetPricingMapForTesting())` in `session-cost-contract.spec.ts`, matching the project's usual isolation pattern (`resetPricingMapForTesting` is the existing reset helper — no new helper introduced).

Files touched in this round: `libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts` (renamed test + `afterEach`), `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts` (one new pricing registration + one new test case). `batches.md` was not touched. No commit was made.

## Execution

- Command run (final, after review round 2): `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/chat-execution-tree --skip-nx-cache`
- Result: 6/6 tasks succeeded (typecheck, test, lint × 2 projects). `@ptah-extension/agent-sdk` test: 2309 passed, 3 skipped (pre-existing, unrelated), 0 failed, 2312 total (up from 2311 — the new `stream-transformer.spec.ts` case). `@ptah-extension/chat-execution-tree` test: 25 passed, 0 failed, 25 total (unchanged by round 2).
- Failures: none on the final (reverted) state. All failures listed above (both rounds) are the deliberate, recorded, reverted mutation runs.
- Not executed: none.

## Verdict

- Criteria proven: live-vs-disk parity (6e) including the `[1m]` live-path (6d) and the multi-run/restored-base edge case; Σ turnCost == session total within 1e-6/turn; `recordAgent` count-only; agent-stats.service per-call summation, skip-without-zeroing, and never-$0 (6f, A2 — no production change needed, confirmed correct).
- Criteria not proven: none within this batch's scope. (CLI-lane spend, long-context tiering, and the analytics UI marker are explicitly out of scope for Batch 6 per context.md and batches.md.)
- Risks a reader should know about: the `session-cost-contract.spec.ts` fixtures use synthetic model ids (`zz-contract-parent`, `zz-contract-sub`) and a locally registered fake pricing entry (via `updatePricingMap`/`resetPricingMapForTesting`) rather than the real Anthropic catalog, so the test is a contract/parity guard, not a live-integration check against the real `@anthropic-ai/claude-agent-sdk`. The `[1m]` test resets the runtime pricing map in a `finally` block; if a future test in the same worker registers global pricing state without similarly isolating it, cross-test pollution is possible (not observed here — the suite passed both isolated and as part of the full project run).
