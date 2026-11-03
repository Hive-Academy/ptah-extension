# Gate 1.7 design review — TASK_2026_860

**Verdict: REVISE**

Reviewed parts A–D, the parity inventory, the specification, and the prototype. Browser checks used 1440×1000 in dark and light themes. Token spot-checks matched `apps/ptah-extension-webview/tailwind.config.js:31-41,87-229` and `src/styles.css:158-165`.

## Findings

1. **Serious — Finished sessions disappear in the collapsed rail.** `design-spec.md:19,24` auto-collapses more than three Finished cards and hides group headings in the 56px rail. `prototype/index.html:11,32` implements both rules. The browser showed zero visible Done cards and `display:none` on the Finished heading. No control remains to expand the group or receive its required fallback focus. Keep Finished expanded in the collapsed rail, or provide an accessible expand control.
2. **Serious — Menu focus and expanded state break.** `prototype/index.html:28,33-34` only hides menus on Escape. The browser left focus inside the hidden overflow menu and kept `aria-expanded="true"`. Selecting a hidden agent also reopened the menu instead of closing it. This contradicts `design-spec.md:30-31,37`. Close the menu on selection and Escape, set `aria-expanded="false"`, and return focus to the trigger.
3. **Serious — Light-theme focus contrast can fail.** `prototype/index.html:11` uses `var(--s)` for every button focus outline. `apps/ptah-extension-webview/src/styles.css:1042-1056` records only 2.94–3.41:1 on light panels and replaces this color with `--ptah-gold-strong`. Copy the existing focus treatment into the prototype to meet the 3:1 non-text minimum.
4. **Minor — Dock freeze release is unspecified.** `task-description.md:53` requires focus freeze to release when focus leaves the dock. `design-spec.md:31` defines the cap and hidden-focus fallback but not this release. Add the release rule and its resulting focus behavior.

## Checks that passed

- All eight local pulse conversions have specified variants. Reduced motion leaves a still dot and preserves labels and determinate progress.
- The dock cap, running-first order, selected exception, safe unknown-width layout, and overflow content have matching decisions.
- The five status jumps, grouping, density, card menu, Move Up/Down, attention actions, footer actions, and inspector narrow fallback remain specified.
- The Finished threshold is reasonable once the collapsed-rail conflict is fixed. No new theme tokens are required.
