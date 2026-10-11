# Batch B2 report — terminology and docs

The trigger suite no longer describes its labels as human ground truth. The suite id stays `skill.trigger-eval.human` with an explicit compatibility note. The display label is `skill.trigger-eval.panel`. The written result keeps `groundTruth.method: 'labelled'` so 619's closed enum still validates, and carries `model-panel:xAI+Google; adjudicator=GLM` on `claim.text`.

## Files changed

| File | Change |
| --- | --- |
| `tools/mcp-bench/src/memory-skills/suites/skills/trigger-human-eval.ts` | Display label, panel-method constant, compatibility note, `raterCount: 2`, honest method string on `claim.text`. Suite id unchanged. |
| `tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts` | Asserts suite id, display label, `method: 'labelled'`, `raterCount: 2`, and the panel string on `claim.text`. |
| `tools/mcp-bench/README.md` | Created. Section "Ground truth: model panel". |

No files under `scorecard/`, `transport/`, `corpus/`, `labelling/`, `ground-truth/`, or `bench-data.ts` were edited.

## Checks

| Command | Result |
| --- | --- |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills --runInBand` | 5 suites passed, 59 tests passed, 0 failed. Time 118.5 s. Includes `namer-and-trigger.suite.spec.ts`. |
| `npx eslint` on the two changed `.ts` files | Exit 0. No findings. |
| `npx prettier --check` on the two `.ts` files and `tools/mcp-bench/README.md` | Exit 0 after `prettier --write` on the README (first check warned on that file only). |
| `ptah_get_diagnostics` on the two `.ts` files | 0 errors, 0 warnings. Coverage clean. |

## Decisions

- **Suite id kept.** `TRIGGER_EVAL_HUMAN_SUITE_ID` remains `skill.trigger-eval.human`. The host registry (`namer-and-trigger.suite.ts`) and the result filename (`<suiteId>.suite.json`) use that id. 619's suite view has no display-label field, so renaming the id would move the scorecard identity. Comment and `claim.text` both say: `model-panel labels; id kept for compatibility`.
- **Display label.** `TRIGGER_EVAL_DISPLAY_LABEL` is `skill.trigger-eval.panel`. It is copied into `claim.text` because the written suite view cannot store a separate display field.
- **Method enum.** `groundTruth.method` is `labelled`, the closest value in `generated | labelled | seeded | git-history`. The prompts are labels, not generated, seeded, or taken from git history. `raterCount` is `2` (xAI and Google). GLM is the adjudicator, not a third rater.
- **Honest string.** `TRIGGER_EVAL_PANEL_METHOD` is `model-panel:xAI+Google; adjudicator=GLM` (space after the semicolon, as the batch states). It is written on `claim.text` as `Ground truth note: …`.

## Deviations

- The spec that tests this suite is `namer-and-trigger.suite.spec.ts`. There is no `trigger-human-eval.spec.ts`.
- The panel string is on `claim.text`, not on `details` or a `note` field. `funnelDetailsSchema` (`memory-skills-suite-kinds.ts:209`) is strict and has no note key. `suite-result.ts` refuses unknown top-level keys. Both files are outside this batch.
- `namer-and-trigger.suite.ts` still says the suite "scores human labels" in its CI refusal message. That file is outside this batch.
- `tools/mcp-bench/README.md` did not exist. This batch created it with the required section only.

## Requests to 619

Widen the closed enum so a suite may report the panel method without failing validation.

- `tools/mcp-bench/src/scorecard/scorecard.types.ts:30` — `method: z.enum(['generated', 'labelled', 'seeded', 'git-history'])`. Accept `model-panel:xAI+Google; adjudicator=GLM` (or a `model-panel:<families>` form) in addition to the four current values. Do not coerce that string back to `labelled`.
- `tools/mcp-bench/src/scorecard/suite-kinds.ts:15` — `SuiteView.groundTruth.method` is the same four-value union. Keep it aligned with the schema.
- Add a backward-compatible display-note field on the suite view so the scorecard can show `skill.trigger-eval.panel` while the suite id stays `skill.trigger-eval.human`. Unknown keys are refused by `tools/mcp-bench/src/memory-skills/runner/suite-result.ts` (the unrecognized-key check), so the field has to be declared on the 619 schema before a suite can persist it.

Until that lands, this suite stores `method: 'labelled'` and puts the panel string on `claim.text`.

## Round 1 fixes

Codex review: REVISE (major CI refusal still said "human labels"; minor README omitted model/timestamp and unresolved-share disclosures).

- `namer-and-trigger.suite.ts`: the `--ci` refusal now says it scores model-panel labels, names display label `skill.trigger-eval.panel`, and includes `model-panel labels; id kept for compatibility`. The file header no longer calls the prompts human-labelled.
- `namer-and-trigger.suite.spec.ts`: the CI test expects that exact trigger-suite message and checks it does not contain `human labels`.
- `README.md`: each panel run records provider, model, model version, and timestamp in the private manifest. No frozen manifest exists yet, so those values and the unresolved share are pending, not a completed panel. A second invalid or declined answer is `unresolved-model-panel` and stays in the denominator. More than 10% unresolved marks the activity ground-truth-untrusted and blocks the affected metric pending escalation.

### Round 1 checks

| Command | Result |
| --- | --- |
| `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills --runInBand` | Test Suites: 6 passed, 6 total. Tests: 63 passed, 63 total. 0 failed. Time 93.4 s. The extra suite is `rubric-ground-truth.spec.ts`, added by another lane. |
| `npx eslint` on `namer-and-trigger.suite.ts` and `namer-and-trigger.suite.spec.ts` | Exit 0. No findings. |
| `npx prettier --check` on those two files and `tools/mcp-bench/README.md` | Exit 0. All matched files use Prettier code style. |
