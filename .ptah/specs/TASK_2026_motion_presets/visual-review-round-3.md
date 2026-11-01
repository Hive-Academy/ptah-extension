# Visual review round 3 - TASK_2026_motion_presets (Electron)

Verdict: **PASS WITH NOTES**. D1 (provider wizard stale panel) did not reproduce in any scenario. One moderate defect in the new theme popover (2 px overflow and a visible scrollbar in light themes). No product code was edited.

## Environment and method
- Real Electron app, built bundle `dist/apps/ptah-electron/main.mjs` (not rebuilt), Playwright `_electron`, one instance at a time, isolated profile `%TEMP%\ptah-motion-udd`, real backend.
- Scripts in `%TEMP%\ptah-visual-test\motion\`: `h3.ts` (helpers), `d1.spec.ts` (Part 1), `p2.spec.ts` (Part 2); outputs `d1.out` (normal), `d1r.out` (Reduce), `p2.out`, `p2r.out`.
- `--force-prefers-no-reduced-motion` on all runs except the Reduce run (`d1r.out`, `matchMedia reduce` = true after the in-app Reduce setting plus restart).
- Census: all `.ptah-motion-panel` under `ptah-provider-setup-wizard`, outer step panels (`wizard-step-*`) counted at 300 ms, 1 s and 5 s after each action, with classes, `inert`, `aria-hidden` and duplicate ids in the document.
- Screenshots: `.ptah/specs/TASK_2026_motion_presets/visual-review-round-3/`.

## Part 1 - D1 provider wizard: PASS (all scenarios)
Scenarios per run: Continue; Back; Continue; Back/Continue x3 (60 ms apart); Back; Continue; direct step-link click (the only link is "Provider"); Continue; Back then Cancel 60 ms later (during the leave; the discard review appears and Discard is confirmed) then reopen; Continue.
Runs: `anubis-light` (`d1.out`), `ptah-glass` (`d1.out`), `anubis` dark with Reduce motion and no flag (`d1r.out`).

| Run | Scenarios | Max outer step panels at 300 ms / 1 s / 5 s | Stuck at 5 s | `inert` / `aria-hidden` seen | Duplicate ids |
|-----|-----------|---------------------------------------------|--------------|------------------------------|---------------|
| anubis-light | 9 | 1 / 1 / 1 | none | none | none |
| ptah-glass | 9 | 1 / 1 / 1 | none | none | none |
| anubis, Reduce motion | 9 | 1 / 1 / 1 | none | none | none |

- At 300 ms the incoming panel is still in `ptah-motion-enter` (320 ms) and the outgoing panel is already gone. Under Reduce no class is present at 300 ms.
- Forward navigation to Provider (Back, step-link) and to Credential: the Provider panel never stayed attached, so round 2's "Provider stuck on forward navigation" did not reproduce either.
- After closing mid-leave the wizard host is gone (`{"wizard":false}`), and a reopen starts with exactly one panel.
- Evidence files: `d1.out`, `d1r.out`, screenshots `theme_anubis-light_*_300ms.png`, `theme_ptah-glass_*_300ms.png`. No `*_STUCK.png` or `_EVIDENCE` entries were produced, so there is no stuck-node data to collect.
- Hypothesis: the six nested function-valued `animate.leave` callbacks were the cause of round 2's stuck panels. The class-based leave at `provider-setup-wizard.component.ts:442`, `:640`, `:1175`, `:1226` (`animate.leave="ptah-motion-leave"`) is removed after the CSS leave animation ends (about 180 ms), and the outer `@switch (step())` at `:440` destroys the node. I cannot say whether the nested callbacks or the combination of the callbacks with the old stage was the cause. The reviewer's doubt cannot be settled from the new build alone, because the old build was not run.

## Part 2 - theme popover tabs

| Test | Result | Evidence |
|------|--------|----------|
| Fit at 1186x738, `anubis` | PASS | Themes 196/196, Animation 407/407 (scrollHeight/clientHeight). `P2_anubis_themes.png`, `P2_anubis_animation.png` |
| Fit, `ptah-glass` | PASS | Themes 318/318, Animation 403/403. `P2_ptah-glass_themes.png`, `P2_ptah-glass_animation.png` |
| Fit, `anubis-light` | **FAIL (moderate)** | Themes 238 vs 236 and Animation 407 vs 405: the panel scrolls by 2 px and shows a scrollbar (`P2_anubis-light_animation.png`, `P2_anubis-light_themes.png`). The panel is inside the viewport (bottom <= 738) |
| Keyboard | PASS | Opening via Enter on the toggle puts focus on the selected theme tile (not on the tablist). On the surface tablist: ArrowRight, ArrowLeft, End, Home each switch tabs and move focus and `tabindex` (roving). Tab from the Themes tab goes to the "Dark" category tab. Tab from the Animation tab goes into the panel (first radio input). Escape closes the popover and focus returns to "Change theme" (`P2_after_escape.png`) |
| Reduce motion note | PASS | Picking "Reduce motion" shows "Restart Ptah to apply" (`role=status`). After Themes then Animation the note is still there and "Reduce motion" is still checked. No "Motion setting is unavailable." text or `role=alert` at any point (`P2_reduce_note.png`, `P2_reduce_note_roundtrip.png`) |
| Preset Scale | PASS | `data-motion-style=scale` applied within 339 ms including the click (`P2_scale.png`) |
| Reduce persists | PASS | `config.json` `motionPreference: reduce`; after restart `matchMedia reduce` = true |

## Defects
**P-1 (Moderate) - theme popover overflows by 2 px in light themes.**
Steps: switch to `anubis-light`, open the Theme popover at 1186x738, view either tab. Observed: `scrollHeight` 238 vs `clientHeight` 236 (Themes), 407 vs 405 (Animation), with a visible vertical scrollbar. Dark and glass have no overflow. Likely cause: `theme-toggle.component.ts:684` takes `panel.scrollHeight` (border excluded) and `:719` sets it as `max-height`; the light surface (`.picker-surface-light`, around `:132` and the border rules) has a 1 px border, so the box is 2 px shorter than the content. Fix: add the border (`offsetHeight - clientHeight`) to the computed max height, or drop the light border from the height maths.

**Note.** Opening the popover with Enter puts focus on the current theme tile, not on the tablist. That is consistent with the code (`onBeforeToggle` / `scheduleFollowup('selected')`), so I treat it as intended and note it only for the reviewers.

## Final profile state
Restored with `p2.spec.ts` (`P2_FINAL=restore`): theme Ptah Glass (`data-theme=ptah-glass`, glass on), preset Rise (no `data-motion-style` attribute), Motion "Always animate" (`config.json` `motionPreference: always`). Screenshot `P2_restored.png`.

## NOT TESTED
- Direct "dark anubis" run of Part 1 with animation (dark was run only under Reduce); light and glass ran with animation.
- Part 2 keyboard checks on glass and light themes (run on dark `anubis` only).
- Credential-mode switching inside the wizard (no catalog provider with both modes, as in round 2).
- The old build, so no before/after for the D1 root cause.
- Narrow window widths for the popover.

## P-1 re-check
Electron (real app, `--force-prefers-no-reduced-motion`), `p1fix.spec.ts` / `p1fix_short.spec.ts`. Window content 1186x738. Panel = `[role=dialog][aria-label=Theme]`. Screenshots in `visual-review-round-3/`, prefix `P1fix_`.

| Theme | Tab | scrollHeight / clientHeight | offsetHeight (max-height) | Overflow |
|-------|-----|-----------------------------|---------------------------|----------|
| anubis-light | Themes | 238 / 238 (was 238 / 236) | 240 (240px) | none |
| anubis-light | Animation | 407 / 407 (was 407 / 405) | 409 (409px) | none |
| anubis | Themes | 196 / 196 | 196 | none |
| anubis | Animation | 407 / 407 | 407 | none |
| ptah-glass | Themes | 318 / 318 | 318 | none |
| ptah-glass | Animation | 403 / 403 | 403 | none |

The panel's max-height now includes the 2 px border, so no scrollbar is shown (`overflow-y:auto`, content fits). Files: `P1fix_<theme>_themes.png`, `P1fix_<theme>_animation.png`.

Short window: the window would not go below a 535 px viewport (min size), so I lowered the minimum size and tested 1186x320 on `anubis-light`. Themes (240 px) fits. Animation is capped at 276.9 px: scrollHeight 407, clientHeight 275, panel y 35 to 312, bottom <= 320 viewport, scrolls inside, nothing off screen (`P1fix_short320_Themes.png`, `P1fix_short320_Animation.png`). At 1186x535 both tabs fit unchanged (`P1fix_short500_*.png`, 535 actual).

**Result: PASS** (P-1 closed).

Final profile state: restored to theme Ptah Glass (`data-theme=ptah-glass`, glass on), preset Rise (no `data-motion-style`), Motion "Always animate".
