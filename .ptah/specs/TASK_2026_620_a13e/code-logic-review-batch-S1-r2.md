# Code logic review — Batch S1, round 2

Verdict: **APPROVED**  
Score: **8/10**  
Findings: **0 Blocking, 0 Serious, 0 Moderate**; failure modes identified: **0**.

## Round-1 finding — resolved

The blocking U4 provenance loss is resolved end to end.

- The committed U4 row schema now retains an optional, trimmed, non-blank `panel`, documented as the verified `PanelEligibility.panel` / `modelPanelName` value ([label-schemas.ts:516-531](../../../tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.ts#L516)). Its schema test confirms trim and blank rejection ([label-schemas.spec.ts:658-675](../../../tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.spec.ts#L658)).
- `toCommittedTriggerLabel` now takes the panel explicitly and includes it only when supplied ([model-panel.ts:603-620](../../../tools/mcp-bench/src/memory-skills/labelling/model-panel.ts#L603)). The writer test passes `evaluatePanelEligibility(...).panel`, confirms its canonical family string persists, and confirms `undefined` omits the key ([model-panel.spec.ts:521-543](../../../tools/mcp-bench/src/memory-skills/labelling/model-panel.spec.ts#L521)).
- The trigger-suite fixture obtains the panel through `evaluatePanelEligibility`, then calls the actual committed-row writer before writing the label file ([namer-and-trigger.suite.spec.ts:419-446](../../../tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts#L419)). It proves one verified panel yields `model-panel`, that panel, and `raterCount: 2` ([namer-and-trigger.suite.spec.ts:671-692](../../../tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts#L671)); no panel yields `labelled` without a `panel` property ([namer-and-trigger.suite.spec.ts:694-709](../../../tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts#L694)); mixed and distinct-panel files reject rather than produce a misleading scorecard ([namer-and-trigger.suite.spec.ts:711-749](../../../tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts#L711)).

The consumer's branching matches those assertions: it returns no panel only for an entirely unpanelled file and throws for mixed or different values ([trigger-human-eval.ts:527-542](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L527)); it emits `labelled` without a panel or `model-panel` with one ([trigger-human-eval.ts:545-556](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L545)). The 619 core contract independently rejects either invalid pairing ([suite-kinds.ts:14-31](../../../tools/mcp-bench/src/scorecard/suite-kinds.ts#L14)).

## New findings

None. I found no path in the reviewed writer-to-reader chain that drops, fabricates, or silently relabels a supplied panel. The revised diff remains outside the prohibited `scorecard/`, `transport/`, `corpus/`, `suites/question-sets.ts`, and `bench-data.ts` paths. TypeScript diagnostics for changed production files reported 0 errors and 0 warnings.

## Five logic questions

1. **Silent failure:** none found in the reviewed panel-provenance path; mixed/different panel data throws instead of falling back to `labelled`.
2. **Unexpected user action:** none found for the required U4 cases; a deliberately mixed label file now fails before scorecard construction.
3. **Wrong-answer input:** none found for all-panel or no-panel committed rows; the result method and optional field agree with the input population.
4. **Dependency failure or invalid shape:** malformed persisted rows are schema-validated; invalid provenance combinations fail at the trigger helper and again at the 619 scorecard boundary. This review did not exercise an external labelling provider, which is outside this batch's pure import/result path.
5. **Missing requirement:** none identified for the round-1 remediation. The end-to-end test covers the requested writer, persistence format, and suite result behaviour.

## Score rationale

This earns 8 rather than 9–10 because the evidence is targeted synthetic import-to-suite coverage, not a production U4 data import. It is above 6 because the previous blocking data-loss path is fixed at every relevant boundary, explicitly tested for both allowed states and both inconsistent states, and diagnostics plus the prescribed focused suite pass.

## Targeted Jest evidence

Command run once:

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/ground-truth tools/mcp-bench/src/memory-skills/suites/skills tools/mcp-bench/src/memory-skills/runner tools/mcp-bench/src/memory-skills/projection.spec.ts --coverage=false --maxWorkers=2 > "$TEMP/s1-r2-jest.txt" 2>&1
```

Exact Jest tail:

```text
Test Suites: 22 passed, 22 total
Tests:       296 passed, 296 total
Snapshots:   0 total
Time:        31.54 s, estimated 40 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/labelling|tools/mcp-bench/src/memory-skills/ground-truth|tools/mcp-bench/src/memory-skills/suites/skills|tools/mcp-bench/src/memory-skills/runner|tools/mcp-bench/src/memory-skills/projection.spec.ts.
```
