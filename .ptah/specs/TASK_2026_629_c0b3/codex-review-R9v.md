# R9v code logic review

**Score: 6/10. Verdict: REVISE.** The card and Rail API, ordinary action path, keyboard path, and fixed-height structure are supported by source and three passing scoped specs. A likely dependency failure leaves the actions menu unusable, and the layout assertion does not exercise the real compact card. This is below 7–8 because the failure path can strand the user, but above 3–4 because the normal menu, payload, bounds, and focus paths are implemented and exercised.

Scope: all six changed files read in full; compared the real compact card, NativePopoverComponent, FloatingUIService, focus-header menu, and the board-mounting spec. No source edited. `ptah_get_diagnostics` found no errors in the six requested files; it reported seven errors in other canvas/core/shared files. Three locked scoped specs passed: card 18/18, Rail 10/10, keyboard 15/15. No full canvas suite or browser layout check was run.

## Findings

### Serious — positioning failure strands an invisible, expanded menu

`canvas-rail-card.component.ts:152-159,171-182` opens a NativePopover and sets `aria-expanded` from `menuOpen`. `native-popover.component.ts:90-99,173-201` keeps the panel hidden until `floatingUI.position` resolves; the awaited call has no rejection or timeout handling. `floating-ui.service.ts:141-150` awaits `computePosition` and then installs auto-update. If positioning rejects or never resolves, the card still reports an open menu, the transparent full-screen backdrop remains, no item receives focus, and the user gets no error or recovery signal. This is a success-looking state for a failed dependency. Fix by catching positioning failure, closing the popover and restoring trigger focus, with a visible or announced failure; guard stale completions after close/destroy. Add a spec that rejects or delays positioning and asserts recovery. The current mock at `canvas-rail-card.component.spec.ts:32-37` only resolves.

### Moderate — delayed positioning can reopen focus after closure

`native-popover.component.ts:173-201` queues and awaits an open without checking `isOpen()` after the await; `canvas-rail-card.component.ts:332-335` can close meanwhile. If the user opens the menu and immediately dismisses it or switches cards while positioning is pending, the old open continuation can focus its hidden panel and emit `opened` after closure. The card's `focusMenuItem(0)` handler at `canvas-rail-card.component.ts:158,337-339` then competes with focus restoration. Impact: keyboard focus can land on stale or detached content. Fix with an open-generation guard in NativePopover and test close-before-position-resolves. This is a shared popover defect exposed by R9v; changing the card alone cannot make the await safe.

### Moderate — the named lane-fit test cannot detect an actual overflow regression

`canvas-rail-card.component.spec.ts:59-80` substitutes a card with a fixed `+2 more` button. The N6(b) case at `:487-522` checks that this stub contains the text and compares a hand-entered width estimate; jsdom never measures the real lane row. The actual dense compact card renders `+N`, not `+N more`, at `compact-rail-card.component.ts:283-301`; the comfortable row renders `+N more` at `:302-320`. Removing or clipping the real overflow button would leave this test green. Impact: the required fit at 176/96 px remains unverified. Fix by testing the real compact component in a browser layout check at the narrowest Rail width, or by measuring its rendered row in an existing browser test, with an explicit density-specific expectation.

### Minor — collapsed scrolling loses its visible pointer affordance

`canvas-rail.component.ts:65-74,158-161` retains vertical scrolling but hides both native scrollbar variants; `:81,168-173` leaves a 56 px rail containing potentially many cards. Wheel and keyboard navigation remain possible, and the expand button at `:107-114` provides a route to a visible scrollbar. A mouse user relying on scrollbar dragging cannot discover or drag the collapsed list. No specific WCAG failure is established by these files. Consider a subtle scroll indicator or showing the scrollbar on hover/focus. The current Rail spec at `canvas-rail.component.spec.ts:132-144` asserts only CSS class presence.

## Contract audit

| Contract | Result and evidence |
| --- | --- |
| Exact card inputs/outputs and tab-id payload | Met: `canvas-rail-card.component.ts:249-259,317-330`; menu and shortcut tests at `canvas-rail-card.component.spec.ts:301-329,428-462`. |
| Rail input and unchanged forwarding | Met: `canvas-rail.component.ts:191-198,240-253`; `canvas-rail.component.spec.ts:100-110`. R9w board consumer is a later batch, so end-to-end reorder/open is not claimed here. |
| Sorted move bounds | Met: sorted tiles at `canvas-rail.component.ts:175-190,256-258`; unsorted-input and single-card checks at `canvas-rail.component.spec.ts:111-118`. |
| B6 strings and disabled Open beside | Met: constants at `canvas-rail-card.component.ts:31-36`; board reason wins and focused card gets the second reason at `canvas-rail.component.ts:272-277`; `canvas-rail-card.component.ts:184-204,317-320` shows the reason, marks the item disabled, and suppresses emission. `canvas-rail-card.component.spec.ts:332-357` exercises both strings. |
| Stale or cross-workspace ID never a disabled reason | Partly evidenced: Rail derives its own reason only from ID equality at `canvas-rail.component.ts:272-277`; the stale focused-ID test at `canvas-rail.component.spec.ts:127-130` stays null. It does not set a stale or cross-workspace card ID; board rejection/announcement belongs to R9w. |
| Trigger position and dimensions | Structural contract met: card sibling at `canvas-rail-card.component.ts:98-152`; 176/96/56 host heights at `:52-56,262-264`; collapsed 32/24 cells at `:110-124,141-150`; Rail removes horizontal padding at `canvas-rail.component.ts:168-173`. Actual pixel fit is unverified, as above. |
| Keyboard, menu semantics, focus | Met on the normal path: roving select/trigger tab indices at `canvas-rail-card.component.ts:110-116,161-173`; role and disabled descriptions at `:177-225`; Alt+Shift handling at `:294-309`, plain navigation at `canvas-rail-keyboard.ts:20-23,48-70`; Escape/outside-click closure at `native-popover.component.ts:219-234` and trigger focus at `canvas-rail-card.component.ts:332-335`. Normal Escape is exercised at `canvas-rail-card.component.spec.ts:390-404`. |
| Click selection and density regressions | Action-area guard at `canvas-rail-card.component.ts:286-293` covers trigger, panel, and backdrop while the sibling compact card remains selectable; click spec `canvas-rail-card.component.spec.ts:131-147,368-387`. Existing density input and Rail toggle remain at `canvas-rail.component.ts:95-103,182-190`; no change to display-dock hosts is present in the six-file diff. |

The whole-area click guard is appropriate: `canvas-rail-card.component.ts:286-293` only excludes descendants of `[data-rail-actions]`; clicks on the compact card still reach `openSession` unless its own interactive target or text selection applies. The NativePopover choice supports ordinary Escape and backdrop click, but its asynchronous positioning branch needs the recovery above. Hidden scrolling is a discoverability and pointer-access cost, not evidence that scrolling is impossible.

## Named-case audit

| Named case | Status | Would removal fail? |
| --- | --- | --- |
| Card to Rail payload forwarding, all three outputs | Present in two cases: `canvas-rail-card.component.spec.ts:301-329`, `canvas-rail.component.spec.ts:100-110` | Yes for menu emissions and Rail forwarding; Rail uses a stub, so it does not prove integrated card-to-Rail wiring. |
| Both disabled reasons shown; Open beside suppressed | Present: `canvas-rail-card.component.spec.ts:332-357`, `canvas-rail.component.spec.ts:119-130` | Yes. |
| Trigger click does not select | Present: `canvas-rail-card.component.spec.ts:368-387` | Yes for guard removal on action descendants. |
| Collapsed select then trigger Tab order | Present: `canvas-rail-card.component.spec.ts:406-426` | Yes for order/index regressions on a mounted card. |
| Alt+Shift forwarding and first/last boundaries | Present: `canvas-rail-card.component.spec.ts:428-462`, `canvas-rail.component.spec.ts:111-118` | Yes for card shortcut or bound removal; Rail's shortcut case at `canvas-rail.component.spec.ts:145-160` is vacuous for forwarding because CardStub never emits a move. |
| Plain arrows unchanged | Present: `canvas-rail-keyboard.spec.ts:19-27,69-82`, `canvas-rail.component.spec.ts:145-160` | Yes for focus navigation; the card-only check at `canvas-rail-card.component.spec.ts:464-485` cannot prove Rail navigation. |
| Escape focus return | Present: `canvas-rail-card.component.spec.ts:390-404` | Yes for normal Escape; missing pending/rejected positioning and outside-click focus assertions. |
| 176/96/56 heights and `+N more` fit | Heights present: `canvas-rail-card.component.spec.ts:487-536`; overflow fit vacuous: `:59-80,510-522` | Height removal fails; real compact overflow clipping would not. |

## Five failure questions

1. **Silent failure:** `native-popover.component.ts:90-99,186-201` can leave `aria-expanded=true`, an invisible panel, and a backdrop when positioning stalls or rejects.
2. **User action:** rapidly opening then dismissing the menu can trigger stale focus after close (`native-popover.component.ts:173-201`); mouse dragging of a collapsed scrollbar is unavailable (`canvas-rail.component.ts:65-74`).
3. **Wrong-answer input:** an unsorted tile array is handled by `orderedTiles` (`canvas-rail.component.ts:256-258`), but a cross-workspace card ID is not tested end to end; its tab lookup is global at `canvas-rail-card.component.ts:265-267`, so R9w must enforce workspace membership before acting on an emitted ID.
4. **Dependency failure:** Floating UI rejection or indefinite positioning wait has no catch or timeout (`native-popover.component.ts:186-201`, `floating-ui.service.ts:141-150`).
5. **Missing requirement detail:** no recovery behavior is specified for failed positioning, and N6(b)'s phrase `+N more` does not match dense card's `+N` rendering (`compact-rail-card.component.ts:283-320`).

Other canvas mounting risk: `orchestra-canvas.rail.spec.ts:49,82,196-233` mounts a real Rail through its board stub, which can instantiate the added closed popovers. The closed path does not start positioning (`native-popover.component.ts:173-180`), and cleanup is registered on destroy (`floating-ui.service.ts:95-99`); no new per-card active observer is evident. That spec was not among the three permitted scoped runs, so its integration result remains unknown. No display dock code was touched; the pre-existing dock requirement in plan row 77 remains outside this batch.

