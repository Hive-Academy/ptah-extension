# Phase A fix round — lane A1

| Item | Status | Change and evidence | Spec |
| --- | --- | --- | --- |
| 1 L-S1 | Fixed | `spec-extractor.ts:75-120,259` accepts `Recommendation: APPROVE/APPROVED/REVISE/NEEDS_REVISION`, verdict headings and existing `Verdict:` lines; missing verdicts produce one bounded, text-free diagnostic per file. | `spec-extractor.spec.ts:53,290` covers real review ending excerpts and missing-verdict diagnostics. |
| 2 L-M1 | Fixed | `spec-harvester.service.ts:170-178` applies the review conflict gate only after batch and lane precedence. | `spec-harvester.service.spec.ts:163` covers batch, lane and review-only conflicts. |
| 3 L-M2 | Fixed (harvester side) | `spec-harvester.service.ts:118-128` passes the verdict without `isError`, leaving the existing `is_error` value to the candidate store. Lane A2 owns the matching optional argument and SQL change. | `spec-harvester.service.spec.ts:127-137,240-255` checks failed verdict reconciliation and asserts that calls omit `isError`. |
| 4 L-M4 | Fixed on harvester side | `spec-harvester.service.ts:151` normalizes the workspace root with the exported `normalizeWorkspaceRoot` helper before attribution lookup, grade write and pruning. | `spec-harvester.service.spec.ts:208` checks the canonical root at all three calls, including a Windows drive-letter variant. |
| 5 L-M6 | Fixed | `spec-harvester.service.ts:133-134,150-190` skips the marker after attribution, upsert or pruning failure so a later harvest retries. The diagnostic logs the error name only. | `spec-harvester.service.spec.ts:228` covers attribution and upsert failure, then a successful retry. |

## Decisions

- Used the existing `platform-core` `normalizeWorkspaceRoot` export for workspace keys; this is the repository's canonical path-key helper. Reversible by changing the single harvester call if the grade-store ownership lane chooses a different persisted key format.
- Removed the legacy `isError` argument under the caller's split-ownership resolution. The temporary TypeScript mismatch is expected until lane A2's candidate-store change lands.
- Left test, typecheck, lint, Nx, build and e2e execution to the orchestrator, as requested. No checks were run in this lane.
