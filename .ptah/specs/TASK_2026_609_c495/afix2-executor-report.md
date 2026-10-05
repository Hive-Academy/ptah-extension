# Batch A-FIX-2 executor report: TASK_2026_609_c495

Executor: backend-developer (sub-agent). Date: 2026-10-04. Scope: batches.md "Batch A-FIX-2" (tasks 2.1–2.3), code-logic-review.md F2 (the quarantine part) and F3. I ran no git command that writes.

## Files

| File | Change |
|---|---|
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine-journal.ts` | CREATED, 272 lines. Holds the journal (`SeedQuarantineJournal`), `mergeSeedQuarantineLists`, `SeedQuarantinePassLock` and the slug rule `isSafeAgentSlug`, which moved here. |
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.ts` | MODIFIED, +246/−70, 917 → 1093 lines. Changed `run` (now split into `run` + `runPass`), `handleSlug`, `moveToHistory` (replaced by `detachToHistory` and the undo helpers) and `writeMarker`. The header doc comment now describes the new protocol. |
| `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-seed-quarantine.spec.ts` | MODIFIED, +257/−24. Adds a detach seam to the unit `describe` and 10 new cases; 2 existing cases were re-wired (see the deviations section). |

The other modified files in `git status` belong to other agents (`apps/*/di/phase-2-libraries.ts`, `cli-engine`, `platform-*`, `rpc-handlers`, `shared`). I did not touch them. `user-layer-mirror.service.ts` is unchanged.

These functions are byte-identical to HEAD (md5 of each function body, HEAD against the working tree):
- `listQuarantined`
- `restore`
- `restoreUnderLock`
- `readValidatedMarker`
- `selectSnapshot`
- `validateSeedQuarantineMarker`
- `compareExisting`
- `copySnapshotToSource`
- `placeExclusive`

The marker's v1 name and shape are unchanged.

## Design as built

### F2: detach by rename (`detachToHistory`, under the existing slug lock)

1. `fs.makeUniqueHistoryDir(.history/<slug>, Date.now())` creates the history dir. It keeps the `<ms>[-<n>]` names that `orderQuarantineSnapshotCandidates` parses.
2. If a sidecar exists, it is renamed into `<ts>/`. Then the clone is renamed to `<ts>/<slug>.md`. Nothing is copied, and nothing at the live paths is ever unlinked or `removePath`'d.
3. If either rename fails (EBUSY or anything else): the sidecar is put back without clobbering anything, the empty `<ts>` is removed with a non-recursive `rmdir`, and the error goes up. The outcome is `failed`, and the clone was never touched.
4. The detached clone is read and compared with the `cloneBytes` that were classified. If they differ, or the file cannot be read, the slug is treated as user work: `undoDetach` puts the clone back without clobbering, then the sidecar, then removes `<ts>`. If the live path has been taken again, the changed file and its sidecar stay together in `<ts>/`, with a warning that names `historyFile`. The outcome is `failed`; the slug is not journaled and gets no marker.
5. A save that lands after the rename creates a new file at the live path. The code never touches that path again, so the new file survives.
6. No-clobber put-back reuses the existing `placeExclusive`: a hard link, or a `COPYFILE_EXCL` fallback, followed by `unlink` of the staged file. Every rename and put-back path goes through `fs.assertUnderUserLayer`.
7. Test seam: an optional third constructor parameter, `renamePath: RenamePath = rename` (from `fs/promises`). Production never passes it; `user-layer-mirror.service.ts:290` is unchanged.

### F3: cumulative journal and pass lock

- **Journal file.** `.ptah-seed-quarantine.journal.json` in the scoped root. It is dot-prefixed and not `*.md`, and it is written with `fs.writeTextAtomic`. Content: `{ version: 1, quarantined, keptWithLocalWork, keptUnprovable }`.
- **Reading the journal.** `SeedQuarantineJournal.open` handles three cases:
  - Absent: treated as an empty journal.
  - Unreadable, unparseable or the wrong shape: `null` plus the warning `seed quarantine journal unreadable; nothing moved`. The pass then returns `ran: false` and moves nothing.
  - Unsafe slugs: dropped one by one with a warning, the same way as for the marker.
- **Recording a move.** After each verified move, `journal.recordMove(slug)` merges and writes; the slug is removed from both kept lists. If that write fails, `undoDetach` puts clone and sidecar back without clobbering and the outcome is `failed`. If the put-back is impossible, `logger.error` names the history file, and the bytes stay in `.history`.
- **Recording kept slugs.** `journal.recordKept(result)` merges the pass's kept slugs (as a union) after the loop. A failure there is only warned: nothing moved for those slugs, and the marker unions the pass anyway.
- **Marker.** Written only when the pass has zero failures, as `mergeSeedQuarantineLists(journal.lists, thisPass)`, in the exact v1 shape. A marker write failure behaves as before (no completion, retried next pass); the journal still holds every move. The result's lists and the info log still report this pass only, so existing assertions keep their meaning.
- **Pass lock.** `SeedQuarantinePassLock` is a promise chain keyed by `resolve(scopedAgentsRoot)`, owned by the `UserLayerSeedQuarantine` instance (so one per `UserLayerMirrorService`). It wraps `runPass` from the marker check to the marker write. Gates only ever resolve, so a pass that rejects still releases the lock. The pure precondition returns stay outside the lock (no workspace root, scoped root equal to the flat base, source not `ok`).

### Residual risk (accepted, as the batch states)

If the process exits between a clone's rename and its journal write, that clone's bytes stay in `.history/<slug>/<ts>/` but are not in the record. The window is one `writeTextAtomic`; no bytes are lost. The module header documents this.

## Deviations, with reasons

1. **`isSafeAgentSlug` moved into the journal module.** The journal must validate slugs on read. Importing the function from `user-layer-seed-quarantine.ts` would create an import cycle. `user-layer-seed-quarantine.ts` re-exports it (`export { isSafeAgentSlug }`), so the public API and every importer are unchanged. The body of `validateSeedQuarantineMarker` is byte-identical.
2. **The batch's size rule is not fully met, and the file now trips the `max-lines` warning.** With blank and comment lines skipped, `user-layer-seed-quarantine.ts` went from 675 code lines (HEAD) to 801. ESLint now warns `File has too many lines (801). Maximum allowed is 700` (a warning only; `nx lint` passes).
   - I moved all the journal bookkeeping (open, validate, record move, record kept, write) into the journal module. That brought the file down from 870 to 801.
   - What remains of the growth is the detach protocol itself, about 90 code lines: `detachToHistory`, `stagedMatches`, `undoDetach`, `putBack`, `move`, `removeEmptyDir`. That is new logic, not delegation.
   - The batch allows exactly three files, so I did not create a fourth. Recommendation for the team-leader: extract `user-layer-seed-quarantine-detach.ts`, holding the detach and undo helpers plus `placeExclusive`. That would bring the file back under 700 without touching any reader body. It needs a file-list amendment.
3. **Two existing spec cases were re-wired.** Both spied on `fsOps.snapshotFileToHistory`, which the new protocol no longer calls.
   - *"a failed move (Windows EBUSY) …"*: the EBUSY is now injected through the rename seam. Every original assertion is unchanged, including `:501`. I added the "no `<ts>` dir" check and the F3 assertions (cumulative marker, `listQuarantined`, `restore` for both slugs) to this case, because it is exactly the batch's "F3 success + EBUSY + retry" scenario.
   - *"does not remove the clone when the snapshot does not hold its bytes"*: replaced by the F2 "save between classification and detach" case. It is the same guarantee (a clone whose detached bytes do not match is never removed), exercised against the new mechanism.
4. **Journal merging is in memory, not re-read from disk.** "Read-merge-write" is done against the record this pass last wrote, which the pass lock makes the current record in this process. Re-reading mid-pass would add a failure mode (a parse error halfway through a pass) without making the update atomic across processes.

## Spec cases added (all in the `UserLayerSeedQuarantine — failure and locking` describe)

1. **F3 (extended existing case).** `video-director` moves and `figma-designer` hits EBUSY. Then:
   - no `<ts>` dir is left for `figma-designer`;
   - the retry writes a marker whose `quarantined` contains BOTH slugs;
   - `listQuarantined` lists both;
   - `restore` returns `restored` for both.
2. **F2, save before detach.** The clone is put back holding the user's bytes, the sidecar is put back, and there is no `<ts>` dir, no marker and no journal. The outcome is `failed`.
3. **F2, changed clone whose path is taken again.** The changed file stays in `.history/<slug>/<ts>/`, a warning names `historyFile`, the new file at the live path is untouched, and there is no marker.
4. **F2, save after detach.** The new file at the live path survives untouched, the detached seed (`VIDEO`) is in history, and the marker records the slug.
5. **Clone rename fails (EBUSY).** Clone and sidecar stay at their original paths, there is no `<ts>` dir, the outcome is `failed`, and there is no marker.
6. **Journal write fails after a move.** The clone is back in place, there is no `<ts>` dir, the outcome is `failed`, and there is no marker. The next pass moves the clone and records it in both journal and marker.
7. **Interrupted pass.** A journal from a prior pass, with no marker: the next clean pass writes a marker that holds the journal's slugs plus this pass's.
8. **Two concurrent `run` calls on one root (`Promise.all`).** One pass moves both clones and the other returns `ran: false`. The final marker holds both slugs.
9. **Malformed journal.** `ran: false`, nothing moves, no marker, and the warning is asserted.
10. **Merge rule.** A slug that was kept in the journal and is quarantined now leaves the marker's kept list.

**Home-path safety.** The spec already mocks `os.homedir()` for the whole file, pointing it at a per-test temp `fakeHome`. The new cases use the unit describe's `fakeHome/.ptah/user/agents/ws-abc123`. `CODEX_HOME` is not read anywhere in `libs/backend/agent-generation/src` (grep found no matches), so there was nothing to clear. After the runs, `~/.ptah/user/agents` holds no `ws-abc123` dir and no `*seed-quarantine*` file.

## Check results (tailed)

`npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation 2>&1 | tail -30`
```
√  nx run @ptah-extension/agent-generation:lint
√  nx run @ptah-extension/agent-generation:typecheck
NX  Successfully ran targets typecheck, lint for project @ptah-extension/agent-generation
```
(The only warning in the three files is the `max-lines` warning from deviation 2. The Nx Cloud "organization disabled" message is unrelated.)

`npx nx test @ptah-extension/agent-generation --maxWorkers=2 2>&1 | tail -40`
```
Test Suites: 36 passed, 36 total
Tests:       1 skipped, 1248 passed, 1249 total
NX  Successfully ran target test for project @ptah-extension/agent-generation
```
The 1219-passed baseline was recorded at `4071ff138`. This batch adds 10 cases, so the remaining +19 must come from commits after that baseline; I did not trace them. There are no failures. The skipped test is the existing POSIX-only chmod case.

## Out-of-scope observations

- No failures were observed in harness-sync or any other lib during this batch, because the checks above are scoped to agent-generation only.
