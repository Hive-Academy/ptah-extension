# B-FIX-1 executor report — TASK_2026_609_c495 (harness-sync)

Fixes `partb-review-backend.md` finding 3 (Serious, deterministic) and finding 1 (Blocking, overwrite race).

## Files

- MODIFIED `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`: `planEntry` local-edit detection, `applyWrite` detach-then-exclusive-publish, `writeArtifact(…, exclusive)`. `snapshotBeforeOverwrite` was replaced by `publishFailureReason`. The file went from 1156 to 1161 lines.
- MODIFIED `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts`: the shared detach core (`detachExisting`), the new exported `detachForOverwrite` and `DetachOutcome`, and a refactor of `retireOwnedArtifact` onto the core. The copy-then-verify `snapshotLocalEdit` and `hashArtifact` were deleted because they had no other users. `isProvablyUnchanged` was not changed (FU-5 stays a follow-up).
- MODIFIED `libs/backend/harness-sync/src/lib/targets/copy-engine.ts`: `copyDirectoryTransformed` and `copySingleFile` take an optional `exclusive` flag. For a directory this means a non-recursive `mkdir` of the target instead of `rm -r`; for a single file it means `COPYFILE_EXCL`.
- CREATED `libs/backend/harness-sync/src/lib/targets/workspace-target.overwrite-detach.spec.ts`: 5 cases (below).

`content-hash.ts` is untouched.

## Design

**Finding 3, in `planEntry`, for an owned path that exists.** `edited = actual !== owned.hash` is now computed before the source-hash comparison is looked at:
- Not edited and the source hash is the same: `unchanged`, exactly as before.
- Anything else: `write`/`update` with `overwritesLocalEdit: edited`.

An untouched copy whose source or model changed therefore still gets `overwritesLocalEdit: false`. An edited copy is flagged whether or not the source changed. `harness-manifest.builder.ts:126` did not need to change.

**Finding 1, in `applyWrite`, for an owned path being updated** (`reason: 'update'` and `baseEntries[relPath]` present):
1. `detachForOverwrite` runs whatever the plan flag says.
   - It uses the same rename-into-history core as retirement: `{ws}/.ptah/harness/.history/<slug>/<ts>/<relPath>`.
   - It then decides on the detached object with `isProvablyUnchanged(owned.hash)`.
   - If the bytes are provably Ptah's, the staged copy is discarded and the empty history is pruned, so nothing is left behind and nothing is reported.
   - Otherwise the staged copy is kept as the snapshot.
   - Rename failure, history-directory failure, wrong kind, or a symlink means nothing is moved or written. The path goes into `writeFailed` and the manifest entry stays for a retry.
   - If the path is absent, or vanished before the rename (ENOENT), the write becomes a plain create.
2. The replacement is published with an exclusive create:
   - agent: `writeFile` with flag `wx`
   - command: `COPYFILE_EXCL`
   - skill directory: non-recursive `mkdir`
3. EEXIST means a save landed after the detach. That copy is kept and never overwritten. A `writeFailed` entry is recorded: `a new copy appeared at <rel> while it was being replaced; kept it; the earlier local edit is saved at <snapshot>`. The entry is not recorded in `written`, so the manifest keeps the old hash and the next pass treats the new copy as an edit (snapshot, then overwrite).
4. `overwrittenLocalEdit` is reported only when a kept snapshot exists and the publish succeeded.

Other paths:
- **`create` writes** (path absent at plan time) also publish exclusively, so a file created between plan and apply is preserved.
- **Adopted writes** (unowned, writer signature present) still replace in place, because their path is occupied by design.
- **MCP** is unchanged.

## Spec cases (all pass, 5/5)

The spec runs the real reconciler and Codex target. `os.homedir()` is mocked and `CODEX_HOME` is cleared. Interleavings come from a path-filtered `fs/promises.rename` spy and a wrapped `target.apply`.

1. Edited Codex copy plus a model-only change: `localEdit` and `overwrittenLocalEdit` are both `[copy]`, the history holds `HAND EDITED`, and the live file has `model-two`.
2. Untouched copy plus a model change: no `.history` is created, `localEdit` and `overwrittenLocalEdit` are `[]`, and the file is rewritten (today's behaviour).
3. A save injected after the detach rename and before the publish: the live file stays `NEWER SAVE`, the history holds the earlier edit, there is a `writeFailed` conflict, and the manifest hash is unchanged. On retry, the newer save is snapshotted too and overwritten, and `overwrittenLocalEdit` is reported.
4. A save between plan and apply on an untouched copy: the plan's `localEdit` is `[]`; apply snapshots `SAVED AFTER PLAN`, reports `overwrittenLocalEdit`, and publishes `model-two`.
5. A detach rename that fails with EXDEV: nothing is written, the edit is byte-unchanged, the reason matches `could not detach for overwrite: EXDEV`, ownership is kept, and no history is left.

## Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync`: `Successfully ran targets typecheck, lint`.
- `npx nx test @ptah-extension/harness-sync --maxWorkers=2`: `Tests: 17 failed, 533 passed, 550 total` (5 suites failed). A direct jest run of the same config listed exactly the baseline set:
  - agent-consent: 2
  - skill-consent: 7
  - gitignore E23: 5
  - cancellation B8: 2
  - write-failure E21: 1
  - capability-policy C3, which fails on main too
- Targeted run of the overwrite-detach, local-edit-report, retire-local-edit, artifact-retirement and agent-model specs: `47 passed, 47 total`.
- No baseline spec's expectation changed. The existing `local-edit-report (c)` prefix `could not save local edit before overwrite:` and the retirement reasons (`… before removal`, `could not detach for removal`) are kept by passing the purpose word into the shared core.

## Deviations and notes

- **Untouched-copy updates now depend on the history store.** Every owned update now detaches through `.ptah/harness/.history`, which is what closes the gap between plan and apply. If that store cannot be written (for example, a file sits where the directory should be), an update to an untouched copy now goes to `writeFailed` and is retried. Before, it was written in place. When the store is usable, the outcome for untouched copies is identical: no snapshot and no report.
- **Owned entries whose hash does not match the current output** (for example, very old manifests) will get a one-time history snapshot on their next update instead of a silent overwrite. This is conservative ("unknown is not unchanged").
- **Skill directories:** exclusive publication covers only the top-level directory. Files a third party writes into the freshly created directory during the copy are not guarded. That would need a staged-rename publish; I left it out to keep the change small.
- **Windows retry on an exclusive file create:** if the first attempt creates the file and then fails with a retryable error, the retry reports EEXIST as a conflict. The partial file is kept and handled on the next pass as an edit.

## Out-of-scope observations

- `claude-target.ts:381` still overwrites flagged command copies in place without a snapshot. It is a different target, not covered by this batch.
- Finding 4 (preview foreign-path fidelity) is not addressed here; it belongs to the rpc-handlers slice.
