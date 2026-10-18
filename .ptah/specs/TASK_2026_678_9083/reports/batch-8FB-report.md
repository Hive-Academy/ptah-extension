# Batch 8FB report

## Work completed

- **8FB.1 — style S3, ruling 2:** Split the default and maximum Crucible round caps into documented constants in `tribunal-run-framing.ts:103-106`. `roundCapFor` now clamps with `MAX_CRUCIBLE_ROUND_CAP` at line 120; `derivePhase` imports and uses `DEFAULT_CRUCIBLE_ROUND_CAP` in `tribunal-phase-derivation.ts:4,91`. Both remain 2, so behavior is unchanged.
- **8FB.2 — style S3, repeated move literals:** `tribunal-ui.types.ts:4-11` defines the ordered `TRIBUNAL_MOVES` tuple and derives the existing `TribunalMove` union from it.
- **8FB.3 — style S2, Moderate 2, Decision D14 ruling 3:** `phase.ts:1-5` documents the pure entry boundary and Decision D6. Named exports at lines 7-30 expose `rosterIsLaunchable`, both caps, the role and move tuples, and the requested types. `phase.spec.ts:3-19` pins the exact sorted runtime export names so an extra export, including an Angular symbol or `export *` addition, fails.

## Import boundary evidence

- `tribunal-roster-rules.ts:1-7` imports only `CRUCIBLE_ROLES`, `RELAY_ROLES`, and types `LaneRole`, `TribunalMove`, `VendorLane` from `../types/tribunal-ui.types`; no Angular import.
- `tribunal-ui.types.ts:1-2` has only type imports: `CliType` from `@ptah-extension/shared` and `TileLayout` from `@ptah-extension/canvas`; no Angular import.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8FB-report.md`

## Verification

- New spec: `phase.spec.ts` asserts the exact sorted runtime exports of `./phase`. No existing spec was changed.
- `ptah_get_diagnostics` found no diagnostics in the five requested files. It reported 23 errors in sibling files, including existing Tribunal specs and `frontend/core` test mocks; this lane did not edit those files.
- `npx prettier --check` output: `All matched files use Prettier code style!`
- Catch-site degradation audit classification: no `catch` or `.catch` sites were added or changed in this batch.
- Nx/Jest scoped verification was reserved for the team leader by the batch rules and was not run here. The requested `git diff` check was also reserved by the lane's no-git rule; the two framing and derivation edits above are constant substitutions only.

## Decisions

- Followed Decision D14's resolved widening of the pure phase entry. The alternative was to keep a Command Center mirror; the batch and source show the roster rule is pure. Reversible by changing named exports and their guard.
