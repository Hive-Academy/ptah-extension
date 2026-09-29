# Batches - TASK_2026_575_74a4

Total tasks: 14 | Batches: 7 | Complete: 5/7 (Batch 4 visual "after" evidence open, capture now unblocked by Batch 3)

BUGFIX, plan-free. Decomposed from task.md, context.md ("Orchestrator scope decisions" 1-7, binding),
research-report.md and research-addendum.md, stress-tested against base 722d921ab on disk.
Worktree: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost (branch fix/task-575-session-cost-accounting).
All paths below are relative to that worktree root unless absolute.

Recorded defaults (execution preferences came with the prompt, so no clarification was needed):

- Gate 0.1: subagents implement; code review of every batch runs on a CLI lane (codex preferred) cross-side. Fallback executor = the matching subagent in a fresh invocation.
- Order: shared pricing first (smallest, no dependents at risk), then the backend delta + wire field, then its consumers, then analytics, TUI and the cross-cutting contract tests.
- Batch 4 (dashboard) is file-disjoint from Batches 1-3 and may run concurrently with them once the visual-reviewer "before" screenshots exist; commits stay sequential (team-leader).
- Every fix batch carries its own scope-decision-6 regression tests, written to FAIL on base 722d921ab and pass after the fix. The executor must name the tests that failed before the fix and show the failing assertion (run the new test against the unmodified production file first, or `git stash push -u -m <tag>` of the production change only; never bare `git stash`).
- Verification is always scoped: `npx nx run-many -t typecheck,test,lint -p <projects>`, output tailed/filtered. Never workspace-wide.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1: SDK `modelUsage` / `total_cost_usd` are cumulative per query process and include Task subagents (sdk.d.ts:5366-5376, research-addendum Q1) - verified from types; the per-turn delta therefore includes subagent spend of that turn. Checked by Task 2.3 tests and Task 6.1 parity test.
- A2: `message_complete.cost` is already PER API CALL (`libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:379-405` prices that message's own `usage`), so `agent-stats.service.ts:97-98` already sums non-cumulative values; the research-addendum claim that it sums cumulative numbers is not what the code does. Task 6.2 pins it; no production change expected there.
- A3: History reload recomputes per-message cost from raw per-call usage (`session-replay.service.ts:233-282`) - verified by research; not touched.
- A4: The live header only installs the backend snapshot and never sums message cost (`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:79-80`) - verified on disk.
- A5: `SessionMetadataStore.addStats` (`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:896-954`) sums `stats.cost` but has no production caller (only its own spec) - verified by grep. Batch 2 deleted it (and `propagateStatsToParent`) as dead code after the rename, per review b2 (minor).
- A6: CLI lanes carry no usage/cost data (`CliSessionReference`, `cliAgentsFor`) and are shown only as a label list (`cliAgents`); they are not in any total today. Scope decision 3: stays out; Task 4.1 adds a guard that a CLI-only session never renders $0.
- A7: The analytics RPC passes `SessionStatsEntry.knownCost` through unchanged (no handler maps it away; `libs/shared/src/lib/types/rpc/rpc-session.types.ts:204-209`). Task 4.1 verifies with a fixture entry carrying `knownCost`.
- A8: `nx` targets `typecheck`, `test`, `lint` exist for every project named below (checked in project.json for shared, dashboard, cli-agent-runtime, ptah-tui; the others are the same lib shape).

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| R1 Delta arithmetic. Scope decision 1 phrases it as `previous = run.current ?? run.base`, but `run.current` is a raw cumulative `RunUsageResult` and `run.base` is a `SavedCostState`; subtracting them directly mis-prices unreported (Codex) runs, whose base is subtracted in TOKENS and repriced (`session-stats-owner.service.ts:224-283`). Correct equivalent: `turnCost = net(new) - net(previous accepted)`, where `net(x) = subtractRunBase(x, run.base).totalCost` and `net(none) = 0`. This telescopes, so the sum of accepted turn costs equals the run's contribution to the session total exactly. | HIGH | Task 2.1 |
| R2 Wire rename crosses the process boundary: after Batch 2 the webview reads `stats.cost` = undefined until Batch 3 lands (message footer cost disappears; header unaffected). The frontend copy of the payload type is a hand-written duplicate cast from `unknown`, so no compile error flags the drift. | MEDIUM | Batch 3 runs immediately after Batch 2; Task 3.1 derives the webview event type from the shared `ResultStatsPayload` so a future rename fails typecheck. The branch is not released between Batch 2 and Batch 3. |
| R3 Footer scope mismatch: per-turn `tokens` are main-loop only (`sdkMessage.usage`), per-turn cost now includes subagent spend of that turn. Pricing `sdkTokens` instead would break sum(messages) == session total. | MEDIUM | Task 2.1 documents the field semantics on `turnCost`; no attempt to reprice `tokens`. |
| R4 Non-accepted outcomes must never republish a cumulative figure. | HIGH | Task 2.1 outcome table: accepted -> delta (null when either side is unpriced); duplicate -> null and not published (revised in review round 1); rejected-invalid / rejected-non-monotonic / stale-owner / ignored-error / no owner (`statsGeneration === null`) / markRunIncomplete path -> null. |
| R5 Existing tests encode cumulative-as-message-cost: `stream-transformer.spec.ts:2365-2399` (expects `[10, 15]`), `:2506-2532` (expects `[1, 2]`), and every spec/fixture that builds a `session:stats` payload with `cost`. | MEDIUM | Tasks 2.3, 3.2, 5.1 fix them to the new semantics; suppressing or deleting an assertion is a rejection. |
| R6 `[1m]` rate choice: an OpenRouter catalog could publish a distinct `[1m]` SKU; long-context (>200K) tiering has no verified rate data. | MEDIUM | Task 1.1 exact match FIRST, then strip; tiering NOT implemented, recorded as follow-up (see Deferred). |
| R7 TUI shows `payload.cost` as the session cost (`apps/ptah-tui/src/hooks/use-sessions.ts:153`); after the rename it would silently fall back to one model row's process-cumulative cost. | MEDIUM | Batch 5 switches the TUI to the backend `sessionStats` snapshot. |
| R8 Analytics lower bound must stay labeled: `knownCost` is "never a substitute for totalCost" (`rpc-session.types.ts:204-209`). | MEDIUM | Task 4.1 sums `totalCost ?? knownCost` into a total explicitly flagged partial/lower-bound; the marker renders whenever any partially priced session contributes. |
| R9 Visual "before" evidence must come from the base build, before Batch 4 lands. | MEDIUM | Batch 4 pre-step: visual-reviewer captures dark + light "before" screenshots of the analytics page at base 722d921ab first. |
| R11 (added at Batch 2 commit, from code-logic-review-b2-r1.md; pre-existing on base) `isGrown` enforces dollar monotonicity on `'unreported'` runs, so a mid-run rate drop rejects every later result and freezes the session snapshot. | MEDIUM | Batch 2b - resolved: `isGrown`/`isSameUsage` compare tokens only when both results are unreported (`dollarsAreObserved`); pinned by owner spec tests (a)-(e). |
| R10 Pinning tests that cannot fail on base: live-vs-disk parity (e) and agent-stats sum (f) describe behaviour that is already correct on base. | LOW | Batch 6 states they are guards (not failing-first) and must fail when the guarded behaviour is broken on purpose (executor shows a deliberate mutation making each fail, then reverts). |

Edge cases:

- First accepted result of a resumed run with a restored base: turnCost = net(new) (base already subtracted) - handled in Task 2.1, tested in Task 2.3.
- Process reset (base not restored, `resolveRunBase` -> null): turnCost = new cumulative for the first result - Task 2.3.
- Model switch / restart = new runToken = new run: first delta measured against that run's own base - Task 2.3.
- Unreported run with one unpriced model: turnCost null, session total null, knownCost kept - Task 2.3.
- Reported run whose saved base has unknown cost (`base.totalCostUSD === null` or `hasUnknownModelCost`): turnCost null for that run - Task 2.3.
- Zero-usage error/startup result (`ignored-error`) and result without modelUsage (`markRunIncomplete`): turnCost null, snapshot unchanged - Task 2.3.
- Duplicate result (identical cumulative): turnCost null and the payload is NOT published (revised in Batch 2 review round 1: publishing 0 overwrote the already-published turn's footer cost) - Task 2.3.
- Unreported run whose rate drops mid-run: snapshot keeps advancing, that turn's turnCost null + runCostDecreased - Batch 2b.
- Model ids `claude-opus-5-5[1m]`, `anthropic/claude-opus-5-5[1m]`, `claude-opus-5-5-20260101[1m]`, and a catalog key that itself contains `[1m]` (exact first) - Task 1.2.
- Analytics: a session with pricingCoverage 'none' stays "Unknown" and out of the sum; a 'partial' one contributes knownCost with the marker; all-full ranges show no marker - Task 4.2.
- CLI-lane-only session (cliAgents set, no priced usage): never renders $0 - Task 4.2.

Deferred (recorded, not implemented, per scope decisions 3 and 5):

- Long-context (>200K prompt) per-call rate tiering for `[1m]` / 1M-context models: rates unverified; the SDK-reported dollars already cover the native Claude route.
- CLI-lane (ptah_agent_spawn) spend: no usage/model data recorded; if ever added, a separate labeled figure, never merged into `totalCost`.
- Reload prices at the current rate card, not the rate at turn time (existing limitation).

## Batch 1: Shared model-id normalizer and [1m] pricing - COMPLETE (e928d2a91)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: one shared lib, one lookup function plus its exported normalizer; tightly coupled edits in one file and its spec.
- Tasks: 2 | Depends on: none
- Reviewer: code-logic review on a CLI lane (codex) - pricing lookup is behavioural (wrong-model billing risk, exact-match rule of b9813a73d).
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`

### Task 1.1: Export one model-id normalizer and use it in lookupPricingEntry - COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\shared\src\lib\utils\pricing.utils.ts (exported from `libs/shared/src/index.ts:55` via `export *`; no index change needed if it lives in this file)
- Plan reference: context.md scope decision 5; research-report.md:33-36; research-addendum.md:26-34
- Pattern to follow: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:72-89` (`normalizeModelKey`), `pricing.utils.ts:240-302`
- Quality requirements: never bill a model at another model's rates (keep the date-snapshot-only partial rule and no reverse match); unknown stays null, never 0.
- Validation notes: R6 - exact match first.
- Implementation details: move `normalizeModelKey` (lowercase, strip trailing `(\[[^\]]*\])+`, strip `provider/` prefix, strip date snapshot suffix) into pricing.utils.ts as an exported, documented function (plus, if cleaner, exported step helpers such as `stripModelVariantTags`). `lookupPricingEntry` order: (1) exact lowercase id; (2) id with trailing `[..]` tags stripped - exact; (3) provider prefix stripped - exact; (4) existing date-snapshot partial match over the tag-stripped + prefix-stripped id. Nothing else about lookup changes. The local copy in stream-transformer is removed in Task 2.2 (not here - different lib, different batch).

### Task 1.2: Regression tests for [1m] and provider-prefixed ids (scope 6d) - COMPLETE

- Depends on: Task 1.1
- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\shared\src\lib\utils\pricing.utils.spec.ts
- Plan reference: context.md scope decision 6(d)
- Pattern to follow: existing `findModelPricing` / `calculateMessageCost` cases in the same spec
- Quality requirements: tests FAIL on base (`claude-opus-5-5[1m]` -> null today).
- Validation notes: R6.
- Implementation details: with a pricing map containing `claude-opus-5-5`: `claude-opus-5-5[1m]`, `anthropic/claude-opus-5-5[1m]`, `claude-opus-5-5-20260101[1m]` all price at the base rates via `findModelPricing` and `calculateMessageCost`; a map that ALSO has a `claude-opus-5-5[1m]` key returns that entry (exact first); `claude-opus-5-5-codex[1m]` (a variant, not a snapshot) and an unknown `foo[1m]` stay null; unit tests for the exported normalizer itself.

### Batch 1 verification

Result: `nx run-many -t typecheck,test,lint -p @ptah-extension/shared` passed (team-leader rerun before commit, cache skipped). Logic review: code-logic-review-b1.md APPROVED 8/10 by a Glm CLI lane (codex lane unavailable, usage limit; reviewer choice recorded in context.md). Minor, accepted: `lookupPricingEntry` tries prefix-stripped before tag-stripped (pricing.utils.ts:326-331) versus the Task 1.1 order; both steps are exact matches over the same normalized forms, so no wrong-rate billing. Committed e928d2a91.

- Both files exist and contain the work; normalizer exported from `@ptah-extension/shared`
- Executor names the tests that failed on base
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared` passes (tail the output)
- Codex CLI-lane logic review returns APPROVE
- Edge cases for model ids above are covered

## Batch 2: Per-turn cost delta and the turnCost wire field - COMPLETE (f1c4a365f)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: the owner's delta, the transformer that publishes it, and the wire type are one contract; the rename must compile in one commit. Deliberate exception to the 2-lib cap: the compile closure of renaming a shared wire field is 3 projects; the shared and cli-agent-runtime edits are one type block and one log key.
- Tasks: 3 | Depends on: Batch 1 (Task 2.2 imports the shared normalizer)
- Reviewer: code-logic review on a CLI lane (codex) - accounting arithmetic, outcome handling, R1/R4.
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime`

### Task 2.1: SessionStatsOwnerService.replaceRun returns the accepted turn's cost - COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts
- Plan reference: context.md scope decision 1; research-addendum.md:36-48 (Q4); research-report.md:11-17
- Pattern to follow: `replaceRun` (:459-499), `applyResult` (:702-719), `subtractRunBase` (:224-283), `publish` (:625-674)
- Quality requirements: sum of accepted turn costs of a run == that run's contribution to the snapshot `totalCost`; never a cumulative figure.
- Validation notes: R1 (net-of-base on both sides, same `subtractRunBase`), R4 (outcome table).
- Implementation details: capture `previous = run.current` BEFORE `applyResult`; after it, when `outcome === 'accepted'` compute `turnCost = diff(net(run.current), previous ? net(previous) : 0)` with `net(x) = subtractRunBase(x, run.base ?? null).totalCost`; `null` if either side is null; clamp tiny negative float noise with the existing `nonNegativeUsd`. Return `{ outcome, snapshot, firstRejection, turnCost }` with `turnCost: number | null` typed separately from any session total (name it `turnCost`, never `cost`/`totalCost`). Duplicate -> 0; every other outcome -> null. `recordAgent` stays count-only (scope decision 2).

### Task 2.2: StreamTransformer publishes turnCost; shared wire type renamed - COMPLETE

- Depends on: Task 2.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\shared\src\lib\types\agent-adapter.types.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.ts
- Plan reference: context.md scope decision 1; research-report.md:13-17, 44-49
- Pattern to follow: stream-transformer.ts:674-787 (result block), agent-adapter.types.ts:31-66
- Quality requirements: no stubs; `totalCost` computed at :674-687 remains only the value handed to the owner, never published as a message cost.
- Validation notes: R2, R3, R4.
- Implementation details: rename `ResultStatsPayload.cost` -> `turnCost: number | null` with a doc comment: "this result's own spend (delta of the run's cumulative cost since the previously accepted result, net of any restored base; includes Task-subagent spend of the turn); null when unknown; never a session or process total". Make stream-transformer's `ResultStatsCallback` / `ValidatedStats` use the shared payload type instead of a duplicate literal type (one source of truth). Publish `turnCost` from `replaceRun`; `null` when `statsGeneration === null`, on the `markRunIncomplete` path, and when no model rows. Fix the stale comments at :281-285 and :769-771. Replace the local `normalizeModelKey` (:72-89) with the Batch 1 shared export (behaviour-identical for `matchTrackedContexts`). In sdk-callbacks.ts:136-143 log `turnCost` instead of `cost`. Fix every compile error the rename causes in agent-sdk / cli-agent-runtime / shared specs (e.g. `sdk-agent-adapter.spec.ts` fake stats, `sdk-callbacks.spec.ts`).

### Task 2.3: Contract tests for per-turn cost (scope 6a, 6b) and fixing wrong-semantics tests - COMPLETE

- Depends on: Task 2.2
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.spec.ts
- Plan reference: context.md scope decision 6(a)(b)
- Pattern to follow: stream-transformer.spec.ts:2240-2400 (`makeHarness`, `cumulativeResult`, `collect`)
- Quality requirements: new tests FAIL on base (base publishes cumulative); fixed tests assert the new semantics, not loosened ones.
- Validation notes: R1, R4, R5; every edge case in the validation section tied to Task 2.3.
- Implementation details: (a) multi-turn run with a NON-ZERO restored base (owner `prepareRun`/`beginRun` with a saved `cost-state` candidate, first result >= base): per-turn `turnCost` values sum to `snapshot.totalCost - prefix total` and the last `turnCost` != session total; (b) the same scenario for `usageCostSource: 'reported'` (Claude, SDK dollars) AND `'unreported'` (Codex, rate-card repricing of token deltas); plus reset (base not restored), second run with a new runToken, unpriced model -> null, duplicate -> 0, rejected-non-monotonic / stale-owner / ignored-error / markRunIncomplete -> null. Owner-level unit tests for `replaceRun().turnCost`. Fix `:2365-2399` to expect `[10, 5]` for turn costs and `[10, 15]` for `sessionStats.totalCost`; fix `:2506-2532` to `[1, 1]` with total 2; update `:2295-2363` / `:1284-1317` field names.

### Batch 2 verification

Result: team-leader reran `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime --skip-nx-cache` - passed (9 tasks, EXIT 0). Verified on disk: `replaceRun` returns `turnCost` / `runCostDecreased` via `acceptedTurnCost` (net(new) - net(previous accepted), both through `subtractRunBase`, rounded 1e-6); duplicates are not published; `validateStats` rejects negative/non-finite `turnCost`; `ResultStatsPayload.cost` renamed to `turnCost` with the contract doc; transformer uses the shared `normalizeModelKey` and the shared payload type; no `cost: totalCost` publish remains; dead `addStats` / `propagateStatsToParent` deleted (no remaining callers). Failing-before evidence reported by the executor: [13,15,18] vs [3,2,3], [10,15] vs [10,5], [1,2] vs [1,1], Codex first turn 0.46 vs 0.23; round 1: 12 tests failed on round-0 code. Logic review (antigravity CLI lane, cross-side): code-logic-review-b2.md REVISE 7/10 -> code-logic-review-b2-r1.md APPROVE 8/10. Remaining pre-existing `isGrown` finding moved to Batch 2b (R11).

- All files exist and contain the work; `grep -n "cost: totalCost" stream-transformer.ts` finds nothing published as a message cost
- Executor names the tests that failed on base and shows the failing assertion
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime` passes
- Codex CLI-lane logic review returns APPROVE
- R1, R3, R4 addressed as described

## Batch 2b: Unreported runs never freeze on a mid-run rate drop - COMPLETE (5b22a67b1)

- Origin: code-logic-review-b2-r1.md moderate finding (pre-existing on base): `isGrown` (session-stats-owner.service.ts:926-948) enforces DOLLAR monotonicity. On a `costSource: 'unreported'` run (Codex / proxy; dollars come from the rate card, not the provider) a mid-run rate decrease (runtime pricing map re-registered when a provider catalog hydrates) makes every later result `rejected-non-monotonic`, freezing the session snapshot (tokens, cost, duration) at the earlier turn. Orchestrator decision: IN SCOPE (user asked for totals reflecting the actual model costs).
- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: one owner function pair plus its spec; accounting semantics need judgment. File-disjoint from Batch 3 (libs/frontend/chat*), so it may run concurrently with Batch 3; commits stay sequential (team-leader). Must land before Batch 6 (same lib, Batch 6 guards the owner).
- Tasks: 2 | Depends on: Batch 2
- Reviewer: code-logic review on a CLI lane, cross-side - accounting monotonicity and duplicate detection.
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`

### Task 2b.1: Monotonicity and duplicate checks by cost source - COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.ts
- Plan reference: code-logic-review-b2-r1.md (isGrown finding); context.md user request; Batch 2 `acceptedTurnCost` contract
- Pattern to follow: `applyResult` (:728-745), `isSameUsage` (:903-919), `isGrown` (:926-948), `subtractRunBase` (:224-283), `acceptedTurnCost`
- Quality requirements: a session snapshot never freezes because a rate changed; token counters stay the monotonicity authority; `'reported'` runs keep dollar monotonicity (SDK dollars are authoritative and cumulative).
- Validation notes: new risk R11 (below). Policy (define and document on `isGrown`/`isSameUsage`): for `costSource === 'unreported'` the run's dollars are a pure function of its tokens and the CURRENT rate card, so (1) `isGrown` checks only token counters (per model, every previous model still present) and ignores `totalCost` and per-model `costUSD`; (2) `isSameUsage` compares tokens only, so identical tokens repriced at a new rate are a `duplicate` (not published, no footer overwrite) rather than a fresh turn; (3) the accepted snapshot reprices the whole run's net tokens at the current rates (what `subtractRunBase` already does) - the documented policy is "an unreported run's total is priced at the rate card in force at its latest accepted result"; (4) `acceptedTurnCost` unchanged: a turn whose net run cost went down by more than 1e-6 returns `turnCost: null` + `runCostDecreased: true` (logged), an increase stays a normal delta. Mixed cost-source across results of one run is not expected; if `prev.costSource !== next.costSource` keep the stricter (dollar) check.
- Implementation details: pass the cost source into `isGrown` / `isSameUsage` (from `next.costSource`), branch on `'unreported'`. No change to `publish`, `recordAgent`, `subtractRunBase` or the wire type. Update the JSDoc of both functions.

### Task 2b.2: Failing-first regression tests - COMPLETE

- Depends on: Task 2b.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-stats-owner.service.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.spec.ts (only if an end-to-end publish case is needed; keep it to one case)
- Plan reference: orchestrator decision (Batch 2 commit round)
- Pattern to follow: the Batch 2 `replaceRun().turnCost` owner cases in session-stats-owner.service.spec.ts
- Quality requirements: tests FAIL on the Batch 2 commit (show the failing assertion, e.g. outcome `rejected-non-monotonic` / frozen snapshot), pass after 2b.1; no loosened assertions.
- Implementation details: (a) unreported run, no restored base, rate R1 for turns 1-2, rate drops to R2 < R1 before turn 3, tokens grow each turn: turn 3 outcome `accepted`, `turnCost` null, `runCostDecreased` true; snapshot tokens equal turn-3 cumulative tokens, `durationMs` includes turn 3, `totalCost` == turn-3 tokens priced at R2; turn 4 (tokens grow, rate R2) accepted with a normal positive `turnCost` == delta at R2 and the snapshot advances again - never frozen. (b) same with a restored non-zero base (net tokens repriced). (c) unreported result with identical tokens but a new rate -> `duplicate`, snapshot unchanged except as documented, `turnCost` null. (d) unreported, a token counter goes down -> still `rejected-non-monotonic`. (e) reported run whose SDK `total_cost_usd` goes down -> still `rejected-non-monotonic` (dollar check kept).

### Batch 2b verification

Result: team-leader reran `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk --skip-nx-cache` - passed (3 tasks, EXIT 0). Verified on disk: private `dollarsAreObserved(a, b)` (false only when both results are 'unreported'); `isSameUsage` / `isGrown` skip total and per-model dollar checks only in that case; policy documented on both ("an unreported run's total is priced at the rate card in force at its latest accepted result"); `acceptedTurnCost`, `publish`, `subtractRunBase` and the wire type unchanged; no stub markers or skipped tests in the diff. New owner tests (a)-(e) plus the mixed-source guard. Failing-first on f1c4a365f reported by the executor: (a), (b) Expected "accepted" Received "rejected-non-monotonic"; (c) failed on the duplicate expectation; (d), (e), mixed are guards that pass on both. Three existing tests (two owner, one transformer at stream-transformer.spec.ts ~3017) grew one output token so the later result is a real new turn; assertions unchanged apart from the exact +0.002 of that token. Logic review (Glm CLI lane, cross-side): code-logic-review-b2b.md APPROVE 9/10, 0 blocking/serious/moderate, 3 minor accepted by the orchestrator.

Deferred follow-ups (from code-logic-review-b2b.md, accepted minors, not implemented):

- F1 Unreported run whose model goes unpriced -> priced with identical tokens stays a `duplicate`, so the snapshot keeps its partial (labeled lower-bound) total until tokens grow. Possible fix: on an unreported duplicate, reprice `run.current` into the snapshot without publishing a turn.
- F2 (pre-existing policy) A rate RISE on an unreported run bills the repricing of earlier tokens to the current turn's `turnCost` (telescoping keeps the session total exact; the per-turn figure absorbs the difference). Documented policy; a per-turn "repriced" split would need a wire change.
- (informational) The mixed-source stricter check matters only if `costSource` ever becomes changeable mid-run; today it is frozen per query stream.

- Files exist and contain the work; policy documented on `isGrown` / `isSameUsage`
- Executor names the tests that failed on the Batch 2 commit and shows the failing assertion
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk` passes
- CLI-lane logic review returns APPROVE

## Batch 3: Webview consumers read turnCost - COMPLETE (8bbe3418c)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: frontend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: two coupled Angular services on one event path; the type derivation and the handler change must agree.
- Tasks: 2 | Depends on: Batch 2 (runs immediately after it - R2)
- Reviewer: code-logic review on a CLI lane (codex) - cross-side contract with Batch 2.
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat,@ptah-extension/chat-streaming`
- Contract from Batch 2 (binding, `libs/shared/src/lib/types/agent-adapter.types.ts` `ResultStatsPayload`): one payload per NEW turn (duplicates are not published), so `turnCost` always applies to the latest assistant message; `turnCost: null` = UNKNOWN, rendered as unavailable, never $0 and never replaced by a previous or summed value; the session header installs only the backend `sessionStats` snapshot.

### Task 3.1: Derive the session:stats event type from the shared payload and read turnCost - COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts
- Plan reference: context.md scope decisions 1 and 6(a); research-report.md:14
- Pattern to follow: session-stats-aggregator.service.ts:21-70 (event types, `isSnapshotOnly`), streaming-handler.service.ts:524-653
- Quality requirements: the webview never sums message cost into a header figure (TASK_2026_533 invariant kept); message `cost` field on `ExecutionChatMessage` / `pendingStats` keeps meaning "this message's own cost".
- Validation notes: R2.
- Implementation details: define `SessionStatsResultEvent` from `ResultStatsPayload` in `@ptah-extension/shared` (e.g. `Omit<ResultStatsPayload, 'sessionId' | 'modelUsage'> & {...}` preserving the existing `TurnModelUsage` narrowing) so a future wire rename fails typecheck; `SessionStatsSnapshotEvent` uses `turnCost?: undefined`; `isSnapshotOnly` checks `turnCost`. `StreamingHandlerService.handleSessionStats` takes `turnCost` and writes it to `pendingStats.cost` and, when finalized, to the last assistant message `cost`. No change to chat-types, message-finalization or chat-transcript (they carry the per-message value already).

### Task 3.2: Webview regression tests - COMPLETE

- Depends on: Task 3.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat\src\lib\services\chat-store\session-stats-aggregator.service.spec.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat-streaming\src\lib\streaming-handler.service.spec.ts
- Plan reference: context.md scope decision 6(a)
- Pattern to follow: existing `handleSessionStats` cases in both specs
- Quality requirements: at least one test FAILS on base (base reads `cost`, so a `turnCost` payload leaves the footer empty).
- Validation notes: R2.
- Implementation details: two successive turn results `{ turnCost: 10 }`, `{ turnCost: 5 }` with snapshots `totalCost` 10 / 15: each finalized assistant message shows its own turn cost (10, 5), the installed header snapshot is 15 exactly as sent (not 20, not 5), and the last message cost != header total; a snapshot-only event still does not touch message cost; `turnCost: null` renders unavailable, never 0. Update all fixtures using `cost:` on the event.

### Batch 3 verification

- Files exist and contain the work; no `stats.cost` read remains in the two services
- Executor names the tests that failed on base
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat,@ptah-extension/chat-streaming` passes
- Codex CLI-lane logic review returns APPROVE

## Batch 4: Analytics keeps the known spend of partially priced sessions - COMPLETE (5b9f468f3)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: frontend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: one lib; the state service, the formatters and three display components share the same partial-pricing rule and must agree.
- Tasks: 2 | Depends on: none (file-disjoint; may run alongside Batches 1-3 after the "before" screenshots exist)
- Pre-step status: DONE - base screenshots in `screenshots/before/` (analytics-dark/light, plus 480px variants, README.md), committed with the Batch 1 docs commit. Runs in parallel with Batch 2 (file-disjoint); commits stay sequential.
- Added requirement: "Unknown" cost values must not render in the success (green) color on the analytics card (seen in screenshots/before/analytics-dark.png); unknown/unavailable uses a neutral muted style, lower-bound values keep the marker.
- Pre-step (orchestrator, before the executor starts): visual-reviewer captures "before" screenshots of the dashboard analytics page, dark AND light, at base 722d921ab, with at least one partially priced session in range (e.g. a session mixing a priced Claude model with an unpriced `opencode-go/*` or `glm-*` model). Store under the task folder `screenshots/before/`.
- Reviewers: code-logic review on a CLI lane (codex) AND visual-reviewer "after" screenshots, dark + light, same page and data, compared with "before" (scope decision 7; rendered UI change).
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard`

### Task 4.1: Aggregate knownCost of every session with an explicit partial marker - COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\utils\format.utils.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\components\session-analytics\metrics-cards.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\components\session-analytics\session-stats-card.component.ts (and its .html)
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\components\session-analytics\session-detail-modal.component.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\components\analytics-card\analytics-card.component.html
- Plan reference: context.md scope decisions 3, 4, 7; research-report.md:26-31
- Pattern to follow: session-analytics-state.service.ts:244-323, 545-581; format.utils.ts:17-75; analytics-card.component.html:97-127
- Quality requirements: no silent drop, no $0 for unknown; a lower bound is always labeled as one; backend `totalCost` semantics unchanged (no backend edit in this batch).
- Validation notes: R8, A6, A7.
- Implementation details: add `knownCost: number | null` to `DashboardSessionEntry` (from `stats.knownCost ?? stats.totalCost ?? null` in `mergeEntry`). `aggregates.totalCost` sums `totalCost ?? knownCost` for every readable session that has either; add `totalCostIsLowerBound` (true when any contributing session has pricingCoverage 'partial' or knownCost-only); `avgCostPerSession` uses the same contributors; `unknownCostSessionCount` counts only sessions with neither. Metrics total card shows the lower-bound marker (e.g. a leading "≥" or "at least" label plus a tooltip/aria text naming the count of partially priced sessions); per-session card and detail modal show the session's knownCost with the same marker instead of "Unknown" when pricingCoverage is 'partial'; cost-per-message uses the same figure only when marked. Update the analytics status line copy to say the partial sessions ARE included as a lower bound (today it says "the total is a lower bound" while excluding them). CLI lanes: nothing added to any sum.

### Task 4.2: Analytics regression tests (scope 6c) - COMPLETE

- Depends on: Task 4.1
- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\dashboard\src\lib\services\session-analytics-state.service.spec.ts
  - format.utils / metrics-cards / session-stats-card specs next to their sources (create where absent)
- Plan reference: context.md scope decision 6(c)
- Pattern to follow: existing aggregates cases in session-analytics-state.service.spec.ts and `session-analytics-state.testing.ts`
- Quality requirements: the aggregate test FAILS on base (a partial session's knownCost is dropped today).
- Validation notes: R8, A6, A7.
- Implementation details: fixture of three sessions: full (totalCost 2), partial (totalCost null, knownCost 3, pricingCoverage 'partial'), none (totalCost null, knownCost null, pricingCoverage 'none'): aggregate total 5, lower-bound flag true, partiallyPricedSessionCount 1, unknownCostSessionCount 1; all-full range -> flag false and no marker rendered; the partial session card renders "$3.00" with the marker, the 'none' session renders "Unknown", a CLI-only session (cliAgents ['codex'], no priced usage) never renders "$0.00".

### Batch 4 verification

Result: team-leader reran `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard --skip-nx-cache` - passed (executor: 13 suites, 109 tests). Files verified on disk: `sessionCostEstimate` is the single rule (total -> full or 'partial'-marked; else knownCost marked lower bound; else unknown) used by aggregates, formatSessionCost, sessionShowsLowerBound, sessionCostPerMessage and sessionCoverageNotes; `cliAgentSessionCount` touches no sum or flag; no stub markers. Failing-on-base evidence reported by the executor: total Expected 5 Received 2; card Expected '$3.00' Received 'Unknown'; avg marker; status-line and CLI-line tests. Logic review (Glm CLI lane, cross-side; codex unavailable as in Batch 1): code-logic-review-b4.md REVISE 6/10 -> code-logic-review-b4-r1.md APPROVE 8/10. Two cosmetic copy nits accepted, not fixed: the CLI status line reads slightly overbroad for a session mixing priced usage with CLI runs (analytics-card.component.html CLI line), and the all-unpriced sentence repeats itself (analytics-card.component.html:114-122); neither misstates a figure. Committed 5b9f468f3 (dashboard files plus the two b4 review files only; Batch 2 working-tree changes left unstaged).

OPEN ITEM (moved to final verification / Mode 3, blocks TASK COMPLETE): visual-reviewer "after" screenshots, dark + light, same page and data as `screenshots/before/`, compared with "before" (scope decision 7, including the neutral-colour requirement for "Unknown"). Cannot be taken now: the webview does not compile between Batch 2 and Batch 3 (cost -> turnCost rename, R2). Capture them after Batch 3 is committed; store under `screenshots/after/`.

- "Before" screenshots (dark + light) exist from base before any Batch 4 edit
- Files exist and contain the work; executor names the tests that failed on base
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard` passes
- Codex CLI-lane logic review APPROVE and visual-reviewer "after" screenshots (dark + light) accepted against "before"

## Batch 5: TUI session cost from the backend snapshot - COMPLETE (6dee59f25)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: frontend-developer (fresh invocation)
- Execution mode: sequential
- Rationale: one app, one hook plus the component that renders its cost; small and coupled.
- Tasks: 1 | Depends on: Batch 2
- Reviewer: code-logic review on a CLI lane (codex).
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-tui`

### Task 5.1: deriveStats uses sessionStats, never a per-turn or per-row figure - COMPLETE

- Files:
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\apps\ptah-tui\src\hooks\use-sessions.ts
  - D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\apps\ptah-tui\src\hooks\use-sessions.spec.ts
  - the TUI component that renders `stats.costUSD` (executor locates it; include it only if its type changes)
- Plan reference: context.md user request ("total ... in the stats not only the last message cost"); R7
- Pattern to follow: use-sessions.ts:47-159
- Quality requirements: unknown never shown as $0.
- Validation notes: R7.
- Implementation details: local `SessionStatsPayload` gains `turnCost` and `sessionStats` (typed from `@ptah-extension/shared` if the app already depends on it); `costUSD` = `sessionStats.totalCost`, else `sessionStats.knownCost` marked partial, else keep the previous known session value / null - never `turnCost`, never a `modelUsage` row. Make `costUSD` `number | null` and render null as unavailable if the view currently prints 0. Test (fails on base): two `session:stats` pushes with turnCost 10/5 and snapshot totals 10/15 -> TUI shows 15.

### Batch 5 verification

Result: team-leader reran `npx nx run-many -t typecheck,test,lint -p ptah-tui --skip-nx-cache` - passed (EXIT 0). Verified on disk: one helper `sessionCostFor(sessionId, snapshot, previous)` in use-sessions.ts used by both the push path (`deriveStats`) and the batch path (`deriveStatsFromBatch`): snapshot used only when `status === 'ok'` and its `sessionId` matches; `totalCost`, else `knownCost` with `costPartial`, else the previous value for the same session, else null; `turnCost` and `modelUsage` rows never consulted; the local wire types now derive from `ResultStatsPayload` / `SessionStatsEntry`. `SessionStats.costUSD` / `StatusLineStats.costUSD` are `number | null`; the status bar hides unknown and prefixes partial with `>=`; `/status` (use-commands.ts) prints "Cost: unavailable" or `>=$x (partial pricing)`. Files: apps/ptah-tui/src/hooks/use-sessions.ts (+spec), apps/ptah-tui/src/lib/status-line.ts (+spec), apps/ptah-tui/src/hooks/use-commands.ts. Failing-first reported by the executor: 6 tests failed on base (e.g. Expected 10 Received 3; unknown Received 0), then 2 sessionId-guard tests failed before the guard fix (Received 99). Logic review (Glm CLI lane): code-logic-review-b5.md APPROVE 8/10 with 1 moderate (sessionId guard) -> fixed -> code-logic-review-b5-r1.md APPROVE 9/10, 0 moderate.

Accepted minors (recorded, not fixed): a batch entry for another session still seeds display tokens/model (never money); a known $0 cost is hidden on the bar (pre-existing `> 0` rule); the `/status` cost branch has no direct test.

- Files exist; executor names the test that failed on base
- `npx nx run-many -t typecheck,test,lint -p ptah-tui` passes
- Codex CLI-lane logic review returns APPROVE

## Batch 6: Cross-cutting contract and parity guards - COMPLETE (SHA recorded in the task-specs commit that follows)

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: senior-tester (fresh invocation)
- Execution mode: sequential
- Rationale: tests only, spanning the live owner, the disk aggregator and the per-agent badge; needs judgment on fixtures, not production edits.
- Tasks: 2 | Depends on: Batches 1, 2 and 2b
- Started in parallel by the orchestrator, assigned to senior-tester: its dependencies (Batch 1 e928d2a91, Batch 2 f1c4a365f, Batch 2b 5b22a67b1) are committed, and its files (libs/backend/agent-sdk session-cost-contract.spec.ts, libs/frontend/chat-execution-tree agent-stats.service.spec.ts, test-report.md) do not overlap with Batches 3, 5 or the Batch 4 visual evidence. Commits stay sequential and are made by the team-leader.
- Reviewer: code-logic review on a CLI lane (codex) - are the guards real (would they catch the regression)?
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/chat-execution-tree`

### Task 6.1: Live-vs-disk parity and end-to-end [1m] pricing (scope 6e, 6d live path) - COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\backend\agent-sdk\src\lib\session-stats\session-cost-contract.spec.ts (new)
- Plan reference: context.md scope decisions 2, 5, 6(d)(e); research-addendum.md:3-14
- Pattern to follow: session-stats-owner.service.spec.ts, session-usage-aggregator spec fixtures, stream-transformer.spec.ts harness
- Quality requirements: guard tests (R10) - executor shows each fails under a deliberate mutation (e.g. `recordAgent` adding cost, dropping subagent ledgers, removing the tag strip) and then reverts the mutation; no production edits.
- Validation notes: A1, R10.
- Implementation details: one fixture session = parent ledger (main-loop per-call usage, model A) + one subagent ledger (model B); drive the live owner with the equivalent cumulative `modelUsage` (A + B rows, `usageCostSource: 'unreported'`, same rate card via the pricing lookup) over several results; assert owner snapshot `totalCost` == `aggregateSessionUsage` ledger `totalCost` (toBeCloseTo), token classes equal, and `recordAgent` for the subagent changes `agentSessionCount` only. Second case: a live `modelUsage` key `claude-opus-5-5[1m]` on the unreported path prices at `claude-opus-5-5` rates end to end (turnCost and snapshot non-null).

### Task 6.2: agent-stats.service sums per-call costs (scope 6f) - COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost\libs\frontend\chat-execution-tree\src\lib\agent-stats.service.spec.ts
- Plan reference: context.md scope decision 6(f); A2
- Pattern to follow: existing cases in the same spec
- Quality requirements: guard test (R10) with a demonstrated mutation failure.
- Validation notes: A2 - if the executor finds `message_complete.cost` is NOT per call, stop and report instead of changing production code.
- Implementation details: an agent with three child `message_complete` events costing 0.10 / 0.20 / 0.30 -> badge `cost` 0.60; a child with `cost` undefined is skipped without zeroing the total; all-unknown -> `cost` undefined (never 0).

### Batch 6 verification

Result: team-leader reran `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/chat-execution-tree --skip-nx-cache` - passed (EXIT 0; tester reported 2309 + 25 tests). Test-only batch: `git diff HEAD` touches no production file. Files: libs/backend/agent-sdk/src/lib/session-stats/session-cost-contract.spec.ts (new: live owner vs disk aggregate parity for parent + subagent ledgers, `[1m]` priced at base rates through the owner, resumed-process base restore parity), libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts (transformer-level `[1m]` unreported-route case), libs/frontend/chat-execution-tree/src/lib/agent-stats.service.spec.ts (per-call sum, undefined skipped, all-unknown stays undefined), test-report.md. A2 confirmed (message_complete.cost is per call; no production change). Guard proofs (R10): each guard failed under a deliberate production mutation, then reverted. Logic review (antigravity CLI lane): code-logic-review-b6.md APPROVE 8/10, regressions R-a..R-f guarded; 2 moderate (mislabeled `[1m]` test title; try/finally cleanup) fixed by the tester (renamed test, afterEach reset, added the transformer-level `[1m]` case shown to fail under mutation).

- Both spec files exist with real fixtures; mutation evidence reported per guard
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk,@ptah-extension/chat-execution-tree` passes
- Codex CLI-lane logic review returns APPROVE
