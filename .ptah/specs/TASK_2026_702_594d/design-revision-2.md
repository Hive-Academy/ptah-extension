# Design revision 2 — Chat start screen

The Round 1 re-review was **APPROVED**. This revision applies only findings N1, N3, N4, and N5. Contrast uses WCAG 2.2 AA normal-text minimum **4.5:1**. Values below are the worst of **3 Aurora phases (0, 20, 40 seconds)** measured with `node check-contrast.js` in Chromium for each theme.

| Finding | Change made | File:line | New contrast numbers, worst of 3 phases (dark / light) |
| --- | --- | --- | --- |
| N1 | Light stripe changed to `#d7bd83`; warm stops to `#b98535`, `#e0b65a`, `#a8752b`; light board opacity raised from `.19` to `.33`. Dark CSS and reduced-motion rule remain intact. Recaptured all 16 screenshots. | `prototype/start-screen.html:32-36`; `design-spec.md:52`; `prototype/screenshots/light-empty.png` | Board hero title **11.15 / 14.84:1**; supporting text **11.96 / 15.25:1**. |
| N3 | Added the light 280px single-chat `.row-state` fixture and measured all fixtures at 0, 20, and 40 seconds. The contrast table records phase minima. | `prototype/check-contrast.js:19`; `design-spec.md:68-84` | Single-chat title **6.46 / 5.52:1**; tagline **4.92 / 5.83:1**; `.row-state` **9.76 / 11.62:1**. Dark running-cap reason **12.39:1**. All measured pairs pass. |
| N4 | Added an Electron CPU spot check and permitted a transform-based shift if repaint cost warrants it. | `design-spec.md:56` | No text contrast change. |
| N5 | Production stops derive from DaisyUI `secondary` and `base-100` with `color-mix`; prototype hex stops are tuning values. Prototype `.62` and `.55` disabled opacities must not become `text-base-content/NN` alpha classes. | `design-spec.md:52,56` | No text contrast change. |

## Visual and file checks

- Ran `node capture-screenshots.js`; all 16 PNGs in `prototype/screenshots/` were recaptured.
- Viewed `light-empty.png` and `dark-empty.png`: the light gold wash is visibly present across the upper board; the dark treatment remains visually consistent with the approved design.
- `prototype/start-screen.html` is 47,652 bytes, under 100 KB, with no embedded base64 payload.
- `node --check` passed for `check-contrast.js` and `capture-screenshots.js`. Ptah diagnostics were unavailable for the HTML and timed out for the JS compiler check; the contrast run itself completed with all pairs passing.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Use `.33` light opacity and the listed darker gold stops. | Keep `.19`, raise opacity only, or adjust both opacity and stops. | N1 identified both low opacity and the near-base stripe as causes. The new light screenshot shows a calm visible wash, while measured hero contrast stays above 14:1. | Yes; CSS values only. |
| Measure three evenly spaced phases and include the narrow light `.row-state` fixture. | Sample only the default frame or sample 0/20/40 seconds. | N3 requests three or more phases in both themes; the 60-second cycle makes 20-second spacing useful. | Yes; script fixture and documentation only. |
| Keep the single-chat Aurora as drawn during this revision. | Remove it or retain it pending the orchestrator's N2 scope decision. | The request explicitly reserves N2 for the orchestrator and forbids adding or removing this treatment. | Yes; no N2 change made here. |
