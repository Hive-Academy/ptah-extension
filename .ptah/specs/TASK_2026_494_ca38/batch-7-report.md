# Batch 7 report: surface input components (text, choice, checkbox)

Executor: frontend-developer (took over from a CLI lane that stopped after writing one file). No git run.

## Files (all under `libs/frontend/declarative-dashboard/src/lib/components/`)

| File | Lines | Status |
| --- | --- | --- |
| `surface-text-input.component.ts` | 180 | reworked from the lane's draft |
| `surface-text-input.component.spec.ts` | 229 | new |
| `surface-choice-input.component.ts` | 157 | new (select + radio-group) |
| `surface-choice-input.component.spec.ts` | 195 | new |
| `surface-checkbox-input.component.ts` | 94 | new |
| `surface-checkbox-input.component.spec.ts` | 118 | new |

No other file changed. `src/index.ts` does not export these yet; that belongs to B8.

## Draft text input: what I kept and what I changed

Kept: standalone + OnPush, signal inputs and outputs, a per-instance id from a module counter, the
`drafts` / `pendingValues` / `issues` inputs, the `draftChange: SurfaceDraftWrite` output (a draft write into
`SurfaceViewState.drafts`, where `undefined` removes the draft), the Rule 4 `displayedValue`, a `baseline` of
pending ?? host for the "unchanged" test, the `checkDraftValue` gate, one timer cleared through `DestroyRef`, the
hint, error and issue ids in `aria-describedby`, and the text colours (`text-base-content-muted` for the hint,
`text-base-content` for errors).

Changed:
1. The commit now reads a local `typedText` first, then `drafts()[id]`. Before, it depended on the parent's
   draft round trip having reached the input signal. A blur, Enter or timer that fired before the parent wrote
   the draft back would have committed nothing.
2. The order is now `inputCommit` first, then the draft removal. The parent can raise its pending overlay
   before the draft leaves, so the host value never flashes (plan:770-771).
3. An Enter that ends an IME composition (`isComposing`) no longer commits.
4. `errorText` is simpler: a host-read error shows only while there is no draft. Otherwise the error comes
   from `checkDraftValue(displayedValue)`.
5. The instance counter moved above the class to match its siblings. The debounce constant is exported as
   `SURFACE_TEXT_COMMIT_DEBOUNCE_MS` so the spec can use it. Error text is now `font-medium`. The constructor is
   explicitly `public` (lint `explicit-member-accessibility`).

## Requirements and how they are met

- `<label for>` + per-instance id: text `ptah-surface-text-N`, choice `ptah-surface-choice-N` (each radio gets
  `-option-i`, and the group `name` is the instance id), checkbox `ptah-surface-checkbox-N`.
- `aria-required` comes from `hints.required`. The visible `*` is `aria-hidden`, as in the prototype
  (prototype/index.html:334-335).
- `aria-invalid` is set when there is a draft error or a submit issue. `aria-describedby` lists the hint
  (text only), the error and each issue id. The radio group puts these on the `fieldset role="radiogroup"`.
- Displayed value is `drafts[id] ?? pendingValues.get(path) ?? hostValue` in all three components.
- `checkDraftValue` gate: an invalid value is never emitted. An invalid text draft stays in view state and
  shows its error. An unchanged value is not emitted: text compares against pending ?? host, choice and
  checkbox against the displayed value.
- Commit rules: text commits on blur, on Enter (single-line only) and after 600 ms idle. Each keystroke
  restarts the one timer, and the timer is cleared on commit and in `DestroyRef`. Select, radio and checkbox
  commit on change.
- Controlled DOM for choice and checkbox: after a change the element is reset to the displayed value, so it
  only moves when the parent applies the commit. Otherwise a rejected commit would leave a stale check,
  because Angular does not re-apply a binding whose value did not change.
- Select: the "—" first option maps to `null`, with the index mapped explicitly (0 → null, n → `options[n-1]`)
  so "—" stays unambiguous. daisyUI classes are `select select-bordered select-sm` (plan:772).
- Radio group: `fieldset` + `legend` (prototype:349-356).
- `data-apps-focus-key`: `{surfaceId}:{componentId}:input` on text, select and checkbox, and
  `{surfaceId}:{componentId}:option-{i}` on each radio.
- Text binding: interpolation, `[value]`, `[attr.placeholder]`, `[checked]` and `[selected]` only. No
  innerHTML, no style attribute, style binding or `<style>` element, and no `text-base-content/NN`.
- Never throws: malformed `options` entries are skipped by an `isOption` guard, a non-array gives `[]`, and
  non-string issues are dropped.

## Spec pins → spec names

| Pin | Spec |
| --- | --- |
| no inputCommit per keystroke | text: "drafts every keystroke into view state and sends no inputCommit per keystroke" |
| commit on 600 ms | text: "commits once 600 ms after the last keystroke, restarting the idle timer on each keystroke" |
| commit on blur | text: "commits on blur and clears the pending timer"; "renders a textarea when multiline..." |
| commit on Enter | text: "commits on Enter in a single-line input, but not on an Enter that ends an IME composition" |
| invalid draft never committed | text: "never commits an invalid draft: it stays in view state and shows its error" |
| unchanged not committed | text: "does not commit an unchanged value..." + "compares against the pending overlay..."; choice: select "does not commit an unchanged value", radio "commits on change and does not commit the value already shown"; checkbox: "does not commit an unchanged value" |
| timer cleared on destroy | text: "clears the timer on destroy: nothing fires after destroy" (also checks `jest.getTimerCount() === 0`) |
| draft > pending > host | "displays the draft over the pending value over the host value" (all three specs) |
| select "—" → null | choice: "commits on change, and "—" maps to null"; "renders an empty "—" option first..." |
| fieldset + legend | choice: "uses fieldset + legend, with a label tied to each radio" |
| aria attributes | text: "ties the label to the control and sets aria-required..."; choice: "ties the label to the select..."; checkbox: "ties the label to the checkbox..." |
| unique ids across two instances | "gives each instance unique ids" (all three; choice also checks radio ids and group names) |
| literal markup text | "renders producer markup as literal text" (all three; asserts no `img`) |
| no style in the DOM | text: "uses no inline style and no alpha text utilities"; choice and checkbox: in the markup spec |
| malformed option skipped | choice: "skips a malformed options entry instead of crashing" |

All specs use `jest.useFakeTimers()`. Nodes are built through the real `buildSurfaceViewModel`, except the
malformed-options case, which the builder rejects by design.

## Contracts cited

- `checkDraftValue(input, value | undefined): SurfaceValueCheck`: `libs/shared/src/mcp-apps-contracts/surface-bindings.ts:201-238`
- `SurfaceInput`, `SurfaceInputOption`, `SurfaceRequiredHints` / `SurfaceTextHints`: `surface.types.ts:49-90`
- `SURFACE_INPUT_KINDS`: `surface-catalog.ts:29-34`; `SURFACE_INPUT_EMPTY_VALUES`: `surface-catalog.ts:61-66`;
  `SURFACE_LIMITS.maxStringLength`: `surface-catalog.ts:86`
- `SurfaceInputCommit`: `libs/frontend/declarative-dashboard/src/lib/surface-interaction.ts:23-26`;
  `pendingValues` / `issues`: `:17-18`
- `SurfaceViewState.drafts`: `surface-view-state.ts:26`
- `InputNode` (`hostValue`, `draftError`): `view-model/view-model.types.ts:40-44`; host value and draft error:
  `view-model/surface-view-model.ts:63-70` (a missing path gives the empty value with no error, the B6 decision)
- Pattern: `surface-layout.component.ts:16,96,134` and `dashboard-list.component.ts:16,88,111`

## Deviations and notes for B8

1. `draftChange` / `SurfaceDraftWrite` is an output the plan does not name. The plan only says "draft into
   `viewState.drafts`". B8's renderer must map it into `viewState.drafts` and fold it into `viewStateChange`.
   Choice and checkbox emit no drafts, but they honour `drafts` for display.
2. `fieldset` carries `role="radiogroup"` so that `aria-required` and `aria-invalid` are valid ARIA on it.
3. The `plainText`, `issueTexts` and `describedBy` logic is repeated across the three components (and
   `plainText` across the siblings). Extracting a shared helper needs a new file outside this batch's
   ownership, so it is left for a later humanize pass.
4. Submit flush (plan:586) belongs to the renderer: unsent text drafts stay in view state after a destroy,
   and no commit fires.
5. Error text is `text-base-content` + `font-medium`, not `text-error`, per Req 7.5 and the prototype
   (prototype:336). Whether it should look visually distinct goes to the R10 visual gate.

## Verification

`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache` (run with
`--parallel=2`): exit 0. Tests: 12 suites, 114 passed (74 before this batch). Lint: 0 errors and 39
`no-non-null-assertion` warnings, all in specs; the lib already accepted this pattern in B6.

Last 10 lines:

```
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      11.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     10.9s (1 task)
  Recoverable time:  1.0s (9% of the run)
```
