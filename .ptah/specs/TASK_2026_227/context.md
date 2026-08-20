# Revert dialog unclickable by mouse in Electron

## How it was found

While mouse-testing the floating hunk action widget built for
`TASK_2026_221`, the Discard path opened its confirmation dialog and neither
button could be clicked in a real Electron host.

Evidence captured at the time:

```
dist/apps/ptah-electron-e2e/test-results/
  editor-hunk-widget-mouse-i-6046d-n-dialog-and-writes-nothing/
  test-failed-1.png
```

In that screenshot the string "Orchestra Canvas" is legible **through** the
modal box. The canvas is painting over the dialog, and its empty-state text
is intercepting pointer events on both Cancel and Discard.

## Mechanism

`libs/frontend/editor/src/lib/diff-view/diff-view.component.ts:491`:

```html
<div class="modal modal-open z-50"></div>
```

`z-50` is not a global layer. It resolves inside the nearest ancestor that
establishes a stacking context, so its effective paint order is only
meaningful among that ancestor's siblings. In the Electron grid layout the
editor panel sits inside a gridstack tile, and the canvas panel wins against
whatever the tile's own context can offer — no value of `z-50` inside the
tile can climb above a sibling of the tile.

The dialog markup is otherwise correct and was written carefully. From the
comment block at `diff-view.component.ts:477`:

- `role="alertdialog"`, `aria-modal="true"`, labelled and described
- focus moved to the non-destructive choice on open
- deliberately **no clickable backdrop** (`diff-view.component.ts:531` is
  `aria-hidden` and inert), because content is about to be destroyed
- Escape cancels, Tab is trapped (`diff-view.component.ts:1710`)

None of that is the bug. The bug is purely paint order and hit-testing.

## Why jsdom never caught it

jsdom has no layout and no compositing, so `z-index`, stacking contexts and
`pointer-events` hit-testing do not exist there. Every specced behaviour —
roles, focus movement, Escape, Tab trapping, and that Discard writes nothing
— passes. The dialog is correct in every dimension jsdom can observe.

This is the same class of defect as `TASK_2026_222` (glyph markers asserted
only as class names in jsdom, actually pinned to the wrong theme in Electron).
Both were invisible until someone looked at a real window.

## Scope

1. Make the dialog paint above the canvas and receive pointer events in the
   Electron grid layout. Prefer escaping the stacking context properly
   (portal / top-layer / native `<dialog>`) over escalating the `z-` number,
   which only moves the collision.
2. Preserve every existing contract: `alertdialog` role, `aria-modal`, focus
   on the non-destructive choice, Escape to cancel, Tab trapped, and the
   backdrop staying non-clickable. Destroying content on a stray backdrop
   click is the thing that comment block exists to prevent.
3. Verify **by mouse in a live Electron host**, not in jsdom. Click Cancel and
   confirm nothing was written; click Discard and confirm the hunk went. A
   passing jsdom spec is not evidence for this task.

## Related

- `TASK_2026_226` — the Electron e2e suite can run a stale renderer. Fix or
  work around that first, or a verification run here may be testing an old
  build. Manual `node apps/ptah-electron/scripts/copy-renderer.js` is the
  known workaround.
- `TASK_2026_221` §"Left out" — the widget's label truncates in a very narrow
  modified pane. `allowEditorOverflow: true` would fix it but would place the
  widget in the same fixed-position layer this task shows is broken. Revisit
  that decision once this is fixed.
