# Phase 5 code logic re-review — TASK_2026_684_a11d

Commit: `0aecad48b` · Round: 1 re-review · Reviewer family: codex · Implementer family: claude

| Prior item | Status | Evidence |
| --- | --- | --- |
| 1. SERIOUS — live eval could silently substitute another catalog model for clef | **FIXED** | `libs/backend/lane-routing/src/lib/decision-model/system-one.live.spec.ts:88-105` pins the default to `clef:27b-cloud` and throws in `beforeAll` if absent. Jest treats a throwing `beforeAll` as failure for its dependent tests, so the catalog and fixture tests at `:109-127,153-204` cannot pass against a substitute. Only an explicit `PTAH_LIVE_DECISION_MODEL` override changes the model. The new model log at `:106` prints the model ID, not the API key. |
| 2. MODERATE — issue-list failure could open a duplicate issue | **FIXED** | `.github/workflows/decision-model-live-eval.yml:110-116` captures `gh issue list` separately and exits on a nonzero status before `gh issue create` at `:128-132`. The `while read` at `:118-123` retains the last field as the full title, including embedded tabs, and guards the blank line produced by an empty here-string. Its `if` and `while` forms are compatible with the runner's `bash -e`; the empty and multiple-match paths reach the intended create/edit logic at `:124-141`. |

## New defects

None identified in the two fixes.

## Five logic questions

1. **Silent failure:** A missing clef now throws before fixture execution (`system-one.live.spec.ts:95-105`); a failed issue lookup exits before creation (`decision-model-live-eval.yml:110-116`).
2. **Unexpected user action:** A manual workflow dispatch takes the same gated probe and issue path (`decision-model-live-eval.yml:7-8,71-84`); the repair adds no separate dispatch behavior.
3. **Wrong answer from data:** A catalog containing other models but no clef fails the default run (`system-one.live.spec.ts:93-105`).
4. **Dependency failure:** A failing `gh issue list` stops the issue step (`decision-model-live-eval.yml:110-116`); a failed catalog request rejects `beforeAll` (`system-one.live.spec.ts:88-93`).
5. **Unstated case:** An explicitly overridden model remains subject to the catalog membership assertion (`system-one.live.spec.ts:95-111`).

## Verification and score

**8/10.** Both prior defects have explicit failure paths and no new behavior defect was found in the changed spec and workflow. This is above the 5–6 band because missing clef and failed issue listing cannot produce a success-looking result; it is below 9–10 because the live workflow was not executed. Read-only review only; no tests, builds, or network calls. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript check.

Verdict: APPROVED
