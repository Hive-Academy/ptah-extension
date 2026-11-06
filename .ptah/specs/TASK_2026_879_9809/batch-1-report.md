# Batch 1 report

## Tasks

- **1.1 complete:** Exported the existing deterministic `dedupeByRun` and added a pure `outcomeFiguresFrom` lookup. It dedupes before counting, excludes subagents, blank lanes, null task kinds, and unverified verdicts, and counts `no-deliverable` as failed.
- **1.2 complete:** Added fixtures and tests for dedupe, exclusions, verdict semantics, separate lane/task pairs, empty lookup, and output field restriction.
- **1.3 complete:** Extended the payload spec to pin the exact `codex/implement` mapping and `{delivered, failed}` keys.

## Files written

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/matrix/local-derivation.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts` (created)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/matrix/outcome-figures.spec.ts` (created)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/decision-model/decision-payload.spec.ts` (modified)
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/.ptah/specs/TASK_2026_879_9809/batch-1-report.md` (created)

## Risks and edge cases

- **R5:** The figure value contains only laneId, taskKind, delivered, and failed. A spec checks the exact keys and that unrelated summary fields are absent. The payload spec checks that System One receives only two numeric fields under the pair key.
- **R6:** Edited only Batch 1 files in lane-routing; did not touch lane-outcomes or platform-core. Scoped verification was attempted for one project only.
- **R7:** Width fitting is assigned to Batch 6; this module returns a lookup so its consumer can request only offered pairs. No request body is built here.
- **R1–R4, R8–R13:** Outside Batch 1 scope; no associated files were edited. Their mitigations remain assigned to later batches in `batches.md`.
- **Batch 1 edge cases:** Subagent lane, whitespace lane, null task kind, unverified-only pair, absent pair, and empty lookup return null. A `no-deliverable` verdict increments failed. Duplicates resolve through the existing deterministic run deduper before counting.

## Verification

- Ran exactly once in the foreground: `set -o pipefail; npm run verify -- -p @ptah-extension/lane-routing | tail -40`.
- **Result: failed before Nx project header.** The verify lock acquired for `@ptah-extension/lane-routing`, then Nx could not connect to or create its Unix daemon/plugin sockets under `/tmp/.nx` (`EPERM`). Final summary line: `lock released after 11.4s, exit code 1`. There are no pass/fail project counts, and the requested **1-project Nx header could not be confirmed**.
- Ptah diagnostics, scoped to the changed TypeScript project, reported **0 errors, 0 warnings** on the initial edit. After the final formatting and extra test, the scoped diagnostic check timed out while TypeScript was still running, so the final edit remains unchecked. Neither diagnostic result substitutes for the blocked Jest/lint/typecheck verify run.

## Decisions

- Key figures internally with a JSON tuple of laneId and taskKind. A literal slash delimiter could conflate distinct IDs; the tuple is reversible and has no effect on the output contract.
- Reuse `dedupeByRun` as specified in the plan, preserving its established newest-run and tie-break rules. This is reversible by replacing the helper if the plan changes.
- Do not rerun verify after the sandbox socket failure because the assignment explicitly permits one scoped run. The coordinator can run the same command where Nx sockets are allowed.
