# Visual review B3b: A3 Generate agents, A4 Project guidance, A5 Done

Method: screenshot and axe-JSON review only (no browser, build or e2e). Source: `screenshots/generate/` (176 files = 88 PNG + 88 axe JSON; 11 states x 4 themes x wide 1280x800 / narrow 464x800). Criteria and conventions reused from `visual-review.b3a.md`.
Not a defect: "A3 completed" has no countdown (restored-run fixture limit).

## Verdict

**REVISE** - Score **7/10**. No blocking defects: no horizontal overflow, clipping or overlap at 464px in any inspected capture, and axe is clean apart from one minor rule. Five serious and several minor issues, mainly copy that contradicts state, missing step state on Done, and inconsistent action treatments.

## Screenshots inspected

Dark themes: ptah-glass (A3 wide+narrow-light sampled below), anubis (A4/A5). Light themes: ptah-glass-light, anubis-light. Every state has a wide and a narrow capture opened in one dark and one light theme.

| State | Dark (wide) | Light (narrow) |
|---|---|---|
| generate-running | `generate-running-ptah-glass-1280x800.png` | `narrow-generate-running-ptah-glass-464x800.png` (dark narrow) |
| generate-completed | `generate-completed-ptah-glass-1280x800.png` | `narrow-generate-completed-ptah-glass-light-464x800.png` |
| generate-failed | `generate-failed-ptah-glass-1280x800.png` | `narrow-generate-failed-ptah-glass-light-464x800.png` |
| generate-mismatch | `generate-mismatch-ptah-glass-1280x800.png` | `narrow-generate-mismatch-ptah-glass-light-464x800.png` |
| generate-lookup-exhausted | `generate-lookup-exhausted-ptah-glass-1280x800.png` | `narrow-generate-lookup-exhausted-ptah-glass-light-464x800.png` |
| guidance-idle | `guidance-idle-ptah-glass-1280x800.png` | `narrow-guidance-idle-ptah-glass-light-464x800.png` |
| guidance-running | `guidance-running-anubis-1280x800.png` | `narrow-guidance-running-anubis-light-464x800.png` |
| guidance-completed | `guidance-completed-anubis-1280x800.png` | `narrow-guidance-completed-anubis-light-464x800.png` |
| guidance-lookup-error | `guidance-lookup-error-anubis-1280x800.png` | `narrow-guidance-lookup-error-anubis-light-464x800.png` |
| guidance-owner-conflict | `guidance-owner-conflict-anubis-1280x800.png` | `narrow-guidance-owner-conflict-anubis-light-464x800.png` |
| done-facts | `done-facts-anubis-1280x800.png` | `narrow-done-facts-anubis-light-464x800.png` |

The remaining 4-theme variants were not opened; they are covered by the identical axe results below. Dark narrow was opened only for generate-running; light wide was not opened for any state (ptah-glass-light and anubis-light are represented by narrow captures only).

## Findings

### Serious

1. **Failure and cancel states reuse the "run continues" copy.** `generate-failed-ptah-glass-1280x800.png`, `narrow-generate-failed-ptah-glass-light-464x800.png`. A card titled "Generation failed" with a Failed badge says "The run continues in its bound session." That contradicts the state and gives no reason for the failure or what Retry does. `generate-agents.page.ts:116` (default branch of `runMessage`); same fall-through in `project-guidance.page.ts:107` for failed and timed-out. Fix: per-state messages (failed, timed-out, stopping) with the safe failure reason.
2. **Done step is never marked complete on A5, and "completed" hides a failure.** `done-facts-anubis-1280x800.png`, `narrow-done-facts-anubis-light-464x800.png`. All four prior steps show a tick but the current "Done" step keeps the dashed circle. The facts read "Agents: completed - 1 written, 1 unchanged, 1 failed", which labels a run with a failed agent as "completed" with no warning treatment. `analyze-done.page.ts:11-14` (stepper items), `:28-34` (facts). Fix: show the final step as current-complete, and surface the failed count as a warning, ideally with a link back to A3.
3. **A3 completed hides the failed agent in the summary and cards.** `generate-completed-ptah-glass-1280x800.png`, `narrow-generate-completed-ptah-glass-light-464x800.png`. The panel is headed "Agents generated" with a green "Done" badge though "1 failed" is in the counts, and the agent cards show status as plain unbadged text ("Failed") unlike the running cards, which use badges. Failed is not visually distinct. `generate-agents.page.ts:55-60`. Fix: reuse the status badge with error colour on cards, and use a warning title or badge when failed > 0.
4. **Narrow stepper truncates the current label.** `narrow-generate-running-ptah-glass-464x800.png`, `narrow-generate-failed-ptah-glass-light-464x800.png`. Current step shows "Generate ag..." while A4/A5 show the full label ("Project guidance", "Done"). The B3a convention (current label only) is met, but the label is cut and the other four steps are unlabeled dots. Fix: let the current pill use the available width (flex-1, min-w-0) as on A4; the dots can shrink.
5. **Stacked cards have no gap on A4.** `guidance-idle-ptah-glass-1280x800.png`, `guidance-owner-conflict-anubis-1280x800.png`, `narrow-guidance-owner-conflict-anubis-light-464x800.png`. The "Saved guidance" card touches the run card or the owner-conflict banner (0px spacing, rest of page uses space-y-5). It also uses a different background and radius than the rest (flat darker block, narrow light variant is grey). Likely the saved-guidance child component's root lacks the `rounded-[22px] border p-5` surface or sits outside the `space-y-5` container: `project-guidance.page.ts:22` container vs the child component. Fix: wrap in the same section surface and keep it inside the spaced container.

### Minor

6. **Weak action hierarchy and tap size on recovery panels.** Retry and Start over (`generate-failed-*`), Retry (`generate-lookup-exhausted-*`, `guidance-lookup-error-*`) and Skip guidance (`guidance-idle-*`) are small low-contrast chips (about 30px tall, `min-h-8`). Retry in the exhausted/error panels sits directly under the body text with no spacing (`narrow-generate-lookup-exhausted-ptah-glass-light-464x800.png`, `narrow-guidance-lookup-error-anubis-light-464x800.png`: button touches text). Not primary-styled although it is the only action. Add a `mt-3` and use the primary style when it is the only action. Sources: `generate-agents.page.ts:31`, `project-guidance.page.ts:29-34`, `analyze-done.page.ts:40`.
7. **Copy: "Ask the panel in chat".** `done-facts-anubis-1280x800.png`. "The panel" is unexplained jargon (Tribunal) for a first-run user, next to "Open chat". Suggest "Get a second opinion in chat" or "Review with the agent panel", plus a title attribute. `analyze-done.page.ts:40`. "Run again" is ghost and less prominent; acceptable, but make it explicit ("Run setup again"). "Open latest" (`generate-mismatch-*`) is vague next to "no longer current".
8. **Detected stack is an undifferentiated text list.** `guidance-running-anubis-1280x800.png`. Five lines with "NestJS API" lead-in and no label/value separation; summary rows use bordered rows with right-aligned counts, so the two cards look unrelated. Use a definition list or chips. `project-guidance.page.ts:51-58`.
9. **Done actions row mixes styles.** `narrow-done-facts-anubis-light-464x800.png`. Primary, two secondary and a ghost button wrap unevenly (3+1 chips ragged at 464px). Make it a column of equal-width buttons below 480px. `analyze-done.page.ts:37-41`.
10. **Owner-conflict banner puts Retry beside "Open it".** `guidance-owner-conflict-anubis-1280x800.png`. Banner border is the white focus-style outline in dark (looks like a focus ring), unlike the red border panels elsewhere. Retry is ambiguous (retry what?). At 464px the message wraps to four lines beside the actions. Stack actions under the text on narrow.
11. **Headings show a heavy focus box on load** (all captures, e.g. `generate-running-ptah-glass-1280x800.png`): the h1 is focused programmatically and shows a full rectangular outline wider than the text. Fine for a11y, but it reads as a rendering defect in screenshots; use `:focus-visible` scoping or a tighter outline. Consistent with B3a, not new.
12. **Standalone A4 stepper shows only two steps** (Project guidance, Done): `guidance-idle-*`, `guidance-lookup-error-*`. Intentional for standalone, but differs from A3/A5 and the prior steps vanish; consider a note or keep the 5-step rail. `project-guidance.page.ts:119-120`.
13. **Capture gap:** viewport-only captures cut the guidance-completed page at the fold ("Generated guidance" list), so the 4-row summary card is visible only as the first two rows at 464px (`narrow-guidance-completed-anubis-light-464x800.png`: "Project Context 7 words", "Framework Guidelines 6 words"). Rows look correct (label left, count right, no truncation); rows 3-4 not verified. Recommend a full-page capture.
14. **Header logo image broken** in every capture (shell, not B3b; same as B3a).

### Positive checks (pass)

- No horizontal scroll or clipping at 464px in any opened capture; agent cards reflow from 2 columns to 1; badges and Stop stay on a row.
- Section landmarks are used (`<section aria-labelledby>`; no nested `main`), so the B3a landmark defect is fixed.
- Links/actions use text-base-content styling; no `.btn-link` contrast failure is present.
- Dark and light themes both legible; progress bar visible in dark glass; Running/Written/Waiting badges clear.
- Failed panel, mismatch panel (warning icon + primary "Open latest") and lookup panels have clear hierarchy and Retry present in all three.

## Axe summary (88 reports)

| State | Violations (per theme x width) |
|---|---|
| generate-running | 0 |
| generate-completed | `aria-allowed-role` (minor), 1 node per card, `article:nth-child(n)` with `role="listitem"`; present in all 8 reports |
| generate-failed, -mismatch, -lookup-exhausted | 0 |
| guidance-idle, -running, -completed, -lookup-error, -owner-conflict | 0 |
| done-facts | 0 |

Total: 8 reports with a minor violation, 80 clean. No `color-contrast`, landmark or critical/serious rules. Fix: drop `role="listitem"` from the `<article>` (`generate-agents.page.ts:55`) or use `<ul>/<li>` and keep `role="list"` off the grid at `:53`.

## Comparison with B3a

Fixed: nested `main` landmarks and `.btn-link` contrast. Carried over: stepper dot-only narrow behaviour (finding 4) and h1 focus box (11). New inconsistency: card spacing/surface on A4 (5), status badge vs text (3).

## Re-check (visual fixes)

Round 1 of 2. Method: PNG and axe-JSON review of the recaptured `screenshots/generate/` (88 PNG + 88 axe) and `screenshots/analyze/` (72 PNG + 72 axe); Electron-config harness captures, no browser run. Deferred minors 8, 11, 12 and 14 are not re-opened.

**Verdict: APPROVE - Score 8/10.** No serious or breaking items remain. Two moderate/minor leftovers (10 partial, summary rows still unverified).

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Failed/cancel copy | RESOLVED | `generate-failed-ptah-glass-1280x800.png`: "Generation failed. Retry the run or start over." (no "run continues"); same in `narrow-generate-failed-ptah-glass-light-464x800.png`. |
| 2 | Done step complete + failed warning | RESOLVED | `done-facts-anubis-1280x800.png`: Done shows a tick, "Agents: needs attention ... 1 failed" in warning colour, "Needs attention" badge and "Review failed agents" link. `narrow-done-facts-anubis-light-464x800.png` same. |
| 3 | A3 completed hides failure | RESOLVED | `generate-completed-ptah-glass-1280x800.png`: "Some agents failed" title, "Needs attention" badge, no green Done chip; failed card has a Failed badge (cut at the fold, badge visible at the edge). |
| 4 | Narrow stepper truncation | RESOLVED | `narrow-generate-running-ptah-glass-464x800.png` and `narrow-generate-failed-ptah-glass-light-464x800.png`: full "Generate agents" label, 4 dots intact. |
| 5 | A4 stacked card gap/surface | RESOLVED | `guidance-owner-conflict-anubis-1280x800.png` and `narrow-guidance-owner-conflict-anubis-light-464x800.png`: Saved guidance card has the same rounded surface and 20px gaps. |
| 6 | Recovery actions | RESOLVED | `narrow-generate-lookup-exhausted-ptah-glass-light-464x800.png`: Retry primary, spaced below text, taller. Failed panel Retry/Start over larger. |
| 7 | A5 copy | RESOLVED | "Get a second opinion in chat", "Run setup again" in `done-facts-anubis-1280x800.png`. |
| 9 | A5 narrow actions | RESOLVED | `narrow-done-facts-anubis-light-464x800.png`: full-width stacked buttons, Run setup again as centred ghost. |
| 10 | Owner-conflict banner | PARTIAL (moderate) | Text-first, "Check again" label, stacked at 464px (`narrow-guidance-owner-conflict-anubis-light-464x800.png`) are fixed. But in dark wide (`guidance-owner-conflict-anubis-1280x800.png`) the border still renders as near-white rgb(229,231,235), sampled at (640,476), not an error colour, so it still resembles a focus ring. Source `project-guidance.page.ts:50` and `generate-agents.page.ts:52` use `border-state-err/70`; that utility apparently does not resolve in the build (the `text-state-need` text colour does). Fix: use a token that resolves, or an existing `border-error`/`--state-err` via the page style block. |
| Summary rows (A4 completed, rows 3-4) | OPEN (capture) | `guidance-completed-anubis-1280x800.png` and `narrow-guidance-completed-anubis-light-464x800.png` are still 1280x800 / 464x800 and cut at "Generated guidance" (rows 1-2 only). The harness full-page overwrite (`onboarding-generate-visual.e2e.spec.ts:170-175`) did not take effect, probably because the shell scrolls an inner container rather than the document. Rows 1-2 render correctly; rows 3-4 remain unverified. Not a product defect. |
| Axe `aria-allowed-role` | RESOLVED | All 88 generate and 72 analyze axe JSON files have `"violations": []`; `grep -L '"violations": \[\]'` returns nothing. |

### New regressions

None serious. Analyze stepper (`narrow-agents-selection-count-ptah-glass-464x800.png`, `narrow-analyze-running-phase-2-anubis-light-464x800.png`): A1 has no stepper; A2 shows the current "Choose agents" pill with 3 dots and a skip icon, no truncation, no overflow. A3-A5 narrow strips fine. Wide stepper unchanged. No contrast or horizontal-scroll issues seen in the opened captures; the orange warning text on dark and light is legible (axe color-contrast clean). Remaining noted: h1 focus box (11) and broken header logo (14) are deferred.

### Residual
Open the summary rows via a scrollable-container capture to close that item. Fix the owner-conflict border token (moderate).
