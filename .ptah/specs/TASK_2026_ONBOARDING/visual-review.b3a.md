# Visual review B3a: A1 Analyze workspace, A2 Choose agents

Method: screenshots only (`screenshots/analyze/`, four themes: ptah-glass, ptah-glass-light, anubis, anubis-light; 1280x800 and `narrow-` 464x800), plus all axe JSON. Spec: `design-spec.md` section 3.2. Not every PNG was opened: I read ptah-glass wide for all A1 states and A2 92-match/owner-conflict, then sampled light/anubis/narrow variants. Other theme/state combinations are inferred from the axe reports (identical rules per view) and from those samples.
Not captured (harness ECONNRESET flake, not defects): ptah-glass-light `analyze-failed` and `analyze-completed` (wide).

## A1 states (theme x width)

| State | glass 1280 | glass 464 | glass-light 1280 | glass-light 464 | anubis 1280 | anubis 464 | anubis-light 1280 | anubis-light 464 |
|---|---|---|---|---|---|---|---|---|
| saved-list | D3,D4 | sampled: D3 | sampled | D3 | sampled | sampled | sampled | sampled |
| running-phase-2 | D6 | sampled | sampled | D6 | sampled | sampled | sampled | sampled |
| completed | D5 | sampled | not captured | sampled | sampled | D5 | sampled | sampled |
| failed | D4 | sampled | not captured | sampled | sampled | sampled | sampled | D4 |
| interrupted | D4 | sampled | sampled | sampled | sampled | sampled | D4 | sampled |

"sampled" = not individually inspected beyond the axe report, or visible only through a same-state sibling; no overflow or clipping seen in any A1 narrow capture opened. No horizontal overflow at 464px in the A1 captures opened.

## A2 states (theme x width)

| State | glass 1280 | glass 464 | glass-light 1280 | glass-light 464 | anubis 1280 | anubis 464 | anubis-light 1280 | anubis-light 464 |
|---|---|---|---|---|---|---|---|---|
| 92-match | D2,D7,D8 | sampled | sampled | D1,D7 | D9 | D9 | D9 | D9 |
| selection-count | OK ("1 selected") | sampled | sampled | sampled | D9 | D9 | D9 | D9 |
| catalog-banner | OK | sampled | sampled | sampled | D9 | D9 | D9 (opened) | D9 |
| owner-conflict | D2,D8 | sampled | sampled | sampled | sampled | D8 | sampled | sampled |

Spec checks that pass: "92% match" text plus meter present and correct ("Backend Developer 92% match", "Software Architect 40% match"); "n selected" present and updates ("1 selected"); catalog banner copy matches spec verbatim with an "Analyze first" link; owner-conflict banner "Another run is active" with "Open it" and Retry matches spec; "Phase 2 of 4" header, four rows, "since you opened this page" label, Stop, and the "events: ... errors" log header are all present; failed shows Retry / Start over; interrupted shows "Continue previous run" primary and "Start fresh".

## Defects

1. **Narrow stepper is broken** (Serious). `narrow-agents-92-match-ptah-glass-light-464x800.png`. Under 720px the strip renders five bare dots with the current label "Choose agents" wrapping over two lines and overlapping the neighbouring dot. Spec: horizontal strip showing the current label only. The dots carry no accessible meaning visually and the label collides with step 3. Source: onboarding shell stepper (`libs/frontend/onboarding/src/lib/shell/`), seen on A2; not in analyze/ but is how A2 renders.
2. **"Model for this tab" select is empty** (Serious). `agents-owner-conflict-ptah-glass-1280x800.png`, `narrow-agents-owner-conflict-anubis-464x800.png`. The control shows no value or placeholder, so the user cannot see which model will run. In glass wide it looks like an empty pill with no caret. Likely the A2 model picker in `libs/frontend/onboarding/src/lib/analyze/` (agents step); fixture may lack models, but the empty state needs a placeholder or "No models available".
3. **Raw ISO timestamp in Saved analyses** (Serious). `analyze-saved-list-ptah-glass-1280x800.png`, `narrow-analyze-saved-list-ptah-glass-light-464x800.png`. Shows `2026-10-29T09:00:00.000Z · 42s`. At 464px it wraps to three lines, squeezes against the "Use" button and nearly touches it. Spec says date; format it (for example "29 Oct 2026, 09:00") and let the Use/Hide buttons wrap below the metadata on narrow. Source: saved-analyses list component under `analyze/`.
4. **Empty "Saved analyses" card has no content** (Moderate; Serious if judged as no feedback). `analyze-failed-*`, `analyze-interrupted-*`, `analyze-running-phase-2-*`. A titled card with nothing inside reads as broken or still loading. Add "No saved analyses yet" text, or hide the card. Source: saved-analyses list in `analyze/`.
5. **Completed primary label deviates from spec** (Moderate). `analyze-completed-ptah-glass-1280x800.png`, `narrow-analyze-completed-anubis-464x800.png`. Button reads "Continue"; spec says primary "Choose agents". Also the primary button is smaller and pill-shaped differently from "Start analysis" (padding inconsistent). Source: analyze result/completed component.
6. **Copy grammar: "1 errors"** (Minor). `analyze-running-phase-2-ptah-glass-1280x800.png`, narrow glass-light. Needs singular/plural handling (note the spec example itself uses "0 errors"). The "Details log" header is also not visibly a disclosure control (no caret), and at 464px the label wraps oddly ("Details / log").
7. **Stepper label "Analyze , skipped"** (Minor). `agents-92-match-ptah-glass-1280x800.png`, `agents-catalog-banner-anubis-light-1280x800.png`. Stray space before the comma (accessible-name pattern "Analyze, skipped" leaking into visible text with a separate span). Skipped step also uses the same dashed circle as future steps, so it is not visually distinct. Stepper is rendered stacked inside the content column rather than the 210px sticky rail; confirm that is intended.
8. **Per-row Preview action not visible** (Serious, needs confirmation). `agents-92-match-ptah-glass-1280x800.png`, `agents-owner-conflict-ptah-glass-1280x800.png`. Spec A2 row lists a Preview button; none visible on the Software Architect or Backend Developer rows. In owner-conflict the banner and the "Preview and generate" CTA sit below the fold after Community packs, and the conflict banner appears far from the toolbar. Verify the Preview action exists, or note the divergence. Source: agent row component in `analyze/`.
9. **Axe color-contrast, serious** (Serious). Rule `color-contrast`, target `.btn-link` ("Analyze first", catalog banner link): 3.58:1 (#2563eb on #131317) vs required 4.5:1 at 12px. Reported in all 12 anubis and anubis-light A2 captures (92-match, catalog-banner, selection-count, wide and narrow). Fix by using a lighter link token in dark anubis, or a theme link colour. The glass themes show the gold/teal link and pass.

## Axe summary

Serious/critical: only `color-contrast` on `.btn-link` (D9). Moderate, repeated in 72 reports: `landmark-main-is-top-level`, `landmark-no-duplicate-main`, `landmark-unique` (targets `.max-w-[760px]`, `.bg-base-100`): the onboarding page renders a second `main` inside the shell's main. Shell/page nesting, not state-specific; fix by using a `div` or `section` for the page root. No critical violations.

## Other observations (out of scope or minor)

- Header logo image is broken (alt icon) in all captures; this is the shell, not B3a.
- Narrow top nav drops labels and truncates icons; host shell behaviour.
- Dark contrast in glass: body, chips and match text are legible; light themes: legible; meter bars are visible in both.
- No truncation hiding meaning at 464px in A1/A2 captures opened; chips wrap correctly (glass-light narrow 92-match).

## Verdict

REVISE. No blocking layout breakage, but five Serious defects (D1, D2, D3, D8 to confirm, D9) plus spec deviations (D5, D4).
