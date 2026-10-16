# Batch 5 (A3) report

## Task 5.1 — route-decide contracts and ports

Created:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\contracts\route-decide-args.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\contracts\route-decide-result.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\contracts\contracts.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\route-candidate-source.port.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-routing\src\lib\lane-model-listing.port.ts`

The argument schema defines strict pre-flight and Gate 0.1 branches, bounded fields, unique phase IDs, and field-path issues for unknown review and pin references. The result schema defines strict pre-flight and Gate 0.1 branches, chosen and unavailable roster entries, usage, exclusions, and all enumerated fallback causes. The two ports use shared candidate and limit types.

## Requirement coverage

- **Req 2.3:** `contracts.spec.ts` rejects unavailable entries with a missing exclusion reason or non-null model, provenance, score, confidence, or fallback cause. It rejects a chosen entry with an `unavailable` executor, including an executor object whose ID is `unavailable`. It verifies a chosen entry needs `taskKind` and accepts its `OUTCOME_TASK_KINDS` value.
- **Req 2.7:** The schema spec accepts a zero-candidate fixture with an `at-limit` excluded row, null choice fields, null overall confidence and zero requests. It accepts invalid-pin fixtures for `not-listed`, `at-limit`, and `reviewer-family`; it also accepts a reviewer-family unavailable entry with `needsDisclosedFallback: true`. Runtime variants with and without a configured decision model, exactly one entry per requested phase, and suppression of model questions are service behaviors for A8; these schemas validate the resulting shapes but cannot enforce call behavior without the request and service state.
- **Req 2.5:** The argument spec verifies strict stage shapes, task type, depth, phase kind, pin strictness, and precise duplicate/unknown-reference paths.

## Decisions and assumptions

- Reused `TASK_TYPES` from `libs/shared/src/lib/types/task-spec.types.ts:23` through the shared barrel (`libs/shared/src/index.ts:42`), as requested by part-a:589-611. Reversible by changing the imported source if the shared contract moves.
- Reused `OUTCOME_TASK_KINDS` from `libs/shared/src/lib/types/lane-outcome.types.ts:17` through the shared barrel (`libs/shared/src/index.ts:26`) for chosen `taskKind` (SC-6). Reversible at the import site.
- Reused `CliDetectionResult` from `libs/shared/src/lib/types/agent-process.types.ts:394` and `LaneLimitState` from `libs/shared/src/lib/utils/plan-limits/lane-state.ts:158` in the candidate port, following part-a:698-719. Reversible at the port boundary.
- Kept the one-entry-per-requested-phase check for A8, since a result schema has no request phase list. Part-a:693-695 explicitly assigns the cross-request assertion to the service spec. Reversible by introducing a request-aware validator there.
- Did not edit `src/index.ts`: part-a:922 lists only the five contract/port files for A3, while part-a:930 gives the index change to A8. Did not create an outcome reader port; SC-2 defines it in shared (`implementation-plan.md:143-167`).

## Validation

- Scoped `ptah_get_diagnostics` on the five changed source files: TypeScript compiler, clean coverage, 0 errors and 0 warnings. Run after the source edits.
- No Nx, Jest, build, serve, dev, e2e, or package command was run, per decision #53 in the assignment. Thus there is no verification-run tail; the team leader owns test and lint execution.
- Imports from lane-routing source use only `@ptah-extension/shared` and local files; no `vscode-core`, `lane-outcomes`, or other backend library import was added (Batch 5 rule 9).
