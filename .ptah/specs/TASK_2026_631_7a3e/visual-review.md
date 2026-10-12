# Visual Review - TASK_2026_631_7a3e (Session Analytics provider list)

**Verdict: PASS WITH NOTES** (score 7.5/10). Visual breaking: 0. Serious: 0. Moderate: 3. Minor: 4.

## Environment and method
- Build under review: running "Ptah Dev" (commit fe504a99b), renderer file `dist/apps/ptah-electron/renderer/index.html`, attached over CDP http://127.0.0.1:9333 with playwright-core. No process launched/killed, no source edited. Production build (no `window.ng`).
- Data: the live app has 5 real owners, all with **no plan windows** (Claude identity unavailable, OpenCode CLI login with local usage, Antigravity, Provider CLI login, Ollama Cloud). No account with windows exists, so windowed/limit/aged/unknown states could not be seen from live data.
- **Fixture rows**: to exercise those states I injected 4 DOM-only fixture `<li data-fixture>` rows after the real rows, built from the row component's own template markup, classes and Angular scope attributes (so the real compiled CSS and container queries apply): Claude Max with 6 windows (42% ok, 92% near, 100% limit, 97% aged, 57% not-confirmed, unknown), Codex with 2 windows (12%, 89%), OpenCode Zen compact + local usage, and a long unbreakable name + stale warning compact row. Fixtures are not produced by the Angular code, so state-to-tone mapping (e.g. 90% threshold, aged -> neutral) is verified from the spec/revise-1 report, not from running code; only layout, colours, contrast and semantics of the shipped CSS/markup were measured. Fixtures were removed afterwards; theme restored to retro and viewport override cleared.
- Viewports (CDP Emulation, height 2800): 1800, 1000, 420 px. Available list (`li`) widths measured: 1652, ~852 (1000 viewport; 868 incl. padding), 316. Themes: anubis, anubis-light, retro (set via `data-theme`). Audit selection, not a support contract.
- Screenshots: `visual-review/{anubis,anubis-light,retro}-{1800,1000,420}.png`, `focus-refresh-anubis.png`, `focus-refresh-anubis-light.png`. Raw data: `visual-review/metrics.json`, `visual-review/a11y.json`. Scripts: `visual-review/lib.cjs, run2.cjs, run3.cjs`.

## Per-item results
| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | List layout | PASS | One full-width row per owner (liW = container width for all 9 rows at every viewport); no grid. Windowless owners are compact single-line rows (~55-75 px tall at 1800; `anubis-1800.png`). Selected-provider-first ordering could not be verified (no selection signal in the UI; real order Claude, OpenCode, Antigravity, Provider CLI, Ollama). |
| 2 | Responsive | PASS (notes) | 1800: identity \| windows \| local \| refresh on one line, windows flex-wrap in the middle (`anubis-1800.png`). 1000: identity+refresh header, windows wrap in a 4-up/2-up grid below, local usage below and right-aligned (`anubis-light-1000.png`). 420: stacked, local usage below identity, left-aligned, bars full width (`anubis-420.png`, `retro-420.png`). No horizontal overflow inside any row (liScrollOverflow 0, secScrollOverflow 0, no child past li edge at 1800/1000; at 420 only a subtitle span of the real OpenCode row reported 0.5px+ past the edge - not visibly clipped). Name never squeezed: h5 keeps ≥169px beside mark+refresh; long unbreakable name wraps via `overflow-wrap:anywhere` (5 lines at 420, no clip). Document-level overflow at 420 (303px) is the app shell tab bar (`div.tabs.electron-tabs`), not the list. |
| 3 | Colours / states | PASS (notes) | ok = green, near (>=90%) = amber + "▲ Near limit", limit = red + "■ Limit reached", aged/not-confirmed = neutral (base-content) fill + "◷ Aged"/"? Not confirmed", unknown = hatched dashed track with "? Unknown", never a 0% bar. Accent left border + mark tint per provider (Claude orange, Codex green, OpenCode blue, Antigravity purple, generic grey). Tick at 90% on every bar. See M1 on neutral-bar weight. |
| 4 | Themes / contrast | PASS text, NOTE non-text | All measured text >= 4.5:1 in all three themes (table below). Bar non-text contrast < 3:1 in light themes (M2). |
| 5 | Accessibility | PASS | `ul.rows` > 9 `li` > `section[aria-label="<name> usage"]`; headings h3 Session Analytics > h4 block > h5 row titles; progressbars carry aria-valuenow + aria-valuetext ("92% used, near limit") + aria-label; refresh buttons have per-row aria-labels, are in tab order (rows 1-9 consecutive), show a 2px solid outline (anubis yellow, anubis-light brown `oklch(.48 .12 70)`; `focus-refresh-anubis-light.png`). axe-core on the list container: 0 violations in all three themes (no serious/critical). Targets: refresh 24x24 (meets WCAG 2.2 AA 2.5.8 minimum exactly; below the 44px guidance, minor). |
| 6 | Prototype | PASS (notes) | See deviations below. |

### Text contrast (ratio, need 4.5)
| Element | anubis | anubis-light | retro |
|---|---|---|---|
| Row name (h5) / window name / value | 13.89 | 14.21 | 10.79 |
| Subtitle, source chip, reset text, local label/caption, compact reason (muted) | 5.65 | 5.39 | 5.75 |
| Status badge text | 13.89 | 14.21 | 10.79 |
| State chips (Near limit / Limit reached / Aged / Not confirmed / Unknown) | 11.25 / 12.45 / 13.89 / 13.89 / 13.89 | 12.58 / 11.50 / 14.21 / 14.21 / 14.21 | 9.59 / 9.34 / 10.79 / 10.79 / 10.79 |
| "Cached data" warning badge | 6.61 | 5.66 | 6.30 |
| Warning compact-reason box text | 13.89 | 14.21 | 10.79 |

### Non-text (bar fill vs row background; need 3:1)
| Bar | anubis | anubis-light | retro |
|---|---|---|---|
| success | 5.25 | **2.12** | **2.32** |
| warning | 6.18 | **2.20** | **2.24** |
| error | 3.59 | 3.19 | **2.42** |
| neutral (base-content) | 13.89 | 14.21 | 10.79 |
Track vs row bg is ~1.2-1.3 in all themes (track is decorative). Accent left border vs row bg: 1.8-4.1 in light/retro (decorative; the name is always text).

## Findings

### Visual breaking
None.

### Serious
None. (Verdict would change only if M2 is judged to be a hard requirement of this task: see below.)

### Moderate
- **M1. Neutral (aged / not confirmed / estimate) bars are the heaviest element in the row.** `bg-base-content` fills render near-black in light themes and near-white in anubis (13.9:1), so a stale 97% bar looks stronger than a healthy green or a red limit bar (`anubis-light-1000.png`, `anubis-1800.png`). It is intentionally "neutral" (revise-1 S1) but reads as emphasised. The prototype used a muted fill. Fix: use a muted tier (e.g. `bg-base-content/45` that still meets 3:1) for the neutral tone. File: `provider-account-row.component.ts:283`.
- **M2. Success/warning (and in retro, error) bar fills are below 3:1 against the row background in anubis-light and retro** (2.1-2.4:1 table above). State is also carried by the percent text and chip words, so information is not lost (WCAG 1.4.11 text-equivalent), but the "ok" green has no word and the bar's fill-vs-track edge is weak (1.7-1.9:1 in light). Fix: darker light/retro tints for the fills (e.g. `--su-t/--wa-t` style tokens the design notes mention) or a 1px darker bar outline.
- **M3. Account status badge renders as bare text in dark and misaligns at narrow widths.** `badge badge-ghost` has no border/fill in anubis, so "Usage unavailable" looks like plain bold text with the badge's left padding, indented against the subtitle and wrapping to its own line at 420 (`anubis-420.png`, rows 1, 2, 4, 5). Light themes show a pill. The prototype used a bordered pill with a glyph (○ / – / ▲) for every status. Fix: add a border (`badge-outline`) and a leading glyph; file `provider-account-row.component.ts:217` / `statusChipClass`.

### Minor
- At 1800 the identity column caps at 19rem so long names wrap to 2 lines (Claude identity unavailable, Ollama Cloud) despite ~1300px free (`anubis-1800.png`). Acceptable, per design.
- Dense wide rows (5-6 windows): "100%" value wraps under a long state chip ("Opus weekly ■ Limit reached 100%") at 1800 and 1000 (`anubis-1800.png`).
- Prototype's inline actions (“Open session”, “Add key”, “How to refresh”) are absent in the build; compact rows show reason text only. Refresh button is 24x24 vs ~36px in the prototype.
- Real OpenCode row's subtitle span reported marginally past the li edge at 420 (not visibly clipped).

## Prototype fidelity (DEVIATES minorly)
Prototype: `prototype/index.html`, `shot-1800/1000/420.png`. Matches: one row per owner, left accent border + tinted mark, identity | windows | actions at wide, windows below at medium, stacked at narrow, hatched unknown track, 90% tick, state chips with glyph+word, compact rows single-line. Deviations: provider mark is a vendor logo (prototype letter tiles; intended), status badge lacks glyph/outline in dark (M3), no inline action links, smaller refresh target, neutral fill heavier (M1), local usage shows full ISO range string ("Range: 2025-12-31T22:00:00.000Z - 2026-10-12T14:07:26.171Z") rather than the prototype's "last 30 days" (cosmetic, minor, long unformatted string wraps but does not overflow).

## Not verified
Live windowed accounts (no data); selected-provider-first ordering; hover/disabled-while-refreshing states; motion/layout shift on data load.
