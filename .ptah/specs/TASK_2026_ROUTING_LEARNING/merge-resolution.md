# Merge resolution

## Decisions

- Item 6: kept main's reviewed `OutcomeFigureLookup` / `outcomeFiguresFrom` contract, run deduplication, lane filtering, and `no-deliverable` counting. Dropped this branch's duplicate array-producing `outcomeFigures`. Added this branch's capacity rule through exported `isCapacityFailure`: `usage-limit`, `auth`, and `timeout` failures do not enter model figures. This is reversible by changing one predicate.
- Pre-flight uses main's fixed-question payload with empty outcome figures, because it offers no lane choice. Updated the branch test to expect no candidate read. This is reversible.

## Resolved files

- `matrix/capability-matrix.store.ts`: kept main's outcome lookup source and retained branch's typed `readMergedView()` which loads workspace outcomes directly, merges user/local/seed cells and writes no files. Reused the injected reader; removed duplicate array fields and import.
- `matrix/outcome-figures.ts`: kept main's API, run deduplication and counting; added branch capacity exclusion.
- `matrix/outcome-figures.spec.ts`: kept main's coverage and added a regression test for capacity classes alongside a quality failure.
- `pipeline/model-refine.ts`: kept main's offered-lane figure lookup and empty pre-flight figures; removed branch's duplicate array API and a duplicate type import.
- `route-decide.gate.spec.ts`: kept main's matrix/logger harness ports and branch's rotation toggle fixture.
- `route-decide.service.ts`: kept main's gate outcome lookup, route summary logging, and pre-flight behavior; retained branch's rotation setting and restored `getLastPicks()` for the rotation read port.
- `route-decide.preflight.spec.ts`: adapted one branch assertion to main's pre-flight behavior.

## Verification

- `git diff --cached --check`: pass; `git ls-files -u`: empty; no conflict markers in the six paths.
- Requested `npm run verify -- -p @ptah-extension/lane-routing,@ptah-extension/lane-outcomes,@ptah-extension/rpc-handlers -- --output-style=static`: confirmed tests for 3 projects; exit 1. Nx ESLint plugin worker exited in lint/typecheck phase. Initial lane-routing test run saw duplicate import and missing `getLastPicks()`; both were fixed during the run. Initial lane-outcomes had 4 failed suites, 16 passed: Windows path assumptions and symlink EPERM in deliverable-check/register specs, plus stale routing type errors from the same run. rpc-handlers had 14 failed suites, 221 passed, including the known Windows path and congestion cases.
- Focused routing tests after fixes: 4 suites, 65 tests passed.
- `npx tsc -p libs/backend/lane-routing/tsconfig.lib.json --noEmit --pretty false`: pass.
- Full lane-routing Jest after fixes: 33 passed, 1 failed, 1 skipped; 854 passed, 1 failed, 8 skipped. The remaining failure was an obsolete pre-flight candidate-read assertion, subsequently updated.
- Updated pre-flight spec: 1 suite, 22 tests passed. Full three-project verification was not rerun. Lane-outcomes Windows tests remain unresolved.
- Scoped `ptah_get_diagnostics`: unavailable because its TypeScript worker timed out and was terminated; direct tsc above passed.

## Git status --short

```text
A  .ptah/specs/TASK_2026_879_9809/HANDOFF.md
A  .ptah/specs/TASK_2026_879_9809/batch-1-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-10-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-11-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-2-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-3-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-4-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-5-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-6-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-7-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-8-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-9-report.md
A  .ptah/specs/TASK_2026_879_9809/batch-p1-fix-report.md
A  .ptah/specs/TASK_2026_879_9809/batches.md
A  .ptah/specs/TASK_2026_879_9809/code-logic-review-final.md
A  .ptah/specs/TASK_2026_879_9809/code-logic-review-fixround.md
A  .ptah/specs/TASK_2026_879_9809/code-logic-review-p1.md
A  .ptah/specs/TASK_2026_879_9809/context.md
A  .ptah/specs/TASK_2026_879_9809/decisions.md
A  .ptah/specs/TASK_2026_879_9809/implementation-plan-review.md
A  .ptah/specs/TASK_2026_879_9809/implementation-plan.md
A  .ptah/specs/TASK_2026_879_9809/peer-note-TASK_2026_878_5513.md
A  .ptah/specs/TASK_2026_879_9809/task.md
M  libs/backend/lane-outcomes/src/index.ts
A  libs/backend/lane-outcomes/src/lib/deliverable-check.spec.ts
A  libs/backend/lane-outcomes/src/lib/deliverable-check.ts
A  libs/backend/lane-outcomes/src/lib/di/register.spec.ts
M  libs/backend/lane-outcomes/src/lib/di/register.ts
M  libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts
M  libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts
M  libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts
M  libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.spec.ts
M  libs/backend/lane-outcomes/src/lib/store/key-value-lane-outcome.store.spec.ts
M  libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts
M  libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts
M  libs/backend/lane-outcomes/src/lib/subagent-stop.integration.spec.ts
M  libs/backend/lane-outcomes/src/lib/write/report-effect.spec.ts
M  libs/backend/lane-outcomes/src/lib/write/report-effect.ts
A  libs/backend/lane-outcomes/src/lib/wrote-lines.parser.spec.ts
A  libs/backend/lane-outcomes/src/lib/wrote-lines.parser.ts
M  libs/backend/lane-routing/src/lib/decision-model/decision-payload.spec.ts
M  libs/backend/lane-routing/src/lib/decision-model/system-one.live.fixtures.ts
M  libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts
M  libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts
M  libs/backend/lane-routing/src/lib/matrix/local-derivation.ts
M  libs/backend/lane-routing/src/lib/matrix/outcome-figures.spec.ts
M  libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts
M  libs/backend/lane-routing/src/lib/pipeline/gather.ts
M  libs/backend/lane-routing/src/lib/pipeline/model-call.ts
A  libs/backend/lane-routing/src/lib/pipeline/model-refine.spec.ts
M  libs/backend/lane-routing/src/lib/pipeline/model-refine.ts
M  libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts
A  libs/backend/lane-routing/src/lib/pipeline/preflight-answer.spec.ts
M  libs/backend/lane-routing/src/lib/pipeline/preflight-answer.ts
A  libs/backend/lane-routing/src/lib/reasons/decision-summary.spec.ts
A  libs/backend/lane-routing/src/lib/reasons/decision-summary.ts
M  libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts
M  libs/backend/lane-routing/src/lib/route-decide.preflight.spec.ts
M  libs/backend/lane-routing/src/lib/route-decide.service.ts
M  libs/backend/platform-core/src/file-settings-manager.cross-process.spec.ts
M  libs/backend/platform-core/src/file-settings-manager.error-paths.spec.ts
M  libs/backend/platform-core/src/file-settings-manager.ts
M  libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts
M  libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts
A  scripts/dev/README.md
A  scripts/dev/check-past-outcomes-live.mjs
A  scripts/dev/seed-lane-outcomes.mjs
A  scripts/dev/seed-lane-outcomes.spec.ts
?? .ptah/specs/TASK_2026_ROUTING_LEARNING/merge-resolution.md
```
