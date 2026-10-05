# Prototype (Revision 5) - TASK_2026_596_0a19 plan limits

Open `index.html` in a browser (no build, no network). Tokens are copied from the webview theme (`anubis`, `anubis-light`) as CSS variables; class names mirror the Tailwind/daisyUI classes in `../design-spec.md`.

Controls (sticky bar, or query string `?theme=light&p3=95&p9=5&p4=B&wd=verbose&w=280`): theme, P3 threshold, P9 freshness (minutes), P4 variant (A detailed pill when hot, B always on, C compact word + dot), source wording (short/verbose), panel width. Clock frozen at 2026-10-03 12:00 UTC.

One state engine implements Revision 3 (freshness against the window's last reset, exhaustion precedence over stale, partial event never establishes room, owner-level exhaustion independent of windows) and drives the UI and the tool text.

Sections: 1 stats grid (collapsed A-F, expanded G, H, H2, I, J as tiles), 1b lane lifecycle storyboard (sessions A and B), 2 dashboard cards (16 states), 3 tool text (13 outputs: list default / no confirmed room / all at limit / empty roster; spawn near, at limit, room, owner-level, unknown, cooldown, estimate, failed, single lane), 4 source-label legend.

Revision 5: every tile starts closed; closed faces show chips and short source labels; lane tiles keep quota state per owner/scope subgroup; same-account lanes point to the plan tiles instead of repeating windows; owner evidence shows active vs expired; a stale tile; no dense grid packing. Added `stats-grid-open-dark.png` (four tiles opened).

Revision 4: the expanded stats grid shows plan-limit windows, no-usage-source, owner-level limit evidence, cooldown and each CLI lane as expandable tiles in the same 2-column card grid (no Plan limits / Lane runs title bars); lane tiles say "lane · not in totals" and a subtotal tile closes them. Added `width-440-dark.png`.

Revision 3: observation-vs-reset is evaluated before age/stale; "Reset · usage unknown" shows the passed reset and the next reset separately; variant A is a wrapping alert line above the chip strip (full state and reset at 280 px); empty-roster and single-lane alternatives print all four groups; the failed-spawn header is marked illustrative.

Screenshots (Revision 3 adds `narrow-280-p4C-dark` and `dashboard-card-p9-30-dark`): `screenshots/` has `stats-grid`, `lane-lifecycle`, `dashboard-card`, `tool-text` in `-dark` and `-light`, plus `variant-p4B-p3-95-p9-5-dark`, `variant-p4C-p3-80-p9-30-verbose-dark`, `narrow-280-dark`.

Data is illustrative. Antigravity, Ollama Cloud and OpenCode shapes are provisional examples, not collected fixtures. Roster rows in the tool text are illustrative samples, not a runtime inventory; each is followed by an annotation line.

## Lane-introduced constraints
- [lane-proposed] New secondary text uses `text-base-content/70` (light-theme `--bcm` on base-200 is 4.46:1).
- [lane-proposed] Semantic colours are never text colour.
- [lane-proposed] Source wording: Provider API / Unofficial / Live event / From error / ~ Estimate (verbose alternative provided).
- [lane-proposed] Collapsed Limits pill is first in the row.
- [lane-proposed] Initial expansion: every tile starts closed; manual open/close is kept for the life of the view. Lane tiles are dashed with a "lane · not in totals" caption.
