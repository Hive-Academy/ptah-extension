# Gate 1.7 re-review — TASK_2026_860

**Verdict: APPROVED**

Checked the revised specification and prototype at 1440×1000 in dark and light themes.

1. **Resolved — collapsed rail:** `design-spec.md:71` and `prototype/index.html:32` keep Finished cards available; the browser showed four visible, focusable, named Done cards.
2. **Resolved — menu behavior:** `prototype/index.html:27-28,33-34` closes dock and inspector menus on selection and Escape, resets `aria-expanded`, and returns focus; browser checks passed for both menus.
3. **Resolved — light focus contrast:** `design-spec.md:73` and `prototype/index.html:11` apply the existing `--ptah-gold-strong` outline color with 2px width and offset on `anubis-light` panels.
4. **Resolved — dock freeze release:** `design-spec.md:74` now releases freeze when focus leaves the dock subtree and defines chip re-planning with selection retained.

**New Blocking issues:** None found in the revised areas.
