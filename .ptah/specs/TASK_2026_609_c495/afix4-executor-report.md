# A-FIX-4 executor report — quarantine rollback never unlinks the original path

## Files

- MODIFIED `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts`
- MODIFIED `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.spec.ts`

No new files. The marker and journal readers are unchanged.

## Change

- `placeExclusive(tmp, dest, onCopyFailure)` now takes a required `'remove-partial' | 'keep-dest'` argument. The cleanup after a failed `COPYFILE_EXCL` copy (`unlink(dest)`) runs only for `'remove-partial'`. The link-first path, the `EEXIST` -> `'exists'` handling and the propagation of the copy error are unchanged.
- `putBack` (the rollback) calls `placeExclusive(file.staged, file.original, 'keep-dest')`. The rollback no longer unlinks the original path on any failure. If placement fails, `putBack` returns `false` as before, and the staged file in `.history/<slug>/<ts>/` is kept. The callers already fail the slug in this case: `detachToHistory` throws, `handleSlug` throws `not recorded`, and both map to `'failed'`. No marker is written.
- The `detached file not put back` warning now gives the recovery path. Its fields are `staged` (the complete bytes), `livePath` and `reason`. On a copy error, `reason` adds that the live path may hold an incomplete copy and that the staged file is the complete one.
- Doc comments on `putBack` and `placeExclusive` explain why rollback must not unlink: an editor may own the path by then. The module header's "nothing is ever unlinked at the live paths" statement is now true for rollback too.

### Residual

When the fallback copy fails partway, rollback can now leave an incomplete copy at the live clone path. Before this fix, rollback deleted whatever was at that path. That incomplete copy is never quarantined, because quarantine requires its bytes to equal the flat file, and it is not the flat file. The next pass therefore classifies it as `kept-local-work`. The complete bytes stay in history, and the warning names them. The review asked for exactly this trade: keep both files rather than risk deleting one.

## Restore impact

Restore's behaviour is unchanged. `copySnapshotToSource` passes `'remove-partial'`, so it still cleans up exactly as before. This keeps its contract that a failed restore leaves neither a partial `dest` nor a temp file.

I did not switch Restore to `'keep-dest'`, because that is not provably safe for it. A partial file left in the source dir would turn every later Restore into a `conflict`, and the reconciler would propagate that file as a workspace-owned source. The same check-then-unlink window exists in Restore. It predates this task and is out of scope here, as `code-logic-rereview.md` #1 states.

## Spec cases

New regression test in the `UserLayerSeedQuarantine — failure and locking` describe: `re-review #1: a rollback whose fallback copy fails never unlinks an editor file created at the live path`.

1. An editor save lands before the detach, so the detached bytes differ and the code requests rollback.
2. The `link` and `copyFile` mocks are filtered by path; only calls whose `dest` is the live clone path are affected. `link` throws `EPERM`. The fallback `copyFile` writes `EDITOR REPLACEMENT` at the live path and then throws `EIO`.
3. The test asserts all of the following:
   - `copyFile` was reached for the clone path.
   - The slug is `failed`, not quarantined.
   - The live path holds `EDITOR REPLACEMENT`.
   - The history file holds `USER SAVE`.
   - The warning carries `staged` and `livePath`.
   - No marker and no journal entry were written.
4. The mocks are reset to the real implementations in `.finally`. `os.homedir()` is still mocked, through the file-level `jest.mock('os')`.

Proof that the test is red without the fix: with the rollback temporarily switched to `'remove-partial'`, running `npx jest -c libs/backend/agent-generation/jest.config.ts .../user-layer-seed-quarantine.spec.ts -t "re-review"` reported `Tests: 1 failed, 65 skipped`. Switching it back to `'keep-dest'` makes it pass.

## Checks (tailed)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation` printed `NX Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation`.
- `npx nx test @ptah-extension/agent-generation --maxWorkers=2` printed:
  - `Test Suites: 36 passed, 36 total`
  - `Tests: 1 skipped, 1249 passed, 1250 total`
  - `NX Successfully ran target test for project @ptah-extension/agent-generation`

The Nx Cloud 401 notice in the output is about the organisation's plan, not this change.
