# Code Logic Review P1 — TASK_2026_879_9809 (libs/backend/lane-routing)

Review family: reviewer claude (in-process), implementer codex

Score: 8/10. Verdict: APPROVED (0 blocking, 0 serious, 2 moderate, 2 minor).

## Findings

1. Moderate — `route-decide.service.ts:154-156` and the `throw` sites at `:142`, `:198`, `:275`. A route that throws (schema failure after the model call, caller open failure) emits no `route decided` log. This matches "exactly one per successful call" and the tests assert no log on invalid input. For diagnosing a decision-model problem, a failed route is the case that most needs a record. Fix (optional): note the intent in the plan, or add a `route failed` warn carrying `stage`, `durationMs` and the error name only.

2. Moderate — `reasons/decision-summary.ts` (`phases[].phaseId`, `executor`). These are caller-supplied or config-supplied strings logged verbatim. They are not request text and not free-form reasons, but a caller could put prose in a `phaseId`. Fix: cap the length or restrict the charset when logging, or document that phase ids are treated as identifiers.

3. Minor — `route-decide.service.ts:145-148`. The reused pre-flight log reports `caller: 'unset'` and `outcomeFigures: 0`. This is correct, since no caller is opened on reuse. The test for the reused path should assert `reused: true` and exactly one `info` call; I could not confirm that assertion in the diff excerpt.

4. Minor — `phase-plan.ts:34`. `LANE_INSTRUCTIONS` says "pastOutcomes". That is the real payload field name (`decision-payload.ts:81`). In the structured (non-system-one) path the prompt instead renders `past outcomes <lane>/<kind>: …` lines (`model-refine.ts:335`), so the wording is slightly mismatched there. This is cosmetic.

## Verified

- **pastOutcomes aggregation** (`matrix/outcome-figures.ts`):
  - Verdicts are verified-only: `unverified` is skipped, and `failed` plus `no-deliverable` count as failed.
  - Rows for `SUBAGENT_LANE_ID`, blank lanes and `taskKind === null` are skipped.
  - Rows are deduped by run through the now-exported `dedupeByRun` (`local-derivation.ts:95`), with no behaviour change.
  - Keys are JSON-encoded pairs, so there is no delimiter collision.
- **Degrade paths** (`capability-matrix.store.ts:280-321`): the unavailable, no-history, no-lane-ids and reader-throw branches all return `EMPTY_OUTCOME_FIGURES`. The neutral snapshot in `gather.ts:289` does the same. Figures come only from the successful read, where they are built from the same `summaries` as the derived matrix.
- **Offered pairs and byte cap** (`model-refine.ts:233-258`): `offeredFigures` runs inside the width loop, so the payload bytes and the structured prompt bytes both count the figures. Only options actually offered are used, the subagent lane is skipped, each phase uses its own `taskKind`, and pairs are deduped. `figureCount` returned from `fitLane` feeds `outcomeFigures`. Fixed pre-flight questions keep `outcomeFigures: []`, so the pre-flight payload is unchanged.
- **NFR field set**: `decision-payload.ts` is untouched in the diff. `DecisionOutcomeFigures` is still lane, kind, delivered and failed. `outcome-figures.spec.ts:84` asserts exactly that.
- **Logging:**
  - Single log site per success path: reused pre-flight (`:147`), pre-flight (`:200`) and gate (`:278`). The gate has no early returns, so there is no double log.
  - Payloads come from `preflightSummary` and `gateSummary`, which contain enums, ids, counts and durations only. The request text and the `reasons` strings are excluded, and the tests assert this.
  - `logSummary` isolates both builder and logger failures with a nested try/catch, and the warn carries only the error name.
  - Pass 1 and pass 2 figure counts are summed.
- **Depth mapping:** `DEPTH_CRITERIA` is built by mapping over `DEPTHS` (`['Full','Partial','Minimal']`), so o1/o2/o3 correspond to Full/Partial/Minimal, which is what `criterionLabels` and `readPreflight` index against. The `taskType` criteria and the threshold are untouched. The live fixtures call `preflightQuestions()` itself, so they cannot drift, and the expected labels are correct (rename gives o3, vague scope gives o1).
- **Callers of the changed contracts:** `LaneQuestion` is built only by `laneQuestion` (`phase-plan.ts:209`). `ModelRequestOutcome` is built in `model-call.ts`, where every return site now sets `outcomeFigures` (the `:136-180` block is complete), and consumed read-only in `scope-check.service.ts` and `decision-caller.ts`. `CapabilityMatrixSnapshot` is built in `capability-matrix.store.ts` and `gather.ts` (`neutralSnapshot`) only. A grep of `apps` and `libs` found no consumer outside lane-routing (no rpc-handlers, vscode-lm-tools or cli-engine use of these types). The package index is not modified, so there is no public API break.
- **Tests:** `model-refine.spec.ts` covers width shrinking under the byte cap, per-phase task kind, subagent skipping and the structured prompt. The gate and pre-flight specs check payload `pastOutcomes` keys and values, `info` called exactly once, absence of the request text, and a throwing logger. These tests assert behaviour, not only shape.
- **Not run:** I did not run any test, build or verify, per the rules. I relied on the orchestrator's 3/3 result.
