# Batch 6 report: harness keep policy for edited managed copies (B9 part 1)

Task 6.1: done. The Claude target, the workspace target and the MCP facet now plan an owned copy
whose on-disk hash differs from the recorded hash (`actual !== null && actual !== owned.hash`) as
**kept**, not as a write. The copy stays byte-identical. Its manifest entry keeps the old hash,
so later passes reach the same answer. It is listed in both `keptLocalEdit` and `localEdit`, on
verify and on reconcile. An unmodified managed copy is still replaced.

## Files changed (all under the worktree)

- `libs/backend/harness-sync/src/lib/targets/harness-target.port.ts`
  - Removed `HarnessPlanWrite.overwritesLocalEdit`.
  - Added the required field `HarnessPlan.keptLocalEdit: string[]`.
  - Documented `HarnessApplyResult.keptLocalEdit` as apply-time kept paths only.
- `libs/backend/harness-sync/src/lib/targets/claude-target.ts`
  - `planEntry` returns `'kept'` for an edited owned copy. The skill and command loops collect
    those paths into `plan.keptLocalEdit` (merged with the MCP list).
  - Removed the dead "push to keptLocalEdit after overwriting" branch from `apply`.
- `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`
  - Added a `PlanEntryOutcome` `{kind: 'kept', owned}`. The plan records the copy in
    `keptLocalEdit` and claims the owned entry in its own manifest (`??=`, the same rule as
    `unchanged`, so ownership borrowed from a co-owner is kept).
  - Removed the `overwritesLocalEdit` plumbing.
  - `applyWrite`: removed the snapshot-then-overwrite branch. When `detachForOverwrite` finds a
    local edit at apply time (a save landing between plan and apply), the edit is restored to
    its live path by the new `restoreDetachedEdit`, reported in `result.keptLocalEdit`, and no
    write happens.
    - The restore never replaces anything: a file is hard-linked back, a directory is renamed
      back.
    - If a newer save already sits at the live path, the restore is a `writeFailed` entry with
      the snapshot path, and the newer save stays.
    - After a successful restore, `discardRestoredSnapshot` removes the empty `<ts>` directory.
  - `publishFailureReason` lost its now-unused snapshot parameter.
- `libs/backend/harness-sync/src/lib/targets/mcp/mcp-facet-planner.ts`
  - Added `McpFacetPlan.keptLocalEdit`. An edited owned server entry is kept. The edit check now
    runs before the source-change check, so a registry change cannot hide an edit (the same
    order as finding 3).
  - `writeFor` and `applyMcpFacet` no longer carry or report `overwritesLocalEdit`.
- `libs/backend/harness-sync/src/lib/health/harness-health.ts`
  - `plannedTargetHealth` fills `keptLocalEdit` and `localEdit` from `plan.keptLocalEdit`.
  - `appliedTargetHealth` sets `keptLocalEdit` to the plan list plus the apply list
    (deduplicated) and `localEdit` to the plan list.
  - Removed `localEditPaths`. This is the point `:142` in the plan.
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts`
  - The removal-pass plan literal gains `keptLocalEdit: []`.
  - The no-op path needs no change: health reads the kept paths off the plan, so a steady-state
    pass with a kept copy still reports it.
- `libs/shared/src/lib/types/harness-sync.types.ts`
  - Carried from Batch 2: the `keptLocalEdit` doc no longer says "overwritten (source wins)". It
    now describes the D8 keep semantics and says these paths are counted in neither `found` nor
    `missing`.
  - Rewrote the `localEdit` doc, including the `{@link keptLocalEdit}` wording.
- Specs:
  - `reconciler/harness-reconciler.local-edit-report.spec.ts`
    - Header rewritten.
    - (a): verify lists the copy as kept and not missing.
    - (b): two reconcile passes over edited agent and skill copies, with a source change, keep
      both byte for byte. No history is written, the owned hashes are unchanged, and both copies
      are listed in kept and localEdit.
    - (c): an unmodified copy whose detach cannot reach history writes nothing and keeps its
      ownership. The retry replaces it and leaves no snapshot.
    - (d) is unchanged.
  - `reconciler/harness-reconciler.foreign-edits.spec.ts`: E10 is now "E10/D8". The edited copy
    is kept across verify and two reconciles while its source changes. An unmodified sibling
    still follows its source.
  - `targets/workspace-target.overwrite-detach.spec.ts`: the model-only change keeps the edit
    (finding 3). Race cases:
    - a save landing between plan and apply is put back and reported kept;
    - a save between plan and apply, plus a newer save after the detach: the newer save
      survives and the earlier one stays in history;
    - a save after the detach of an unmodified copy is an EEXIST conflict with no snapshot;
    - EXDEV on the detach writes nothing.
  - `reconciler/harness-reconciler.{cancellation,capability-policy,write-failure}.spec.ts`: the
    stub plan literals drop `overwritesLocalEdit` and add `keptLocalEdit: []`.

No other file was edited. `artifact-retirement.spec.ts`, `rival-targets.agent-model.spec.ts` and
`skill-sibling-links.spec.ts` were reformatted by mistake when I ran prettier over a glob. I
restored them byte-for-byte from `HEAD`.

## Verification

- `npm run verify -- -p @ptah-extension/harness-sync,@ptah-extension/cli-engine,@ptah-extension/shared`
  exited 0 after waiting about 379 s for the lock: "9 tasks: 9 succeeded, 6 cached".
- To confirm the test count, I ran
  `npm run verify -- -t test,lint,typecheck -p @ptah-extension/harness-sync -- --output-style=static`.
  It exited 0, all from cache:
  - `harness-sync:test`: 57 suites, 551 tests passed;
  - typecheck passed;
  - lint: 0 errors, 5 warnings, all of them already present before this batch.
- `workspace-target.ts` already had a `max-lines` warning: 777 counted lines on `HEAD`, 811 now.
  It is a warning, not an error.
- The degradation audit (`check-degradation.ts`) reports `libs/backend/harness-sync: 6 ok
  (baseline 6)`, `libs/backend/cli-engine: 12 ok`, and no orphaned marker in my files. The audit
  as a whole still exits 1 on markers in other batches' files (see "Outside this batch").
- I did not run rpc-handlers or the host projects (Electron, VS Code, CLI). The orchestrator
  runs the host checks after the parallel batches finish. `HarnessPlan`, `HarnessPlanWrite` and
  `McpFacetPlan` have no consumers outside `harness-sync`, and the shared change is doc-only.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | --- | --- | --- | --- |
| B6-1 | Keep `detachForOverwrite` and its exclusive publish for unmodified owned updates. Remove only the snapshot-then-overwrite branch. | (a) delete the detach and replace in place; (b) keep the detach as a race guard | The plan's A-retire assumption said other callers exist; `detachForOverwrite` has one caller, `workspace-target.ts`. Deleting it would bring back Part B review finding 1: a save between plan and apply is overwritten. Under D8 an edit must survive every pass, so (b). | yes |
| B6-2 | An edit the apply-time detach finds is restored in place and reported kept, not snapshotted and overwritten. | restore; snapshot and write (old behaviour); report as a write failure | D8 ("kept in every sync pass"). The restore never replaces a newer save: it uses a hard link for files and rename for directories, and judges a failure on whether the path is present. | yes |
| B6-3 | Kept paths are counted in neither `found` nor `missing`. | count them as missing; count them in neither | A kept copy is owned. `missing` means "not owned on disk" (shared doc) and reads as a red gap the user cannot fix by syncing. Batch 7 repair takes `keptLocalEdit` paths from a fresh verify, which this batch now reports. | yes |
| B6-4 | `HarnessPlan.keptLocalEdit` is required, not optional. | optional; required | Both target implementations produce it. The only other literals are 3 reconciler test stubs, which I updated. | yes |
| B6-5 | A copy that cannot be hashed (`actual === null`) is still planned as an update. The detach then decides on it, and an edit it finds is restored. | keep it; write it | The batch rule says `actual !== null && …`. The detach makes this safe. | yes |

## Deviations

- The plan locates the dead branches at `claude-target.ts:376-383` and
  `workspace-target.ts:925-973`. I removed the reporting and overwrite logic there but kept
  `detachForOverwrite` (B6-1), because A-retire did not hold.
- The `harness-health.ts` change goes beyond the `:142` filter: the planned and applied health
  functions now read the plan's kept list.

## Outside this batch (reported, not touched)

- UI wording that still describes the old behaviour, for the frontend batches:
  - `libs/frontend/marketplace/src/lib/data/attention.ts:165` labels `keptLocalEdit` as "local
    edits replaced";
  - `harness-target-row.component.ts:130,142` uses `data-testid="harness-target-overwritten"`.
- `apps/ptah-cli/src/cli/output/formatter.ts:483-521` reads `keptLocalEdit` as "kept", which is
  correct now. Nothing to change.
- The degradation audit exits 1 on `orphaned-suppression` markers in files that are not mine:
  - `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-clone-state.ts:109`
    (Batch 5);
  - `libs/backend/agent-generation/src/lib/services/wizard-agent-origin.store.ts:92`
    (Batch 4, committed);
  - `libs/backend/agent-sdk/src/lib/session-importer.service.ts:993`.
