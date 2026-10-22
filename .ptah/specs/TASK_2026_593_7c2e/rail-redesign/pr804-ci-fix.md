# PR #804 CI repair — spot-editor-save "Back asks first" failure

## Verdict

Real product defect, not a stale test contract. A `file:content-changed` push
that starts a reload while the spot editor is clean can wipe the user's buffer
and clear the dirty flag when its read resolves after typing. Back then leaves
without asking. No file changed; the recommended product fix is below.

## Failure evidence (CI run 39533059655, shard 2, job 119003251363)

- CI log: test 35 (`apps/ptah-electron-e2e/src/specs/git/spot-editor-save.spec.ts:273`)
  failed at line 289 — `getByRole('alertdialog')` reported "element(s) not found"
  after 30 s. Tests 30-34 (save/back, a11y, CRLF, conflict) passed in the same
  run. The conflict test proves typing set `modified` and the confirm dialog
  opened fine on the same build.
- Trace timeline (artifact `test.trace`, ms):
  - 190898 openFileInShell evaluate
  - 191292 openEditable poll success (document equals disk content)
  - 191300 `before` read, 191307 content click
  - 191592 `keyboard.insertText('// PTAH_E2E_EDIT')`
  - 191649 `typeAtEnd` poll SUCCESS — the document held `before + TYPED`
  - 191672 spot-editor-back click — no dialog for 30 s after it
  - 23 ms between the dirty-document proof and the click.
- `error-context.md` aria snapshot: the spot editor is GONE, the Changes file
  list is back, no alertdialog. Back took the clean-leave path.

## Root cause (file:line)

1. `typeAtEnd` is correct (`spot-editor-save.spec.ts:52-63`). The 191649 poll
   read the document through the component handle's state
   (`support/spot-editor.ts` `spotEditorText` → `handle.text()` →
   `view.state.sliceDoc()`). A docChanged transaction ran, so CodeMirror's update
   listener (`codemirror-setup.ts:218-222`) called `setModified(true)`
   (`codemirror-setup.ts:172-176`), so the component's `modified` signal was
   TRUE at 191649.
2. `goBack` (`spot-editor.component.ts:621-627`) read `modified()` FALSE at
   about 191674 and emitted `backToReview` without asking.
3. Writers of `modified`, and why each is excluded:
   - `markSaved` (`codemirror-setup.ts:253-258`) — needs a completed save.
     Test 35 never saves.
   - `open()` (`spot-editor.component.ts:852-869`) — runs only from
     `requestOpen` (`:812-823`) when the `[request]` input changes. The request
     is re-stamped only in `ReviewNavigationService.commit`
     (`review-navigation.service.ts:563`), which runs only from `navigate()`.
     No navigation call exists in the window: the review shell has no
     git-status or content subscription other than the spot-editor forward
     (`review-shell.component.ts` constructor), and the navigation service has
     no subscription at all (grep: no `listen`/`subscribe`/`MessageHandler`).
   - Component recreation — excluded: the 191649 poll read the same live
     component handle.
   - `handle.load()` through `reload()` → `mountDocument`
     (`spot-editor.component.ts:784-805`, `:871-886`) — the only remaining
     writer.
4. `reload()` is started by `notifyDiskChange`'s clean branch
   (`spot-editor.component.ts:592-606`) — or the Retry button, which is absent.
   So a `file:content-changed` push started `reload()` while the editor was
   clean; `reader.read` stayed in flight across the typing; it resolved between
   191649 and the click.
5. The wipe: `unchanged = result.status === 'fresh' && result.sha256 ===
   current.sha256 && !this.modified()` (`spot-editor.component.ts:797-800`).
   Typing during the read makes `!this.modified()` false, so `unchanged` is
   FALSE EVEN WHEN THE DISK SHA EQUALS THE LOADED SHA — nothing changed on
   disk. `mountDocument` then ran `handle.load(disk text)`
   (`codemirror-setup.ts:227-232`): the document was replaced (the typed text
   was destroyed), the baseline was reset, and `setModified(false)` cleared the
   dirty flag. `goBack` read false and left silently.

Two defects, one race:

- The `!this.modified()` term misclassifies "the user typed while the read was
  in flight" as "the disk changed".
- `notifyDiskChange` checks dirty state at push time only. `reload()` does not
  re-check at apply time, so a read that started clean destroys edits made
  while it was in flight. The push-time dirty branch (`:597-600`) correctly
  marks `stale` instead; the apply-time path lacks the same check.

## Trigger — what is and is not provable

- The push is Electron IPC and is not recorded in the Playwright trace; app
  logs do not print push payloads.
- The console window shows only the harness reconcile at 191045-191066. It
  wrote `.gitignore`, `.mcp.json` and `.ptah/harness/state.json`
  (`error-context.md` lists them as the untracked files). None key-matches
  `src/calc.ts` in `fileViewTabKey` (`file-view.types.ts:47-51`). Their content
  push lands at about 191566 (500 ms debounce,
  `git-watcher.service.ts:292`).
- Which watcher event queued a path matching the open file is therefore not
  provable from the artifacts. The reload itself IS provable by elimination
  (root cause step 3). The recommended fix closes the race regardless of which
  push starts the read.

## Changes

None.

- Product source is out of scope for this role. The task says: report evidence
  and recommended fix, then stop.
- The spec and helper were NOT changed either. They behaved correctly: the
  poll proved the dirty document through the app's own state. Weakening,
  skipping or retry-masking the assertion is forbidden and would hide a
  genuine data-loss path.

## Decisions

1. Verdict: real product defect, not a stale test contract.
   - Options: (a) stale contract — `typeAtEnd` races the app's async mount;
     (b) product defect — an in-flight reload wipes the buffer and the dirty
     flag.
   - Evidence: the 191649 poll read the typed text through the app's own state,
     and every other writer of `modified` is excluded with file:line evidence.
     A stale-contract theory cannot explain a clean leave 23 ms after a
     proven-dirty document.
   - Reversible: yes. The facts stand regardless of the fix chosen.
2. No test or helper change.
   - Options: (a) weaken, skip, or add retries/timeouts — forbidden by the
     task and by the evidence; (b) no change plus this report and a
     recommended fix — the task's stated stop condition for a product defect.
   - Evidence: the defect is in the app. The test is the only thing that caught
     it.
   - Reversible: yes.
3. No verification commands.
   - Zero files changed, so typecheck and lint have nothing to check. Runtime
     e2e is not authorized (context file, line 18).

## Recommended product fix (report-only)

In `SpotEditorComponent.reload()` (`spot-editor.component.ts:784-805`):

1. Remove `!this.modified()` from `unchanged`. When
   `result.sha256 === current.sha256`, the disk did not change; return without
   mounting. This also keeps undo history for save echoes — the comment's own
   stated goal at `:802`.
2. After the read resolves, re-check dirty state before mounting. If
   `this.modified() || this.saving()`, do not mount; mark `stale` when the sha
   differs — the same behavior `notifyDiskChange` uses at push time
   (`:597-600`).

Suggested regression test (unit, `spot-editor.component.spec.ts`): start
`reload()` while clean; set `modified` true (simulate typing); resolve the read
with the SAME sha; assert the document and `modified` survive. Repeat with a
DIFFERENT sha and assert `stale` is set instead of a remount.

## Verification results and limitations

- No checks run. No file changed, so typecheck and lint are not applicable.
  Runtime e2e is not authorized in this task.
- The failing test will keep failing until the product fix lands. This report
  intentionally does not mask it.
- The failure was not reproduced locally; the diagnosis is from CI artifacts
  (log, trace, error-context) and source reading.
- Tool budget: the diagnosis consumed the call budget; the count ends slightly
  over 40 because the deliverable and the pre-exit report are both mandatory.

## Changed files

None.