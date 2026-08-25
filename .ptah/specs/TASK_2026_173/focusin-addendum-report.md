# TASK_2026_173 — `(focusin)` addendum report

**Scope**: one two-binding fix + tests. No commit made; index untouched.

## What changed

| File                                                                       | Change                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`      | `+17 / -1` — two `(focusin)` bindings (lines 204, 368) routed to the existing `onPaneClick`, plus 15 lines of doc comment on that handler explaining why it now has two entry points.          |
| `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.spec.ts` | `+512` — six new tests in two describe blocks, plus three additive fields on the existing service/vim stubs (`updateSplitContent`, `targetLine`/`clearTargetLine`, `attachToEditor`/`detach`). |

The two bindings:

```html
(click)="onPaneClick('left')" (focusin)="onPaneClick('left')"
```

```html
(click)="onPaneClick('right')" (focusin)="onPaneClick('right')"
```

No new method, no new state, no rename. `setFocusedPane`, the mirror-cancel path, the
reconciliation path, the two Batch-7 panel guards and the negative typing test are all
byte-identical — `git diff` on `editor-diff-split.ts` is empty.

`focusin` was chosen over `focus` because it bubbles; `focus` does not, and Monaco puts
focus on a hidden textarea deep inside the pane. The two pane containers are siblings, so
neither pane's `focusin` can reach the other.

## Tests added (6)

Block 1 — `EditorPanelComponent — keyboard focus retargets the pane (focusin)`, stub editors:

1. _focus arriving in the split pane focuses it — with no click anywhere_ — a bubbling
   `focusin` flips `focusedPane` to `'right'`; a `click` listener on the fixture root
   records zero clicks; both panes' `[isFocused]` inputs (the exact input the Ctrl+S
   handler gates on) flip to `[false, true]`.
2. _focus returning to the primary pane focuses it back_ — proves the LEFT binding exists
   too, not just the right one.
3. _still focuses a pane on (click)_ — the mouse path is intact. This is the control:
   it is the one new test that must still pass when the bindings are removed.
4. _runs the C2 reconciliation and cancels the pending mirror on a KEYBOARD focus change_ —
   runs the **real `EditorDiffSplitHelper`** behind the service stub (real
   `EditorTabsHelper`, the panel's own signal instances as its state). An edit is typed in
   the split pane, the tab record moves, the left pane is still stale and a mirror is armed;
   keyboard focus then moves to the left pane and, **with no timer advanced**, the left pane
   already holds the split pane's text and the armed mirror's timer id has been passed to
   `clearTimeout`.

   Timer identity is observed by spying on the global `setTimeout`/`clearTimeout` rather
   than by fake timers: the helper's `setTimeout` runs inside the Angular zone, whose
   patched timer functions are captured before any fake clock could replace them, so
   `jest.useFakeTimers()` would not have seen it.

Block 2 — `EditorPanelComponent — a keyboard user can save from the split pane`, **real
`CodeEditorComponent`** in both panes over a fake Monaco that returns one editor instance
per `create()` call (keyed by the host element, which is also the keydown target):

5. _Tab into the split pane, Ctrl+S, and THAT pane's text is written_ — Ctrl+S on the split
   pane's Monaco host **before** the focus move is declined (`saveFile` not called: this is
   the reported bug, reproduced); a real `textarea.focus()` inside that host then bubbles a
   real `focusin`; `focusedPane` becomes `'right'`; Ctrl+S on the same host now yields
   `saveFile('/ws/a.ts', 'typed with the keyboard')` + `markTabClean`, exactly once.
6. _hands the save gate back to the primary pane when focus returns to it_ — the gate is
   per-pane, not sticky.

Tests 5 and 6 use real `.focus()` (jsdom does dispatch bubbling `focusin`), so nothing about
the focus event is simulated. Test 1's `focusin` is dispatched directly, which is what lets
it assert that no click occurred anywhere in the tree.

## Break-it-and-watch-it-fail (both directions)

**A. Remove both `(focusin)` bindings, keep everything else.** Run
`npx jest --config libs/frontend/editor/jest.config.ts --testPathPatterns=editor-panel`:

```
Tests: 5 failed, 43 passed, 48 total
  ● … a keyboard user can save from the split pane › Tab into the split pane, Ctrl+S, and THAT pane's text is written
  ● … a keyboard user can save from the split pane › hands the save gate back to the primary pane when focus returns to it
  ● … keyboard focus retargets the pane (focusin) › focus arriving in the split pane focuses it — with no click anywhere
  ● … keyboard focus retargets the pane (focusin) › focus returning to the primary pane focuses it back (both bindings, not just one)
  ● … keyboard focus retargets the pane (focusin) › runs the C2 reconciliation and cancels the pending mirror on a KEYBOARD focus change
```

Exactly the five focus tests fail; the `(click)` control test passes, confirming the mouse
path is genuinely independent. Bindings restored → `48 passed`. This check was run twice —
once on the first draft and again on the final, reformatted tests — with identical results.

**B. Second mutation, because A's reconciliation test failed on its first assertion
(`focusedPane`) and so did not prove the data-integrity assertions bite.** With the bindings
restored, `setFocusedPane`'s two body lines were temporarily commented out in
`editor-diff-split.ts`:

```
● … runs the C2 reconciliation and cancels the pending mirror on a KEYBOARD focus change
    Expected: "v0 + right pane edit"
    Received: "v0"
    > 1800 |     expect(editor.activeFileContent()).toBe('v0 + right pane edit');
```

The reconciliation assertion is load-bearing on its own. `editor-diff-split.ts` was then
restored; `git diff` on that file is empty.

## Suite state

- `npx nx test @ptah-extension/editor` → **16 suites, 279/279 passed**. Baseline was 273
  (Batch 7 + SEQ-2); +6 is exactly this addendum.
- `npx nx run @ptah-extension/editor:lint --max-warnings=-1` → **0 errors**. The 18 remaining
  warnings are pre-existing and in other files; the first draft added 4 non-null-assertion
  warnings in the new tests, which were refactored away — neither touched file appears in the
  lint output now.
- `npx nx run @ptah-extension/editor:typecheck` → clean.
- `git diff --stat -- libs/frontend/editor/` → 2 files, `+528 / -1`. Nothing outside
  `libs/frontend/editor/**`. No `git add`/`stash`/`checkout`/`reset`/`restore` was run.

## Notes for the team-leader

- **Ordering side effect, benign**: a mouse click on Monaco now fires `focusin` before
  `click`, so `onPaneClick` runs twice for one click. `setFocusedPane` is idempotent —
  `setLeftPaneContent`/`setRightPaneContent` both early-return on content equality and the
  second `cancelPendingMirror` finds no timer — so the second call is a no-op. Not papered
  over with a guard, because a guard would be the "new logic" this was scoped to avoid.
- **Deliberately in range**: keyboard focus on a tab-strip button or the close-split button
  now also retargets its pane, because those controls live inside the pane containers. That
  is correct — those controls belong to that pane — and `closeSplit` still resets
  `focusedPane` to `'left'` afterwards.
- The two-binding fix was sufficient; no scope expansion was needed and none was taken.
