# Batch B1 report — Panel schemas and import

## Round 1 fixes

Codex logic review returned REVISE. All four findings are fixed.

1. Eligibility derives the canonical family only from the resolved provider and model. Tier aliases (`sonnet` / `opus` / `haiku`) resolve first, then an OpenCode Zen or Go model must be an own property of `OPENCODE_MODEL_ROUTES`. OpenAI identifiers are ineligible: `openai`, `openai-*`, `openai-codex`, `codex` forms, `gpt-*`, and o-series ids (`o1`, `o3`, `o4-mini`). A declared family that disagrees with the derived family is rejected. An unknown model is ineligible. The method string uses the derived spelling (`model-panel:xAI+Google; adjudicator=GLM`). Tier tables and the route table come from `@ptah-extension/shared` (npm scope). A relative import of `libs/shared` failed `@nx/enforce-module-boundaries`.
2. `rubricAgreementOptionsSchema` and `judgeAgreementOptionsSchema` take an optional private manifest, validated with `panelManifestSchema`, and require each panel `raterId` to match `options.raters`. `panelProvenanceFromManifest` re-runs eligibility and passes `method`, `population`, and `unresolvedCount` into `loadRubricGroundTruth`. The scorecard `groundTruth.method` stays the closed enum value `labelled` (619-owned `scorecard.types.ts` was not edited). The model-panel method string and `raterCount=2` are written on `claim.text`, the same place batch B2 uses.
3. The loader keeps the frozen eligible population separate from accepted labelled documents. Agreement, strata, candidates, and anchors use accepted, adjudicated labels. Metrics report the full population and the unresolved share. A missing rater row is unresolved when a panel is supplied. The load stays trusted at exactly 10% and marks the activity ground-truth-untrusted only when the share is above 10% (`unresolvedCount * 10 > population`). One unresolved document of ten stays trusted. The load throws when the manifest population or unresolved count disagrees with the frozen documents.
4. Specs cover OpenCode `gpt-5.6-terra`, o-series, a Copilot tier alias, and a declared-versus-resolved mismatch; criterion 6 with total 64 passes and the infeasible neighbours fail; a total gap of exactly 12 does not adjudicate and 13 does; both the rubric suite and the judge suite run once with a real panel manifest.

Files touched in this round, in addition to the round-0 list: `rubric-agreement.suite.ts`, `rubric-agreement.suite.spec.ts`, `judge-agreement.suite.ts`, `judge-agreement.suite.spec.ts`. Not edited: `namer-and-trigger.suite.ts`, `trigger-human-eval.ts`, `README.md`, `libs/`, `.claude/commands/orchestrate.md`, and 619-owned `scorecard/`, `transport/`, `corpus/`, `bench-data.ts`.

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/ground-truth tools/mcp-bench/src/memory-skills/suites/skills/rubric tools/mcp-bench/src/memory-skills/suites/skills/judge --runInBand --silent
```

Result: Test Suites: 11 passed, 11 total. Tests: 167 passed, 167 total. Snapshots: 0 total. Time: 82.07 s.

ESLint on the nine changed sources: exit 0, 0 errors, 2 `max-lines` warnings (`model-panel.ts` 713, `judge-agreement.suite.ts` 732; the rule is `warn` at 700). Prettier `--check` after `--write`: "All matched files use Prettier code style!"

U1–U4 panel labels now have a manifest schema, a family-eligibility rule, a `groundTruth.method` builder, and import into the existing label rows. Unresolved answers stay in the frozen-population denominator. More than 10% unresolved is ground-truth-untrusted.

## Files changed

- `tools/mcp-bench/src/memory-skills/labelling/model-panel.ts` (new)
- `tools/mcp-bench/src/memory-skills/labelling/model-panel.spec.ts` (new, 20 tests)
- `tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.ts`
- `tools/mcp-bench/src/memory-skills/ground-truth/label-schemas.spec.ts` (5 tests added; 44 in the file)
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.ts`
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth.spec.ts` (new; round 1 added the population and gap cases)
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.ts` (round 1)
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts` (round 1)
- `tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.ts` (round 1)
- `tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.spec.ts` (round 1)

`scorecard/`, `transport/`, `corpus/`, and `bench-data.ts` were not touched. Round 1 also left `namer-and-trigger.suite.ts`, `trigger-human-eval.ts`, `README.md`, and `libs/` alone.

## Schemas added

Private manifest (`panelLaneManifestSchema`, `panelManifestSchema`): opaque `raterId`, `family`, resolved `provider` and `model`, `promptSha256`, `packetCount`, `responseCount`, `failureCount`, `timestamp`. The manifest also records `population`, `unresolvedCount`, and `unresolvedShare` (must equal the ratio).

Eligibility (`evaluatePanelEligibility`): two raters from distinct non-OpenAI families plus an adjudicator from a third family. The lane is the resolved family (and provider/model). `cliName` is ignored.

Method (`modelPanelMethod`): `model-panel:<A>+<B>; adjudicator=<C>`. Example: `model-panel:xAI+Google; adjudicator=GLM`. `raterCount` is 2 (`RUBRIC_GROUND_TRUTH_RATER_COUNT`, `rubricGroundTruthMetadata`).

U2: `panelMemoryDecisionSchema`, `panelMemoryAdjudicationSchema` (`decision-differs`, `replacement-hash-differs`). Accept has no replacement; edit requires one; reject excludes. Accepted fact, merge, update, and temporal drafts are parsed with the existing strict schemas and stamped `labeller` / `labelledAt`. An accepted abstention is returned as `excluded` / `accepted-abstention` with the abstention row.

U3: `panelMatcherLabelSchema`, `panelMatcherAdjudicationSchema` (`match-differs`). `toMatcherSampleRow` fills packet `subject`, `content`, and `chunk` into `matcherSampleRowSchema`. `humanMatch` stays the committed key; `MATCHER_MATCH_PROVENANCE` is `panel-labelled`.

U4: `panelSessionLabelSchema`, `panelSessionAdjudicationSchema` (`line-refs-differ`) strip to `realSessionLabelSchema`. `panelTriggerLabelSchema`, `panelTriggerAdjudicationSchema` (`prompt-array-hash-differs`) plus `committedTriggerLabelSchema` (`skillId`, `description`, `shouldTrigger`, `nearMiss`).

U1 import (`importRubricPanelCsv`) uses the existing columns `opaqueId,raterId,c1..c8,total,pass,ratedAt` and `rubricScoreRowSchema` (integer 0–10, total is the sum, pass iff total >= 64 and no criterion < 6). Rubric adjudication is unchanged: pass differs or totals differ by more than 12 (`ADJUDICATION_TOTAL_GAP`).

`unresolved-model-panel`: a declined line or a second-failure invalid row is excluded from the accepted set and kept in the denominator. Missing rows up to `population` count too. `unresolvedCount * 10 > population` (more than 10%) sets `ground-truth-untrusted`. Exactly 10% stays trusted. `loadRubricGroundTruth` records this when `options.panel` is set.

## Checks

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/labelling tools/mcp-bench/src/memory-skills/ground-truth tools/mcp-bench/src/memory-skills/suites/skills/rubric-ground-truth --runInBand --no-coverage
```

Result: 9 suites passed, 136 tests passed, 0 failed. Time 30.3 s. Includes the new panel and rubric specs and the existing labelling and ground-truth specs.

```
npx eslint <the six files above>
```

Result: exit 0, no findings.

```
npx prettier --check <the six files above>
```

Result: first check warned on `model-panel.ts`, `model-panel.spec.ts`, and `rubric-ground-truth.ts`. `prettier --write` fixed those three. Re-check: "All matched files use Prettier code style!" ESLint re-run after the write: exit 0.

`ptah_get_diagnostics` on the six files did not finish (TypeScript check still running after 45s, 6 files unchecked). The Jest run compiled the same files with ts-jest.

## Decisions

- The method string has a space after the semicolon, matching this batch's builder `model-panel:<A>+<B>; adjudicator=<C>`. The design addendum's scorecard example (`model-panel:xAI+Google;adjudicator=GLM`) has no space. 619's `groundTruth.method` enum was left alone.
- OpenAI is rejected when the family, provider, or model normalizes to `openai`, `openai-*`, `openai/*`, or `gpt-*`. A CLI named grok with family xAI is eligible. Two CLIs of family xAI are not.
- Family equality is case-insensitive. The method string keeps the caller's spelling, in rater order.
- The 10% cap uses an integer comparison so 1/10 stays trusted. The share reported is `unresolvedCount / population`.
- This module does not retry. A lane retries invalid output once, then imports the second failure as unresolved.
- A merge edit's `replacement` is JSON `{"left":string,"right":string}`. Fact and abstention edits replace `statement`. Update and temporal edits replace `expectedAnswer`.
- Without `options.panel`, a loaded rubric file still reports `method: 'labelled'` so current fixtures keep their meaning. With a panel, the method is the builder string.

## Deviations

- Round 0 left `rubric-agreement.suite.ts` emitting only `method: 'labelled'`. Round 1 wires a validated manifest through that suite and the judge suite. The persisted scorecard method stays `labelled`; `claim.text` carries the panel method and `raterCount=2`.
- `committedTriggerLabelSchema` duplicates the shape of `triggerLabelSchema` in `trigger-human-eval.ts`. That module belongs to batch B2 and was not edited.
- The `HumanConsensus` type name is unchanged so existing suite imports stay valid. The comment now says the verdict is a model-panel or legacy consensus.
- Diagnostics did not return a TypeScript result within 45s. Jest's compile is the type check that completed.
