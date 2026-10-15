# Code Logic Review — `TASK_2026_629_c0b3` — Rail correction (commit 1908f240e)

Scope: diff `27be1d79f..1908f240e` only. Static read of the whole changed files plus their DOM producers. No tests, builds or git state changes were run (team-leader's results taken as given: canvas 409/409, chat-ui 1131/1131, typecheck and lint pass).

## Summary

| Metric              | Value         |
| ------------------- | ------------- |
| Overall score       | 9/10          |
| Assessment          | APPROVED      |
| Blocking issues     | 0             |
| Serious issues      | 0             |
| Moderate issues     | 0             |
| Minor issues        | 3             |
| Failure modes found | 3 (all Minor) |

N1 and N2 are both closed. No regression was found. Evidence separating this from 10: the specs run on test doubles, not on the real `CanvasRailCardComponent`. N2 is proven by a class marker and CSS reading only, with no browser check.

## 1. N1 — `focusRailSelectButton`

Helper: `canvas-rail-keyboard.ts:10-14`. It lists `.rc-select, button` in document order and focuses the first element with no `[aria-hidden="true"]` ancestor. `closest()` includes the element itself.

- **Collapsed mode: CLOSED.** The card renders the hidden `<ptah-compact-session-card style="display: none" aria-hidden="true">` (`canvas-rail-card.component.ts:77-86`) before the visible `<button>` (`:87-101`). Every button inside the hidden producer, including its `.rc-select` (`compact-rail-card.component.ts:166`), has the producer host as an `aria-hidden` ancestor. They are skipped, and the first remaining candidate is the visible collapsed button. The helper reaches the card's DOM children through `querySelectorAll`, so it does not matter that the hidden card is a child component.
- **Expanded mode: identical to before.** `.rc-select` is the first element of `compact-rail-card.component.ts:166-174`, and its only `aria-hidden` neighbour is a decorative `<span>` at `:177-181`, which is not an ancestor of any button. `querySelector(sel)` returns the first match in document order, and `find` over `querySelectorAll(sel)` returns the same element. No behaviour change.
- **Stray `aria-hidden` ancestors that could exclude every candidate:**
  - Inside the card, the only `aria-hidden` sites are the hidden producer and that decorative dot span.
  - Above the card, I grepped `libs/frontend/canvas/src/lib/**` (non-spec) and the webview app. The `aria-hidden` sites there are the lane-tab, layout-controls and tile icons, and the boot error icon in `app.html:21`. None of them wraps the board.
  - The path rail host, `canvas-rail-board` and `session-viewport` have no `aria-hidden` or `inert`. A non-active board in the Grid/Rail mix only gets `display:none` (`canvas-rail-board.component.ts` host `[style.display]`) and renders nothing (`@if (visible())`). It does not use `aria-hidden`.
  - So the no-op risk exists only if a future ancestor adds `aria-hidden="true"`. Today it does not.
- **Next ArrowDown/ArrowUp advances.** Focus lands on the visible button inside the `[data-rail-card]` host. The next keydown calls `target.closest('[data-rail-card]')` (`canvas-rail-keyboard.ts:28`) and gets that card's `data-tab-id` (`:41`), so `currentId` is the new card. The old stuck state is gone.
- **Escape.** `canvas-rail-keyboard.ts:30-37` calls `focusSelectButton(card.tabId)`. Focus returns to the visible collapsed button of that card, which is the correct target. Both call sites (`canvas-rail.component.ts:265`, `orchestra-canvas.component.ts:422`) now use the helper. The orchestra site searches all `[data-rail-card]` in `sessionViewport`. Only the visible board renders cards, so there is no cross-workspace id collision.

## 2. Do the specs prove it?

- `canvas-rail.component.spec.ts:76-88` (new):
  - It mounts the real `CanvasRailComponent` with its real `onKeydown` and the real helper, using `CardStub`.
  - `CardStub` reproduces the DOM shape: a `display:none` + `aria-hidden` wrapper holding `.rc-select` before the visible button (`:15-18`).
  - It does two ArrowDown and two ArrowUp, asserting `document.activeElement` each time. That also covers `currentId` advancing, because each press starts from the previously focused visible button.
  - It is not trivial: jsdom `focus()` ignores inline `display:none`. With the old `querySelector('.rc-select, button')?.focus()` the hidden `.rc-select` would be focused and the assertion would fail. The test fails on the old code and passes on the fix.
- `orchestra-canvas.rail.spec.ts` (new Escape test):
  - `RailStub` now holds a card with a hidden `.rc-select` before `.rail-visible`. `SURFACE_ACTIVE` is provided as `true`, which is required because the default is `signal(false)`.
  - Escape from `.rail-inner` must focus `.rail-visible`. This also fails on the old code.
  - Only Escape is covered at this site. ArrowUp/ArrowDown at this site share the same helper.
- Gap (Minor): no spec uses the real `CanvasRailCardComponent` template, so the `aria-hidden` shape is asserted by reading, not by test. No spec asserts that expanded-mode focus still targets `.rc-select` through the helper. Existing keyboard-spec tests use mocks.

## 3. N2 — `rc-lane-overflow`

- **Fit.** `.rc-action.rc-lane-overflow { height:16px; line-height:16px }` (`compact-rail-card.component.ts:125-128`) fits the `rc-line h-4` counts line (`:288`). It overrides the base 18px (`:119`) on specificity, (0,3,0) against (0,2,0), including under emulated encapsulation. The button now equals the line box, so `overflow:hidden` on `.rc-line` clips nothing.
- **Focus ring.** `.rc-action.rc-lane-overflow:focus-visible { outline-offset:-2px }` (`:129-131`) beats `.rc-action:focus-visible` (`:137-141`, offset 1px). A 2px ring drawn inside a 16px button on a 16px line is not clipped. The base 2px outline colour is kept.
- **Geometry.** The grid row is 70px (`:80`), made of 16 + 3x18 = 70. The `h-[18px]` lane rows are untouched (`:311`). Card heights 176/96 come from `COMPACT_RAIL_CARD_HEIGHT`, which this commit does not touch.
- **Other buttons.** The Allow/Deny/Open/Answer/Output buttons (`:212-263`) and the dense `+N` button (`:273-283`) do not carry the modifier, so they stay at 18px. The aria-label (`:294-299`) and `(click)="moreLanes.emit()"` are unchanged.

## Five logic questions

1. **Silent failure.** The helper silently no-ops (`?.focus()`) if there is no non-hidden candidate. A future `aria-hidden` ancestor over the board, or a card whose `tab()` resolves to null (`canvas-rail-card.component.ts:75`), makes arrow keys do nothing visible with `preventDefault` already called (`canvas-rail-keyboard.ts:61`). This is not a regression, because the old code behaved the same.
2. **Unexpected user action.** In collapsed mode, Escape on the visible collapsed button is swallowed with `preventDefault` (`canvas-rail-keyboard.ts:31-36`) and focus does not move, because the target is not `.rc-select`. This is Minor. It is pre-existing and has no effect on the fix.
3. **Input data.** If a candidate `button` is `disabled` or `tabindex=-1`, `.focus()` still works for `tabindex=-1`. A disabled one would no-op. No such button exists in the card today.
4. **Dependency.** The `[data-rail-card]`/`data-tab-id` contract with the card is the dependency. The card sets both (`canvas-rail-card.component.ts:43-44`). OK.
5. **Missing.** An explicit data hook (for example a `data-rail-select` attribute on the visible control) is more robust than `aria-hidden` ancestry as a signal. This is a design alternative, not a defect.

## Failure modes (all Minor)

- **Escape swallowed on the sole collapsed button** — `canvas-rail-keyboard.ts:31-36`. Trigger: Escape on the collapsed button. Symptom: `defaultPrevented` set, no focus change, other Escape handlers see a prevented event. Recommendation: skip `preventDefault` when the resolved target is already `document.activeElement`. Pre-existing.
- **Helper depends on `aria-hidden` ancestry** — `canvas-rail-keyboard.ts:12`. A future wrapper with `aria-hidden="true"` around the rail or board would make all arrow focus a no-op. Recommendation: a comment on the helper stating the contract, or a `data-` marker. No ancestor does this today.
- **`+N more` hit area stays at 16px high** — the `.rc-action::after` extension (`:132-136`) is clipped by `.rc-line { overflow:hidden }`, as it was at 18px. It is below the 24px WCAG 2.5.8 target size and relies on the spacing exception. Pre-existing, with a 2px smaller target than before. Accepted by the design (decisions row 63 keeps the line at 16px).

## Blocking / Serious / Moderate

None.

## Data flow (collapsed ArrowDown)

1. Keydown on the visible collapsed button bubbles to the `<ul (keydown)>` (`canvas-rail.component.ts:157`) or the orchestra detail handler. OK.
2. `closest('[data-rail-card]')` gives the card, and `data-tab-id` gives `currentId`. OK.
3. `ctx.focus(id)` updates the store or board focus. OK.
4. `focusSelectButton(id)` finds the target card and picks the first non-`aria-hidden` candidate (the visible button) and focuses it. OK (this was the broken step).
5. The next keydown starts at the new card. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| N1 collapsed arrows and Escape focus the visible button | COMPLETE | Only the hand-built stubs prove it; no real-card spec |
| N1 expanded mode unchanged | COMPLETE | None |
| N2 `+N more` fits 16px, ring visible | COMPLETE | Class-marker assertion only, no browser check |
| Geometry 70px / 176 / 96 unchanged | COMPLETE | None |
| Allow/Deny/aria-label/`moreLanes` unchanged | COMPLETE | None |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Collapsed, 3 cards, down/up x2 | YES | Helper + spec | None |
| Escape from inner button | YES | Helper + orchestra spec | None |
| Expanded mode | YES | `.rc-select` still first | No new expanded spec |
| Closed tab (`tab()` null) | NO-OP | Optional chaining | Same as before |
| Multiple workspaces | YES | Hidden boards render nothing | None |
| Future `aria-hidden` ancestor | NO | `closest` excludes all | Hypothetical, documented above |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the logic (static read of all producers and consumers). MEDIUM-HIGH on the visuals (no browser run; CSS specificity and geometry checked by reading).
- Top risk: the helper's reliance on `aria-hidden` ancestry as the visibility signal, and the unverified visual ring in Electron.
- Recommended follow-ups (optional, not blocking): one expanded-mode assertion through the helper; the Electron visual check for the collapsed arrow navigation and the `+N more` focus ring.
