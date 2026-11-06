# Batch 4 report

## Tasks

- **4.1 complete:** Added `outcomeFigures` to `CapabilityMatrixSnapshot`. `readLocalMatrix` builds figures from the same summaries and existing 90 day window as local cells; absent, unavailable, nonpersistent, empty-query, and failed reads return `EMPTY_OUTCOME_FIGURES`.
- **4.2 complete:** Store specs assert present figures and the single read/window, plus empty figures for absent, nonpersistent, throwing, and non-array readers.
- **4.3 complete:** `neutralSnapshot` returns `EMPTY_OUTCOME_FIGURES` when matrix loading throws.
- **4.4 complete:** The `neutralMatrix()` gate test fixture carries `EMPTY_OUTCOME_FIGURES`. No other part of the gate spec changed.

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/pipeline/gather.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts` (modified, `neutralMatrix()` and its import only)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/.ptah/specs/TASK_2026_879_9809/batch-4-report.md` (created)

## Risks and edge cases

- **Reader failure:** A missing reader, throwing or non-boolean `isPersistent`, throwing `recentOutcomes`, or non-array result follows the existing warning/reason path and yields empty figures. A nonpersistent reader and an empty lane query also yield empty figures. Tests cover absent, nonpersistent, throwing persistence, throwing read, and non-array paths.
- **Matrix failure:** The `gather.ts` fallback snapshot supplies empty figures when `matrix.load` throws.
- **Performance:** Figures reuse the same `summaries`; no extra `recentOutcomes` call. A spec checks one call and `NOW - OUTCOME_WINDOW_MS`.
- **R5:** The figure lookup returns the Batch 1 allow-listed values. No path, request text, or log metadata is added here.
- **R6:** Only Batch 4's listed files changed. Other lanes' library files were untouched.
- **R1–R4, R7–R13:** Their mitigations belong to other batches; no files in those scopes changed.

## Verification

- **Required orchestrator command:** `npm run verify -- -p @ptah-extension/lane-routing` (Nx header must say **1 project**). I did not run it, as directed because this sandbox cannot reach the Nx daemon socket. Pass/fail counts are therefore unavailable in this lane; the orchestrator owns the run.
- `ptah_get_diagnostics` on all four changed TypeScript files: **0 errors, 0 warnings; clean coverage**.

## Decisions

- Added a `LocalLoad` type extending the existing `LayerLoad` so only the outcome read path must supply figures. This follows the existing store structure and is reversible.
- Retained the existing reader call and warning behavior; computed figures from the same flattened summaries after the successful read. This keeps the 90 day window and one read per lane unchanged.
