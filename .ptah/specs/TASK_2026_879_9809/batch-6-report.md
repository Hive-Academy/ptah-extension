# Batch 6 report

## Tasks

- **6.1 complete:** `runLaneRequest` accepts the snapshot figure lookup. Each `fitLane` width attempt rebuilds distinct figures in phase then offered-option order; the System One body and structured prompt byte checks include those figures. Subagent options are skipped. The returned outcome reports the number of figures sent. `runFixedRequest` retains an empty list with the pre-flight explanation; all `model-call` outcomes default to count zero.
- **6.2 complete:** Added `model-refine.spec.ts` for offered pairs, pair deduplication, subagent exclusion, width shrink and byte cap, structured prompt lines, and fixed-request empty outcomes.
- **6.3 complete:** `laneQuestion` sets `taskKind: plan.taskKind`; `LANE_INSTRUCTIONS` uses the plan's verbatim double-counting note.
- **6.4 complete:** Both gate passes forward `gathered.matrix.outcomeFigures`; a gate case checks that the captured payload contains only offered lane/implement pairs.

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/pipeline/model-refine.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/pipeline/model-refine.spec.ts` (created)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/pipeline/model-call.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.service.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/.ptah/specs/TASK_2026_879_9809/batch-6-report.md` (created)

## Risks and edge cases

- **R5:** Figures are selected from the lookup only for offered lane/task-kind pairs. The payload builder retains its allow-list; the structured prompt renders only laneId, taskKind and two counts. No paths or request metadata are added.
- **R6:** Edited only Batch 6 lane-routing files; lane-outcomes and platform-core were untouched.
- **R7:** Figures are recomputed inside every width attempt, and both wire-body and structured-prompt byte checks include them. A spec uses the wide body size minus one byte to force shrink and asserts the dropped option's figures disappear.
- **Other Batch 6 cases:** Repeated phases of the same task kind share one figure per lane. Subagent options yield none. Fixed requests yield no figures and report count zero. A failed sent request still reports how many figures were transmitted; an unsent request reports zero.
- **R1–R4, R8–R13:** Their mitigations are assigned to other batches; no associated files changed here.

## Verification

- **Orchestrator commands, in order:** `npm run verify -- -p @ptah-extension/lane-routing` (Nx header: **1 project**), then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` (Nx header: **2 projects**).
- Did **not** run either verify command, as directed because this sandbox cannot access the Nx socket. Pass/fail counts are unavailable in this lane.
- `ptah_get_diagnostics` was called on changed TypeScript files, but the compiler did not complete within its 45-second response limit on repeated attempts. It returned **unchecked**, not a pass or a diagnostic count.

## Decisions

- Deduplicate offered figures by a JSON tuple of laneId and taskKind, matching the Batch 1 internal key scheme. This is reversible and avoids slash collisions in selection.
- Keep `model-call` outcome builders at zero and override with the fitted count only in `runLaneRequest` after a request was sent. This preserves fixed-request behavior and makes the count match the chosen width.
