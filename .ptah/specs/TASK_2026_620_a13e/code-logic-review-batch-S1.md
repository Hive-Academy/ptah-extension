# Code logic review — Batch S1

Verdict: **REVISE**  
Score: **5/10**  
Findings: **1 Blocking, 0 Serious, 0 Moderate**; failure modes identified: **1**.

## Scope and evidence

Reviewed the complete changed production files and their changed tests, the S1 report, the design addendum's “Scorecard honesty” requirement, the 619 scorecard contract, and the relevant scorecard/projection paths. `git diff --name-only` contains no changed path under `scorecard/`, `transport/`, `corpus/`, `suites/question-sets.ts`, or `bench-data.ts`.

TypeScript diagnostics for the changed production files reported 0 errors and 0 warnings. The targeted Jest command passed; its exact tail is included below. Passing tests do not cover importing a U4 panel label through to the trigger scorecard metadata.

## Finding

### Blocking — U4 panel imports silently lose provenance and are emitted as ordinary labelled ground truth

`committedTriggerLabelSchema` has no `panel` field ([label-schemas.ts:521-526](../../../tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.ts#L521)), and `toCommittedTriggerLabel` consequently serializes only the four legacy fields ([model-panel.ts:603-612](../../../tools/mcp-bench/src/memory-skills/labelling/model-panel.ts#L603)). The existing test locks that provenance loss in as expected output ([model-panel.spec.ts:521-526](../../../tools/mcp-bench/src/memory-skills/labelling/model-panel.spec.ts#L521)).

The reader does accept an optional panel ([trigger-human-eval.ts:105-116](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L105)), but no U4-produced row can supply it. `triggerLabelPanel` returns `undefined` when every imported row lacks it ([trigger-human-eval.ts:527-542](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L527)), and `triggerGroundTruth` then reports `{ method: 'labelled' }` ([trigger-human-eval.ts:545-556](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L545)). This is a success-looking, schema-valid scorecard that falsely omits the verified model-panel provenance required by the design ([design addendum:62](design-addendum-codex-recording-and-model-panel.md#L62)). It is blocking for the upcoming U4 import, because the loss occurs at the committed artifact boundary and cannot be reconstructed from the resulting rows.

Exact change required before U4 import:

1. Add optional `panel: z.string().trim().min(1).optional()` to `committedTriggerLabelSchema` and its committed-row documentation in `ground-truth/label-schemas.ts`.
2. Add a `panel: string | undefined` parameter to `toCommittedTriggerLabel`, include it only when defined, and have `labelling/model-panel.ts`'s U4 import pass the verified `PanelEligibility.panel` / `modelPanelName(...)` value, rather than accepting a free-form family string.
3. Update the committed-row test to assert that a verified panel survives. Add end-to-end trigger-suite tests proving: all rows with one panel produce `method: 'model-panel'` plus that panel and `raterCount: 2`; no rows with a panel produce `method: 'labelled'` with no panel; mixed or differing panels throw before a misleading scorecard is produced.

## Verified behaviour outside the finding

- The 619 boundary rejects a panel with any method other than `model-panel`, and rejects `model-panel` without one ([suite-kinds.ts:14-31](../../../tools/mcp-bench/src/scorecard/suite-kinds.ts#L14)). `suiteResultSchema` passes result fields through that core schema and refuses dropped unknown keys ([suite-result.ts:166-183](../../../tools/mcp-bench/src/memory-skills/runner/suite-result.ts#L166)).
- Rubric metadata throws for both invalid method/panel combinations ([rubric-ground-truth.ts:305-318](../../../tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.ts#L305)). The trigger helper also throws for mixed or inconsistent panels ([trigger-human-eval.ts:535-540](../../../tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts#L535)). That is the correct failure mode: the runner fails instead of manufacturing a valid-looking but false provenance block.
- `displayLabel` is retained by the input schema result ([suite-result.ts:184-205](../../../tools/mcp-bench/src/memory-skills/runner/suite-result.ts#L184)) and copied to the scorecard suite ([run-scorecard.ts:199-223](../../../tools/mcp-bench/src/memory-skills/runner/run-scorecard.ts#L199)). The projection only includes ground truth, not `displayLabel` ([projection.ts:49-85](../../../tools/mcp-bench/src/memory-skills/projection.ts#L49)); its test verifies display-label omission while preserving panel ground truth ([projection.spec.ts:261-288](../../../tools/mcp-bench/src/memory-skills/projection.spec.ts#L261)). Thus suites without panel/displayLabel retain their prior projection shape and hash inputs.

## Five logic questions

1. **Silent failure:** U4 import succeeds, but strips `panel` and later reports `labelled`, concealing non-human panel provenance (finding above).
2. **Unexpected user action:** importing otherwise valid U4 panel output through `toCommittedTriggerLabel` produces the legacy-labelled trigger scorecard instead of `model-panel`.
3. **Wrong-answer input:** any valid U4 `PanelTriggerLabel` or adjudication from verified rater families is converted to a committed row with no family record, so it receives the wrong method rather than an error.
4. **Dependency failure/invalid shape:** malformed, mixed, or differently panelled trigger rows fail fast at parsing/`triggerLabelPanel`; rubric helpers likewise throw on invalid pairs. I found no path here that converts those failures into a success response.
5. **Missing requirement coverage:** persistence of verified panel identity through the U4 committed-label format and importer was omitted. Current tests exercise the reader's optional field, but not the writer-to-scorecard chain.

## Score rationale

This is above 3–4 because the 619 validation, display-label propagation, projection treatment, and invalid-pair fail-fast behaviour are implemented and tested. It cannot reach 7–8 while a mandatory, imminent U4 path silently publishes a valid-looking but dishonest ground-truth method. The localized blocking provenance loss puts it at 5 rather than a broad foundational rejection.

## Targeted Jest evidence

Command run once:

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/suites/skills tools/mcp-bench/src/memory-skills/runner tools/mcp-bench/src/memory-skills/projection.spec.ts tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.spec.ts --coverage=false --maxWorkers=2 > "$TEMP/s1-review-jest.txt" 2>&1
```

Exact Jest tail:

```text
Test Suites: 18 passed, 18 total
Tests:       235 passed, 235 total
Snapshots:   0 total
Time:        32.792 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/labelling|tools/mcp-bench/src/memory-skills/suites/skills|tools/mcp-bench/src/memory-skills/runner|tools/mcp-bench/src/memory-skills/projection.spec.ts|tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.spec.ts.
```
