# Batch S1 report — adopt the 619 model-panel schema

619 `suite-kinds.ts` (`GROUND_TRUTH_METHODS` includes `model-panel`; `refineGroundTruthPanel` requires `panel` for that method and rejects it otherwise; `SuiteView.displayLabel` is 1–80 characters) is consumed, not edited. No files under `tools/mcp-bench/src/scorecard/`, `transport/`, `corpus/`, `suites/question-sets.ts`, or `bench-data.ts` were changed. Nothing was committed.

## Files changed

- `tools/mcp-bench/src/memory-skills/labelling/model-panel.ts`
- `tools/mcp-bench/src/memory-skills/labelling/model-panel.spec.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.spec.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.spec.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts`
- `tools/mcp-bench/src/memory-skills/runner/suite-result.ts`
- `tools/mcp-bench/src/memory-skills/runner/suite-result.spec.ts`
- `tools/mcp-bench/src/memory-skills/runner/run-scorecard.ts`
- `tools/mcp-bench/src/memory-skills/projection.spec.ts`
- `tools/mcp-bench/src/memory-skills/memory-skills-suite-kinds.spec.ts`
- `tools/mcp-bench/README.md`

## Decisions

- `modelPanelMethod` is replaced by `modelPanelName` (`labelling/model-panel.ts:241`). It returns `${A}+${B}; adjudicator=${C}` (example `xAI+Google; adjudicator=GLM`), without the `model-panel:` prefix. The eligibility ok-branch (`model-panel.ts:435`) returns `method: 'model-panel' satisfies GroundTruthMethod` and `panel: modelPanelName(...)`.
- Loaded rubric truth carries `method: 'labelled' | 'model-panel'` and `panel` only in the model-panel branch (`rubric-ground-truth.ts`, load return). `rubricGroundTruthMetadata` (`rubric-ground-truth.ts:290`) returns `{ id, version, method, panel?, raterCount }` and throws if `model-panel` has no panel or `labelled` is given one.
- `rubric-agreement.suite.ts:360` and `judge-agreement.suite.ts:785` call that helper when panel labels are loaded, and use `labelled` with no `panel` otherwise. Claim text interpolates the panel string (`xAI+Google; adjudicator=GLM`), not `model-panel:...`.
- Trigger suite id stays `skill.trigger-eval.human`. Both suite results set `displayLabel` to `TRIGGER_EVAL_DISPLAY_LABEL` (`skill.trigger-eval.panel`). `triggerLabelSchema` (`trigger-human-eval.ts:115`) gained optional `panel`. `triggerLabelPanel` (`trigger-human-eval.ts:528`) uses `model-panel` plus that string when every row shares one panel, `labelled` with no panel when none do, and throws when rows disagree. The old comment that 619's enum could not hold the panel string is removed. Header comments now say 619 accepts `model-panel`.
- `suite-result.ts:198` and `run-scorecard.ts:219` copy `displayLabel` onto the suite view. `groundTruth` is copied as a whole, so `panel` stays. `projection.ts:82` already assigns `groundTruth: input.suite.groundTruth`, so `panel` is in the projection. `displayLabel` stays off the projection whitelist (`projection.ts:49-61`); it is presentation on the SuiteView, which is what the scorecard markdown heading reads.
- The only `groundTruth: z.` under memory-skills is `runner/runner-plan.ts:57`, a plan ref `{ id, paths }`, not a scorecard method list. It was left as it is. No local method enum was replaced; suite results already validate through 619 `suiteCoreSchema`, which uses `GROUND_TRUTH_METHODS` and `refineGroundTruthPanel`.
- `committedTriggerLabelSchema` / `toCommittedTriggerLabel` still omit `panel`. A file those writers emit has no panel, so the trigger suite records `labelled` until a writer stamps the optional field.

## Checks

Command (once):

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --coverage=false --maxWorkers=2`

Tail:

```
Test Suites: 55 passed, 55 total
Tests:       651 passed, 651 total
Snapshots:   0 total
Time:        54.934 s, estimated 81 s
Ran all test suites matching tools/mcp-bench/src/memory-skills.
```

Exit code 0. Jest also printed: "A worker process has failed to exit gracefully and has been force exited." The run still passed.

Command (once):

`npx tsc -p tools/mcp-bench/tsconfig.json --noEmit --pretty false`

Output was only a Node warning (`NO_COLOR` ignored because `FORCE_COLOR` is set). No type errors. Process exit 0.

## Open issues

- The Jest worker force-exit warning is not a failed suite. It was not investigated with `--detectOpenHandles`.

## Revise round 1

The blocking finding was that U4 committed trigger rows dropped `panel`, so the trigger suite reported `labelled`. Applied the review's three steps.

- `committedTriggerLabelSchema` (`ground-truth/label-schemas.ts:529`) now has optional `panel: z.string().trim().min(1)`. The committed-row comment above the schema documents that the value is `PanelEligibility.panel` / `modelPanelName`, and that it is omitted when the row is unpanelled. `label-schemas.spec.ts` checks trim and rejects a blank panel.
- `toCommittedTriggerLabel` (`labelling/model-panel.ts:612`) takes `panel: string | undefined` and writes the field only when it is defined. The committed-row test passes `evaluatePanelEligibility(...).panel` (equal to `modelPanelName('xAI', 'Google', 'GLM')`) and asserts that string survives; `undefined` omits the key (`model-panel.spec.ts:526`).
- Trigger-suite tests write those committed rows and run `runTriggerEvalHuman`: one verified panel yields `method: 'model-panel'`, that panel, and `raterCount: 2` (`namer-and-trigger.suite.spec.ts:672`); no panel yields `labelled` with no `panel` property; mixed panelled/unpanelled rows throw `/mix a panel/`; two verified panels (`xAI+Google` vs `Google+xAI`) throw `/more than one panel/`.

Checks, once each:

`npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --coverage=false --maxWorkers=2`

```
Test Suites: 55 passed, 55 total
Tests:       653 passed, 653 total
Snapshots:   0 total
Time:        83.177 s
Ran all test suites matching tools/mcp-bench/src/memory-skills.
```

Exit code 0.

`npx tsc -p tools/mcp-bench/tsconfig.json --noEmit --pretty false`

Log length 164 bytes. The only text is the Node warning that `NO_COLOR` is ignored because `FORCE_COLOR` is set. No type errors. Wrapper exit code 0.
