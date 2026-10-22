# PR #804 — spot-editor reload race product fix

## Verdict

Fixed in `SpotEditorComponent.reload()`. A background reload whose read
resolves while the editor is dirty, or while a save is running, no longer
replaces the buffer. It keeps the buffer and the dirty flag, marks the file
stale when the disk bytes differ, and leaves the loaded baseline (the
`sha256` sent as `expectedSha256`) untouched so the next save still meets the
host's conflict check. The two explicitly confirmed Reload answers are the
only paths that still replace a dirty buffer, and they behave exactly as
before.

## Root cause recap (from pr804-ci-fix.md, confirmed in source)

`reload()` computed `unchanged = fresh && sha256 equal && !this.modified()`
(`spot-editor.component.ts:797-800` pre-fix). Edits made while the read was
in flight made `!this.modified()` false, so even a same-sha read classified
as "changed" and `mountDocument` wiped the buffer, reset the baseline and
cleared the dirty flag. `notifyDiskChange` checks dirty state at push time
only (`spot-editor.component.ts:601-605`), so the clean-start branch had no
apply-time protection.

## Changes

`libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`:

- `spot-editor.component.ts:783-821` — `reload(discardEdits = false)`:
  - After the read resolves (and after the existing `destroyed`/`seq`
    guards), re-checks `this.modified() || this.saving()` before applying a
    background read. When dirty and not `discardEdits`, it returns without
    mounting, without `file.set` (baseline kept) and without clearing
    `saveError`; it sets `stale` only when the fresh result's sha256 differs
    from the loaded baseline (`spot-editor.component.ts:804-813`).
  - Removed `!this.modified()` from the same-sha decision. A same-sha fresh
    result still returns without mounting — the save-echo path keeps the
    undo history (`spot-editor.component.ts:816-819`).
  - `discardEdits` skips the dirty guard entirely and also mounts on a
    same-sha result, which is exactly the pre-fix behavior of the confirmed
    paths (they were always dirty at apply time, so `unchanged` was always
    false for them).
- `spot-editor.component.ts:673` — `onDialogConfirmed` case `'reload'`
  ("Discard and reload") now calls `this.reload(true)`.
- `spot-editor.component.ts:711` — `onDialogSecondary` (the conflict's
  explicit Reload) now calls `this.reload(true)`.
- Callers left on background semantics (default `false`):
  `notifyDiskChange` (`:605`), `reloadFromBanner` (`:635`), `retry`
  (`:640`).

`libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts`:

- `spot-editor.component.spec.ts:900-993` — new describe "reload racing
  edits made while its read is in flight", with a `holdNextRead()` helper
  (`:908-927`) that holds one `file:viewContent` call in flight until the
  test releases it, so the race is deterministic (no timers, no retries).
  Tests:
  - `:924` same-sha dirty during the read: buffer text and the dirty flag
    survive; no stale mark.
  - `:942` different-sha dirty during the read: buffer text and dirty flag
    survive; stale mark appears; the next save still sends
    `expectedSha256: SHA_A` (the loaded baseline), proving the baseline was
    not advanced.
  - `:965` clean reload still remounts the new disk version.
  - `:976` the confirmed "Discard and reload" still replaces the dirty
    buffer with the disk version through the held read.

No other file changed. Existing tests, UI copy, dialog kinds, save flow,
`confirmLeave` and sequence/destroy guards are untouched.

## Decisions

1. Reload callers split into background vs confirmed.
   - Options: (a) a blanket apply-time dirty guard on every reload;
     (b) a `discardEdits` flag set only by the two confirmed dialog
     answers.
   - Evidence for (b): the confirmed answers call `reload()` while
     `modified` is true (their dialogs only open when it is), so option (a)
     would make "Discard and reload" and the conflict's Reload into no-ops
     and break the task's requirement to preserve explicit confirmed
     discard. All five callers were inspected (`notifyDiskChange`,
     `reloadFromBanner`, `retry`, `onDialogConfirmed` 'reload',
     `onDialogSecondary`).
   - Reversible: yes, one default parameter.

2. The dirty branch keeps the loaded baseline (no `file.set`).
   - Options: (a) advance `file` to the new read; (b) leave it.
   - Evidence for (b): `save()` sends `current.sha256` as `expectedSha256`
     (`spot-editor.component.ts:739`). Advancing the baseline to the new
     disk sha while keeping our buffer would make the next save silently
     win over the on-disk change the user never saw — the conflict check
     must compare against the sha the buffer was loaded from. This is the
     task rule "do not advance loaded disk baseline while preserving dirty
     buffer on differing SHA".
   - Reversible: yes.

3. `stale` in the dirty branch is written only for a fresh result:
   `stale.set(result.sha256 !== current.sha256)`; a failed re-read leaves
   the previous stale mark and save error untouched, because a failed read
   proves nothing about the disk. The clean branch keeps the pre-fix
   unconditional `stale.set(false)` / `saveError.set(null)` before
   `file.set`.
   - Evidence: pre-fix code cleared both unconditionally only on paths that
     end in the clean branch or the wipe; no existing test pins saveError
     behavior on a reload that meets a dirty buffer.
   - Reversible: yes.

4. No additional guard inside `mountDocument`'s `ensureEditor` await.
   - Evidence: every `reload()` caller requires `hasDocument` true (or
     routes through `open()` instead, as `retry` does without a document),
     and `hasDocument` only becomes true after the editor promise is
     created, so `ensureEditor()` resolves a cached promise there — the
     await is a microtask continuation and no keystroke task can interleave
     before `handle.load`. Cross-read races are covered by the existing
     `seq !== this.readSeq` check inside `mountDocument`.
   - Reversible: yes (nothing changed).

5. The dirty guard includes `this.saving()`, matching `notifyDiskChange`'s
   push-time condition and the CI report's recommendation: a save in flight
   (including `overwrite` after a conflict, where `modified` can be false)
   must not have its buffer replaced by a background read.

## Checks (exact commands and results)

One heavy check at a time, foreground, changed project only.

1. `npx jest -c libs/frontend/git-ui/jest.config.ts libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts --coverage=false --maxWorkers=2`
   — BEFORE the product fix, with only the new tests added:
   `2 failed, 49 passed, 51 total`. Both new race tests failed on the
   exact CI mechanism (buffer replaced by disk text: expected
   `'const a = 1;\n// typed while the read was in flight\n'`, received
   `'const a = 1;\n'` for same-sha and `'from disk\n'` for different-sha).
   The two capability tests (clean reload, confirmed discard) passed, so
   the new tests fail before and the guard tests pin behavior across the
   fix.
2. Same command AFTER the fix: `1 passed, Tests: 51 passed, 51 total` (14.4 s).
3. `npx nx typecheck @ptah-extension/git-ui --parallel=1` — exit 0
   (9.5 s; the "Nx Cloud organization disabled" message is a plan warning,
   not a task failure).
4. `npx nx lint @ptah-extension/git-ui --parallel=1` —
   `NX Successfully ran target lint for project @ptah-extension/git-ui`
   (5.2 s).

## Limitations

- The Electron e2e suite was not run (build/serve/dev/e2e/package targets
  are not authorized in this task). The CI failure
  `apps/ptah-electron-e2e/src/specs/git/spot-editor-save.spec.ts:289`
  should pass once this lands, but that is CI's result to show, not a
  verified claim here. The unit tests reproduce the exact wipe mechanism
  deterministically instead.
- The watcher push that started the CI reload remains unproven (IPC pushes
  are not recorded in the Playwright trace, per pr804-ci-fix.md). The fix
  closes the apply-time race regardless of which push starts the read.
- The jsdom run prints a non-fatal `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`
  warning from CodeMirror's lazy language-chunk import
  (`codemirror-setup.ts:246`). It is pre-existing environment noise for
  this spec, present in both runs, and the suite passes.
- Dependent hosts: the change is inside `@ptah-extension/git-ui`, which the
  Electron app, the TUI and the VS Code webview host. Only the changed
  project was checked here (memory-safe rules). CI and the pre-push hook
  run the other hosts' checks.
- No git operations were performed: no commit, push, merge, stash, reset,
  clean or discard. The working tree holds exactly the two scoped files
  modified, plus this report and the two pre-existing untracked context
  files.

## Changed files

- `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`
- `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts`
- `.ptah/specs/TASK_2026_593_7c2e/rail-redesign/pr804-product-fix.md` (this report)