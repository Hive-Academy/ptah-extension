# Visual Review - TASK_2026_629_c0b3 (Phase A compact session card)

## Verdict: MATCHES WITH GAPS (static comparison only; rendered review BLOCKED)

| Metric | Value |
| --- | --- |
| Overall score | 6/10 (provisional, template-level evidence only) |
| Assessment | NEEDS_REVISION pending rendered check (no visual-breaking issue is proven; none could be ruled out) |
| Visual breaking | 0 proven, 1 suspected (G1) |
| Serious | 1 (G1, unverified) |
| Moderate | 4 (G2-G5) |
| Minor | 2 (G6-G7) |
| Viewports tested | 0 (blocked) |
| Screenshots taken | 0 |

## Environment and what was blocked

- No browser session existed (`ptah_browser_status`: not connected) and no running Ptah webview or Electron instance was identified.
- The browser tool refuses `file:` URLs ("Only http: and https: are permitted"). The prototype could therefore not be opened without starting a local server, which CLAUDE.md forbids (no serve/dev). **No screenshots of the prototype or of the real card exist.** Nothing below is a visual claim; it is a source comparison.
- The prototype (`prototypes/01-board.html`, `shared.css`, `shared.js`) is **dark only**: one `:root` palette, no `data-theme` and no toggle. There is no approved light reference, so the light theme can only be judged against DaisyUI token behaviour.
- `task-description.md` section "3. Status card layout with the Lanes table" holds the criteria (numbered 1-9, there is no literal "AC 3.x" string). Criterion 7 is the two-cards-side-by-side check.

### Steps for the user to take the real screenshots (BLOCKED for me)

1. Launch the app yourself (your usual Electron or webview dev flow) on branch `feat/task-629-canvas-board`.
2. Open the canvas with at least two child-agent tabs that have different data. Cover: A = 3+ lanes (so "+N more lanes" shows), a long branch name and a long "Now" text; B = no lanes, plus a permission callout; C = an error callout. Put two cards side by side.
3. For each of dark (for example `night`/`dark`) and light (`light`), screenshot at a tile height around 244px and at a larger one.
4. Check criterion 7 by measuring that the sub line, Now row, Lanes block and metrics row start at the same y on both cards. Save to `.ptah/specs/TASK_2026_629_c0b3/screenshots/phase-a/`, named `card-{dark|light}-{pair|callout-permission|callout-error|many-lanes}.png`.
5. Send the images back and I will finish the zone verdicts.

## Zone-by-zone comparison (prototype `boardCardHtml` / `.bcard` vs `compact-session-activity.component.ts`)

| Zone | Prototype | Implementation | Dark ok | Light ok | Gap |
| --- | --- | --- | --- | --- | --- |
| Header | dot, title (600, truncates), state pill, expand button `⤢` | session dot (line 431), icon, `status.text` truncated, tone badge, workspace label right-aligned (427-468). No expand button in the component; the card emits `expandToFull` from a click on the whole card | likely | likely (DaisyUI `/10` tints) | G2 |
| Sub line (branch · model · elapsed) | one mono truncating line, 11px | separate truncating spans, 10px, `—` placeholders, fixed `1.625rem` row (396, 471-485) | likely | likely | G4, G6 |
| Now | `Now` label (40px, 10px uppercase) + activity, truncates | same label class and width (398-405, 487-496), muted 12px, truncates with title | likely | likely | none |
| Lanes | label + summary line; `ul` rows in a 5-column grid `18 / 1fr / 72 / 76 / 54`, 6px gap; max 3; `+N more lanes` | identical column template (407-413), max 3 via `slice(0,3)`, `+N more lanes` (928-934), `—` placeholder, summary text "No lanes" | likely | likely | G1 |
| Callout | replaces rows, summary stays; `<b>agent</b> asks to run <code>cmd</code>`; Allow, Deny; error: Retry and Show output | replaces rows, summary stays (829-935). Permission shows one plain `permission.text` span (no bold agent or code styling). Allow `btn-success`, Deny `btn-error btn-outline`. Error shows text and Show output; Retry hidden (decision 5) | likely | likely | G3, G5 |
| Metrics | todos done/total + mini bar, `ctx N%`, cost, git +/- in a 4-column grid, top border | `ptah-compact-session-stats` (model, tokens, cost, agents, compacted) plus `Context N%` on the right when known (939-954). No todos, no git, no per-field placeholders | partly | partly | G2b (G6 below) |
| Zone order and fixed heights | header, sub, now, lanes, foot; lanes `flex:1` | `grid-template-rows: auto 1.625rem 2rem minmax(7.5rem,1fr) auto` (396); `.cs-lanes min-height 7.5rem` (415) | yes | yes | G1 |

Order matches criterion 1. Fixed rows for the sub line and Now row give same-offset starts, provided the header and metrics rows do not grow (both are `auto`; a long wrapped status would not wrap because of `truncate`, so offset parity is plausible).

## Numbered gaps

1. **G1 - Serious (unverified, possible clipped "+N more lanes").** `compact-session-activity.component.ts:396,415,816-934`. At the prototype tile height of 244px, the leftover for the lanes row is roughly `244 - ~36 (header) - 26 - 32 - ~28 (metrics) = ~122px`. The full content is padding (12) + summary (16) + gap + 3 rows (~24 each) + "+N more" (~16), so about 126px or more. The zone has `overflow-hidden` and `min-height 7.5rem` (120px), so the last line may be cut off, or the card may grow and break criterion 7. Needs a rendered check at 244px; if confirmed it is visual-breaking for cards with more than 3 lanes. Fix: give the lanes row `minmax(8.5rem,1fr)` or reduce paddings, or hide the summary gap.
2. **G2 - Moderate (known, decisions 6).** `...stats.component.ts:13-37`, template 939-954. Todos and git +/- are absent, and metrics are not the prototype's todos / ctx / cost / git quartet. Criterion 1 requires "a zone with no data keeps its place and shows a placeholder"; the implementation shows no placeholder for todos and git. Header also lacks the prototype expand affordance (template 427-468; expand is whole-card click only, `compact-session-card.component.ts:88`). The expand icon is also a keyboard and discoverability gap.
3. **G3 - Moderate.** `...activity.component.ts:836-838`. The permission callout renders one plain-text line, so the prototype's emphasis (agent name bold, command in `code`) is lost and a long command truncates with only a `title` tooltip.
4. **G4 - Moderate (light theme).** `...stats.component.ts:18` uses `text-purple-400` for the model, which is typically below 4.5:1 on a light background; `text-base-content-muted` (used throughout the card) is a project token whose light value was not measured. Needs contrast measurement in a render.
5. **G5 - Moderate.** Callout height: prototype callout fits the lanes row; implementation stacks text and an `btn-xs` row with `p-2` inside a 7.5rem minimum (about 5.6rem needed plus summary 1rem). Tight; confirm no clipping of the buttons.
6. **G6 - Minor.** Model is shown twice in board mode: sub line (477-479) and the stats row (`...stats.component.ts:16-21`). Prototype shows it once.
7. **G7 - Minor.** Sub line is 10px vs prototype 11px; lane-row vertical padding `py-0.5` vs prototype `3px` (about 1px per row, adds to G1).

## Light theme

No prototype reference exists, so fidelity is NOT APPLICABLE. The implementation uses DaisyUI semantic colours (`text-warning`, `bg-warning/10`, `border-error/30`, `text-info`, `text-success`), which switch per theme, so tones should carry over; contrast of the `/10` tints and of the 10-11px muted text needs measurement (G4).

## Accessibility notes (source level)

Lane rows are `button`s with an aria-label and a visible `focus-visible` outline; callouts have `role="group"` and labels; status dots are `aria-hidden` and the status text is also written. The lane status dot is not the only status carrier. Target sizes (`btn-xs` = 24px high, lane rows about 24px) are at the WCAG 2.2 AA 24px floor and cannot be measured without a render.

## Screenshots

None. Rendered screenshots of prototype and real card are BLOCKED (file URLs refused by the browser tool; serve/dev forbidden; no running instance).
