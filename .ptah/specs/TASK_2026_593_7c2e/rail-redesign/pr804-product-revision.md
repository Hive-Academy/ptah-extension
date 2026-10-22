# PR #804 — spot-editor correction round (review defects 1 and 2)

## Verdict

Both confirmed review defects are fixed in `SpotEditorComponent.reload()`,
inside the existing dirty-guard branch. Nothing outside that branch changed,
and no existing test was modified.

- Defect 1 (serious): a failed confirmed reload left the editor read-only
  under the read-error banner, and Retry's successful read was dropped by
  the dirty guard, so the trap never cleared. A `fresh` background result
  now repairs the failed-read status (`error` / `blocked` back to `fresh`)
  while keeping the buffer, the dirty flag and the loaded baseline, so Retry
  restores a usable editor. The next save still sends the loaded hash, so a
  moved-on disk still meets the host's conflict check instead of being
  silently overwritten.
- Defect 2 (moderate): an older in-flight read whose bytes matched the
  baseline forced `stale` false and cleared a mark set by a newer
  `notifyDiskChange` push that landed during the read. The dirty branch now
  only raises the mark (`stale.set(true)` on a differing sha); it never
  forces it false. A push newer than the read can no longer be erased by
  that read.

Confirmed discard semantics are untouched: `discardEdits` still skips the
dirty guard and still mounts the disk version, same-sha or not. The clean
branch, `notifyDiskChange`, `retry`, the sequence/destroy guards, the save
flow and the undo history are all unchanged.

## Root cause recap (from code-logic-review-pr804-ci.md, confirmed in source)

A confirmed reload (`reload(true)`, `spot-editor.component.ts:673` and `:711`)
whose read returns non-fresh skips the dirty guard and does
`file.set(result)` with the error state, then returns before
`mountDocument` (`:822-826`). `modified` stays true because only
`mountDocument` clears it, `canEdit` requires `status === 'fresh'`
(`:431-439`), so the editor is read-only with the error banner up
(`:301-315`). Retry calls `reload()` with the default (`:638-644`); the
dirty guard returned before any `file.set`, so the `fresh` result was
dropped and the trap persisted.

In the same guard, `stale.set(result.sha256 !== current.sha256)` wrote the
mark from a read that started before pushes that could land during its
await, so a same-sha result erased a newer push's `stale` mark
(`notifyDiskChange` sets it at `:601-603` without starting a second read).

## Changes

`libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`:

- `spot-editor.component.ts:806-821` — the dirty-guard branch of
  `reload(discardEdits = false)`:
  - `:812` — `stale` is now raise-only:
    `if (result.sha256 !== current.sha256) this.stale.set(true);`. A
    same-sha fresh result no longer writes `false`, so a mark set while the
    read was in flight survives it (defect 2).
  - `:816-818` — status repair (defect 1): when the result is fresh but
    `current.status !== 'fresh'` (the `error` / `blocked` state a failed
    confirmed reload left),
    `this.file.set({ ...current, status: 'fresh', failure: undefined })`.
    Spreading `current` — not `result` — is what keeps the loaded
    `sha256` baseline, the baseline `content` and the copied
    `encoding`; no `mountDocument` runs, so the buffer, the undo history
    and the dirty flag are untouched. The failed read's state carries the
    previous `sha256` / `encoding` / `content` because
    `FileViewReaderService.baseState` copies them on a failed refresh
    (`file-view-reader.service.ts:117-124`), so the repair alone restores
    `canEdit`.
  - Non-fresh results in the dirty branch still change nothing: a failed
    re-read proves nothing about the disk.
- `spot-editor.component.ts:783-794` — the `reload()` docblock gained two
  sentences stating the raise-only mark and the status repair. No other
  comment, signature, caller or branch changed; `retry()`, `open()`,
  `save()`, `notifyDiskChange`, `reloadFromBanner` and both dialog handlers
  are byte-identical to the earlier lane's versions.

`libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts`
(inside the existing `describe('reload racing edits made while its read is
in flight')`, reusing `holdNextRead()`):

- `spot-editor.component.spec.ts:994-1039` — regression for defect 1:
  type, push (stale), confirmed "Discard and reload" whose held read fails
  (`not-found`); asserts the trap first (read-error banner present, editor
  `readOnly`, dirty badge present), then Retry's held read resolves fresh
  with a new sha and new bytes; asserts the read-error banner is gone, the
  stale banner is up (sha differs), the editor is editable again, the
  buffer still holds the typed text, the dirty flag survives, and the next
  save sends `content: 'const a = 1;\nx'` with `expectedSha256: SHA_A` (the
  loaded baseline, not `SHA_B`).
- `spot-editor.component.spec.ts:1041-1060` — regression for defect 2
  (deferred read): a clean reload's read is held, the user types, a second
  `notifyDiskChange` push marks the file stale without a second read; the
  held read then resolves with the baseline bytes and sha; asserts the
  stale banner survives, and the buffer and dirty flag stay.

## Decisions

1. Defect 1 repaired the status inside the dirty branch, not in `retry()`.
   - Options: (a) give `retry()` a discard/mount path; (b) pass
     `discardEdits: true` from Retry; (c) repair the status in the dirty
     branch when the fresh result arrives.
   - Evidence for (c): (a) and (b) both mount the disk text over the dirty
     buffer — the task rule is "restore successful Retry recovery WITHOUT
     losing dirty buffer or adopting new baseline while keeping old text",
     and mounting is exactly what the confirmed answers exist for
     (`:673`, `:711`). The review's recommendation is the same: no mount,
     no new sha, clear the error. The trapped state differs from a normal
     dirty race only in `current.status`, so a `current.status !== 'fresh'`
     condition touches exactly that state and leaves every other dirty-race
     apply (including the CI race the fix closed) byte-identical.
   - Reversible: yes, one conditional.

2. The repair spreads `current`, not `result`.
   - Options: (a) `file.set(result)` and keep the buffer (adopts the new
     sha); (b) `file.set({ ...current, status: 'fresh', failure: undefined })`.
   - Evidence for (b): `save()` sends `current.sha256` as `expectedSha256`
     (`:739`). Adopting the new sha while keeping our buffer would make the
     next save silently win over on-disk bytes the user never saw — the
     same rule as decision 2 of `pr804-product-fix.md`. Keeping
     `current.content` also keeps `file().content` consistent with the kept
     sha, and the failed read's state already carries the copied
     `encoding` / `sha256` (`file-view-reader.service.ts:117-124`), so
     `canEdit` recovers without adopting anything.
   - Reversible: yes.

3. `saveError` is still not touched in the dirty branch.
   - Evidence: the banner that trapped the editor is the read-error banner
     (`file().status === 'error'`, template `:301-315`), not
     `saveError`. A read says nothing about a save; the pre-fix decision 3
     stands. `saveError` still clears at the start of the next `save()`
     (`:725`).
   - Reversible: yes (nothing changed).

4. Defect 2 fixed raise-only, not with push/read ordering metadata.
   - Options: (a) keep the two-way write; (b) raise-only
     (`stale.set(true)` on a differing sha, never `false`); (c) record a
     sequence for the stale mark and clear it only when a newer read
     started after the mark.
   - Evidence for (b): a push that lands during the read is newer
     information than the read, and the review recommends exactly this.
     (c) adds state for a corner. The residual cost of (b): a stale mark
     set before the read started survives a same-sha fresh read in the
     narrow "clean + stale, then push, then type during the read" order;
     the banner then stays until a successful save (which clears it,
     `:768`) or a confirmed reload. Assessed safe: it is conservative (an
     extra true warning, never a lost one), the host conflict check
     refuses a stale `expectedSha256` either way, and both recovery paths
     are tested behaviors. The clean branch still clears `stale`
     unconditionally, and it cannot clobber a newer mark: a push arriving
     while clean starts a newer read that supersedes the old one via
     `readSeq`.
   - Reversible: yes.

5. Scope kept to the numbered defects.
   - The review's decision 3 (post-save baseline revert on the clean path)
     is pre-existing and explicitly out of this verdict; untouched.
   - The review's minor note (no held-read test for the conflict dialog's
     secondary Reload) is coverage, not a numbered defect; not addressed.
     The source at `:711` passes `true` and the immediate-read test
     (`:569-588`) pins the mount.
   - No test was skipped, weakened or deleted; all 51 pre-existing
     assertions run unchanged and pass; no retry counts changed.

## Checks (exact commands and results)

One heavy check at a time, foreground, changed project only.

1. `npx jest -c libs/frontend/git-ui/jest.config.ts libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts --coverage=false --maxWorkers=2`
   — BEFORE the fix, with only the two new tests added:
   `2 failed, 51 passed, 53 total` (15.3 s). Both new tests failed on the
   exact review mechanisms: defect 1's test at
   `spot-editor.component.spec.ts:1028` (the read-error banner is still
   present after Retry's fresh read), defect 2's test at `:1057` (the
   stale banner is gone after the older same-sha read). All 51 pre-existing
   tests passed, so the earlier lane's behavior is pinned across this
   change.
2. Same command AFTER the fix: `Test Suites: 1 passed, 1 total`,
   `Tests: 53 passed, 53 total` (15.0 s).
3. `npx nx typecheck @ptah-extension/git-ui --parallel=1` — exit 0
   (7.9 s).
4. `npx nx lint @ptah-extension/git-ui --parallel=1` — exit 0 (4.8 s).

The full-library `nx test` guard was not run: the parent command guard
refuses it due to a false-positive git-ui token. It was not run and not
routed around; only the previously authorized focused spec above ran.

## Limitations

- The blocked-status variant of defect 1 (`reload(true)` returning
  `blocked`, then Retry) is covered by the same `current.status !== 'fresh'`
  condition but has no dedicated unit test; the error variant is the one
  the review demonstrated and the one tested.
- The reviewer's minor held-read gap for the conflict dialog's secondary
  Reload remains open (see decision 5).
- The pre-existing post-save baseline revert (review decision 3) is still
  present by design; this round did not expand into it.
- Electron e2e was not run (build/serve/dev/e2e/package targets are not
  authorized). The unit tests reproduce both mechanisms deterministically
  with held reads.
- The jsdom run still prints the pre-existing
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` warning from CodeMirror's
  lazy language-chunk import; environment noise, present in all runs.
- Dependent hosts: the change stays inside `@ptah-extension/git-ui`; only
  the changed project was checked (memory-safe rules). CI and the pre-push
  hook run the other hosts.
- No git operations were performed: no commit, push, merge, stash, reset,
  clean or discard. The working tree still holds exactly the two scoped
  files modified (this round's edits on top of the earlier lane's fix),
  plus the untracked task-folder reports.

## Changed files

- `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`
- `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts`
- `.ptah/specs/TASK_2026_593_7c2e/rail-redesign/pr804-product-revision.md`
  (this report)