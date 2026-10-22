# Shared popover top-layer repair (TASK_2026_710)

Bounded correction of `ptah-native-popover`. Not an acceptance pass, and not a reset of the exhausted CI corrections. No git commit, push, stash, or history change. Working tree left dirty.

`search_tool` for `ptah` and `ptah_agent_report` returned no schema (`total_hidden_tools: 10` on the tasks server). This lane could not call `ptah_agent_report`.

## Result

`NativePopoverComponent` still renders in place (no portal, no `FloatingUIService` change). While `isOpen()` is true, the backdrop and the floating panel sit in one `popover="manual"` shell. `openPopover()` calls `showPopover()` on that shell before `FloatingUIService.position()`, so the shell is on the top layer before measurement. The shell is transparent, full viewport, and `pointer-events: none`. The optional backdrop and the panel are `pointer-events: auto`. The native `::backdrop` is transparent and `pointer-events: none`, so `hasBackdrop === false` does not block the page.

This is not proof of a real top-layer hit-test. Jest was not run. Electron was not launched.

## Source evidence

Read this session:

- `.ptah/specs/TASK_2026_710_ptah-glass-theme/glass-ui-repair.md` lines 47–61. Section 3: every `[data-glass-surface]` is `position: relative; isolation: isolate`, so a z-index inside that context does not escape. `ptah-native-popover` kept the panel in the host DOM (`fixed inset-0 z-40` backdrop, `popover-panel … z-50`). The open-panel lift is `z-index: 30` on the hosting surface, the same level as the bar. Proposal, not previously implemented: Popover API `popover="manual"`, backdrop must join the top layer, do not raise `.popover-panel` z-index. `styles.css` was not re-opened here; the isolation claim is that section, and this lane was forbidden to edit `styles.css`.
- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts` before the edit (lines 89–110 then): backdrop and panel were conditional children of the host, not a popover element and not `dialog.showModal()`. Inputs, outputs, generation guard, 1000ms position timeout, `reposition()`, host Escape (`preventDefault` + `stopPropagation`), backdrop click emissions, and focus restore were already in this file.
- `libs/frontend/ui/src/lib/native/shared/floating-ui.service.ts` lines 176–182 and 229–236. `strategy: 'fixed'`, and `applyPosition` writes `position/left/top/visibility` only. The comment there says floating-ui resolves a fixed element's containing block from a transform ancestor. No service edit.
- `node_modules/typescript/lib/lib.dom.d.ts` lines 17869–17879. `showPopover(options?: ShowPopoverOptions)` and `hidePopover()` exist on `HTMLElement`. `libs/frontend/ui/tsconfig.json` lib is `dom` + `es2022`, so the call compiles for the shared UI lib.
- Spec before the edit: `native-popover.component.spec.ts` (trigger vs anchor, unpositioned no-anchor, reposition, backdrop dark/transparent/`hasBackdrop`, backdrop click emissions, Escape, focus restore, position failure/timeout/stale generation, destroy). Those cases were left in place. New cases are only the `top-layer shell` describe.

Popover API usage elsewhere: `showPopover` / `popover="manual"` had **zero** matches in this worktree before this edit. The theme menu was not used as a copy source.

## Preserve inventory

Unchanged public contract on `NativePopoverComponent`:

| Kind | Names |
| --- | --- |
| Inputs | `isOpen` (required), `placement` (`'bottom'`), `anchor`, `offset` (`DEFAULT_OVERLAY_OFFSET`), `hasBackdrop` (`true`), `backdropClass` (`'dark'` \| `'transparent'`), `keepInViewport` (`false`) |
| Outputs | `opened`, `closed`, `backdropClicked` |
| Methods | `reposition()`, `handleBackdropClick()`, `handleHostKeyDown()` |
| Constant | `POPOVER_POSITION_TIMEOUT_MS` = 1000 |
| Provider | component-scoped `FloatingUIService` |
| Position options | `flip: true`, `shift: true`, `shiftCrossAxis` only when `keepInViewport()` |
| Focus | store `document.activeElement` on open; focus the panel after a live open; restore the previous element on close and destroy if still connected |
| Generation | `openGeneration` bumped on open, close, and destroy; a stale open does not focus or emit `opened` |
| Projected content | `[trigger]` outside the shell; `[content]` inside `.popover-panel` |
| Panel classes | `popover-panel surface-3 z-50 rounded-xl p-2` plus the existing focus-visible outline. z-50 was not raised |
| Backdrop classes | `fixed inset-0 z-40`, `bg-black/50` only when `backdropClass() === 'dark'`. z-40 was not raised |

Not edited: `FloatingUIService`, `styles.css`, theme toggle, `.gitignore`, any other source file.

## Decisions

1. **One manual shell, only while open.** Options: raise z-index (rejected by section 3; cannot escape `isolation`), portal to `document.body` (new stacking and focus-root behavior; broader than the brief), `dialog.showModal()` (modal `::backdrop` would block even when `hasBackdrop` is false), two popovers (backdrop and panel can reorder). The brief names one wrapper around the existing backdrop and panel. `popover="manual"` does not light-dismiss, so outside clicks still do nothing unless the optional backdrop element is there. Reversible: the shell is local to this template.

2. **`showPopover()` before `position()`.** A non-open `[popover]` is `display: none` in the UA stylesheet, so Floating UI would measure an empty box. Promotion is synchronous at the start of `openPopover()`, after the floating element exists and before `positionPanel()`. If `showPopover` is missing or throws, the shell gets inline `display: block` and positioning still runs (in-place fallback, not the top layer). Reversible.

3. **Shell box resets, no containing-block properties.** UA `[popover]` sets `inset: 0`, `margin: auto`, `width/height: fit-content`, `border: solid`, `padding: 0.25em`, `background: Canvas`. A top-layer element is the containing block for `position: fixed` descendants. Floating UI `strategy: 'fixed'` returns viewport coordinates and does not know about the top layer (`floating-ui.service.ts` 176–182). The shell therefore resets margin, border, padding, inset, and size to a borderless full viewport and does **not** set `transform`, `filter`, `contain`, or `will-change`. Viewport `left`/`top` then match the shell's padding edge. Reversible.

4. **`::backdrop` is forced transparent and click-through with `!important`.** The optional dark/transparent veil stays the existing div. The native backdrop must not paint a sheet or steal hits when `hasBackdrop` is false. `!important` is only on those two `::backdrop` declarations so a UA `pointer-events` or background rule cannot undo them. Reversible.

5. **Failed positioning pins the panel under the trigger.** The old fallback left the panel in normal flow "under the trigger". Inside a full-viewport shell that static position is the viewport origin. On `'failed'` or `'timed out'`, if the trigger is connected, the panel gets `position: fixed` at the trigger's `left` and `bottom` and then `visibility: visible`. No flip, shift, or auto-update. The no-anchor path still only reveals visibility (no rect). Reversible.

6. **Hide after promote, focus after hide.** `closePopover()` and `ngOnDestroy()` call `hidePopover()` only after a successful `showPopover()`, then restore focus. A disconnected node swallows `hidePopover` errors without a dev log (removal from the `@if` already hides a showing popover; a second hide throws). `destroyed` blocks a queued open from showing or focusing after destroy. Generation checks after `await` still skip focus and `opened`. Reversible.

7. **Escape stays on the host.** `handleHostKeyDown` still `preventDefault` + `stopPropagation` + `closed`. The shell does not stop the event first, because the host is the DOM ancestor; stopping on the shell would swallow Escape before `closed` is emitted. No `CloseWatcher` was added (see risks).

## What changed

Files:

- `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts`
- `libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts`

Verbatim patch: unstaged `git diff` for those two paths (index `b3687cd42..e69ffc04d` and `79efddccc..4291dccc5` at the time of this report).

### Component

- Header comment: content stays in this component and joins the top layer; it is not portaled.
- Template: `@if (isOpen())` wraps one `<div #layerRef popover="manual" class="ptah-popover-layer">` around the unchanged backdrop `@if` and the unchanged `.popover-panel`.
- Styles on `.ptah-popover-layer`: `position: fixed; inset: 0; box-sizing: border-box; width/height: 100%; max-width/max-height: none; margin/border/padding: 0; overflow: visible; background: transparent; color: inherit; box-shadow: none; pointer-events: none`. No z-index on the shell.
- `::backdrop`: `background: transparent !important; pointer-events: none !important`.
- Direct `.popover-panel` and `[role='presentation']` children: `pointer-events: auto`.
- Fields: `layerRef`, `layerElement`, `layerShowing`, `destroyed`.
- `openPopover`: bail if destroyed; `showLayer()` before the anchor check and before `positionPanel()`; reveal helper for the unpositioned paths; stale/destroyed checks do not focus.
- `showLayer` / `keepLayerInPlace` / `hideLayer` / `revealUnpositioned` as in decisions 2, 5, and 6.
- `closePopover` and `ngOnDestroy` call `hideLayer()` before focus restore. Destroy sets `destroyed` first.

### Spec (`describe('top-layer shell')`)

Mocks `HTMLElement.prototype.showPopover` / `hidePopover` and restores them. Does not claim a real top layer.

- Shell absent when closed; `popover="manual"` and the panel inside it when open.
- Component `ɵcmp.styles` contain the reset, both pointer-events values, and `::backdrop`, and do not declare `transform`, `filter`, `contain`, `will-change`, or `z-index`.
- Dark backdrop still inside the shell; click emits `backdropClicked` and `closed`.
- `hasBackdrop === false` mounts the shell and omits `[role="presentation"]`.
- `showPopover` runs before `computePosition` (`['show','compute']`), then `opened`.
- Close before the open microtask does not call `showPopover` and does not emit `opened`.
- Close calls `hidePopover` once and a later flush does not move focus off the trigger.
- Destroy calls `hidePopover` once.
- With no popover methods installed, compute still runs, `opened` fires, panel is focused.
- Rejected positioning sets the panel to `fixed` at the trigger rect (`40px`, `70px`).
- Escape dispatched on the panel is `defaultPrevented`, emits `closed`, and does not reach the fixture element.

## Unresolved risks

- **No hit-test.** Electron 44 has the Popover API (Chromium well past 114). This change was not rendered. A glass ancestor can still paint over the panel if `showPopover()` does not run or does not put the shell on the top layer.
- **Parent modal dialog and Escape.** `popover="manual"` does not install a close watcher. `stopPropagation` on the host stops a bubbling keydown from reaching an ancestor `<dialog>`. The UA close watcher for `dialog.showModal()` runs before that key event and can still close the dialog. A `CloseWatcher` was not added; it is easy to get wrong while a modal dialog is open, and the brief asked for the manual popover, not a second dismiss system.
- **Coordinate coupling.** Correct `left`/`top` depends on the shell's padding edge matching the viewport. Any later `transform`, `filter`, `contain`, `will-change`, border, or margin on `.ptah-popover-layer` will desync Floating UI. `applyPosition` still writes viewport coordinates.
- **Close vs view teardown.** The `isOpen` effect runs after render, so the `@if` has often already removed the shell. Removal hides a showing popover. `hidePopover()` then throws on a disconnected node and is ignored. If a browser hides without leaving the top layer, this would not repair it. Destroy runs `hidePopover()` from `ngOnDestroy` while the view is still more likely to be connected.
- **No-anchor fallback.** With no connected trigger, the revealed panel is in the flow of the full-viewport shell (viewport corner), not at the old host static position. That path already logs in dev and skips `computePosition`.
- **`showPopover` reentrancy.** `layerShowing` is set only after `showPopover()` returns. A synchronous close during `beforetoggle` can clear `layerElement` before the flag is set, and the shell can remain showing with no later `hidePopover()`. Nothing in this component listens for `beforetoggle`.
- **In-place fallback is not the top layer.** Missing or throwing `showPopover` sets `display: block` so the UA `display: none` does not hide the shell. The panel then stays under the same isolation as before.
- **Encapsulation and `::backdrop`.** The rule is `.ptah-popover-layer::backdrop` in the component stylesheet. Emulated encapsulation should rewrite it to an attribute selector on the same element. That was not verified in a browser.
- **Style test reads `ɵcmp.styles`.** If the runtime component def does not keep those raw strings, that one assertion fails even when the stylesheet is correct.
- **jsdom prototype install.** If `showPopover` exists and is non-configurable, `installPopoverApi` throws. Not checked.

## Checks not run

User restriction for this lane: no tests, typecheck, lint, diagnostics, build, serve, dev, e2e, package, browser, or app launch. None of those were run. The new spec has not executed. No Electron screenshot. Top-layer painting and hit-testing are not claimed.
