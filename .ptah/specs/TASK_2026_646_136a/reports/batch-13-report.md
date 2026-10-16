# Batch 13 (A7) report

Task 13.1 is implemented. `compileChosenReason`, `compileUnavailableReason`, `compileResultReasons`, `compilePreflightReasons` and `compileGateReasons` build deterministic reason text from structured facts. `overallConfidence` implements Requirement 13.5. `src/index.ts` was not edited (A8 owns exports). No file outside `LR/reasons/` and this report was edited.

## Files

CREATED:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\reasons\compile-reasons.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\reasons\confidence.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\reasons\compile-reasons.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\reasons\confidence.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-13-report.md`

## Requirement coverage

| Req | Function | Spec case |
| --- | --- | --- |
| 13.1 | `compileChosenReason` | `drops structured-output free text and the proposal label from a chosen reason` |
| 13.1 | `compileUnavailableReason` | `drops structured-output free text from an unavailable reason` |
| 13.1 | `compilePreflightReasons` | `drops structured-output free text from pre-flight reasons` |
| 13.2 | `compileChosenReason` | `states seed provenance with asOf and stale and omits the dataset URL` |
| 13.2 | `compileChosenReason` | `states a fresh seed cell as stale false` |
| 13.2 | `compileChosenReason` | `states user provenance and omits the dataset URL and asOf` |
| 13.2 | `compileChosenReason` | `states local provenance with the sample count and omits asOf and sourceRef` |
| 13.2 | `compileChosenReason` | `states no profile when the matrix cell is unknown` |
| 13.2 | `compileChosenReason` | `names a subagent executor and its limit state` |
| 13.2 | `compileChosenReason` | `states when rotation changed the choice` |
| 13.2 | `compileChosenReason` | `states when rotation did not change the choice` |
| 13.2 | `compileChosenReason` | `states when a preference changed the choice and echoes its source` |
| 13.2 | `compileChosenReason` | `states when a preference did not change the choice` |
| 13.2 | `compileChosenReason` | `states the model probability for a model-sourced choice` |
| 13.2 | `compileChosenReason` | `states no confidence reported when a model reports none` |
| 13.2 | `compileChosenReason` | `does not treat a ranking choice as no confidence reported` |
| 13.2 | `compileChosenReason` | `does not treat a pin choice as no confidence reported` |
| 13.2 | `compileChosenReason` | `states fallback cause timeout` |
| 13.2 | `compileChosenReason` | `states fallback cause unreachable` |
| 13.2 | `compileChosenReason` | `states fallback cause auth` |
| 13.2 | `compileChosenReason` | `states fallback cause provider-error` |
| 13.2 | `compileChosenReason` | `states fallback cause bad-output` |
| 13.2 | `compileChosenReason` | `states fallback cause low-confidence` |
| 13.2 | `compileChosenReason` | `states fallback cause payload-too-large` |
| 13.2 | `compileChosenReason` | `states fallback cause question-limit` |
| 13.2 | `compileChosenReason` | `states fallback cause none when there is no fallback` |
| 13.2 | `compileChosenReason` | `states limit state at-limit` |
| 13.2 | `compileChosenReason` | `states limit state near-limit` |
| 13.2 | `compileChosenReason` | `states limit state confirmed-room` |
| 13.2 | `compileChosenReason` | `states limit state unknown` |
| 13.2 | `compileUnavailableReason` | `states no-eligible-candidate when nobody was excluded` |
| 13.2 | `compileUnavailableReason` | `states reviewer-family and the disclosed fallback flag` |
| 13.2 | `compileUnavailableReason` | `states pin-unavailable and the pin rule` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule at-limit on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule disabled on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule not-installed on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule never-on-a-lane on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule reviewer-family on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule pruned on the unavailable entry and the top-level reasons` |
| 13.2 | `compileUnavailableReason` / `compileResultReasons` | `states exclusion rule not-listed on the unavailable entry and the top-level reasons` |
| 13.3 | `compileGateReasons` | `lists each excluded candidate once, then the pin rule, then each missing input` |
| 13.3 | `compileResultReasons` | `names missing input agent-list` |
| 13.3 | `compileResultReasons` | `names missing input limits` |
| 13.3 | `compileResultReasons` | `names missing input roles` |
| 13.3 | `compileResultReasons` | `names missing input model-lists` |
| 13.3 | `compileResultReasons` | `names missing input matrix-file` |
| 13.3 | `compileResultReasons` | `names missing input outcome-history` |
| 13.3 | `compileResultReasons` | `names missing input rotation-store` |
| 13.3 | `compilePreflightReasons` | `names each missing input on a pre-flight result` |
| 13.4 | `compileChosenReason` / `compileUnavailableReason` | `keeps reason facts aligned for every source, cause and exclusion reason` |
| 13.4 | `compileGateReasons` | `does not name a candidate that was not supplied` |
| 13.4 | `compileResultReasons` | `refuses an excluded candidate that is not an input row` |
| 13.4 | `compileResultReasons` | `allows a not-listed pin that is absent from the rows` |
| 13.4 | `compileChosenReason` | `refuses a chosen executor that is not an input row` |
| 13.5 | `overallConfidence` | `uses the minimum of model-sourced confidences 0.9 and 0.6` |
| 13.5 | `overallConfidence` / `overallRosterConfidence` | `keeps 0.8 when a ranking entry sits beside a model-sourced 0.8` |
| 13.5 | `overallConfidence` | `returns null when a model-sourced null sits beside a model-sourced 0.8` |
| 13.5 | `compileStageConfidence` / `compilePreflightReasons` / `compileChosenReason` / `formatConfidence` | `keeps null confidence on the structured-output path at both stages` |
| 13.5 | `overallConfidence` / `resolveAnswerConfidence` | `returns null when no answer is model-sourced` |
| 13.5 | `appliesLowConfidenceFallback` | `does not treat the threshold itself as low confidence` |
| 13.5 | `compileStageConfidence` | `does not treat a ranking number as low confidence` |
| 13.5 | `compileStageConfidence` | `flags a reported model confidence below the threshold` |
| 13.5 | `formatConfidence` | `prints the same digits in the reason and the table` |

Schema locks, not extra requirements: `accepts a chosen reason on the published chosen-entry schema`, `accepts an unavailable reason on the published unavailable-entry schema`, `accepts pre-flight reasons on the published pre-flight schema`, `accepts the minimum on the published gate schema`. The table mark for null confidence is U+2014 (`NULL_CONFIDENCE_MARK`), asserted in the structured-output case. That is the "—" of Requirement 8.3. The reason phrase stays `no confidence reported`.

`it.each` names above are the titles Jest prints (`%s` replaced by the case value).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Matrix provenance text uses `MatrixCell.source` (`seed` / `user` / `local`). `sourceRef` and `note` are never copied. Seed text includes `asOf` and `stale`. User text is `provenance user` only. Local text is `provenance local` plus `sampleCount`. An unknown cell is `no profile` | copy `sourceRef` into the reason; include `asOf` on every value cell | TL-10 on Task 13.1 (`batches.md` Batch 13). `MATRIX_CELL_SOURCES` is `seed` \| `user` \| `local` (`matrix.types.ts:20-22`). `sourceRef` is the dataset URL, required on seed and forbidden on local (`matrix.types.ts:36-41`). Req 13.2 names seed with `asOf` and `stale`, user, local with sample count, or "no profile" | yes (one clause) |
| Missing-input phrases are `agent-list-unavailable`, `limits unavailable`, `roles unavailable`, `models unknown`, `matrix file unreadable`, `no outcome history`, `rotation store unavailable` | one sentence that lists them; kebab-case for every input | F10 names `agent-list-unavailable`. Data-flow step 4 names `models unknown`. SC-2 names `no outcome history` when `isPersistent()` is false (`implementation-plan.md` SC-2). F11 names limits, roles, model lists, the matrix file, the outcome reader and the rotation store | yes (one record) |
| `no confidence reported` is only for source `model` with a null provider confidence. Ranking, pin and skill-table say the probability or confidence is not applicable. Unavailable reasons do not use the phrase | use the phrase for every null confidence | Req 13.2 limits the phrase to a model-sourced entry. Req 1.8 is the model that reports no native confidence. Req 13.5 gives ranking, pin, skill-table and unavailable confidence null without calling them model-sourced | yes |
| Null provider confidence does not set a low-confidence fallback. `appliesLowConfidenceFallback` is true only when a reported number is `< CONFIDENCE_THRESHOLD` (0.5). The compiler prints a cause it is given; it does not apply the fallback | treat null as below the threshold | Req 1.8 and Req 13.5. `CONFIDENCE_THRESHOLD` (`routing-constants.ts:136-137`). Component 7 is pure and runs after merge (data-flow steps 10-11) | yes |
| `not-listed` may name a pin that is not an input row. Every other excluded candidate, and every chosen executor, must be an input row or the compiler throws | drop the pin id; allow any rule to name an absent id | Req 2.7: an unknown pin is `not-listed`. Req 13.4: a reason must not name a candidate absent from the input rows. The pin is an input fact, not an invented row | yes |
| A value cell's score must equal the chosen score | print both numbers | Req 13.4: a fact in the reason has to match the entry. One score plus that cell's provenance cannot describe two different numbers | yes |
| `compileGateReasons` lists `excluded`, then any unavailable `excludedBy` pair not already listed, then one `pin unavailable` line, then missing inputs. Duplicates collapse | only the flat `excluded` array; repeat pairs | Req 13.3 requires both the candidate list and the pin rule in `reasons`. A8 may pass the pair on the entry, on `excluded`, or on both | yes |

## Assumptions

Batch 13 owns no row in the assumptions table (`implementation-plan.md` "Assumptions to check first"). None were resolved here.

Checked before writing:

- `FALLBACK_CAUSES`, `EXCLUSION_RULES`, `ChosenEntrySchema`, `UnavailableEntrySchema`, `PreflightResultSchema` and `GateResultSchema` are the Batch 5 result schema.
- `MatrixCell` / `MatrixCellSource` are the Batch 9 types (`matrix.types.ts`).
- `LaneLimitState` is `at-limit` \| `near-limit` \| `confirmed-room` \| `unknown` (`lane-state.ts:158-159`).
- `SCORE_MIN`, `SCORE_MAX`, `MINIMUM_SAMPLE_COUNT` and `CONFIDENCE_THRESHOLD` are `routing-constants.ts`.

## Validation notes

- Rule 9: the new files import `@ptah-extension/shared` (`LaneLimitState` only), this lib's contracts and matrix types, `routing-constants.ts`, and `./confidence`. They do not import `vscode-core`, `platform-core`, `lane-outcomes`, or `agent-sdk`. Zod is reached only through the existing result schema, the same way Batch 10 reaches it.
- TL-10: reason provenance is the cell `source` enum. Specs pass a dataset URL on `sourceRef` and a note and assert neither string appears. Seed text still carries `asOf` and `stale`. Local text carries `sampleCount` and throws when that count is missing or below `MINIMUM_SAMPLE_COUNT`.
- Strict TypeScript: no `any`, no `@ts-ignore`, no `as unknown as`. `as const` is the existing const-array pattern.
- `src/index.ts` was not edited.
- `ptah_get_diagnostics` is not available in this lane (tool search returned no `ptah_*` tools, including `ptah_agent_report`). No Nx, Jest, build, serve, dev, e2e, or package command was run (decision #53). There is no verification tail. The team-leader owns `J(libs/backend/lane-routing, libs/backend/lane-routing/src/lib/reasons/compile-reasons.spec.ts libs/backend/lane-routing/src/lib/reasons/confidence.spec.ts)`.

## Risks

- Parallel lanes own `LR/decision-model/**` and `lane-outcomes`. This batch did not touch them.
- A8 (route decide) must call these functions. The entry `reason` and the top-level `reasons` are empty until it does. `overallSource` stays in A8; this batch returns `overallConfidence` only.
- The structured-output fixture here is the pure compiler plus `compileStageConfidence` at both stages. It does not open a fake HTTP model. The live structured-output client remains A13 / A8.
