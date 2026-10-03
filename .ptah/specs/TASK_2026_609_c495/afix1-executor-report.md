# A-FIX-1 executor report — harness-sync detach-then-decide retirement (F1, F2)

Executor: backend-developer (sub-agent). No git writes. Working tree left dirty.

## Files changed (A-FIX-1 list only)

- CREATED `libs/backend/harness-sync/src/lib/targets/artifact-retirement.ts` (390 lines): `retireOwnedArtifact`, `RetirementOutcome`, `RetirementHooks`, plus the moved `hashArtifact` / `snapshotLocalEdit` (exported), `historySlug`, `createUniqueDir`, `LOCAL_EDIT_HISTORY_DIR`, `MAX_SNAPSHOT_SUFFIX`.
- CREATED `libs/backend/harness-sync/src/lib/targets/artifact-retirement.spec.ts`: 20 unit cases, real fs, temp dirs.
- MODIFIED `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`: `retireOwned` is now a delegation that maps outcomes. The moved helpers are deleted. `snapshotBeforeOverwrite` imports `hashArtifact` / `snapshotLocalEdit`, and its semantics are unchanged. Imports that became unused (`cp`, `basename`, `errorCode`, `HARNESS_STATE_DIR`, `removeManaged`) are removed. **1293 → 1156 lines.**
- MODIFIED `libs/backend/harness-sync/src/lib/hash/content-hash.ts`: `MAX_DEPTH` is now `export const` with a doc line. No change to the ignore set, `listContentFiles` or `hashDir`.
- MODIFIED `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.retire-local-edit.spec.ts`: case 5 is rewritten and cases 10-12 are new. `os.homedir` is now mocked to the temp home and `CODEX_HOME` is cleared and restored.

I did not touch the B-5f1 files or the A-FIX-2 files.

## Design as built

`retireOwnedArtifact({ workspaceRoot, relPath, isDirectory, ownedHash }, hooks?)` returns one of `removed`, `removed-local-edit` (with `snapshotPath`) or `failed` (with `reason`). It applies these rules in order:

1. `lstat`. If the path is absent, `removeManaged` runs (ENOENT tolerated) and the outcome is `removed`. If it is a symlink, it is unlinked only (never followed, never snapshotted) and the outcome is `removed`.
2. If the kind does not match the manifest (a dir where a file was recorded, the reverse, or another node type), the outcome is `failed` with `cannot read to check for local edits: <relPath> is not a readable file|directory`. This is the same text case 4 asserts.
3. It creates `{ws}/.ptah/harness/.history/<slug>` (recursive), then a unique `<ts>` dir (non-recursive mkdir, `-N` on EEXIST), then the parents of `<ts>/<relPath>`. If any of these fails, the outcome is `failed` with `could not save local edit before removal: ...` and the original is untouched.
4. DETACH: `rename(original, staged)` under `withWindowsRetry`. If it fails, the outcome is `failed` with `could not detach for removal: <CODE>: ...`. ENOENT returns `removed` instead. In both cases the `<ts>` tree is cleaned up with an empty-dirs-only removal (non-recursive `rmdir`, so no byte can be deleted), and so are the empty `<slug>` and `.history` ancestors. There is no copy+delete fallback.
5. Nothing touches the original path after the rename.
6. DECIDE on the staged object. It counts as unchanged only when all of these hold:
   - `ownedHash` is defined.
   - The staged kind is right.
   - The hash equals `ownedHash`.
   - For a directory, `isFullyHashable` walks the whole staged tree and finds no ignored name at any depth, no symlink, no non-file/non-dir node, no unreadable directory and no directory deeper than `MAX_DEPTH`.
   This walk mirrors `listContentFiles`, including its `MAX_DEPTH` semantics and its `lstat` fallback for untyped dirents, but it answers "not covered" wherever that function skips something.
7. Unchanged: `rm -r` the staged `<ts>` dir, then prune only the empty ancestors (`<slug>`, then `.history`), so other snapshots are never visited. A failure to delete the staged copy is ignored and the outcome is still `removed`.
8. Otherwise the outcome is `removed-local-edit` and the staged copy is the snapshot.

`retireOwned` maps the outcomes as before: `failed` goes to `writeFailed`, so the entry is kept and retried. `removed` goes to `result.removed`. `removed-local-edit` goes to both `removed` and `removedLocalEdit`.

## Deviations from the batch text

- **"Logged-and-ignored" (rule 7).** The targets layer has no logger: nothing in `targets/` takes or uses a `Logger`. Adding one would mean a new dependency and changes to every target's wiring, which is out of scope. The ignored failure therefore carries the repository's `// degradation-audit: optional-capability - ...` comment, which is the convention used throughout this lib. It is not logged.
- **Case 12 seam.** The reconciler path has no hook-injection point. Threading one through `WorkspaceHarnessTargetOptions` would be a test-only production option. Instead, case 12 uses a path-filtered `jest.spyOn` on the real `fs/promises` module object (`jest.requireActual`): only the rename of `.codex/agents/agent-two.toml` fails, and the spy is restored before the retry pass. This is not `jest.mock('fs')`. The unit spec uses the module's own `RetirementHooks.rename` seam, as the batch asked.
- **Reason text for a failed rename.** The batch says "failed with the code in the reason". The reason is `could not detach for removal: EXDEV: ...`, which is a new prefix. The cases 4 and 5 texts are unchanged.
- **Case numbering.** Cases 10 (`.history/notes.md`), 11 (`_candidates` plus a symlink, end-to-end) and 12 (EXDEV detach failure, then a clean retry) are in the reconciler spec. The F2 race cases and the depth/`.ptah-origin.json` variants are in the unit spec only, because the hooks are not reachable through the reconciler.
- **`MAX_DEPTH` export.** It is used by the coverage walk and by the depth unit case. Behaviour is unchanged.

## Spec cases

`artifact-retirement.spec.ts` (20 cases, all pass):

- Unchanged file removed, no history. Unchanged skill dir removed, no history. An unchanged retirement leaves an earlier snapshot of the same slug untouched.
- Hand-edited file kept as the snapshot. No recorded hash means the copy is kept.
- F1 (`it.each`): `.history/notes.md`, `_candidates/draft/SKILL.md` and `.ptah-origin.json` inside an otherwise unchanged skill. Each case first asserts that the filtered hash is still equal, then that the bytes are kept in the snapshot.
- F1: a junction/symlink inside the skill is kept as a link in the snapshot, and its outside target is untouched.
- F1: a file at depth `MAX_DEPTH + 1` is kept.
- F2: a save after detach (`afterDetach`) with an unchanged staged copy: the new bytes stay at the original path, the staged copy is discarded and no history is left.
- F2: a save after detach with an edited staged copy: the original holds EDIT B and the snapshot holds EDIT A.
- F2: a save before detach (`rename` hook writes, then renames): the detached object is the new bytes, kept as `removed-local-edit`.
- Rename EXDEV / EBUSY: `failed` with the code, original intact, no `.history` left, and the next call retires the copy.
- Rename ENOENT: `removed`, no history.
- History store is a FILE: `failed` with `could not save local edit before removal`, and the unchanged original is kept.
- Kind mismatch: `failed` with the exact case-4 reason, nothing moved.
- Absent path: `removed`.
- Root symlink: unlinked, target untouched, no history.

`harness-reconciler.retire-local-edit.spec.ts` (12 cases, all pass):

- Cases 1-4 and 6-9 are unchanged and green.
- Case 5 now asserts that both the edited Codex copy and the unchanged Copilot copy are `writeFailed`, kept on disk and still owned. The comment cites design adjustment 2.
- Case 10: F1 `.history/notes.md`, end-to-end.
- Case 11: F1 `_candidates` plus a symlink, end-to-end.
- Case 12: EXDEV detach failure, then a clean retry.

## Checks (tailed)

`npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync 2>&1 | tail -30`:

```
√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck
NX  Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
```

I also ran `prettier --check` on the changed files. It flagged formatting in the 3 new/edited files; I applied `prettier --write` and they are now clean.

`npx nx test @ptah-extension/harness-sync --maxWorkers=2` result:

```
Test Suites: 6 failed, 50 passed, 56 total
Tests:       18 failed, 525 passed, 543 total
```

The failures, from a jest `--json` breakdown of the same run, all match the baseline:

| Spec | Failures | Baseline |
| --- | --- | --- |
| gitignore (E23) | 5 | yes |
| skill-consent | 7 | yes |
| agent-consent (`:143`, `:201`) | 2 | yes |
| cancellation (B8) | 2 | yes |
| write-failure (E21) | 1 | yes |
| capability-policy C3 | 1 | known flaky |

C3 passes when rerun in isolation (`capability-policy.spec.ts`: 8/8). No failure falls outside the baseline. `agent-consent.spec.ts:226`, `idempotency-removal.spec.ts:237`, `remove.spec.ts:97` and `foreign-edits.spec.ts:136` all pass.

## Batch verification items

- `workspace-target.ts` line count went down: 1293 → 1156.
- No TODO or stub.
- Retirement has no copy+delete fallback. The only `cp` left is in `snapshotLocalEdit`, which only the overwrite path (`snapshotBeforeOverwrite`, Part B) uses. Its semantics are unchanged, as the batch states.
- `git status --short` shows the five A-FIX-1 files, plus the A-FIX-2 agent-generation files that belong to the other agent, the task folder and `test-results/`. None of the B-5f1 files were modified at the time of the check.

## Out-of-scope observations

- `snapshotBeforeOverwrite` keeps the copy→verify→overwrite race already recorded for the B-7 review. It is not touched here.
- `lstatOrNull` returning `null` for a non-ENOENT `lstat` error (for example EACCES on the parent) still routes the path to `removeManaged`, as before. That behaviour is unchanged from Part A and is recorded here for the re-review.
