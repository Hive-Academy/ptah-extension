# R9o code logic review

Review family: codex (implementer: Claude)

Score: **6/10**. Verdict: **REVISE**. One serious state bug prevents the conflict force-open contract from holding across turns. The implementation otherwise carries the specified card data and detail paths. This is above the 3–4 band because the ordinary render and actions are wired and covered; it is below the 7–8 band because a likely turn transition can conceal conflict detail.

## Findings

1. **Serious — a new turn inherits the prior turn's card and section state.** `libs/frontend/chat-ui/src/lib/organisms/display-panel/turn-summary.component.ts:406-410,429-438` stores choices by card kind without a turn identity or reset. `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:211-229,299-306` keeps the summary panel keyed by the same summary key and passes a changed model into the same child. The dock updates that input from its current summary (`libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts:178-185,244-247`). Reproduce by closing a conflicted Files card, then receiving another conflicted turn while the dock remains mounted: `userOpen.get('files') === false` defeats the new turn's conflict force-open rule. An open Tests or Tokens detail also persists into an unrelated turn; a closed section stays closed. The existing conflict test checks only a fresh instance (`turn-summary.component.spec.ts:345-355`). **Fix:** key/reset local disclosure state on a stable turn identity, while allowing updates to the *same* turn (such as marks changing) to retain the user's choice. Add an input-change spec covering a new turn after open and closed choices, including a new conflict.

## Parity and boundary checks

| Parity | Evidence and impact |
| --- | --- |
| 71, 106 | Files/Lines/Tokens/Cost/Time and Tests are mapped in `turn-summary.component.ts:506-596`; Files detail keeps the file action outputs at `:327-340`, with action emission tested in `turn-summary.component.spec.ts:385-400`. The new-turn state defect above qualifies this coverage. |
| 107–109 | Lines and Tokens values/captions are constructed at `turn-summary.component.ts:527-559`; Cost and Time at `:561-579`; details at `:461-495`. `turn-summary.component.spec.ts:185-229` checks the labels, token caption and detail rows. |
| 110 | Tests detail still delegates to the existing tests component (`turn-summary.component.ts:337-340`); its rows are exercised by `turn-summary.component.spec.ts:514-556`. |
| 111 | A fresh conflict forces Files open (`turn-summary.component.ts:429-433`; `turn-summary.component.spec.ts:345-355`). The action error is outside each card's inert region (`turn-summary.component.ts:287-311`), tested with Files closed at `turn-summary.component.spec.ts:489-510`. The prior-choice case is the finding above. |

The chip's DOM classes are preserved: its section has static `my-2` plus the extracted `MINI_SECTION_CLASS`, while the original section had those tokens together; its card, label, value, caption and metric classes now refer to identical strings in `turn-summary-mini-card.styles.ts:41-85` (`turn-summary-chip.component.ts:82-159`). The chip spec checks the shared classes (`turn-summary-chip.component.spec.ts:457`). Removing the gradient and the “host-built” subtitle removes no stated data: the Host pill remains (`turn-summary.component.ts:188-198`; `turn-summary.component.spec.ts:612-615`). “Time” is the inline chip's label for duration (`turn-summary.component.ts:68-75`). The shared styles use theme tokens and `color-mix` (`turn-summary-mini-card.styles.ts:21-85`; `turn-summary.component.ts:84-100`); the narrow-width grid has a 104 px minimum and a one-column fallback (`turn-summary-mini-card.styles.ts:29-33`). Layout and color contrast still need a browser check because the component's axe spec disables color contrast (`turn-summary.component.spec.ts:618-640`).

`display-panel.component.ts:224-229` still binds all four summary inputs/outputs. The chat dock binds the display panel at `display-dock.component.ts:178-190`; the transcript binds the inline chip at `chat-transcript.component.html:75-79`. Mode 2 should run `display-panel.component.spec.ts` for this shared host path. I ran that allowed spec through the lock runner: **18/18 passed**. The writer reports 32/32 turn summary, 24/24 chip and 28/28 display chip tests in `lane-R9o-report.md`; I did not rerun them. Scoped `ptah_get_diagnostics` reported no errors in the three changed source files, with 10 existing sibling errors outside them.

## Five logic questions

1. **Silent success-looking failure:** a new conflict leaves Files collapsed after an earlier user choice (`turn-summary.component.ts:429-438`); the new model renders without an error while its required detail stays hidden.
2. **Unexpected user action:** close Files for one turn, then inspect the next conflicted turn; the old disclosure state wins (`display-panel.component.ts:211-229`; `turn-summary.component.ts:429-438`).
3. **Wrong answer from input data:** a newer summary whose Files card has `conflictedCount > 0` still has `aria-expanded=false` when the saved map contains `files=false` (`turn-summary.component.ts:429-433`), contrary to parity 111.
4. **Dependency failure or malformed shape:** the display-panel action error remains an alert outside collapsed card regions (`turn-summary.component.ts:287-311`), and unavailable usage is kept as status text rather than `$0` (`turn-summary.component.ts:546-579`). This batch adds no external parser or async dependency; no new dependency failure path was found in the reviewed render flow.
5. **Unstated requirement:** disclosure state needs a defined lifetime per turn. The current model has no turn identity (`turn-summary.model.ts:138-151`), while the host reuses the summary child (`display-panel.component.ts:211-229`).

## Decisions

- **REVISE** for the turn-transition defect. Keep the expanded detail, per-file actions, tests detail and alert placement while fixing it.
- The visual check in dark and light themes and at narrow panel widths remains a browser-only check; the 18 passing display-panel tests establish binding behavior, not actual layout or contrast.
