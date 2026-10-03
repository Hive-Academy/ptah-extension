# Cutover visual fix — bounded correction review

Reviewer: codex — GPT-6

Reviewed commit: `907a1028322bdf7b26a29c67a061e7be6e91f04a`.

Score: **9/10**

Verdict: **APPROVED**

Reviewed the product/spec diff under `libs/` and relevant committed integration code. Screenshots and `.ptah` artifacts were excluded. No tests, builds or browser checks were run, as requested; this is a code review, not an independent measurement of rendered geometry.

| Finding | status | evidence file:line |
| --- | --- | --- |
| N-5 / previous round finding 1 — Open-in caret clipped at 299–300 px | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:115` makes the host the size container, with the flex row now its child at `:162`. The query at `:124` changes the descendant row/actions gaps, so it measures the correct container. `:154` removes the path minimum at widths up to 320 px. The metadata group at `:210` can shrink, while the separate action group at `:240` cannot. This removes the forced-width combination that previously pushed the caret beyond the clipping edge. |

At 299 px, the compact rules apply, totals are hidden, and the path can use the remaining space without imposing a minimum. The clipped metadata group contains only informational badges; Comment, Edit and Open-in remain outside it. Those controls retain their accessible names at `file-section-header.component.ts:263`, `:279` and `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts:95`. The action group's inset focus rings remain within the controls, and row padding keeps the group inside the host. The Open-in dropdown has not been moved into the metadata clipping box.

The full Working tree/Staged text remains at `file-section-header.component.ts:219`, visually hidden through `:136`; the WT/S pseudo-element has empty alternative text at `:146`. The renamed-from text remains in the DOM at `:206` and uses the same screen-reader-only treatment. No newly hidden element requires keyboard interaction. The new populated-header spec includes both Comment/Edit and an available editor, although its DOM/class assertions do not themselves measure pixel bounds.

## N-6 assessment

**Consistent with the code; the specific harness-timing cause is not proven by this review.** No concrete product defect retaining a dark theme was found. `libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts:290` derives the mode from the app theme signal and passes it to sections at `:187`; `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:436` forwards it to Pierre. `libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.ts:237` reads the current mode when mounting, and `:197` applies subsequent changes to the live renderer. `libs/frontend/git-ui/src/lib/renderer/pierre-config.ts:308` keeps distinct dark/light theme selections.

The new `review-canvas.component.spec.ts:812` checks section inputs when mounting after the app is already light; the existing switch case at `:798` checks input propagation after mounting. The renderer spec at `libs/frontend/git-ui/src/lib/renderer/pierre-diff-host.component.spec.ts:602` checks an in-place theme update against its renderer double. Together these support the intended product flow, but do not reproduce the capture ordering or inspect real asynchronously rendered Pierre colors. Accept N-6 as no demonstrated product bug, with harness timing remaining an attribution that requires runtime evidence rather than a conclusion established by these unit specs.

## New findings

None.
