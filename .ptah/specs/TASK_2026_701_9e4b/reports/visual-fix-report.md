# Visual fix report — TASK_2026_701_9e4b (visual-review Issues 1, 3, 4, 6)

The changes are layout-only. Copy text, roles, test ids and behaviour are unchanged. Issues 2 and 5 were not touched, as instructed.

## Per issue

### Issue 1 (Serious): the config-home action button cannot wrap
- `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts:181`
  - Button class changed from `btn btn-xs h-auto min-h-6 py-1 [overflow-wrap:anywhere]` to `btn btn-xs h-auto min-h-6 max-w-full justify-start whitespace-normal py-1 text-left [overflow-wrap:anywhere]`.
  - `whitespace-normal` overrides daisyUI's `.btn` nowrap, so the existing `[overflow-wrap:anywhere]` now takes effect.
  - `max-w-full` keeps the button inside the notice's flex-wrap row.
  - `text-left` and `justify-start` keep a multi-line path readable.
  - The full label and the spinner are unchanged.

### Issues 3 and 4 (Moderate): the provenance badge squeezes the name, and wrapped text spills over the pill
Both issues use one approach: the badge is a single line that truncates, and its existing `title` carries the full origin.
- `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:322`
  - The badge changed from `badge badge-sm h-auto max-w-[40%] shrink-0 … [overflow-wrap:anywhere]` to `badge badge-sm min-w-0 max-w-[40%] shrink …`.
  - The badge can now shrink.
  - It keeps daisyUI's fixed single-line height, so no text can sit on the border (Issue 4).
- `installed-skills-page.component.ts:330-332`
  - The badge text now sits in an inner `<span class="min-w-0 truncate">`. The extra span is needed because `text-overflow: ellipsis` does not apply to the text node of an inline-flex `.badge`.
  - The `title="Origin: …"`, the colour binding and `data-testid="installed-skill-provenance"` are unchanged.
- `installed-skills-page.component.ts:286`
  - The row link (`data-testid="installed-skill-open"`) changed from `min-w-0 flex-1` to `min-w-[7rem] flex-1`.
  - The name block now keeps at least 112 px, about 14 characters of `text-sm`. The badge shrinks and truncates first (Issue 3).

### Issue 6 (Moderate): the install failure copy is off screen
- `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts:459-473`
  - The `@if (installFailed())` alert block moved out of the `max-h-[55vh] overflow-y-auto` body (:189). It is now placed directly above `.modal-action`, and `mt-3` was added for spacing.
  - The copy, `role="alert"` and `data-testid="external-consent-error"` are identical.
  - It is now always visible next to the Retry button, however long the local-files list is.

## Specs changed
- `libs/frontend/marketplace/src/lib/external-consent-dialog.component.spec.ts:252-257`
  - Added to "renders an error without dismissing the dialog".
  - It asserts that the alert has no `.overflow-y-auto` ancestor and that its next element sibling is `.modal-action`.
- `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.spec.ts:425-433`
  - Added to "shows a provenance badge on every row and the agent count".
  - It asserts that the first badge keeps `title="Origin: Plugin: Ptah Release Kit"` and that its text sits in a `.truncate` child.
  - The existing `textContent` assertions still pass unchanged.
- The `plugin-config-home-notice` specs needed no change, because no spec asserts the button's classes.

## Verification
- Command: `npm run verify -- -p @ptah-extension/marketplace` (one foreground run, with filtered output).
  - Result: `NX   3 tasks: 3 succeeded` (lint, test and typecheck for `@ptah-extension/marketplace`).
- After that run, one assertion in `installed-skills-page.component.spec.ts` was reformatted to match Prettier's line width. The change only splits one `toBe(...)` call across lines; there is no logic change.
  - `npx prettier --check` on all five changed files reports "All matched files use Prettier code style!".
  - verify was not re-run for this formatting-only edit.
- No build, serve or e2e targets were run.
- No new screenshots were taken. The rendered result at 400 px has not been rechecked in Electron.

## Decisions
- **Issues 3 and 4: truncate vs wrap.** Options were (a) a single-line `truncate` plus `title`, (b) `whitespace-normal h-auto py-0.5` with a smaller radius, or (c) moving the badge under the name.
  - Chosen: (a). It fixes both issues with one rule, keeps the row height stable, and uses the `title` that already exists. Wrapping (b) would still take width from the name. Moving the badge (c) would change the row structure and the meta line.
  - Evidence: visual-review.md Issues 3 and 4 suggest these options.
  - Reversible: yes.
- **Name floor of `min-w-[7rem]`.** This guarantees a readable name without a breakpoint.
  - Option considered: hiding the badge below a breakpoint. It was rejected because the origin label would then disappear entirely at narrow width.
  - Reversible: yes.
- **Issue 6 placement.** Options were (a) between the scroll body and the actions, (b) above the scroll body, or (c) scroll into view or focus it.
  - Chosen: (a). The user looks at the actions after a failed confirm, and it is a pure template move with no new behaviour. (c) would add behaviour, which is out of scope.
  - Reversible: yes.

## Open issues
- Issues 1, 3, 4 and 6 need an Electron re-capture at 400 px and at wide width to confirm the fixes visually. Note that Issue 2, the 400 px app-shell overflow, still clips the right 32 px at a true 400 px window, and that clipping is not caused by these fixes.
- Issues 2 and 5 are not addressed, as instructed.
