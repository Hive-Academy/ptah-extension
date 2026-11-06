# R1 implementation report

Implemented routing and outcome-learning items 1–6 in this worktree. No git action was run.

## Item 1 — rotation-off selection

Files: `libs/backend/lane-routing/src/lib/scope/lane-rotation-setting.ts`, `di/register.ts`, `ranking/spread.ts`, `route-decide.service.ts`, and their `spread.spec.ts` and `route-decide.gate.spec.ts` tests. The `ptah` workspace setting `agentOrchestration.laneRotation` defaults to enabled; only `false` disables rotation. With rotation disabled, selection uses `natural[0]` from the existing tie-break order and does not load or advance the persisted cursor. `getLastPicks()` exposes stored picks for the RPC-owning lane. Tests cover the off-mode choice and cursor behavior.

## Item 2 — keep model choice in band

Files: `libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts`, `phase-resolve.ts`, and new `phase-plan.spec.ts`. The model only receives options within the closeness band; sendability uses the same band. Tests cover a partial band and a single-member band, preventing selection of a lower-ranked out-of-band lane.

## Item 3 — capacity failures do not reduce quality

Files: `libs/backend/lane-routing/src/lib/matrix/local-derivation.ts` and `local-derivation.spec.ts`. Exported `isCapacityFailure` and excluded `usage-limit`, `auth`, and `timeout` from delivery/quality scoring while preserving their outcome and limit information. Tests cover the classifier and unaffected scoring.

## Item 4 — workspace-scoped outcomes

Files: `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts`, `in-memory-lane-outcome.store.ts`, `sqlite-lane-outcome.store.ts`, `lane-outcome-recorder.service.ts`, `lane-outcome-reader.service.ts`, the corresponding store specs, `libs/backend/lane-outcomes/src/lib/di/register.ts`, and `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`. Newly recorded outcomes carry `workspaceRoot`; the CLI producer supplies its working directory. Readers query the active workspace. Historical null-root rows remain visible within the requested window. In-memory and SQLite tests cover workspace filtering and legacy null rows.

## Item 5 — review-rate denominator

Files: `libs/backend/lane-routing/src/lib/matrix/local-derivation.ts` and `local-derivation.spec.ts`. Review rate now includes unresolved `reviseRounds` in the denominator, with an open review counted once; the approval numerator is unchanged. Added a regression test for the formula.

## Item 6 — real outcome figures in model payloads

Files: `libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts`, `outcome-figures.spec.ts`, `capability-matrix.store.ts`, `pipeline/model-refine.ts`, `route-decide.service.ts`, `route-decide.preflight.service.ts`, and `route-decide.preflight.spec.ts`. Both gate and preflight payload builds receive figures derived from recorded outcomes; the item 3 classifier excludes capacity failures from quality-failure figures. Tests cover the aggregation and preflight reads.

## Verification

- `npm run verify -- -p @ptah-extension/lane-routing`: lint/typecheck `NX 2 tasks: 2 succeeded`; test `NX 1 task: 1 succeeded`.
- `npm run verify -- -t test -p @ptah-extension/lane-routing -- --testPathPatterns=phase-plan.spec.ts --coverage=false --maxWorkers=2`: `NX 1 task: 1 succeeded`. This ran after adding the new phase-plan spec.
- `npm run verify -- -t test -p @ptah-extension/lane-outcomes -- '--testPathPatterns=(in-memory-lane-outcome.store|sqlite-lane-outcome.store|lane-outcome-recorder.service|lane-outcome-reader.service).spec.ts' --coverage=false --maxWorkers=2`: `NX 1 task: 1 succeeded`.
- `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime`: lint/typecheck `NX 6 tasks: 6 succeeded`; test `NX 3 tasks: 0 succeeded, 3 failed`. This preceded the corrected preflight assertion. The lane-outcomes and CLI suites also encounter the worktree's missing `marked` Jest mapping; CLI has unrelated `mcp-install` and `claude-approval` failures.
- `npm run verify -- -t test -p @ptah-extension/lane-routing,@ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime -- --output-style=static --coverage=false --maxWorkers=2`: `NX Running target test for 3 projects`, failed with the same preflight assertion (subsequently corrected), missing `marked` mapping, and unrelated CLI failures.
- `npm run verify -- -p @ptah-extension/lane-routing -- --output-style=static --coverage=false --maxWorkers=2`: failed because the extra Jest flags also reached lint/typecheck; preflight assertion was subsequently corrected.
- A first focused outcome command used Jest 29's `--testPathPattern` and failed; the successful command above uses Jest 30's `--testPathPatterns`.
- Scoped `ptah_get_diagnostics` on changed files reported zero errors after the final source and spec edits.

## Decisions

- Rotation off uses `natural[0]`, as specified in `verification-routing.md`; missing setting means rotation on. The cursor is untouched while off. Reversible setting behavior.
- New outcome rows use the workspace root supplied at recording. A scoped read includes exact-root and null-root rows; null rows preserve legacy visibility until they age out. Reversible storage/query behavior.
- The review denominator counts outstanding revise rounds and one open review, following the task formula. Reversible scoring calculation.
- The model receives only band members, so an out-of-band choice is unavailable. Reversible payload restriction.

## Remaining limits

- Full lane-outcomes and CLI test suites did not pass in this worktree because of the missing `marked` mapping; CLI also has unrelated failures. Their changed-project lint/typecheck checks passed and the focused outcome tests passed.
- Platform setting declaration and RPC exposure belong to the other lane and were outside this assignment.
