# Code Logic Review — TASK_2026_629_c0b3, Rail actions inside card

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking / serious / moderate issues | 0 / 0 / 0 |
| Failure modes found | 0 new failures demonstrated |

Review family: codex; implementer family: Claude. Scope: the five changed Rail card, compact Rail card, and passthrough files and focused specs. The canvas spec passed 19/19. Score 8 reflects sound code paths and focused assertions, with browser geometry and theme contrast still unmeasured. A 9 would require those visual checks; a 7 would require a demonstrated functional gap.

## Five logic questions

1. **Silent failure:** No new success-looking failure found. Disabled Open beside returns without emitting and keeps its reason visible (`canvas-rail-card.component.ts:190-206,319-323`); the action surface is excluded from card selection (`canvas-rail-card.component.ts:288-295`).
2. **Unexpected action:** Trigger, menu, and backdrop clicks do not select the session; Escape restores trigger focus (`canvas-rail-card.component.ts:144-175,288-295,334-337`; spec `:453-489`).
3. **Wrong-answer input:** Long title/state text is contained in the reserved title line; lane overflow is in a lower line (`compact-rail-card.component.ts:87-105,208-232,319-337`). Exact clipping at minimum rendered width remains a browser check.
4. **Dependency failure:** Popover positioning uses flip and shift, then displays an unpositioned fallback on failure or timeout (`native-popover.component.ts:202-264`; `canvas-rail-card.component.ts:153-161`). Fallback placement from the new corner was not visually exercised.
5. **Missing requirement:** “Clear” light/dark highlight has no contrast threshold or minimum viewport. CSS uses primary/base tokens without changing geometry (`compact-rail-card.component.ts:155-164`); specs assert CSS text rather than rendered perception (`compact-rail-card.component.spec.ts:185-217`).

## Failure modes

No new failure mode was established. The remaining uncertainty is visual: jsdom asserts DOM and CSS source without measuring layout or contrast (`canvas-rail-card.component.spec.ts:625-670`; `compact-rail-card.component.spec.ts:185-240`).

## Data flow

1. Canvas passes `reserveActionCorner=true` only in the expanded branch (`canvas-rail-card.component.ts:98-139`).
2. Chat passes it to chat-ui (`compact-session-card.component.ts:117-143,188-195`); chat-ui reserves 22 px on the title line only (`compact-rail-card.component.ts:95-100,208-231`). Chat-ui imports no canvas/chat code (`compact-rail-card.component.ts:1-28`).
3. The 24 px trigger is an absolutely positioned sibling over the full-width card; the card is the only in-flow child (`canvas-rail-card.component.ts:125-175`; spec `:611-646`).
4. Trigger clicks open the popover without selecting; commands emit tab id and return focus (`canvas-rail-card.component.ts:175-228,288-337`; spec `:386-489`).
5. Focus changes border, inset shadow, and surface paint only; the left state stripe remains a separate pseudo-element (`canvas-rail-card.component.ts:130-133`; `compact-rail-card.component.ts:43-62,155-164`).

## Requirements fulfilment

| Contract | Status | Evidence / limit |
| --- | --- | --- |
| Row 110: full-width expanded card, top-right trigger, no gutter | COMPLETE | `canvas-rail-card.component.ts:125-175`; spec `:611-646` |
| No nested interactive control; ignored card click | COMPLETE | `canvas-rail-card.component.ts:125-175,288-295`; spec `:453-473` |
| Escape focus return; collapsed roving Tab | COMPLETE | `canvas-rail-card.component.ts:110-117,174,334-337`; spec `:475-524` |
| Alt+Shift moves; plain arrows unchanged | COMPLETE | `canvas-rail-card.component.ts:296-317`; spec `:526-583` |
| B6 disabled reasons | COMPLETE | `canvas-rail-card.component.ts:31-36,190-206,319-323`; spec `:417-451` |
| 176/96 expanded and 56 collapsed heights | COMPLETE | `canvas-rail-card.component.ts:56,110-112`; spec `:585-692` |
| Title/Now/lanes clear corner; +N more clickable | PARTIAL VISUAL EVIDENCE | Title padding and separate rows support clearance (`compact-rail-card.component.ts:78-100,208-232,300-337`); real control and Tab asserted (canvas spec `:648-670`), but 272 px fit unmeasured |
| Trigger focus ring and menu placement | COMPLETE STATICALLY | Inner outline avoids card overflow (`canvas-rail-card.component.ts:85-90,144-175`); popover flip/shift (`native-popover.component.ts:249-256`) |
| Row 111: focus in both themes, no shift, stripe and aria-current | PARTIAL VISUAL EVIDENCE | Theme tokens, paint-only properties, unchanged stripe and aria-current (`compact-rail-card.component.ts:43-62,155-164,199-205`); rendered contrast unmeasured |
| No new as-any, console, or forbidden chat-ui dependency | COMPLETE | Imports and changed declarations (`compact-rail-card.component.ts:1-28,373-404`; `compact-session-card.component.ts:117-143,188-195`) |

## Edge cases and verification

| Case | Handled | Evidence / limit |
| --- | --- | --- |
| Expanded dense and comfortable | YES, static | Canvas spec `:585-670` |
| Collapsed 56 px | YES | `canvas-rail-card.component.ts:98-124,144-175`; spec `:676-692` |
| Repeated open/close and late opened event | YES | `canvas-rail-card.component.ts:334-342`; spec `:386-501` |
| Boundary moves and disabled split | YES | `canvas-rail-card.component.ts:302-333`; spec `:417-443,526-560` |
| Large title or lane count at minimum width | UNMEASURED | CSS truncation and separate rows (`compact-rail-card.component.ts:87-105,319-337`); jsdom lacks geometry (canvas spec `:665-670`) |

Focused check: `node .ptah/tmp/check-run.mjs rc-rev-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` exited 0; one suite, 19 tests passed. Scoped `ptah_get_diagnostics` was attempted twice and returned unavailable after 45 seconds both times; this is not a clean type-check result. Writer-reported chat-ui/chat specs were not rerun here.

## Verdict

Recommendation: APPROVE. Confidence: MEDIUM. Top risk: CSS-source assertions can pass while the light-theme highlight or narrow-width menu looks weak or crowded in Electron (`compact-rail-card.component.spec.ts:185-240`; canvas spec `:665-670`). Complete the planned Electron visual re-check at 176/96 px and minimum Rail width in both themes.
