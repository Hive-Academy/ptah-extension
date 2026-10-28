# Sidebar preview dialog fix: 400 px (Serious 1, visual-review-p2)

## Cause

There were two independent causes. Both were in `agent-preview-dialog.component.ts`, and the layering came from the app shell.

1. **The height was never capped.** The overlay was `fixed inset-0 grid place-items-center p-3`. The section had `max-h-full`. The grid has one implicit `auto` row. While the track is being sized, the item's percentage `max-height` resolves against that indefinite track, so it acts as `none`. The row then grows to the section's content height, and `max-h-full` caps the section at that same height. So the section never scrolls.
   - When the section is shorter than the viewport, the row is centered. At 1280 px the title is at y 120 and Confirm at 749-781 (`reviews/visual/p2/sidebar.json`).
   - At 400 px the wrapped content makes the section about 1005 px tall. The overflowing track starts at the 12 px padding edge, so the title sits at y 29 and Confirm at y 970-1002. Both match the review numbers exactly.
   - The containing block is the viewport. The wide-layout metrics are centered on the viewport, so no transformed ancestor is involved.

2. **The overlay is below the Electron header in glass mode.** The narrow screenshot shows glass on. `apps/ptah-extension-webview/src/styles.css`:
   - Line 2871 gives every `[data-glass-surface]` `position: relative; isolation: isolate`.
   - Line 2983 gives the navbar `[data-glass-surface='bar']` `z-index: 30`.
   - The dialog renders inside `configuration-surface-host` (`data-glass-surface="chrome"`, `electron-shell.component.ts:455-459`). That element is an isolated stacking context with `z-index: auto`.
   - So the overlay's `z-50` is trapped inside that context, and the z-30 header paints over the dialog's top. `elementFromPoint` at the title returns the header.
   - The shell's lift rule (styles.css about line 3006) raises only surfaces that contain an open `.modal`, and this overlay is not a `.modal`.
   - The narrow workflow sheet (`absolute z-20`, `generation-workflow-shell.component.ts:166-174`) is another such trap.
   - The wizard modal works because `ptah-native-modal` uses `showModal()`, which puts it in the top layer.

A height cap alone (option a) would not have fixed the covered title. That is why option (b) was used as well.

## Change

`libs/frontend/setup-wizard/src/lib/components/agent-preview-dialog.component.ts`:

- **Top layer.** The overlay `<div>` is now a `<dialog>`, and an effect calls `showModal()` on it once it renders. This escapes every app-shell stacking context and containing block.
  - The classes reset the UA modal box: `fixed inset-0 m-0 h-full w-full max-h-none max-w-none border-0`, the same `bg-neutral/60 p-3` scrim, `text-base-content`, and `backdrop:bg-transparent`.
- **Height cap.** The panel is `max-h-[calc(100dvh-1.5rem)] flex flex-col`. The title and description are `shrink-0` at the top and the actions row is `shrink-0` at the bottom. Only the body between them scrolls (`min-h-0 flex-1 overflow-y-auto`, with `-mx-1 px-1` so focus outlines are not clipped). Title and Confirm stay visible at any viewport height.
- **ARIA and keyboard.** `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`, `tabindex="-1"`, `#dialog` and `(keydown)` moved from the inner `<section>` to the `<dialog>`, so there is one dialog role and no nested second one.
  - `[role="dialog"]` still matches exactly one element. Every data-testid, the selector, the inputs and the outputs are unchanged.
- **Focus.** The existing Tab trap, Escape handling, first-focus and loading refocus are kept.
  - `focusFirst()` runs right after `showModal()`, so the dialog's own first-focus rule wins over the UA's.
  - When the dialog closes, it calls `close()` before restoring focus to the opener. While a modal is open the rest of the page is inert, so the opener could not otherwise take focus.
  - A new `onCancel` handles the native `cancel` request (Escape with focus on the `<dialog>` itself): it prevents the self-close and emits `dismissed`, because the owner still controls `open`.

Extra file (strictly needed): `libs/frontend/setup-wizard/src/test-setup.ts`. jsdom 30 has no `showModal`/`close`. I added `??=` stubs of the same shape that the chat lib specs use, so the three setup-wizard specs that render this dialog keep running. A spec's own stub still takes precedence, as in `generation-preview-modal.component.spec.ts`. No spec assertion needed to change.

## Verify

`npm run verify -- -p @ptah-extension/setup-wizard,ptah-extension-webview`: exit 1, `6 tasks: 5 succeeded, 1 failed`, 0/5 cache hits.
- setup-wizard lint, test and typecheck passed, and so did webview test and typecheck.
- The only failure is `ptah-extension-webview:lint`: `Circular dependency between "ptah-extension-webview" and "@ptah-extension/command-center"`. This is accepted under D19 and unrelated to this change.

Not run: an Electron re-shot at 400 px. A visual re-review should confirm two things: the title at the top is hit-testable, and Confirm is inside the 900 px viewport.

## Decisions

- **Structure: top layer via native `<dialog>` in this component**, rather than wrapping in `ptah-native-modal` or adding a `.modal` class.
  - `ptah-native-modal` would add backdrop-click dismissal and a different projection structure, which changes behaviour.
  - A `.modal` class would pull in daisyUI's opacity and pointer-events rules.
  - The change is reversible.
