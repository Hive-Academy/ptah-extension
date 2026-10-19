# Batch 49 report

## Snapshot rule

- Before: `reconcileDirClone` and `reconcileFileClone` snapshotted a clone when the upstream hash changed and the clone still matched its recorded source hash. Every upstream-only fast-forward therefore added an unchanged prior clone to `.history/`.
- After: those two fast-forward branches replace tracked clone content and refresh the sidecar without a history snapshot. A new seed already creates no snapshot. User saves, enhancements, rebase, and revert retain their existing snapshot calls. Diverged clones are still marked for rebase rather than overwritten.

## Files changed

- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`: removed the two upstream-only fast-forward snapshot calls.
- `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.spec.ts`: added repeated seed and fast-forward regression coverage for skill directories and flat command files.
- `user-layer-fs-ops.ts` and `user-layer-enhance.spec.ts` needed no changes; their snapshot implementations and edit/revert assertions remain in place.

## Write-path trace

The removed directory call wrote through `snapshotDirToHistory` to `<skills>/<slug>/.history/<ts>/`; the removed flat-file call wrote through `snapshotFileToHistory` to `<commands-or-agents>/.history/<slug>/<ts>/`. Both helpers delegate to `UserLayerFsOps`, whose layout is unchanged. `UserLayerMirrorService.listHistory` reads those locations. The `skillSynthesis:getClone` RPC lists entries, `skillSynthesis:getHistoryBody` reads a selected entry, and clone summaries read the history count. `skillSynthesis:revertEnhancement` calls `SkillEnhancerService.revert`, then `UserLayerMirrorService.revert`, which reads the selected history body and snapshots the body being replaced. These readers and their RPC results are unchanged; upstream-only revisions simply stop adding entries. The quarantined-agent restore RPC uses its separate quarantine snapshot flow and is untouched.

Remaining writers: `saveCloneBody` snapshots a prior body before a user save; `writeEnhancedSkill`/`writeEnhancedFileClone` snapshot an existing body before enhancement; `rebaseClone` snapshots a diverged body before replacing it; `revert` snapshots the current body before restoring a selected history entry. Their call sites and `UserLayerFsOps` implementation are unchanged.

## Tests added and retained

- Added a mirror-service spec that seeds twice, fast-forwards two upstream revisions, and checks both skill and command history remain empty while clone content reaches the latest revision.
- Retained mirror-service save tests that assert a user edit creates a readable prior-body snapshot, rebase tests that assert a snapshot, and enhance/revert tests that assert the restored body and the new revert snapshot.
- Tests, typecheck, lint, build, serve, and e2e were not run, per task instruction; the orchestrator runs checks.

## Decisions

- Applied the plan's snapshot-only portion. Promoted-slug retirement remains batch 70.
- Kept snapshot helper behavior and the history/RPC contracts unchanged; only the two pure-upstream call sites stopped writing.

## Clarifications Needed

None.
