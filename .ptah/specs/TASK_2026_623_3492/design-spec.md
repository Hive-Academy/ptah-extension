# Design Spec - TASK_2026_623_3492 (display panel)

Revision: 3 (design review rounds 1 and 2 addressed). Status: awaiting Gate 1.7 (user approval of the prototype). Prototype: `prototype/index.html` (open with
`?screen=chat|previews|summary|states|agents|atoms|dock|empty&theme=dark|light&w=300|360|960|1024&state=collapsed|expanded|closed`).
Screenshots: `prototype/screenshots/` (52 files, listed in `prototype/README.md`).
Inputs: task-description.md rev 2 (R1-R9), parity-inventory.md rev 2, decisions.md #5-#10, the two reference screenshots.

Design system applied: the app's existing DaisyUI themes `anubis` (dark) and `anubis-light`
(`apps/ptah-extension-webview/tailwind.config.js`, values copied literally into the prototype). No new theme and no new
colour is introduced; every value below is a DaisyUI theme token or a `color-mix()` of theme tokens.

## 1. Visual direction

The references share: soft cards with subtle depth, a large confident number, a small trend pill, a mini bar
sparkline with one highlighted bar, generous spacing. Adapted to the app:

- Card: `bg --dp-card` (dark `base-200`, light `base-100`), 1px border `bc @14%`, radius `--rounded-box` (0.75 rem dark,
  1 rem light), shadow `--dp-shadow` (dark `0 1px 1px black/.28, 0 8px 24px -12px black/.5`; light a plum-tinted
  equivalent) plus a 1px inner top rim `bc @9%/8%`. Depth is subtle, not glassy.
- Dock (panel background): dark `base-100`, light `base-200`, so cards always lift off it.
- Number: Inter 600, `clamp(1.5rem, 11cqi, 2.125rem)` (24 to 34 px), letter-spacing -0.025em, tabular-nums.
- Labels/eyebrows: 12 px, 500, `--dp-muted` (= `base-content-muted` `--bcm`). Titles 14 px 600. Body 12 to 13 px.
- Sparkline: 7 bars, 30 px tall, `--dp-bar-dim` (bc @20% over card) with the latest bar `--dp-hl` (= `secondary`, gold).
  A failing series (tests) uses the error fill for its highlight bar. Bars are decoration: the sparkline is
  `role="img"` with a text label that states the latest value, and the number next to it is the data.
- Spacing: 8 px base. Card inner padding 12 px, gap between cards 8 px (grid) or 10 px (stack), section body padding 12 px.
- Hero gradient on the host-built Turn summary only: `secondary @12%` into card colour at 135 deg.

## 2. Display panel (R1)

### Decision: one dock, two tabs (coexistence with agent-monitor-panel)

The monitor panel and the display panel share **one dock** on the right of the chat column. A segmented control at the
top of the dock switches `Displays (n)` and `Agents (n)`. A dot beside a tab means "new content in that tab", and the
tab label carries the count so the signal is not colour-only (R1.8).
Justification: R1.3 requires the chat column to stay at or above the overlay width when both are open; two side-by-side
panels cannot do that at 1280 px (300 + 300 + chat below 600). One dock keeps the chat at host width minus one panel,
reuses `PanelResizeService` (min 300 px, max 75%), and the user flips tabs instead of juggling two resizers.
Below 600 px host width the dock is an overlay sheet (`inset 0`) exactly like the monitor panel today; at most one
overlay is visible. The prototype shows all three states (`screen=dock`).

### Anatomy (top to bottom)

1. **Dock header** (padding 6x8 px, bottom border `bc @14%`): segmented tabs (pill, `--dp-well` track, selected tab =
   card colour + shadow), then right-aligned `pin` (toggle button, `aria-pressed`) and `close` (28 px square icon
   buttons, hover `--dp-well`). Closing a pinned panel unpins it (R1.6).
2. **Display strip** (only on the Displays tab): one pill per display, 28 px tall, max-width 180 px with ellipsis and
   full title in `title`/accessible name, horizontal scroll inside the strip only (this is a tablist, not content).
   Selected pill: card colour, strong border, 600 weight. New or updated display: 8 px gold dot with a 2-pulse ring
   (1.4 s, removed under `prefers-reduced-motion`; the dot stays) and the visually hidden text "new".
3. **Body** (padding 12, gap 10, vertical scroll): the selected display as a `section` card, or all displays stacked
   when the strip is collapsed at narrow widths (implementation choice: stack in order, host summary first).
4. **Resize separator** on the dock's left edge: 8 px hit area, 2x36 px grip, `role="separator"`
   `aria-orientation="vertical"` `aria-valuenow/min/max` (300 and 75% of the host in the prototype, 960 at a 1280 px window; same as `PanelResizeService`).
   Arrow keys move 16 px; Enter or double-click resets; hover/focus grows the grip to 56 px and brightens it.

### States

| State | Spec |
| --- | --- |
| Empty | Centered icon, "Nothing to show yet", one sentence on what appears here (turn summary after a turn, agent displays). Never blank. `screen=empty`, 440 and 300 px. |
| New display | Gold dot + ring on its pill, plus tab dot; panel scroll and focus are not moved when pinned (R1.6). |
| Closed by user, new content in same turn | Toggle shows a text badge "1 new" (accessible name "Displays, 1 new"). |
| Overlay | Sheet covers the chat; Escape closes it and returns focus to the opener. |

## 3. Layout kinds and atoms mapped to DaisyUI (R3, R4)

Grammar stays semantic; the renderer picks the markup. Mapping used in the prototype and to implement:

| Kind | Renderer markup | Notes |
| --- | --- | --- |
| `row` | `flex flex-row flex-wrap gap-2 items-center min-w-0` | wraps at narrow widths, children `min-w-0` |
| `col` | `flex flex-col gap-2 min-w-0` | |
| `grid` | CSS grid `repeat(auto-fit, minmax(min(100%, 128px), 1fr))`, gap 8 | `columns` hint only raises the minimum; panel-wide (container >= 700) uses 3 columns for stat grids |
| `card` | `.card`-style surface: card bg, border, rounded-box, shadow, rim | |
| `section` | card with header row (icon, title, subtitle, right slot) and collapsible body | header is a `button` with `aria-expanded`/`aria-controls`; open by default |
| `accordion` | card whose header toggles a body of any layout kind | closed by default (R4.6); DaisyUI `collapse` is avoided because it uses a hidden checkbox, see 7 |
| `stat` | card: label+icon, number+unit, trend pill, sparkline, chevron; detail region below | Expanded detail sits in a `--dp-well` panel |
| trend pill | DaisyUI `badge badge-sm` look, `--tint` background, `--txt` text, 1px inset ring; arrow icon up/down, never colour alone | semantic kinds: success, warning, error, info, neutral (an up-arrow can be bad, e.g. tokens up = warning) |
| `progress` | DaisyUI `progress` (6 px), fill = status fill, track `bc @16%`; always with a text percentage beside it | `aria-label` carries value |
| `badge` | DaisyUI `badge` pill, 12 px 600, leading 8 px status dot (pulse only while running) | text always present |
| `avatar` | 32 px circle, initials or icon, status dot 10 px bottom-right with 2 px card-colour ring | decorative (`aria-hidden`), name is in adjacent text |
| `note` | DaisyUI `alert`: tint background, 24% ring, leading icon, bold title, body text in `base-content` | info/success/warning/error; error uses `role="alert"`, others `role="note"` |

Status colours (derived once, reused everywhere): `--dp-{su,wa,er,in}-fill` (bars, dots), `-text` (pill and note text:
theme colour mixed toward `base-content` by 35% dark / 50% light, plus 25% fill mix in light), `-tint`
(theme colour 16% over `base-300`). See section 9 for the measured pairs.

## 4. Worked `$agents` display (R5)

`screen=agents` at 300 and 960 px. Section "Subagents", subtitle "display: agents - updated 8s ago", `Live` badge.
Summary band: eyebrow "3 agents - 1 running", total `184.2k tokens`, cost-trend pill, a 3-bar sparkline (tokens per agent,
latest agent highlighted), then pills `$0.32 total`, `1 running`, `1 failed`.

**Allowed fields only (R5.1, revision 2).** Each agent row shows exactly `name`, `status`, `tokens`, `cost`, `duration`.
There is no "Latest activity", no tool name or argument, no role or task text, no transcript, no stdout or error text.
Tool arguments are agent output and can carry paths or secrets, so they are not rendered anywhere in this display.
The previous "role" line is removed because `name` already carries the agent type.

Per agent (well card, collapsed by default, a toggle with `aria-expanded`):

- Collapsed head: avatar (initials, `aria-hidden`, status dot), `name` (wraps, never truncates), `N tokens` beneath, status badge
  (Running with pulsing dot, Done, Failed; `Pending` and `Stopped` from the R5.2 vocabulary use the neutral badge), chevron.
- Usage bar (row under the head): a DaisyUI `progress` plus a text percentage. **Definition: the agent's share of the turn's
  total tokens** (`agent tokens / sum of all rows' tokens`, rounded; shares sum to about 100). It is not a context-window
  figure and not a status. Its accessible name reads "code-explorer: 26 percent of the turn's tokens". The bar colour is the
  neutral info fill for every row so the bar never implies success or failure; status lives only in the badge. When a row's
  tokens are unavailable the bar and percentage are omitted, not shown as 0%.
- Expanded detail: a key-value list `Status`, `Tokens`, `Cost`, `Duration`, `Share of turn tokens` (for example "26% of 184.2k").
  Cost shows "unavailable" when the source says so.

**Narrow (300 px) subtitle (review defect 4).** The section subtitle no longer truncates. It wraps below the title
(`overflow-wrap:anywhere`) so "display: agents - updated 8s ago" is fully visible, and the full string is also the element's
`title`. The header button's accessible name is "Subagents, display: agents, updated 8s ago". Agent names wrap onto two lines
instead of clipping (see `agents-panel-narrow-300-*`).

Layout: one column at both widths (rows read better than cards for a ranked list); at panel-wide the usage bar stretches.

## 5. Turn summary (R6)

### In the panel (`screen=summary`, `screen=states`)

Host-built section, always first, `Host` pill with pin icon, hero gradient. Six stat cards: Files, Lines, Tokens, Cost,
Duration, Tests. Grid: 1 column at 300 px, 2 columns at roughly 400 to 699, 3 columns at >= 700
(`@container frame (min-width:700px)`), satisfying R9.6. A card with nothing to show (no files, no test command) is omitted,
not shown as zero (R6.4). Collapsed: label, number (+ unit), trend pill, sparkline. Expanded: detail in a `--dp-well` panel.
An expanded stat spans the full grid row; at container >= 700 it splits into a summary column (min 200 px, 38%) and the detail
column.

| Card | Expanded detail |
| --- | --- |
| Lines, Tokens, Cost, Duration | kv list or split bar (see prototype); Duration splits tools vs model |
| Files | "Files detail" below |
| Tests | "Tests detail" below |

**Files detail (parity: change-set card, parity-inventory section 2).** One row per file, in a well:

- Status letter badge (20 px: `A` added, `M` modified, `D` deleted, `R` renamed, `U` conflicted; each has an accessible name such
  as "Modified" and a tint, so colour is never the only signal).
- Path: directory muted (wraps), file name 600 (wraps, never truncated); `title` holds the full path.
- Rename origin: a second line "renamed from <old path>" (mono, wraps anywhere).
- Counts at the right: `+n` success text, `-n` error text; `binary` for binary files; `?` for null counts; "+0 -0" only when both are 0.
- Row actions (24 px pills wrapping under the path): `Open file` (`ChangeSetActionsService.openFile`) and `Review`
  ("Show in review"); a conflicted row adds `Resolve`. Each has an accessible name that includes the file name.
- Footer: `Review all` (the card's review action), "Show more (50 per page)" when more than 50 rows, and "+N more files not listed"
  (`truncatedCount`).
- Reconciled files: a native `<details>` group "No longer changes HEAD (n)" with neutral status badges.
- Action failure: an inline `role="alert"` line (error text with icon) inside the Files card, as today.

**R6.3 states** (all in `screen=states`, collapsed and expanded, 300 and 960):

| State | Treatment |
| --- | --- |
| `countsUnavailable` | Files and Lines show `?` with a neutral "counts unavailable" pill; detail says counts are unavailable |
| `baselineMissing` | warning pill "baseline missing" on the head, plus a warning `note` "May include changes made before this turn" at the top of the detail |
| `truncatedCount` | footer text "+N more files not listed" |
| null per-file counts | `?` in place of `+n -n`; binary shows `binary` |
| conflicted / reconciled | `U` badge, error-tinted "1 conflicted" pill, `Resolve` action; the Files card is forced open even in the collapsed state (parity: conflict forces expansion); reconciled rows are grouped and neutral |
| aborted or errored turn | warning pill "incomplete" on the head and a sentence in the detail |
| background test run | info pill "in background"; the run row reads "Running in background" |
| cost unavailable | Cost number reads "unavailable" with a neutral pill; a real 0 stays "$0.00" |

**Tests detail (parity: tests row, parity-inventory section 1).** A progress bar of the passed share, then one row per run:
outcome icon with an accessible name ("Passed", "Failed", "Running in background", "Unknown"), the run label (Nx project or
command, mono, wraps), an eyebrow line "Outcome - counts", up to 5 failure lines (error icon + mono text, wrapping anywhere), and
a native `<details>` "Full command" holding the exact command in a wrapping mono block. The head value and pill carry passed,
failed, running and unknown counts. The old tests row was expanded by default; the card is collapsed by default per R9.4.

### In chat

- **Turn summary chip** (collapsed, one line group): icon, "Turn summary", metric pills `7 files`, `+412`, `-96`,
  `2 failed`. They wrap under the title at chat-narrow rather than truncate (R9.6). Expanded: auto-fit mini cards
  (min 104 px) for Files, Lines, Tokens, Cost, Time, Tests and an "Open in panel" pill button. This replaces the
  Electron change-set card and tests row (decisions #5, #10); message footer badges stay (decision #6).
- **Display history chip** (decision #7): icon, title, `Live` badge (pulsing dot) or `Updated later` badge (dashed card
  border, neutral). Expanded: item counts and totals, an info `note` "A newer version exists" for superseded chips, and
  a button "Open in display" / "Open latest". No inline snapshot.

## 6. Command and file previews (R7, both webviews)

Shared by Bash, Read, Write and Edit; `screen=previews` at chat-narrow 360 and chat-wide 1024, collapsed and expanded, both
themes. Both webviews run the same Angular app and the same DaisyUI themes (`apps/ptah-extension-webview`), so one visual spec
covers Electron and VS Code; only the file-open mechanism differs (Electron dock viewer, VS Code `file:open`) and it has no visual
difference. The R7.8 review checks both hosts against these screenshots.

Card: card bg `base-200`, border, rim, collapsible. Header (collapsed height 36 px, the R7.9 baseline to beat): type icon, a wrapping
group, chevron, and for file tools a separate 28 px `Open <file>` icon button (a sibling of the toggle, since buttons cannot nest).

| Type | Header | Always visible | Expanded body |
| --- | --- | --- | --- |
| Bash | name; outcome pill with icon and text "succeeded", "failed" or "running" (icon has an accessible name, "Command succeeded, exit code 0"); duration | command row: `$`, mono command, `Copy command` icon button. Collapsed: one line with ellipsis, full text in `title`. Expanded: wraps | output block (ANSI stripped, wraps) height-limited to 9.6em with a fade; footer "Output: last 200 of 1,204 lines retained" (retention notice), `Show full output` / `Show less` toggle (`aria-expanded`), `Copy output` |
| Read | file name 600 + muted directory (full path in `title`), `Read` badge, open icon | none | meta bar: language label pill ("TypeScript"), "Lines 1-12 of 212"; highlighted content with line numbers, height-limited with `Show all lines`; `Copy content` |
| Write | path, `Write` badge, `+84` count, open icon | none | meta bar: language label, "New file - 84 lines"; highlighted, height-limited preview (first 11 of 84 lines, no 60-character truncation) with `Show all 84 lines`; `Copy content` |
| Edit | path, `Edit` badge, `+3 -1`, open icon | none | meta bar: language label, "1 replacement", "Lines 41-46"; diff with line-number gutter and a sign gutter (`+`/`-` glyph with aria-label "added"/"removed" plus row tint); long lines wrap |

Syntax highlight tokens use existing derived colours: keyword = info text, string = success text, comment = muted italic,
number = warning text. Contrast on the well is 6.36/6.76/7.43 (dark) and 6.04/5.68/5.74 (light), section 9. Code never scrolls
horizontally; it wraps with `overflow-wrap:anywhere`. Height-limited blocks are focusable (`tabindex=0`) with an aria-label naming
their content, and the clipped text remains in the accessibility tree. A pending permission forces a tool card open (parity).

## 7. Collapse and responsive mechanics (R9)

- Every R9 component uses one pattern: a header `<button>` with `aria-expanded`, `aria-controls`, 32 px minimum height
  (28 px inside dense headers), operable with Enter and Space; the hidden region is `inert` and `visibility:hidden` so it
  is not a tab stop or read. Escape handling (collapse and refocus the toggle) is an implementation requirement, not
  shown in the static prototype.
- Animation: `grid-template-rows 0fr -> 1fr`, 220 ms ease; chevron rotates 180 deg in 200 ms. Both are gated by
  `prefers-reduced-motion: no-preference`.
- Containers are queried, not viewports: `.frame` is `container-type:inline-size; container-name:frame`. Breakpoints:
  `chat-narrow` 360, `chat-wide` 1024, `panel-narrow` 300, `panel-wide` 960; component thresholds 420 px (labels
  collapse to icons on secondary buttons, agent detail indent drops) and 700 px (stat grid 3 columns, expanded stat splits).
- Width verification: the prototype contains a harness check (`?check=1`) that asserts, for every element, no
  visible-overflow scrollWidth beyond clientWidth, and root `scrollWidth <= clientWidth`. Result: all 48 screen x width x state x theme combinations (chat, previews, summary, states, agents, atoms; collapsed and expanded; dark and light) report no overflow, after fixes to the path rows, kv grid and diff wrapping. The real visual review should reuse the same assertion.

## 8. Accessibility

General: colour is never the only signal (every status has text, an icon shape or a glyph); sparklines and splits are `role="img"`
with text labels; avatars are `aria-hidden` next to the name; touch targets are 28 px for icon buttons and pills (24 px for dense
file-row actions, the WCAG 2.2 AA minimum) and 32 px for toggles; focus ring `2px solid base-content`, 2 px offset, 4 px `base-100`
halo. Reduced motion: pulse dot, new-display ring, chevron rotation and collapse transition are disabled; end states remain.

### Testable assertions

The prototype implements the interactive ones (open `screen=dock`, `previews`, `atoms`) and the measurable ones (`?check=1`, `?contrast=1`).

Collapsible (R9): every card, chip, accordion, preview, stat card and agent row.

1. The toggle is a `<button>` with `aria-expanded` matching state and `aria-controls` pointing at the region's id.
2. Collapsed: the region has `inert` and `visibility:hidden`, so no descendant is a tab stop or is read. Assert Tab never
   lands inside it and `region.matches(':focus-within')` is false.
3. Enter and Space on the toggle flip `aria-expanded` and set or remove `inert`; focus stays on the toggle.
4. Escape with focus inside an expanded component collapses it and moves focus to its toggle (assert
   `document.activeElement === toggle` and `aria-expanded="false"`). The prototype implements this.
5. An agent-written `accordion` renders collapsed on first paint: `atoms-panel-*-collapsed-*.png` shows "Release checklist" closed;
   the expanded capture shows it open. Expansion survives an in-place id update (R9.4).

Dock tablists (`Displays | Agents` and the display strip):

6. The container is `role="tablist"` with an `aria-label`; each tab is `role="tab"`, exactly one has `aria-selected="true"`, and each has
   `aria-controls` naming its panel; the panel is `role="tabpanel"` with `aria-labelledby` the active tab id.
7. Roving tabindex: the selected tab has `tabindex=0`, all others `-1`. Tab enters the list once and then leaves it for the panel.
8. ArrowRight and ArrowLeft move to the next or previous tab and wrap; Home goes to the first, End to the last. Selection follows
   focus (automatic activation): on arrow, Home or End the newly selected tab's controlled `tabpanel` is shown and every other
   panel of that tablist is hidden (`hidden`, so it is neither visible nor in the accessibility tree). The prototype implements
   this and `?selftest=1` asserts it (selected tab shows its panel, siblings hidden, focus on the new tab). Focus stays on the newly selected tab; the next Tab moves into the
   panel (the panel body is `tabindex=0`).
9. A tab with new content has a visually hidden "New: " prefix (the Agents tab adds ", 1 running"); the dot itself is `aria-hidden`.

Resize separator:

10. `role="separator"`, `aria-orientation="vertical"`, focusable, `aria-valuemin=300`, `aria-valuemax` = 75% of the host width (R1.5; 960 at a 1280 px host, which is the `panel-wide` width). The 600 px host width is only the overlay trigger from R1.2, not a second clamp,
    `aria-valuenow` the width, and `aria-valuetext="Panel width N pixels"` updated on every change so screen readers announce it.
11. ArrowLeft widens and ArrowRight narrows by 16 px (the separator is on the panel's left edge); Home sets the minimum, End the
    maximum; Enter or double-click resets to the default 400 px and updates `aria-valuenow` and `aria-valuetext`. Values clamp at the
    minimum and maximum. The prototype implements 10 and 11 on the `dock` screen.

Previews and rows:

12. "Show full output" and "Show all lines" toggles expose `aria-expanded` and swap their label to "Show less".
13. Open-file buttons have accessible names that include the file name; status badges have names ("Modified", "Conflicted").

## 9. Contrast (measured)

Criterion: WCAG 2.2 AA, 4.5:1 for text under 18 px, 3:1 for non-text UI and graphical objects. Measured in the prototype
(`?contrast=1`, canvas colour resolution, relative luminance):

| Pair | Dark | Light |
| --- | --- | --- |
| body text on card | 13.89 | 15.92 |
| muted text on card / dock / well | 5.65 / 6.05 / 5.00 | 6.04 / 5.39 / 5.39 |
| success text on its tint / on card | 5.47 / 7.64 | 4.78 / 6.37 |
| warning text on its tint / on card | 5.84 / 8.40 | 4.83 / 6.43 |
| error text on its tint / on card | 4.60 / 6.07 | 5.66 / 7.96 |
| info text on its tint / on card | 5.25 / 7.18 | 5.00 / 6.76 |
| success/warning/error/info fill vs card (3:1) | 5.25 / 6.18 / 3.59 / 4.71 | 3.85 / 3.89 / 5.28 / 4.17 |
| syntax keyword / string / number text on well | 6.36 / 6.76 / 7.43 | 6.04 / 5.68 / 5.74 |
| highlight bar vs card (3:1) | 8.24 | 4.11 |
| dim bar vs card (decorative, not relied on) | 1.60 | 1.38 |

All text pairs >= 4.5, all informational non-text pairs >= 3. The raw theme `success`/`warning`/`error` colours fail as
light-theme text, which is why the derived `-text` and (light only) `-fill` mixes exist; implementation must use the
derived tokens, not `text-success`.

## 10. Decisions

1. One dock with Displays/Agents tabs instead of two panels (section 2). Reason: R1.3.
2. Stat cards expand in place and span the full row; at >= 700 px they split into summary and detail columns.
3. Derived `--dp-*` tokens (renderer-only, defined once on the display root) rather than DaisyUI `text-success` etc., for
   light-theme contrast (section 9).
4. DaisyUI `collapse` is not used for R9 components: its checkbox/`:focus` mechanism cannot give the required
   `aria-expanded`, Escape-to-refocus and `inert` semantics. DaisyUI is still used for `badge`, `progress`, `alert`, `avatar`, `btn`.
5. Prototype note: the prototype CDN DaisyUI 4.12 defines `.stat` and `.hero`; the prototype renames its own classes. The real
   renderer must namespace its classes (`dp-*`) or it will collide with the DaisyUI component classes of the same name.
6. Code in previews wraps; no horizontal scroll anywhere (R9.5).
7. Sparkline highlight uses the theme `secondary` (gold) in both themes, error fill for failing series.
8. Revision 2: `$agents` rows expose only the R5 fields; the usage bar is the agent's share of the turn's total tokens, drawn in a neutral fill (status is the badge's job).
9. Revision 2: one visual spec for both webviews (same app and theme tokens); previews cover Bash, Read, Write and Edit.
10. Revision 2: R6.3 states have their own screen (`states`) instead of being implied by the happy path.

## Revision 3 note (requirements rev 3, decisions.md #11-#15) [rev 3]

Added after Gate 1.7 approval. No new component, token or colour; the approved visuals are unchanged except item 1.

1. **Sparkline highlight (#12).** The user chose theme `primary`. This overrides decision 7 and the `--dp-hl`
   value in section 1 (gold). A failing series keeps the error fill. Open Question 1 is resolved; Open Question 2 is
   resolved as "keep the warm tint" (#13).
2. **Agents tab (#11).** The Agents tab always controls a `role="tabpanel"`; with no agents it shows "No agents in
   this session" (R1.13).
3. **`$agents` `context` field (R5.10).** It is a row in the agent's expanded key-value list (section 4), labelled
   `Context`, with values such as "50,000 tokens - 25% of window", "50,000 tokens" (window unknown) or "unavailable".
   It is a different figure from the usage bar (share of tokens), which stays as specified.
4. **`$agents session` (R5.11).** Same layout as section 4. The section subtitle names the scope ("display: agents -
   session"), and the usage bar is the share of the listed rows' total tokens.
5. **`$limits` (R10).** It renders through the existing `table` and `stat` atoms; no new visual. The "as of" time is
   the surface description text.

## Lane-introduced constraints

Mirrors `prototype/README.md`. All are `[lane-proposed]`; none removes an existing component.

- `[lane-proposed]` Single dock, tabs `Displays | Agents`, one resizer.
- `[lane-proposed]` Derived `--dp-*` colour tokens for status text and fills.
- `[lane-proposed]` Stat grid breakpoints 128 px min column, 700 px for 3 columns and the split expanded stat.
- `[lane-proposed]` Class namespace `dp-` for all renderer classes.
- `[lane-proposed]` Usage bar on an agent row means share of the turn's total tokens (neutral fill).
- `[lane-proposed]` Tab semantics: automatic activation, wrapping arrows, Home/End (assertions 6-9).
- `[lane-proposed]` Separator keys: arrows 16 px, Home/End min/max, Enter or double-click resets to 400 px.

## Open Questions for the User

1. Sparkline highlight colour: gold (`secondary`, matches the brand and the reference's single accent) or the theme
   primary (blue in dark, teal in light)? Recommended: gold. Taste only, one token.
2. Hero gradient on the Turn summary section: keep the warm tint (recommended, it marks the host-owned card) or flat card colour?
