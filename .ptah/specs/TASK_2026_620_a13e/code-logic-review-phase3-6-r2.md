# Phase 3.6 code-logic re-review — Batches 21–23

## Summary

| Metric | Value |
|---|---|
| Overall score | 4/10 |
| Verdict | REVISE |
| Blocking / serious / moderate | 0 / 1 / 0 |
| Failure modes | 1 |

The mechanical fixes in commits `490397b4b` and `9be41ac25` are present.  However, the revised feed fixture changes a known product violation into its expected successful output.  The absorbed requirement is ground truth: archaeology must precede authoring and a no-routine verdict must visibly reject the session.  Sessions 20–22 are labelled `routine: null`; expecting their `analyze-run` output therefore makes this benchmark pass only while the product is wrong.

This is a 4 rather than 5–6 because the benchmark gives a success-looking result for the central absorbed requirement.  It is not 3 or below because all other round-1 correctness gaps checked here have been closed with both plan-time/runtime guards and focused specifications.

## Round-1 finding status

| Round-1 finding | Status | Evidence | Impact |
|---|---|---|---|
| 1. Sessions 20–22 had unreachable empty feeds | **OPEN — reframed** | Fixture now scripts `drain-eligible-candidate` and expects `analyze-run` at `skill-sessions.v1/index.json:237-270`; generator maps that operation to `analyze-run` at `skill-session-fixture.ts:63-65`. But those sessions remain `routine: null` at `index.json:238,249,260`, while the absorbed requirement is archaeology-before-authoring/no candidate for no routine (`context.md:202`; suite claim at `funnel.suite.ts:138-142). | The test now treats today's defect as correct behaviour instead of failing today. |
| 2. Fixture-scale judge pass could appear to close decision 7 | **CLOSED** | `funnel.suite.ts:153-157` explicitly limits the judge claim to one fixture cycle and assigns the 2,347 copy-scale row to backlog/audit. | A fixture pass cannot close the copy-scale decision. |
| 3. Divergent options for the shared pass were swallowed | **CLOSED** | Both plan validators call `funnelPlanProblems` (`runner-plan.ts:103-108`, `plan.schema.ts:263-266`); a late divergent caller throws `FunnelPlanError` (`funnel.suite.ts:295-305`). | Mismatched stage options fail loudly rather than score another suite's run. |
| 4. Non-`Method not found` RPC errors became `ran` | **CLOSED** | `funnel-host-port.ts:207-212` returns `{ rpcError }` for every other refusal. | A failed manual run is scored with its cause. |
| 5. Child containers / pending reconcile pass were not disposed | **CLOSED** | Lifecycle children are tracked (`funnel-host-port.ts:312-318`) and disposed in `close` (`:712-720`) through `disposeChild` (`funnel-host-graph.ts:643-649`). The deliberately unresolved reconcile call has no retained child after close. | No supported resource-leak finding remains. |
| 6. Delivery depended on prior resident count | **CLOSED** | It records residents at entry and lifts the cap to at least `residentAtEntry + 1` (`funnel-host-port.ts:654-665`); the result reports the count (`funnel-lifecycle.ts:534`). | Earlier lifecycle suites cannot refuse this promotion merely by filling the cap. |
| 7. B23 local-only suites ran in CI | **CLOSED** | Both host suite entry points refuse CI before fixture/service work (`namer-and-trigger.suite.ts:61-89`). | CI receives a loud refusal, not a misleading `na` or private-data read. |

## Key question — correct expectation for sessions 20–22

**`analyze-run` is wrong.** A correct pipeline must first obtain the archaeology verdict and, for these labels (`routine: null`), reject authoring.  Today it does the reverse: the prefilter stage calls `analyzeSession` and creates the candidate before it enqueues archaeology (`stage-handlers.service.ts:294-344`); `analyzeSession` then records `analyze-run` when it registers that candidate (`skill-synthesis.service.ts:1164-1194`).  The archaeology stage is only subsequently run (`stage-handlers.service.ts:891-929`).

The proper observable expectation is **`ineligible` with a visible `noRoutine` (or equivalently explicit archaeology-no-routine) reason**, and the suite must mark the current `analyze-run` as **fail today**.  The current contract cannot represent that correct expectation: fixture reasons permit only `prefilterTooThin` and `prefilterRejected` (`skill-session-fixture.ts:25-28`), despite `ineligible` being an event kind (`rpc-curator-diagnostics.types.ts:32-45`).  There is no existing `noRoutine` reason to reuse.  The required product/contract/fixture work is therefore: make archaeology gate authoring, emit a visible `ineligible` event with a new reason, extend the fixture schema/script vocabulary, and retain this case as a product-failing case until that path lands.

## Five logic questions

1. **Silent failure:** the changed fixture makes a non-routine candidate creation look like correct feed parity (`index.json:237-270`), concealing a product failure from the scorecard.
2. **Unexpected user action:** ending a session containing a single edit but no routine produces a candidate before archaeology can reject it (`stage-handlers.service.ts:312-340`).
3. **Wrong-answer input:** the three ground-truth `routine: null` single-edit transcripts yield `analyze-run`, not visible rejection (`index.json:238,249,260`; `skill-synthesis.service.ts:1186-1193`).
4. **Dependency failure/timeout/wrong shape:** non-missing RPC errors are now retained (`funnel-host-port.ts:207-212`); the intentional never-settling reconcile scenario is bounded and its child is disposed (`funnel-lifecycle.ts:419-429`; `funnel-host-port.ts:712-720`).
5. **Unspecified missing requirement:** the event schema has no reason for the required no-routine rejection (`skill-session-fixture.ts:25-28`), so it cannot distinguish that valid rejection from a prefilter failure.

## Serious issue

### Ground truth encodes the known single-session authoring bug as a pass

- **Files:** `tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/index.json:237-270`; `tools/mcp-bench/src/memory-skills/ground-truth/skill-session-fixture.ts:63-68`; `libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts:312-340`.
- **Scenario:** Sessions 20–22 have no labelled routine, yet a single edit satisfies the prefilter and authoring runs before archaeology.
- **Impact:** `skill.funnel.feed-parity` ceases to be evidence for TASK_2026_588.  It can report parity while candidates are incorrectly drafted from non-routines.
- **Fix:** Reverse the product ordering so archaeology is a pre-authoring gate; add a durable visible no-routine rejection reason to the event contract; update the fixture to expect that `ineligible` event and assert the present product output is a fail-today result.

## Verification

- Diagnostics for the changed benchmark paths: 0 errors, 0 warnings.
- Tests: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` — **Tests: 578 passed, 578 total** (51 suites, 143.496 s).

No additional logic defect was evidenced in the scoped correction changes.  No source file was modified by this review.

## Verdict

**REVISE.** The benchmark must fail on the current single-session auto-candidate behaviour, not normalize it.  Once the contract can express a visible no-routine rejection and the feed-parity case expects it, the closed round-1 corrections support re-review at the 5–6 band or higher.
