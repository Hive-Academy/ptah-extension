# Visual Review b5b-a5 (Generate / Guidance / Done)

Verdict: REVISE. Score 6/10. Visual breaking 0, Serious 2, Moderate 3, Minor 1.
Evidence is static (existing PNG + axe JSON). No live browser, no build. Only 5 PNGs were opened (listed under "Not checked").

## Findings
1. SERIOUS - Contrast: error fills fail AA in anubis (dark) and anubis-light. `.badge-error`, `.alert-error`, `strong` inside it: #e8e6e1 on #dc2626 = 3.87:1 (needs 4.5:1; 10-12px text). Seen in done-facts-anubis-1280x800.png, narrow-done-facts-anubis-light-464x800.png (hot-pink fill, white bold text). ptah-glass themes pass. Source: failed alert/badge in libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts (safe error list) and outcome-summary.component.ts (the "Failed." alert); fix with the theme's error-content token or darker error base, not per-component colours.
2. SERIOUS - axe `scrollable-region-focusable` on `pre` at 464px, all 4 themes (narrow-done-facts-*.axe.json). The `<pre>` at analyze-done.page.ts:312 scrolls horizontally but is not keyboard-focusable. Fix: `tabindex="0"` + role="region" + aria-label, or `whitespace-pre-wrap break-words` as other pages do (analyze-workspace.page.ts:46).
3. MODERATE - Attention colour is inconsistent. Done-facts uses a solid orange `alert-warning` fill (outcome-summary.component.ts ~line 58, narrow-done-facts-ptah-glass: soft tinted/outlined) while guidance-owner-conflict-anubis-1280x800.png uses orange text on an outlined box with a white ring. Same "needs attention" meaning, 3 treatments across themes; in anubis-light the solid orange with white text was also low-weight legible. Pick one alert pattern.
4. MODERATE - Contradictory facts in failed done-facts: header "Setup Finished With Errors" (analyze-done.page.ts:489) sits directly above "Agents: completed" (done-facts-anubis-1280x800.png), and the failure appears 3 times (Needs attention badge + "Review failed agents" link, row badge, bottom alert). "completed" should read e.g. "Agents: finished with 1 failed" when counts.failed > 0 (hasFailures, line ~494). Also title-case "Setup Finished With Errors" vs sentence case elsewhere.
5. MODERATE - Guidance page stepper shows only 2 steps (Project guidance / Done, guidance-owner-conflict-anubis-1280x800.png) while Generate shows 5 (generate-failed-anubis-light-1280x800.png). Progress context disappears between adjacent steps.
6. MINOR - Narrow (464px): outcome grid wraps 2-col leaving an orphan "Failed" tile (narrow-done-facts-anubis-light-464x800.png); file names break mid-word (`platform-/engineer.md`, `agent/s/`) and "Changed since preview (kept)" pill crowds the name in ptah-glass. Not clipped, no horizontal page overflow seen. Acceptable; cosmetic (outcome-summary.component.ts grid class `grid-cols-2` when compact; let the badge wrap under the name).

## Count inconsistency ("Kept (your file) 0 / Already current 1" vs a Kept row)
Not a defect in the current build. Counters are derived from the rows (outcome-summary.component.ts doc comment, lines 25-30; OUTCOME_LABELS lines 15-20), so they cannot diverge. Current capture: Written 1, Kept 1, Already current 0, Changed since preview 1, Failed 1 = 4 rows = "Generated Agents (4)". The row detail "Kept: not regenerated (no content was generated for it)" is outcome-rows.ts:216 text and consistent. The earlier text mismatch was from older capture/fixtures; no remaining evidence of it. Residual: the "Kept" row says "no content was generated" while the library/notice implies intent; wording only.

## Heading/subtitle for failed done-facts
Logic correct: pageHeading = 'Review workspace setup' when !setupReady (hasFailures true), subtitle "Review the agent run..." (analyze-done.page.ts:474-485). Visible in screenshot: the page heading itself is above the fold in the crop, so it was verified from source only. Outcome header "Setup Finished With Errors" correct for failed (not cancelled/timed-out).

## Layout/narrow, themes
- No horizontal overflow or clipped text at 464px in the opened done-facts images; stacked layout reads well. Library notice correctly shows "will not appear in the Library" (orange banner, both widths).
- Generate failed anubis-light: legible; the heading shows a black focus box (programmatic focus ring, generate-failed-anubis-light-1280x800.png). Intentional focus but heavy; consider `focus-visible` only.

## Axe summary (176 files: 4 themes x 11 views x wide/narrow x png/json -> 88 axe files)
| Rule | Impact | Where | Count |
|---|---|---|---|
| color-contrast | serious | done-facts, anubis + anubis-light, wide + narrow (.badge-error, .alert-error, strong) | 3 nodes x 4 files |
| scrollable-region-focusable | serious | narrow-done-facts, all 4 themes (pre) | 1 node x 4 files |
| any other rule, any other view, ptah-glass wide done-facts, critical | - | none | 0 |
All generate-* and guidance-* axe files: zero violations.

## Not checked
- Only opened 5 PNGs: done-facts-anubis wide, narrow-done-facts anubis-light and ptah-glass, generate-failed-anubis-light, guidance-owner-conflict-anubis. The other views/themes (running, completed, mismatch, lookup-exhausted, guidance idle/running/completed/lookup-error, ptah-glass-light) were judged only by axe JSON (clean), not visually.
- Top of done page (heading, Pro Tips, example commands, agent count, workflow types) is below/above the crop; not seen.
- No hover/focus/keyboard, no live contrast measurement beyond axe, no motion/layout-shift, no prototype comparison.

## Coordinator follow-up

- #2 fixed: the example `<pre>` in analyze-done.page.ts is focusable (`tabindex="0"`) with an
  `aria-label`. Re-captured done-facts (8/8 passed): `scrollable-region-focusable` no longer fires
  in any theme.
- #4 fixed: a completed run with failures shows "Agents: needs attention" (as the committed page
  did); covered in analyze-done.page.spec.ts.
- #1 deferred: pre-existing. The failed badge/alert come from the reused
  outcome-summary.component.ts, which uses the same `badge-error`/`alert-error` classes on main;
  the anubis themes' error token pair is 3.87:1. Theme-level fix, out of this task's scope.
- #3, #5, #6 deferred (cross-component state-colour treatment, Guidance stepper length, 464px
  orphan tile). No clipping or overflow.
- Remaining axe after the fix: `color-contrast` (3 nodes) on done-facts in anubis and anubis-light
  only; ptah-glass and ptah-glass-light clean; all generate and guidance captures clean.
